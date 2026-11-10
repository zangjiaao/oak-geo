# 支撑端点抽检附录

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../../spec-map.md)。本文件只含非核心端点，默认抽检；涉及原文/C类/配额的端点不得下沉。

## brand

### brand.read

`GET /tenants/{tid}/brands/{bid}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / viewer / strategist / factcheck / cs / content / evidence / admin；system：无。权限行：`(role, brand, read)`。审阅风险：承重动作。

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
    "id": "b1",
    "industry": "B2B"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### brand.configure

`POST /tenants/{tid}/brands/{bid}/configure` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行：`(role, brand, configure)`。审阅风险：承重动作。

校验：配置操作；不得自动换模型或改已冻结配置。

审计：brand.configure。副作用：无业务副作用。

请求JSON（另带Idempotency-Key）：

```json
{
  "name": "示例品牌",
  "market": "CN"
}
```

响应JSON：

```json
{
  "data": {
    "id": "b1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## user_member

### user_member.read

`GET /tenants/{tid}/members` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / admin；system：无。权限行：`(role, user_member, read)`。审阅风险：承重动作。

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
        "user_id": "u1",
        "role": "editor"
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

### user_member.configure

`POST /tenants/{tid}/members/configure` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行：`(role, user_member, configure)`。审阅风险：承重动作。

校验：同租户，九角色枚举；客户端权限不得扩张。

审计：user_member.configure。副作用：更新策略，已撤权请求立即重新鉴权。

请求JSON（另带Idempotency-Key）：

```json
{
  "user_id": "u1",
  "role": "editor"
}
```

响应JSON：

```json
{
  "data": {
    "user_id": "u1",
    "role": "editor"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## seed_list

### seed_list.read

`GET /tenants/{tid}/seed-lists` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs；system：无。权限行：`(role, seed_list, read)`。审阅风险：承重动作。

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
        "id": "s1",
        "maintainer": "张三",
        "seed_version": 1
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

### seed_list.create

`POST /tenants/{tid}/seed-lists` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, seed_list, create)`。审阅风险：承重动作。

校验：维护人具体人名、复核时间必填；word_type产品枚举。

审计：seed_list.create。副作用：新版本；无maintainer不开管道。

请求JSON（另带Idempotency-Key）：

```json
{
  "word": "排产",
  "word_type": "场景",
  "maintainer": "张三",
  "last_reviewed_at": "2026-11-09T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "id": "s1",
    "seed_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### seed_list.revise

`POST /tenants/{tid}/seed-lists/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, seed_list, revise)`。审阅风险：承重动作。

校验：新版本，旧版保留。

审计：seed_list.revise。副作用：生成语法只造词，预览确认后调用本操作。

请求JSON（另带Idempotency-Key）：

```json
{
  "word": "自动排产",
  "maintainer": "张三",
  "last_reviewed_at": "2026-11-09T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "id": "s2",
    "seed_version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## keyword_pool_snapshot

### keyword_pool_snapshot.read

`GET /tenants/{tid}/keyword-pool-snapshots` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, keyword_pool_snapshot, read)`。审阅风险：承重动作。

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
    "pool_version": 1,
    "seed_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### keyword_pool_snapshot.append

`POST /internal/keyword-pool-snapshots/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：weekly_pool。权限行：`(role, keyword_pool_snapshot, append)`。审阅风险：承重动作。

校验：pool_version唯一，归簇稳定ID。

审计：keyword_pool_snapshot.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "pool_version": 2
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

## intent_cluster

### intent_cluster.read

`GET /tenants/{tid}/brands/{bid}/clusters/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, intent_cluster, read)`。审阅风险：承重动作。

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
    "id": "c1",
    "question_pool_version": 1,
    "status": "active"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.archive

`POST /tenants/{tid}/brands/{bid}/clusters/{id}/archive` · 语义 write · destructive=true · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, intent_cluster, archive)`。审阅风险：承重动作。

校验：只能active→archived；§8三条件；保留90天分母。

审计：intent_cluster.archive。副作用：软删除；过渡补位，单期变化>20%暂停复核。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "需求消退",
  "evidence_probe_ids": [
    "p1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "c1",
    "status": "archived"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.transition

`POST /internal/clusters/transition` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：weekly_pool。权限行：`(role, intent_cluster, transition)`。审阅风险：承重动作。

校验：词池周批稳定ID匹配与规则归簇；只新增active或更新需求快照引用，不改已锚定question_pool_version，不恢复archived；只允许本资源状态表命名事件，不接受任意status裸更新。

审计：intent_cluster.refresh。副作用：周快照与双筛候选联动；拆并只提案，人工upgrade后重开基线，不自动换题。

请求JSON（另带Idempotency-Key）：

```json
{
  "pool_version": 2,
  "representative_word_ids": [
    "k1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "cluster_id": "c1",
    "status": "active",
    "pool_version": 2,
    "question_pool_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## opportunity_card

### opportunity_card.read

`GET /tenants/{tid}/brands/{bid}/opportunity-cards/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, opportunity_card, read)`。审阅风险：承重动作。

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
    "id": "o1",
    "snapshot_id": "snp1",
    "demand_tier": "S"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### opportunity_card.create

`POST /tenants/{tid}/brands/{bid}/opportunity-cards` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, opportunity_card, create)`。审阅风险：承重动作。

校验：版本ID链齐备，不复制四分。

审计：opportunity_card.create。副作用：新卡进候选，需求来源必填。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "pool_version": 1,
  "snapshot_id": "snp1",
  "demand_tier": "S",
  "demand_source": "keyword:k1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "o1",
    "status": "候选"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### opportunity_card.recommend

`POST /tenants/{tid}/brands/{bid}/opportunity-cards/recommendations` · 语义 proposal · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, opportunity_card, recommend)`。审阅风险：承重动作。

校验：样本满足§14交付门槛；提供证据链。

审计：opportunity_card.recommend。副作用：形成建议，不代Owner拍板。

请求JSON（另带Idempotency-Key）：

```json
{
  "opportunity_ids": [
    "o1",
    "o2",
    "o3"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "recommended_ids": [
      "o1",
      "o2",
      "o3"
    ],
    "status": "建议"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### opportunity_card.confirm

`POST /tenants/{tid}/brands/{bid}/opportunity-cards/confirm` · 语义 write · destructive=false · 幂等=24h

权限候选：owner；system：无。权限行：`(role, opportunity_card, confirm)`。审阅风险：承重动作。

校验：human；full；3簇；demand_tier/demand_source必填。

审计：opportunity_card.confirm。副作用：确认→生产，未有T0基线不得声称提升。

请求JSON（另带Idempotency-Key）：

```json
{
  "opportunity_ids": [
    "o1",
    "o2",
    "o3"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "confirmed_ids": [
      "o1",
      "o2",
      "o3"
    ],
    "status": "确认"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### opportunity_card.transition

`POST /internal/opportunity-cards/{id}/transition` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：opportunity_lifecycle。权限行：`(role, opportunity_card, transition)`。审阅风险：承重动作。

校验：候选→评分：双筛通过且基线开始；确认→在测：监测开始；在测→归档：关联簇归档；禁止请求直接指定任意目标态；只允许本资源状态表命名事件，不接受任意status裸更新。

审计：opportunity_card.advance。副作用：仅模板已列出边；基线失败留工单处理，不擅自增状态。

请求JSON（另带Idempotency-Key）：

```json
{
  "trigger_batch_id": "bt1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "o1",
    "status": "评分"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## cluster_score

### cluster_score.append

`POST /internal/cluster-scores/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行：`(role, cluster_score, append)`。审阅风险：承重动作。

校验：仅基线评分；(cluster,snapshot)唯一；不足样本分数null；同一事务先写问句分数再写簇分数，保留原question_score内部表，不再有独立API族。

审计：cluster_score.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "snapshot_id": "snp1",
  "question_scores": [
    {
      "question_id": "q1",
      "snapshot_id": "snp1"
    }
  ]
}
```

响应JSON：

```json
{
  "data": {
    "recorded": true
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## cluster_platform_signal

### cluster_platform_signal.read

`GET /tenants/{tid}/brands/{bid}/cluster-platform-signals` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, cluster_platform_signal, read)`。审阅风险：承重动作。

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
        "cluster_id": "c1",
        "platform": "官网",
        "model_citation_count": 1
      }
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### cluster_platform_signal.append

`POST /internal/platform-signals/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行：`(role, cluster_platform_signal, append)`。审阅风险：承重动作。

校验：基线评分顺带产生；计数可回溯probe。

审计：cluster_platform_signal.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "snapshot_id": "snp1"
}
```

响应JSON：

```json
{
  "data": {
    "recorded": true
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## content_asset

### content_asset.read

`GET /tenants/{tid}/brands/{bid}/content-assets/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / content；system：无。权限行：`(role, content_asset, read)`。审阅风险：承重动作。

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
    "id": "a1",
    "review_status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### content_asset.create

`POST /tenants/{tid}/brands/{bid}/content-assets` · 语义 draft · destructive=false · 幂等=24h

权限候选：editor / content；system：无。权限行：`(role, content_asset, create)`。审阅风险：承重动作。

校验：Editor本品牌full；Content限任务；仅内容工作台。

审计：content_asset.create。副作用：挂同机会卡，可含多块。

请求JSON（另带Idempotency-Key）：

```json
{
  "opportunity_card_id": "o1",
  "type": "FAQ",
  "platform": "官网"
}
```

响应JSON：

```json
{
  "data": {
    "id": "a1",
    "review_status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## claim_block

### claim_block.read

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / content；system：无。权限行：`(role, claim_block, read)`。审阅风险：承重动作。

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
    "id": "cl1",
    "version": 1,
    "status": "draft",
    "source_level": "L1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.reject

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, claim_block, reject)`。审阅风险：承重动作。

校验：仅pending_review，waiting队列条目未结算；reason必填。

审计：claim_block.reject。副作用：approve/reject原子结算队列；retract追同源块并重算asset。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "来源需补充"
}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.citations

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}/citations` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, claim_block, citations)`。审阅风险：承重动作。

校验：关联任务，返回聚合不含全文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "probe_ids": [
      "p1"
    ],
    "cited_claim_ids": [
      "cl1"
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## probe_result

### probe_result.read

`GET /tenants/{tid}/brands/{bid}/probe-results/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, probe_result, read)`。审阅风险：承重动作。

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
    "id": "r1",
    "probe_id": "p1",
    "brand_mentioned": true,
    "refused": false
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## metric_snapshot

### metric_snapshot.read

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / owner / viewer / editor；system：无。权限行：`(role, metric_snapshot, read)`。审阅风险：承重动作。

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
    "id": "m1",
    "snapshot_id": "snp1",
    "batch_id": "bt1",
    "mention_rate": 0.5,
    "citation_rate": 0.25,
    "lexicon_version": 1
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### metric_snapshot.export

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/{id}/report` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / viewer / cs；system：无。权限行：`(role, metric_snapshot, export)`。审阅风险：承重动作。

校验：报告脱敏，不含raw_answer；披露我方生产+对照组；不可比不出差值报告。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "download_ref": "短时报告引用",
    "produced_by_us": true,
    "control_cluster_ids": [
      "c4",
      "c5",
      "c6"
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### metric_snapshot.append

`POST /internal/metric-snapshots/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：metric_aggregate。权限行：`(role, metric_snapshot, append)`。审阅风险：承重动作。

校验：按批次追加，历史不可变；拒答排除；显式/隐式引用计算层推导；citation_rate仅规范化URL全等explicit；指纹及仅域名命中只内部分析；仅completed批次选定完整尝试，禁止从failed批次或多次部分尝试拼样本；lexicon_version必须与该批次判定记录一致，不读当前最新版本。

审计：metric_snapshot.append。副作用：不写cluster_score；触发回流扫描。

请求JSON（另带Idempotency-Key）：

```json
{
  "batch_id": "bt2",
  "snapshot_id": "snp1",
  "cluster_id": "c1",
  "committed_attempt_no": 1,
  "lexicon_version": 1
}
```

响应JSON：

```json
{
  "data": {
    "id": "m2",
    "lexicon_version": 1
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## industry_score

### industry_score.read

`GET /tenants/{tid}/industry-scores` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist；system：无。权限行：`(role, industry_score, read)`。审阅风险：承重动作。

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
        "industry": "B2B",
        "version": 1
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

### industry_score.revise

`POST /tenants/{tid}/industry-scores/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, industry_score, revise)`。审阅风险：承重动作。

校验：仅内部排产，版本化；不进对外报价报告。

审计：industry_score.revise。副作用：无业务副作用。

请求JSON（另带Idempotency-Key）：

```json
{
  "industry": "B2B",
  "version": 2,
  "reliability_note": "内部策略"
}
```

响应JSON：

```json
{
  "data": {
    "version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## review_queue

### review_queue.read

`GET /tenants/{tid}/brands/{bid}/review-queue` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：factcheck；system：无。权限行：`(role, review_queue, read)`。审阅风险：承重动作。

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
        "id": "rv1",
        "object_type": "claim_block",
        "object_id": "cl1",
        "status": "waiting"
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

### review_queue.submit

`POST /tenants/{tid}/brands/{bid}/review-queue/submit` · 语义 write · destructive=false · 幂等=24h

权限候选：evidence / strategist；system：无。权限行：`(role, review_queue, submit)`。审阅风险：承重动作。

校验：作者本人；MVP五类object_type：claim_block/evidence_package/diagnosis_report/brand_lexicon/official_fact；plan_draft仅预留不接受；strategist仅本人词表/口径/诊断，evidence仅本人证据包。

审计：review_queue.submit。副作用：入waiting，通知FactCheck。

请求JSON（另带Idempotency-Key）：

```json
{
  "object_type": "evidence_package",
  "object_id": "ev1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "rv2",
    "status": "waiting"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### review_queue.withdraw

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/withdraw` · 语义 write · destructive=false · 幂等=24h

权限候选：editor / content / evidence / strategist；system：无。权限行：`(role, review_queue, withdraw)`。审阅风险：承重动作。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人；Editor/Content只能撤回本人claim_block，入口属于内容工作台。

审计：review_queue.withdraw。副作用：原子修改对象态及队列终态；无通用裸状态update。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "rv1",
    "status": "withdrawn"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## objection

### objection.read

`GET /tenants/{tid}/brands/{bid}/objections/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / viewer / cs / factcheck；system：无。权限行：`(role, objection, read)`。审阅风险：承重动作。

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
    "id": "ob1",
    "probe_id": "p1",
    "status": "submitted"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### objection.create

`POST /tenants/{tid}/brands/{bid}/objections` · 语义 write · destructive=false · 幂等=24h

权限候选：owner / editor / viewer；system：无。权限行：`(role, objection, create)`。审阅风险：承重动作。

校验：本品牌已可见结论，指名单probe且reason非空；owner按§9.3，editor/viewer仅diagnosis档唯一写入口候选，随矩阵审阅。

审计：objection.create。副作用：3个工作日内响应；异议状态与查看会话分开。

请求JSON（另带Idempotency-Key）：

```json
{
  "probe_id": "p1",
  "conclusion_ref": {
    "object_type": "diagnosis_report",
    "object_id": "dr1"
  },
  "reason": "请求复核该结论"
}
```

响应JSON：

```json
{
  "data": {
    "id": "ob1",
    "status": "submitted"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### objection.reject

`POST /tenants/{tid}/brands/{bid}/objections/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：cs / factcheck；system：无。权限行：`(role, objection, reject)`。审阅风险：承重动作。

校验：submitted；CS处理，敏感升级FactCheck；必须记录处理人/时间。

审计：objection.reject。副作用：granted不返回原文或开启客户直接读raw权限。

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
    "status": "rejected"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## backflow_ticket

### backflow_ticket.read

`GET /tenants/{tid}/brands/{bid}/backflow-tickets/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, backflow_ticket, read)`。审阅风险：承重动作。

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
    "id": "tk1",
    "status": "open",
    "signal_type": "cited_wrong"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.create

`POST /internal/backflow-tickets` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：backflow_scan。权限行：`(role, backflow_ticket, create)`。审阅风险：承重动作。

校验：§8五信号；cited_wrong urgent且deadline24h；证据链必填。

审计：backflow_ticket.create。副作用：出工单通知责任角色。

请求JSON（另带Idempotency-Key）：

```json
{
  "signal_type": "cited_wrong",
  "cluster_id": "c1",
  "evidence_probe_ids": [
    "p1"
  ],
  "trigger_metric_id": "m1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "open"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.complete

`POST /tenants/{tid}/brands/{bid}/backflow-tickets/{id}/complete` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, backflow_ticket, complete)`。审阅风险：承重动作。

校验：assigned或expired；本人负责的工单；resolution_note必填。

审计：backflow_ticket.complete。副作用：保留超时历史，写resolved_at；补办不覆盖expired审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "resolution_note": "已修正并安排复测",
  "followup_batch_id": "bt2"
}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "done"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.expire

`POST /internal/backflow-tickets/{id}/expire` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：ticket_deadline。权限行：`(role, backflow_ticket, expire)`。审阅风险：承重动作。

校验：open/assigned且超过deadline。

审计：backflow_ticket.expire。副作用：超时告警，保留原责任人。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "expired"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## evidence_package

### evidence_package.read

`GET /tenants/{tid}/brands/{bid}/evidence-packages/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行：`(role, evidence_package, read)`。审阅风险：承重动作。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文；items仅该package子资源，父包租户/任务校验及sealed客户投影继承，受限excerpt继续不返回。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "ev1",
    "version": 1,
    "status": "sealed",
    "items": [
      {
        "id": "ei1",
        "package_id": "ev1",
        "probe_id": "p1",
        "source_level": "L1",
        "conclusion_text": "可复核结论"
      }
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_package.approve

`POST /tenants/{tid}/brands/{bid}/evidence-packages/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, evidence_package, approve)`。审阅风险：承重动作。

校验：对应waiting；非created_by；仅一次approve，不另设seal。

审计：evidence_package.approve。副作用：同时结算队列approved，写sealed_by/sealed_at。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "ev1",
    "status": "sealed"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_package.export

`GET /tenants/{tid}/brands/{bid}/evidence-packages/{id}/download` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：editor / owner / cs；system：无。权限行：`(role, evidence_package, export)`。审阅风险：承重动作。

校验：仅sealed包的结论/来源元数据及模板；不含模型回答全文或受限摘录；模板属于包投影。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "package_id": "ev1",
    "version": 1,
    "template_refs": [
      "tpl1"
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## publish_registration

### publish_registration.read

`GET /tenants/{tid}/brands/{bid}/publish-registrations/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / owner；system：无。权限行：`(role, publish_registration, read)`。审阅风险：承重动作。

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
    "id": "pub1",
    "content_asset_id": "a1",
    "status": "registered"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### publish_registration.transition

`POST /internal/publish-registrations/{id}/transition` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：publication_lifecycle。权限行：`(role, publish_registration, transition)`。审阅风险：承重动作。

校验：registered→retesting：登记排期执行；retesting→reported：相关报告完成；reported终态不改；只允许本资源状态表命名事件，不接受任意status裸更新。

审计：publish_registration.advance。副作用：重登记新增登记事件/审计历史，asset单独registered。

请求JSON（另带Idempotency-Key）：

```json
{
  "trigger_batch_id": "bt2"
}
```

响应JSON：

```json
{
  "data": {
    "id": "pub1",
    "status": "retesting"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## diagnosis_report

### diagnosis_report.read

`GET /tenants/{tid}/brands/{bid}/diagnosis-reports/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行：`(role, diagnosis_report, read)`。审阅风险：承重动作。

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
    "id": "dr1",
    "status": "sealed",
    "probe_ids": [
      "p1"
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### diagnosis_report.create

`POST /tenants/{tid}/brands/{bid}/diagnosis-reports` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, diagnosis_report, create)`。审阅风险：承重动作。

校验：结论能回到probe与来源；覆盖样本及§14门槛。

审计：diagnosis_report.create。副作用：交付前须FactCheck放行。

请求JSON（另带Idempotency-Key）：

```json
{
  "opportunity_ids": [
    "o1",
    "o2",
    "o3"
  ],
  "probe_ids": [
    "p1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "dr1",
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### diagnosis_report.approve

`POST /tenants/{tid}/brands/{bid}/diagnosis-reports/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, diagnosis_report, approve)`。审阅风险：承重动作。

校验：对应waiting且非作者；样本与证据门槛通过。

审计：diagnosis_report.approve。副作用：同一步定稿+队列approved，不另设seal。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "dr1",
    "status": "sealed"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### diagnosis_report.export

`GET /tenants/{tid}/brands/{bid}/diagnosis-reports/{id}/report` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / cs；system：无。权限行：`(role, diagnosis_report, export)`。审阅风险：承重动作。

校验：本品牌sealed，无模型原文或批量摘录；结论附probe_id/来源等级。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "dr1",
    "status": "sealed",
    "format": "pdf"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### diagnosis_report.revise

`POST /tenants/{tid}/brands/{bid}/diagnosis-reports/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, diagnosis_report, revise)`。审阅风险：承重动作。

校验：作者Strategist；新行新版本，旧sealed不改；重新入通用审核队列。

审计：diagnosis_report.revise。副作用：新的waiting条目人工提交后再放行。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "补充结论证据",
  "probe_ids": [
    "p1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "dr2",
    "version": 2,
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## offboarding

### offboarding.read

`GET /tenants/{tid}/offboarding/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行：`(role, offboarding, read)`。审阅风险：承重动作。

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
    "id": "off1",
    "deleted_raw_answers": true
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## deletion_ledger

### deletion_ledger.read

`GET /tenants/{tid}/deletion-ledger` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行：`(role, deletion_ledger, read)`。审阅风险：承重动作。

校验：同租户配置/审计职责；ledger不含原文或令牌。

审计：普通只读无业务审计。副作用：只读，不提供ledger删除操作。GET不迁移业务对象状态。

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
        "id": "dl1",
        "object_type": "audit_log",
        "time_range": {
          "from": "2024-01-01T00:00:00Z",
          "to": "2024-12-31T23:59:59Z"
        },
        "executed_by": "u1",
        "basis": "legal1"
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

