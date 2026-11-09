# 核心审阅集

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

从[一页地图](../spec-map.md)进入；21个承重审阅项中的组合动作逐接口展开，每个接口示例只出现一次。其余raw_answer/C类/配额风险接口也必须审，支撑件合并为[抽检附录](generated/endpoints.md)。

| 项 | 承重项 | 端点 |
|---|---|---|
| 1 | 批次启动与执行 | [probe_batch.start](core-set.md#probe_batchstart) / [probe_batch.execute](core-set.md#probe_batchexecute) |
| 2 | 失败整批补偿 | [probe_batch.compensate](core-set.md#probe_batchcompensate) |
| 3 | 采样配置冻结 | [scoring_snapshot.freeze](core-set.md#scoring_snapshotfreeze) |
| 4 | 问句冻结与锚定升级 | [question_pool.freeze](core-set.md#question_poolfreeze) / [question_pool.upgrade_anchor](core-set.md#question_poolupgrade_anchor) |
| 5 | 簇级出数与不可比 | [cluster_score.read](core-set.md#cluster_scoreread) / [cluster_score.compare](core-set.md#cluster_scorecompare) |
| 6 | 判定写入 | [probe_result.judge](core-set.md#probe_resultjudge) |
| 7 | 块创建 | [claim_block.create](core-set.md#claim_blockcreate) |
| 8 | 块新版本修订 | [claim_block.revise](core-set.md#claim_blockrevise) |
| 9 | 块提交 | [claim_block.submit](core-set.md#claim_blocksubmit) |
| 10 | 块放行 | [claim_block.approve](core-set.md#claim_blockapprove) |
| 11 | 块撤回下线 | [claim_block.retract](core-set.md#claim_blockretract) |
| 12 | 通用队列放行 | [review_queue.approve](core-set.md#review_queueapprove) |
| 13 | 通用队列驳回 | [review_queue.reject](core-set.md#review_queuereject) |
| 14 | 资产三态迁移 | [content_asset.transition](core-set.md#content_assettransition) / [publish_registration.register](core-set.md#publish_registrationregister) / [content_asset.retire](core-set.md#content_assetretire) |
| 15 | 发布登记 | [publish_registration.register](core-set.md#publish_registrationregister) |
| 16 | 诊断原文摘录·异议链 | [diagnosis_report.excerpt](core-set.md#diagnosis_reportexcerpt) |
| 17 | 异议授权 | [objection.grant](core-set.md#objectiongrant) |
| 18 | 异议发起调阅 | [objection.view](core-set.md#objectionview) |
| 19 | 令牌撤销 | [api_token.revoke](core-set.md#api_tokenrevoke) |
| 20 | 回流派单 | [backflow_ticket.assign](core-set.md#backflow_ticketassign) |
| 21 | 官方口径读取·judge唯一比对基准 | [official_fact.read](core-set.md#official_factread) |

### probe_batch.start

`POST /internal/probe-batches/{id}/start` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行：`(role, probe_batch, start)`。审阅风险：quota。

校验：start仅pending，其余仅running；completed/failed/cancelled终态。

审计：probe_batch.start。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "bt2",
    "status": "running"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.execute

`POST /internal/probe-batches/{id}/execute` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行：`(role, probe_batch, execute)`。审阅风险：raw_answer / quota。

校验：probe所属running batch；全文按不可信数据；禁止当作指令；完整citation元数据/正文URL归一化抽取，不丢路径；probe与result均属路径指定batch，running状态、完整尝试号及冻结锚定校验；原probe.append与probe_result.append合并为一个服务层原子写入口。

审计：probe_result.append。副作用：先生成/关联probe再追加回答，按batch/attempt留痕，未改变原始结果存储或失败补偿规则。

请求JSON（另带Idempotency-Key）：

```json
{
  "probe": {
    "batch_id": "bt1",
    "cluster_id": "c1",
    "question_id": "q1",
    "model": "T14待核实",
    "temperature": 0,
    "round": 1,
    "attempt_no": 1
  },
  "result": {
    "probe_id": "p1",
    "refused": false,
    "raw_answer": "官方API返回数据",
    "cited_domains": [
      "example.com"
    ],
    "cited_urls": [
      "https://example.com/article"
    ]
  }
}
```

响应JSON：

```json
{
  "data": {
    "id": "r1"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.compensate

`POST /tenants/{tid}/probe-batches/{id}/compensate` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行：`(role, probe_batch, compensate)`。审阅风险：quota。

校验：仅failed；整批补偿；新batch同配置，禁止局部补跑。

审计：probe_batch.compensate。副作用：原批次保留dead-letter及告警；新批次全量执行；完整复制原批次范围/锚定清单，禁止混入旧批次部分成功结果。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "失败整批重跑"
}
```

响应JSON：

```json
{
  "data": {
    "original_batch_id": "bt2",
    "new_batch_id": "bt3",
    "status": "pending"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### scoring_snapshot.freeze

`POST /tenants/{tid}/scoring-snapshots/{id}/freeze` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行：`(role, scoring_snapshot, freeze)`。审阅风险：quota。

校验：执行前冻结；模型温度轮次judge接地不变；问句由簇锚定；system仅受控模型/判定/轨道变更事件可创建冻结新配置，不能改已有冻结配置。

审计：scoring_snapshot.freeze。副作用：此后换配置开新snapshot，不因复测新建配置。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "snapshot_id": "snp1",
    "frozen": true
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.freeze

`POST /tenants/{tid}/brands/{bid}/question-pools/versions/{version}/freeze` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, question_pool, freeze)`。审阅风险：C_data。

校验：版本open→frozen；校验版本内各问句五字段；冻结整个引用版本原文集合，不只冻单条。

审计：question_pool.freeze。副作用：改动只能新版本，不重写旧问句。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1"
}
```

响应JSON：

```json
{
  "data": {
    "question_pool_version": 1,
    "frozen": true
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.upgrade_anchor

`POST /tenants/{tid}/brands/{bid}/question-pools/upgrade-anchor` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, question_pool, upgrade_anchor)`。审阅风险：C_data。

校验：Strategist human显式动作；未锚定簇首次入测写锚，已锚定簇只有人工升级/拆并可改；同版本校验ID集合，跨版本重开基线。

审计：intent_cluster.upgrade。副作用：原anchor与upgrade两个入口合并；不动其他簇锚定；旧结果保留不可比。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "question_pool_version": 2,
  "reason": "人工升级问句",
  "question_ids": [
    "q4",
    "q5",
    "q6"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "cluster_id": "c1",
    "question_pool_version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### cluster_score.read

`GET /tenants/{tid}/brands/{bid}/cluster-scores/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, cluster_score, read)`。审阅风险：承重动作。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文；question_scores节仅原question_score.read的内部五角色可见，客户不因父资源可读而新增问句级权限。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "cluster_id": "c1",
    "snapshot_id": "snp1",
    "blank_score": null,
    "n_valid": 8,
    "model_coverage": 2,
    "insufficient_sample": true,
    "question_scores": [
      {
        "question_id": "q1",
        "n_valid": 24
      }
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### cluster_score.compare

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/compare` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / owner / viewer / editor；system：无。权限行：`(role, cluster_score, compare)`。审阅风险：承重动作。

校验：同snapshot_id+同簇同锚定版本+question_id集合一致；否则422 incomparable无delta。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "baseline_batch_id": "bt1",
  "retest_batch_id": "bt2",
  "cluster_id": "c1"
}
```

响应JSON：

```json
{
  "data": {
    "baseline_batch_id": "bt1",
    "retest_batch_id": "bt2",
    "delta": {
      "mention_rate": 0.1
    }
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_result.judge

`POST /tenants/{tid}/brands/{bid}/probe-results/{id}/judgments` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：judge。权限行：`(role, probe_result, judge)`。审阅风险：quota。

校验：judging-spec先人审冻结；refused排除所有分母；样例不定义判定算法；输入必须读取已审历史lexicon_version与L1 approved官方口径；被指定口径retract即拒绝，缺基准error_i=null；不得替换为latest或claim_block。

审计：probe_result.judge。副作用：保留判定审计；已出分需重新判定则换judge配置与基线；job及审计记录lexicon_version、official_fact_ids；不覆盖历史判定与聚合。

请求JSON（另带Idempotency-Key）：

```json
{
  "blank_i": 0,
  "error_i": 0,
  "generic_i": 0.5,
  "competitor_i": 0,
  "spec_score": 3,
  "note": "人工示例",
  "batch_id": "bt1",
  "lexicon_version": 1,
  "official_fact_ids": [
    "f1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "r1",
    "judged": true,
    "lexicon_version": 1,
    "official_fact_ids": [
      "f1"
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.create

`POST /tenants/{tid}/brands/{bid}/claim-blocks` · 语义 draft · destructive=false · 幂等=24h

权限候选：editor / content；system：无。权限行：`(role, claim_block, create)`。审阅风险：承重动作。

校验：L3不得入库；四问字段及来源非空；作者留痕。

审计：claim_block.create。副作用：草稿不进waiting，submit才进队列。

请求JSON（另带Idempotency-Key）：

```json
{
  "content_asset_id": "a1",
  "text": "示例事实及边界",
  "number": "10",
  "unit": "天",
  "scope": "示例适用边界",
  "source_url": "https://example.com/facts",
  "source_level": "L1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "version": 1,
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.revise

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：editor / content；system：无。权限行：`(role, claim_block, revise)`。审阅风险：承重动作。

校验：作者本人；新版本号及新行；保留旧版；retracted→draft由新行承接。

审计：claim_block.revise。副作用：重算asset ready；不因修订降低registered。

请求JSON（另带Idempotency-Key）：

```json
{
  "content_asset_id": "a1",
  "text": "示例事实及边界",
  "number": "10",
  "unit": "天",
  "scope": "示例适用边界",
  "source_url": "https://example.com/facts",
  "source_level": "L1",
  "reason": "修订事实"
}
```

响应JSON：

```json
{
  "data": {
    "id": "cl2",
    "version": 2,
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.submit

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/submit` · 语义 write · destructive=false · 幂等=24h

权限候选：editor / content；system：无。权限行：`(role, claim_block, submit)`。审阅风险：承重动作。

校验：作者；draft；四问、L1/L2、整篇必配与自包含校验；judging-spec未冻结不实现正则。

审计：claim_block.submit。副作用：创建waiting队列条目，通知FactCheck。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "status": "pending_review",
    "review_entry_id": "rv1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.approve

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, claim_block, approve)`。审阅风险：承重动作。

校验：仅pending_review，waiting队列条目未结算；FactCheck≠作者；L3禁入、四问与必配校验通过。

审计：claim_block.approve。副作用：approve/reject原子结算队列；retract追同源块并重算asset。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "status": "approved"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.retract

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/retract` · 语义 write · destructive=true · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, claim_block, retract)`。审阅风险：承重动作。

校验：仅approved；reason与说错工单必填；FactCheck执行下线。

审计：claim_block.retract。副作用：approve/reject原子结算队列；retract追同源块并重算asset；registered→ready后按必配条件继续ready→draft，同事务同cause逐跳审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "事实错误",
  "ticket_id": "tk1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "status": "retracted"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### review_queue.approve

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, review_queue, approve)`。审阅风险：承重动作。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人；品牌词表版本或官方口径同样检查创建者，不能封自己版本。

审计：review_queue.approve。副作用：原子修改对象态及队列终态；无通用裸状态update；lexicon批准即新版本生效，official_fact批准即approved；保留旧批次引用版本。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "rv1",
    "status": "approved"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### review_queue.reject

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, review_queue, reject)`。审阅风险：承重动作。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人。

审计：review_queue.reject。副作用：原子修改对象态及队列终态；无通用裸状态update。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "证据不足"
}
```

响应JSON：

```json
{
  "data": {
    "id": "rv1",
    "status": "rejected"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### content_asset.transition

`POST /internal/content-assets/{id}/transition` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：content_reconcile。权限行：`(role, content_asset, transition)`。审阅风险：承重动作。

校验：按§3裁定派生；绝不让人工直接指定目标状态；只允许本资源状态表命名事件，不接受任意status裸更新。

审计：content_asset.reconcile。副作用：同事务先事件降一级再派生重算、逐跳同cause审计；非必配retract且必配条件成立停ready；无registered→draft直达。

请求JSON（另带Idempotency-Key）：

```json
{
  "trigger_claim_id": "cl1",
  "cause_event_id": "evt-retract-1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "a1",
    "review_status": "draft",
    "audited_transitions": [
      "registered→ready",
      "ready→draft"
    ],
    "cause_event_id": "evt-retract-1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### publish_registration.register

`POST /tenants/{tid}/brands/{bid}/publish-registrations` · 语义 write · destructive=false · 幂等=24h

权限候选：editor；system：无。权限行：`(role, publish_registration, register)`。审阅风险：承重动作。

校验：full本品牌；ready且全部当前必配块approved；仅记录不验证远端URL。

审计：publish_registration.register。副作用：排D+3/14/30；重新登记更新URL/时间，旧历史audit；不代发。

请求JSON（另带Idempotency-Key）：

```json
{
  "content_asset_id": "a1",
  "url": "https://example.com/article",
  "published_at": "2026-11-09T00:00:00Z",
  "platform": "官网"
}
```

响应JSON：

```json
{
  "data": {
    "id": "pub1",
    "status": "registered",
    "content_asset_status": "registered"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### content_asset.retire

`POST /tenants/{tid}/brands/{bid}/content-assets/{id}/retire` · 语义 write · destructive=true · 幂等=24h

权限候选：strategist / owner；system：无。权限行：`(role, content_asset, retire)`。审阅风险：承重动作。

校验：human；draft/ready/registered→retired；retired不可逆。

审计：content_asset.retire。副作用：如需复活新建asset，挂同机会卡。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "人工下线"
}
```

响应JSON：

```json
{
  "data": {
    "id": "a1",
    "review_status": "retired"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### diagnosis_report.excerpt

`GET /tenants/{tid}/brands/{bid}/objections/{id}/excerpt` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / viewer / cs；system：无。权限行：`(role, diagnosis_report, excerpt)`。审阅风险：raw_answer。

校验：仅POST已建会话，申请人本人或发起CS；24h内只读查看；每次GET留审计但不改状态；禁下载/批量；诊断/证据结论的通用异议链投影，仍沿conclusion_ref校验；沿用原objection.excerpt路径，不新增直读raw_answer能力。

审计：objection.excerpt。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "viewing_session_id": "vs1"
}
```

响应JSON：

```json
{
  "data": {
    "probe_id": "p1",
    "excerpt": "水印单条摘录",
    "watermark_meta": {
      "viewer_user_id": "u1",
      "at": "2026-11-09T00:00:00Z"
    }
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### objection.grant

`POST /tenants/{tid}/brands/{bid}/objections/{id}/grant` · 语义 write · destructive=false · 幂等=24h

权限候选：cs / factcheck；system：无。权限行：`(role, objection, grant)`。审阅风险：raw_answer。

校验：submitted；CS处理，敏感升级FactCheck；必须记录处理人/时间。

审计：objection.approve。副作用：granted不返回原文或开启客户直接读raw权限。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "复核处理说明"
}
```

响应JSON：

```json
{
  "data": {
    "id": "ob1",
    "status": "granted"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### objection.view

`POST /tenants/{tid}/brands/{bid}/objections/{id}/view` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行：`(role, objection, view)`。审阅风险：raw_answer。

校验：CS账号发起；granted→viewed；session唯一且同异议probe只一次；客户仅只读查看器。

审计：objection.view。副作用：审计CS/调阅人/时间/session；24h会话；查看器水印。

请求JSON（另带Idempotency-Key）：

```json
{
  "viewing_session_id": "vs1",
  "viewer_user_id": "u1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "ob1",
    "status": "viewed",
    "viewing_session_id": "vs1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### api_token.revoke

`POST /tenants/{tid}/api-tokens/{id}/revoke` · 语义 write · destructive=true · 幂等=24h

权限候选：admin；system：无。权限行：`(role, api_token, revoke)`。审阅风险：quota。

校验：显式撤销，重复幂等；撤销后不允许请求。

审计：api_token.revoke。副作用：写revoked_at，不删除审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "撤销凭证"
}
```

响应JSON：

```json
{
  "data": {
    "revoked_at": "2026-11-09T00:00:00Z"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.assign

`POST /tenants/{tid}/brands/{bid}/backflow-tickets/{id}/assign` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行：`(role, backflow_ticket, assign)`。审阅风险：承重动作。

校验：open→assigned；受理人任务授权内。

审计：backflow_ticket.assign。副作用：通知责任人。

请求JSON（另带Idempotency-Key）：

```json
{
  "assigned_user_id": "u2",
  "owner_role": "content"
}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "assigned"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### official_fact.read

`GET /tenants/{tid}/brands/{bid}/official-facts` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：judge。权限行：`(role, official_fact, read)`。审阅风险：judge_input。

校验：judge只读同品牌L1、approved且effective_from已到期的指定口径；请求含retracted/draft/缺失基准则422 validation_failed且error_i=null，不以其他资料替代。

审计：普通只读无业务审计。副作用：error唯一比对基准；人工内部读取可按权限查看审核元数据，judge不可引用retracted。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "fact_ids": [
    "f1"
  ],
  "as_of": "2026-11-09T00:00:00Z",
  "cursor": null,
  "limit": 20
}
```

响应JSON：

```json
{
  "data": {
    "items": [
      {
        "id": "f1",
        "tenant_id": "t1",
        "brand_id": "b1",
        "fact_category": "price",
        "content": "示例官方价格口径，非产品承诺",
        "source_level": "L1",
        "status": "approved",
        "effective_from": "2026-01-01T00:00:00Z"
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### tenant.read

`GET /tenants/{tid}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行：`(role, tenant, read)`。审阅风险：quota。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "t1",
    "mode": "full"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### tenant.configure

`POST /tenants/{tid}/configure` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行：`(role, tenant, configure)`。审阅风险：quota。

校验：合同范围内配置；禁止借此改业务状态。

审计：tenant.configure。副作用：配置审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "name": "示例租户",
  "mode": "full",
  "plan": "contract_ref"
}
```

响应JSON：

```json
{
  "data": {
    "id": "t1",
    "mode": "full"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### keyword_raw.read

`GET /tenants/{tid}/keyword-imports` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs；system：无。权限行：`(role, keyword_raw, read)`。审阅风险：C_data。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "cursor": null,
  "limit": 20
}
```

响应JSON：

```json
{
  "data": {
    "items": [
      {
        "id": "k1",
        "channel": "B"
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### keyword_raw.import

`POST /tenants/{tid}/keyword-imports` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：c_import。权限行：`(role, keyword_raw, import)`。审阅风险：C_data。

校验：C先书面授权、自动脱敏；B人工/半自动CSV；四渠道枚举。

审计：keyword_raw.import。副作用：归一化、去重；只存指数不存绝对搜索次数。

请求JSON（另带Idempotency-Key）：

```json
{
  "channel": "C",
  "authorization_ref": "auth1",
  "csv_ref": "upload1"
}
```

响应JSON：

```json
{
  "data": {
    "added": 1,
    "duplicate": 0,
    "rejected": 0
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### keyword_raw.read_raw

`GET /tenants/{tid}/keywords/{id}/raw` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, keyword_raw, read_raw)`。审阅风险：C_data。

校验：仅授权C数据或公开源的关联任务，服务端审计，不含已删除数据。

审计：keyword_raw.read_raw。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "k1",
    "redacted_payload": "已脱敏示例"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.read

`GET /tenants/{tid}/brands/{bid}/question-pools/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, question_pool, read)`。审阅风险：C_data。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "q1",
    "question_pool_version": 1,
    "frozen": true
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### scoring_snapshot.read

`GET /tenants/{tid}/scoring-snapshots/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, scoring_snapshot, read)`。审阅风险：quota。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "snapshot_id": "snp1",
    "judge_version": "rule_manual_v1",
    "grounding_mode": "search_on"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.create

`POST /tenants/{tid}/brands/{bid}/question-pools` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, question_pool, create)`。审阅风险：C_data。

校验：五溯源非空，source_word_id指keyword_raw；intent_type六类；不得凭空造测量题。

审计：question_pool.create。副作用：无业务副作用。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "question": "排产怎么选？",
  "source_word_id": "k1",
  "intent_type": "选型对比",
  "source_channel": "B",
  "collected_at": "2026-11-09T00:00:00Z",
  "maintainer": "张三",
  "question_pool_version": 1
}
```

响应JSON：

```json
{
  "data": {
    "id": "q1",
    "frozen": false
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.revise

`POST /tenants/{tid}/brands/{bid}/question-pools/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, question_pool, revise)`。审阅风险：C_data。

校验：复用五溯源字段并重新校验；旧记录只读。

审计：question_pool.revise。副作用：不自动更改簇锚定。

请求JSON（另带Idempotency-Key）：

```json
{
  "question_pool_version": 2,
  "reason": "人工升级",
  "question": "自动排产适合谁？"
}
```

响应JSON：

```json
{
  "data": {
    "id": "q4",
    "question_pool_version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_pool.archive

`POST /tenants/{tid}/brands/{bid}/question-pools/versions/{version}/archive` · 语义 write · destructive=true · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, question_pool, archive)`。审阅风险：C_data。

校验：frozen→archived；停止新锚定，不得删除/改动已锚定版本原文。

审计：question_pool.archive。副作用：仅停止新锚定，历史继续可读取。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "版本退役"
}
```

响应JSON：

```json
{
  "data": {
    "id": "q1",
    "state": "archived"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### scoring_snapshot.create

`POST /tenants/{tid}/scoring-snapshots` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行：`(role, scoring_snapshot, create)`。审阅风险：quota。

校验：示例model_set是占位，不可执行；T14定具体ID；区分配置与批次；system仅受控模型/判定/轨道变更事件可创建冻结新配置，不能改已有冻结配置。

审计：scoring_snapshot.create。副作用：配置草稿，不直接发探针。

请求JSON（另带Idempotency-Key）：

```json
{
  "model_set": [
    "T14待核实"
  ],
  "temperature_set": [
    0,
    0.7
  ],
  "rounds": 3,
  "judge_version": "rule_manual_v1",
  "grounding_mode": "search_on"
}
```

响应JSON：

```json
{
  "data": {
    "snapshot_id": "snp1",
    "frozen": false
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_result.read_raw

`GET /tenants/{tid}/brands/{bid}/probe-results/{id}/raw-answer` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, probe_result, read_raw)`。审阅风险：raw_answer。

校验：内部租户级或任务关联对象级；每次审计，不提供列表/导出。

审计：probe_result.read_raw。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "probe_id": "p1",
    "raw_answer": "受限单条示例"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_result.access

`POST /tenants/{tid}/brands/{bid}/probe-results/{id}/admin-access` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行：`(role, probe_result, access)`。审阅风险：raw_answer。

校验：Admin默认deny；本次显式调阅必填理由+审计；不授予永久read_raw。

审计：probe_result.access。副作用：单条理由调阅留痕，不改变业务判定。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "排查指定数据故障"
}
```

响应JSON：

```json
{
  "data": {
    "probe_id": "p1",
    "raw_answer": "受限单条示例"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### audit_log.read

`GET /tenants/{tid}/audit-logs` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行：`(role, audit_log, read)`。审阅风险：raw_answer。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "cursor": null,
  "limit": 20
}
```

响应JSON：

```json
{
  "data": {
    "items": [
      {
        "action": "probe.raw_access",
        "actor_type": "human"
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### api_token.read

`GET /tenants/{tid}/api-tokens` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行：`(role, api_token, read)`。审阅风险：quota。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "cursor": null,
  "limit": 20
}
```

响应JSON：

```json
{
  "data": {
    "items": [
      {
        "id": "tok1",
        "scopes": [
          "metric_snapshot.read"
        ],
        "created_at": "2026-11-09T00:00:00Z",
        "last_used_at": null,
        "revoked_at": null
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### probe_batch.read

`GET /tenants/{tid}/probe-batches/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, probe_batch, read)`。审阅风险：quota。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文；Content/Evidence仅能请求probes投影并按所分派机会卡/簇/来源过滤，不获得批次完整配置/其他任务探针；probe仅batch内查询。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{
  "include": "probes"
}
```

响应JSON：

```json
{
  "data": {
    "id": "bt1",
    "type": "baseline",
    "snapshot_id": "snp1",
    "status": "pending",
    "probes": [
      {
        "id": "p1",
        "batch_id": "bt1",
        "model": "T14待核实"
      }
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### audit_log.append

`POST /internal/audit-logs/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：audit_middleware。权限行：`(role, audit_log, append)`。审阅风险：raw_answer。

校验：仅服务层审计中间件；不允许人类/Agent提交伪造审计；job_name必须注册表枚举；探针类batch必填，非探针可null且trigger_source与对象必填；audit_middleware继承调用者actor。

审计：audit_log.append。副作用：只追加，禁止更新/删除；敏感访问也记录。

请求JSON（另带Idempotency-Key）：

```json
{
  "actor_type": "system",
  "action": "probe_execute",
  "object_type": "probe_batch",
  "object_id": "bt1",
  "job_name": "probe_execute",
  "batch_id": "bt1",
  "agent_run_id": null,
  "prompt_version": null,
  "trigger_source": {
    "event_id": "evt1"
  }
}
```

响应JSON：

```json
{
  "data": {
    "recorded": true
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_package.create

`POST /tenants/{tid}/brands/{bid}/evidence-packages` · 语义 draft · destructive=false · 幂等=24h

权限候选：evidence；system：无。权限行：`(role, evidence_package, create)`。审阅风险：raw_answer。

校验：任务关联；作者created_by留痕；条目随父包草稿或新版提交，同原evidence_item.create作者与draft约束；不再提供独立条目接口族。

审计：evidence_package.create。副作用：无业务副作用。

请求JSON（另带Idempotency-Key）：

```json
{
  "brand_id": "b1",
  "items": [
    {
      "conclusion_text": "结论示例",
      "probe_id": "p1",
      "source_level": "L1",
      "excerpt": "受限单条摘录"
    }
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "ev1",
    "version": 1,
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_package.revise

`POST /tenants/{tid}/brands/{bid}/evidence-packages/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：evidence；system：无。权限行：`(role, evidence_package, revise)`。审阅风险：raw_answer。

校验：新行，新version；sealed不可变；条目随父包草稿或新版提交，同原evidence_item.create作者与draft约束；不再提供独立条目接口族。

审计：evidence_package.revise。副作用：旧版保留；新队列重新审核。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "补充证据",
  "items": [
    {
      "conclusion_text": "结论示例",
      "probe_id": "p1",
      "source_level": "L1",
      "excerpt": "受限单条摘录"
    }
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "ev2",
    "version": 2,
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### api_token.create

`POST /tenants/{tid}/api-tokens` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行：`(role, api_token, create)`。审阅风险：quota。

校验：per-user；scopes与该用户权限相交；只存token_hash，日志不含明文。

审计：api_token.create。副作用：创建令牌；不引入MCP能力。

请求JSON（另带Idempotency-Key）：

```json
{
  "user_id": "u1",
  "scopes": [
    "metric_snapshot.read"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "token": "仅此一次展示的占位令牌",
    "created_at": "2026-11-09T00:00:00Z"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.create

`POST /tenants/{tid}/probe-batches` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行：`(role, probe_batch, create)`。审阅风险：quota。

校验：冻结配置；事件3目标+3对照，锚定版本未变；baseline/event/monthly；保存各簇锚定清单，执行/比较不得读取最新池替代该清单。

审计：probe_batch.create。副作用：独立batch_id；复测共用snapshot，probe_result可追加；判定开始时记录该批次lexicon_version，后续新版词表不改旧批次解释。

请求JSON（另带Idempotency-Key）：

```json
{
  "type": "event",
  "snapshot_id": "snp1",
  "scheduled_at": "2026-11-12T00:00:00Z",
  "cluster_ids": [
    "c1",
    "c2",
    "c3",
    "c4",
    "c5",
    "c6"
  ],
  "cluster_question_sets": [
    {
      "cluster_id": "c1",
      "question_pool_version": 1,
      "question_ids": [
        "q1",
        "q2",
        "q3"
      ]
    }
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "bt2",
    "status": "pending",
    "snapshot_id": "snp1"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.cancel

`POST /tenants/{tid}/probe-batches/{id}/cancel` · 语义 write · destructive=true · 幂等=24h

权限候选：cs；system：无。权限行：`(role, probe_batch, cancel)`。审阅风险：quota。

校验：仅pending；其他状态409。

审计：probe_batch.cancel。副作用：终态保留不覆盖。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "排期撤销"
}
```

响应JSON：

```json
{
  "data": {
    "id": "bt2",
    "status": "cancelled"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.complete

`POST /internal/probe-batches/{id}/complete` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行：`(role, probe_batch, complete)`。审阅风险：quota。

校验：start仅pending，其余仅running；completed/failed/cancelled终态。

审计：probe_batch.complete。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "bt2",
    "status": "completed"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.fail

`POST /internal/probe-batches/{id}/fail` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行：`(role, probe_batch, fail)`。审阅风险：quota。

校验：start仅pending，其余仅running；completed/failed/cancelled终态；整批尝试编号/结果提交草案：≤3次整批重试，成功只选完整一次尝试，不合并多次部分结果。

审计：probe_batch.fail。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "bt2",
    "status": "failed"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### offboarding.execute

`POST /tenants/{tid}/offboarding` · 语义 write · destructive=true · 幂等=24h

权限候选：admin；system：offboarding。权限行：`(role, offboarding, execute)`。审阅风险：raw_answer / C_data。

校验：显式解约；删除C类原文及raw_answer；合同可另定保留期。

审计：offboarding.execute。副作用：30天内删C原文/raw_answer，保留聚合及audit；2年在线后只读冷归档，不自动删；显式清理另走cleanup并独立ledger。

请求JSON（另带Idempotency-Key）：

```json
{
  "contract_ref": "contract1",
  "reason": "合同解除"
}
```

响应JSON：

```json
{
  "data": {
    "id": "off1",
    "delete_within_days": 30,
    "retention_years": 2,
    "after_online_window": "readonly_cold_archive"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### offboarding.cleanup

`POST /tenants/{tid}/offboarding/{id}/cleanup` · 语义 write · destructive=true · 幂等=24h

权限候选：admin；system：无。权限行：`(role, offboarding, cleanup)`。审阅风险：raw_answer / C_data。

校验：human人工执行；合同/法务明确授权；无自动到期清理；仅指定范围；不可删除ledger；Admin身份只代表配置履约职责，仍必须校验本次合同/法务授权依据，不能万能绕过。

审计：offboarding.cleanup。副作用：先可靠追加独立tombstone再清理，tombstone不随源消失；记录执行人/时间范围/依据。

请求JSON（另带Idempotency-Key）：

```json
{
  "basis": "合同/法务依据引用",
  "object_type": "audit_log",
  "time_range": {
    "from": "2024-01-01T00:00:00Z",
    "to": "2024-12-31T23:59:59Z"
  },
  "reason": "按法务要求清理"
}
```

响应JSON：

```json
{
  "data": {
    "cleanup_ref": "del1",
    "tombstone_ref": "dl1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### deletion_ledger.append

`POST /internal/deletion-ledger/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：offboarding。权限行：`(role, deletion_ledger, append)`。审阅风险：raw_answer。

校验：仅显式offboarding链路，独立追加；按合同/法务授权，不允许自由伪造actor。

审计：deletion_ledger.append。副作用：独立tombstone，生命周期不随源删除。

请求JSON（另带Idempotency-Key）：

```json
{
  "object_type": "probe_result.raw_answer",
  "time_range": {
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-11-09T00:00:00Z"
  },
  "executed_by": "u1",
  "basis": "contract1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "dl1",
    "recorded": true
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### api_token.record_use

`POST /internal/api-tokens/{id}/record-use` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：audit_middleware。权限行：`(role, api_token, record_use)`。审阅风险：quota。

校验：认证服务层在成功认证后显式记录使用；只更改该token时间，不改业务对象状态。

审计：api_token.record_use。副作用：记录凭证元数据，不在日志中放明文。

请求JSON（另带Idempotency-Key）：

```json
{
  "used_at": "2026-11-09T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "last_used_at": "2026-11-09T00:00:00Z"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### brand_lexicon.read

`GET /tenants/{tid}/brands/{bid}/brand-lexicons/versions/{version}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：judge。权限行：`(role, brand_lexicon, read)`。审阅风险：judge_input。

校验：明确tenant/brand/version；历史版本只读，禁止无版本默认latest；Content/Evidence仅关联任务；judge仅已批准的指定版本。

审计：普通只读无业务审计。副作用：读取不改状态；返回lexicon_version供判定记录。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "brand_id": "b1",
    "version": 1,
    "entries": [
      {
        "kind": "brand_alias",
        "term": "简造"
      },
      {
        "kind": "exclusion",
        "term": "erp"
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### brand_lexicon.create

`POST /tenants/{tid}/brands/{bid}/brand-lexicons` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, brand_lexicon, create)`。审阅风险：judge_input。

校验：strategy映射既有strategist；创建完整版本，新version新行，旧版本只读；kind为五类；created_by/created_at服务端记录。

审计：brand_lexicon.create。副作用：不立即生效；version_object_id引用该版本首行id，审核整版本条目集合。

请求JSON（另带Idempotency-Key）：

```json
{
  "entries": [
    {
      "kind": "brand_alias",
      "term": "简造"
    },
    {
      "kind": "exclusion",
      "term": "erp"
    }
  ]
}
```

响应JSON：

```json
{
  "data": {
    "version": 1,
    "version_object_id": "lx1",
    "effective": false
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### brand_lexicon.submit

`POST /tenants/{tid}/brands/{bid}/brand-lexicons/versions/{version}/submit` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, brand_lexicon, submit)`。审阅风险：judge_input。

校验：版本作者本人；只能提交完整未生效版本，所有条目归属同品牌/版本；不另发明lexicon状态枚举。

审计：brand_lexicon.submit。副作用：入review_queue，FactCheck≠版本作者；approve即该新版本生效，旧版本保留可还原。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "review_entry_id": "rv-lx1",
    "object_type": "brand_lexicon",
    "object_id": "lx1",
    "status": "waiting"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### official_fact.create

`POST /tenants/{tid}/brands/{bid}/official-facts` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, official_fact, create)`。审阅风险：judge_input。

校验：四类fact_category；只准L1；effective_from为UTC；作者从创建审计及review_queue.submitted_by溯源。

审计：official_fact.create。副作用：同事务创建draft与waiting条目，无额外submit端点；未批准不得供judge使用。

请求JSON（另带Idempotency-Key）：

```json
{
  "fact_category": "price",
  "content": "示例官方价格口径，非产品承诺",
  "source_level": "L1",
  "effective_from": "2026-01-01T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "id": "f1",
    "status": "draft",
    "review_entry_id": "rv-f1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### official_fact.approve

`POST /tenants/{tid}/brands/{bid}/official-facts/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, official_fact, approve)`。审阅风险：judge_input。

校验：human、draft且对应waiting；FactCheck≠创建者；与review_queue.approve同一原子服务动作。

审计：official_fact.approve。副作用：口径approved生效（仍受effective_from限制），结算队列approved。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "f1",
    "status": "approved"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### official_fact.retract

`POST /tenants/{tid}/brands/{bid}/official-facts/{id}/retract` · 语义 write · destructive=true · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, official_fact, retract)`。审阅风险：judge_input。

校验：human；approved→retracted；reason必填；不改历史metric_snapshot。

审计：official_fact.retract。副作用：后续judge拒绝引用，不出无基准error分；终态保留审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "官方口径已失效"
}
```

响应JSON：

```json
{
  "data": {
    "id": "f1",
    "status": "retracted"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## 共享错误示例

HTTP 403

```json
{
  "error": {
    "code": "permission_denied",
    "message": "请求未满足契约条件",
    "details": {}
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

HTTP 409

```json
{
  "error": {
    "code": "state_conflict",
    "message": "请求未满足契约条件",
    "details": {}
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

HTTP 422

```json
{
  "error": {
    "code": "validation_failed",
    "message": "请求未满足契约条件",
    "details": {}
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

HTTP 422

```json
{
  "error": {
    "code": "incomparable",
    "message": "采样配置或簇问句口径不一致",
    "details": {
      "baseline_snapshot_id": "snp1",
      "retest_snapshot_id": "snp2"
    }
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

HTTP 429

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "请求未满足契约条件",
    "details": {}
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```
