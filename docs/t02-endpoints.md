# T02 逐端点契约与请求响应示例

> 未冻结；由 `node scripts/generate-t02-docs.mjs` 从 `docs/t02-contracts.json` 生成。字段示例均为虚构，不能直接发起模型调用。完整权限以 `t02-permissions.csv` 的三键行及全局条件为准，不在此简写列表中隐含授权。所有POST携带Idempotency-Key（24h）；元数据包括无快照时的null。

## tenant

### tenant.read

`GET /tenants/{tid}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行索引：`(role, tenant, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：admin；system：无。权限行索引：`(role, tenant, configure)`。

校验：合同范围内配置；禁止借此改业务状态。

审计事件：tenant.configure。副作用：配置审计。

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

## brand

### brand.read

`GET /tenants/{tid}/brands/{bid}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / viewer / strategist / factcheck / cs / content / evidence / admin；system：无。权限行索引：`(role, brand, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：admin；system：无。权限行索引：`(role, brand, configure)`。

校验：配置操作；不得自动换模型或改已冻结配置。

审计事件：brand.configure。副作用：无业务副作用。

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

权限候选：owner / admin；system：无。权限行索引：`(role, user_member, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：admin；system：无。权限行索引：`(role, user_member, configure)`。

校验：同租户，九角色枚举；客户端权限不得扩张。

审计事件：user_member.configure。副作用：更新策略，已撤权请求立即重新鉴权。

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

权限候选：strategist / factcheck / cs；system：无。权限行索引：`(role, seed_list, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, seed_list, create)`。

校验：维护人具体人名、复核时间必填；word_type产品枚举。

审计事件：seed_list.create。副作用：新版本；无maintainer不开管道。

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

权限候选：strategist；system：无。权限行索引：`(role, seed_list, revise)`。

校验：新版本，旧版保留。

审计事件：seed_list.revise。副作用：生成语法只造词，预览确认后调用本操作。

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

## keyword_raw

### keyword_raw.read

`GET /tenants/{tid}/keyword-imports` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs；system：无。权限行索引：`(role, keyword_raw, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：c_import。权限行索引：`(role, keyword_raw, import)`。

校验：C先书面授权、自动脱敏；B人工/半自动CSV；四渠道枚举。

审计事件：keyword_raw.import。副作用：归一化、去重；只存指数不存绝对搜索次数。

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

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, keyword_raw, read_raw)`。

校验：仅授权C数据或公开源的关联任务，服务端审计，不含已删除数据。

审计事件：keyword_raw.read_raw。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

## keyword_pool_snapshot

### keyword_pool_snapshot.read

`GET /tenants/{tid}/keyword-pool-snapshots` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, keyword_pool_snapshot, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：人类九角色全部deny；system：weekly_pool。权限行索引：`(role, keyword_pool_snapshot, append)`。

校验：pool_version唯一，归簇稳定ID。

审计事件：keyword_pool_snapshot.append。副作用：服务层追加，不覆盖配置下已有分数。

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

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行索引：`(role, intent_cluster, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, intent_cluster, archive)`。

校验：只能active→archived；§8三条件；保留90天分母。

审计事件：intent_cluster.archive。副作用：软删除；过渡补位，单期变化>20%暂停复核。

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

### intent_cluster.anchor

`POST /tenants/{tid}/brands/{bid}/clusters/{id}/anchor` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行索引：`(role, intent_cluster, anchor)`。

校验：human显式动作；初次入测锚定，版本只读。

审计事件：intent_cluster.anchor。副作用：仅新簇入测，不改其他簇。

请求JSON（另带Idempotency-Key）：

```json
{
  "question_pool_version": 1,
  "question_ids": [
    "q1",
    "q2",
    "q3"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "c1",
    "question_pool_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.upgrade

`POST /tenants/{tid}/brands/{bid}/clusters/{id}/upgrade-questions` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行索引：`(role, intent_cluster, upgrade)`。

校验：human拍板；升级或拆并，禁止自动改锚。

审计事件：intent_cluster.upgrade。副作用：新建基线执行批次；旧数据保留不可比。

请求JSON（另带Idempotency-Key）：

```json
{
  "question_pool_version": 2,
  "reason": "问法漂移"
}
```

响应JSON：

```json
{
  "data": {
    "id": "c1",
    "question_pool_version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.refresh

`POST /internal/clusters/refresh` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：weekly_pool。权限行索引：`(role, intent_cluster, refresh)`。

校验：词池周批稳定ID匹配与规则归簇；只新增active或更新需求快照引用，不改已锚定question_pool_version，不恢复archived。

审计事件：intent_cluster.refresh。副作用：周快照与双筛候选联动；拆并只提案，人工upgrade后重开基线，不自动换题。

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

## question_pool

### question_pool.read

`GET /tenants/{tid}/brands/{bid}/question-pools/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, question_pool, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### question_pool.create

`POST /tenants/{tid}/brands/{bid}/question-pools` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行索引：`(role, question_pool, create)`。

校验：五溯源非空，source_word_id指keyword_raw；intent_type六类；不得凭空造测量题。

审计事件：question_pool.create。副作用：无业务副作用。

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

### question_pool.freeze

`POST /tenants/{tid}/brands/{bid}/question-pools/versions/{version}/freeze` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行索引：`(role, question_pool, freeze)`。

校验：版本open→frozen；校验版本内各问句五字段；冻结整个引用版本原文集合，不只冻单条。

审计事件：question_pool.freeze。副作用：改动只能新版本，不重写旧问句。

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

### question_pool.revise

`POST /tenants/{tid}/brands/{bid}/question-pools/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行索引：`(role, question_pool, revise)`。

校验：复用五溯源字段并重新校验；旧记录只读。

审计事件：question_pool.revise。副作用：不自动更改簇锚定。

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

权限候选：strategist；system：无。权限行索引：`(role, question_pool, archive)`。

校验：frozen→archived；停止新锚定，不得删除/改动已锚定版本原文。

审计事件：question_pool.archive。副作用：仅停止新锚定，历史继续可读取。

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

## opportunity_card

### opportunity_card.read

`GET /tenants/{tid}/brands/{bid}/opportunity-cards/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行索引：`(role, opportunity_card, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, opportunity_card, create)`。

校验：版本ID链齐备，不复制四分。

审计事件：opportunity_card.create。副作用：新卡进候选，需求来源必填。

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

权限候选：strategist；system：无。权限行索引：`(role, opportunity_card, recommend)`。

校验：样本满足§14交付门槛；提供证据链。

审计事件：opportunity_card.recommend。副作用：形成建议，不代Owner拍板。

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

权限候选：owner；system：无。权限行索引：`(role, opportunity_card, confirm)`。

校验：human；full；3簇；demand_tier/demand_source必填。

审计事件：opportunity_card.confirm。副作用：确认→生产，未有T0基线不得声称提升。

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

### opportunity_card.advance

`POST /internal/opportunity-cards/{id}/advance` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：opportunity_lifecycle。权限行索引：`(role, opportunity_card, advance)`。

校验：候选→评分：双筛通过且基线开始；确认→在测：监测开始；在测→归档：关联簇归档；禁止请求直接指定任意目标态。

审计事件：opportunity_card.advance。副作用：仅模板已列出边；基线失败留工单处理，不擅自增状态。

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

## scoring_snapshot

### scoring_snapshot.read

`GET /tenants/{tid}/scoring-snapshots/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, scoring_snapshot, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### scoring_snapshot.create

`POST /tenants/{tid}/scoring-snapshots` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行索引：`(role, scoring_snapshot, create)`。

校验：示例model_set是占位，不可执行；T14定具体ID；区分配置与批次；system仅受控模型/判定/轨道变更事件可创建冻结新配置，不能改已有冻结配置。

审计事件：scoring_snapshot.create。副作用：配置草稿，不直接发探针。

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

### scoring_snapshot.freeze

`POST /tenants/{tid}/scoring-snapshots/{id}/freeze` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行索引：`(role, scoring_snapshot, freeze)`。

校验：执行前冻结；模型温度轮次judge接地不变；问句由簇锚定；system仅受控模型/判定/轨道变更事件可创建冻结新配置，不能改已有冻结配置。

审计事件：scoring_snapshot.freeze。副作用：此后换配置开新snapshot，不因复测新建配置。

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

## question_score

### question_score.read

`GET /tenants/{tid}/brands/{bid}/question-scores/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, question_score, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "question_id": "q1",
    "n_valid": 24
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### question_score.append

`POST /internal/question-scores/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行索引：`(role, question_score, append)`。

校验：基线判定聚合，拒答排除，连续值4位。

审计事件：question_score.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "question_id": "q1",
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

## cluster_score

### cluster_score.read

`GET /tenants/{tid}/brands/{bid}/cluster-scores/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行索引：`(role, cluster_score, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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
    "insufficient_sample": true
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### cluster_score.append

`POST /internal/cluster-scores/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行索引：`(role, cluster_score, append)`。

校验：仅基线评分；(cluster,snapshot)唯一；不足样本分数null。

审计事件：cluster_score.append。副作用：服务层追加，不覆盖配置下已有分数。

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

## cluster_platform_signal

### cluster_platform_signal.read

`GET /tenants/{tid}/brands/{bid}/cluster-platform-signals` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行索引：`(role, cluster_platform_signal, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：人类九角色全部deny；system：baseline_scoring。权限行索引：`(role, cluster_platform_signal, append)`。

校验：基线评分顺带产生；计数可回溯probe。

审计事件：cluster_platform_signal.append。副作用：服务层追加，不覆盖配置下已有分数。

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

权限候选：strategist / factcheck / cs / editor / content；system：无。权限行索引：`(role, content_asset, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：editor / content；system：无。权限行索引：`(role, content_asset, create)`。

校验：Editor本品牌full；Content限任务；仅内容工作台。

审计事件：content_asset.create。副作用：挂同机会卡，可含多块。

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

### content_asset.retire

`POST /tenants/{tid}/brands/{bid}/content-assets/{id}/retire` · 语义 write · destructive=true · 幂等=24h

权限候选：strategist / owner；system：无。权限行索引：`(role, content_asset, retire)`。

校验：human；draft/ready/registered→retired；retired不可逆。

审计事件：content_asset.retire。副作用：如需复活新建asset，挂同机会卡。

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

### content_asset.reconcile

`POST /internal/content-assets/{id}/reconcile` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：content_reconcile。权限行索引：`(role, content_asset, reconcile)`。

校验：按§3裁定派生；绝不让人工直接指定目标状态。

审计事件：content_asset.reconcile。副作用：同事务先事件降一级再派生重算、逐跳同cause审计；非必配retract且必配条件成立停ready；无registered→draft直达。

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

## claim_block

### claim_block.read

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / content；system：无。权限行索引：`(role, claim_block, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### claim_block.create

`POST /tenants/{tid}/brands/{bid}/claim-blocks` · 语义 draft · destructive=false · 幂等=24h

权限候选：editor / content；system：无。权限行索引：`(role, claim_block, create)`。

校验：L3不得入库；四问字段及来源非空；作者留痕。

审计事件：claim_block.create。副作用：草稿不进waiting，submit才进队列。

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

权限候选：editor / content；system：无。权限行索引：`(role, claim_block, revise)`。

校验：作者本人；新版本号及新行；保留旧版；retracted→draft由新行承接。

审计事件：claim_block.revise。副作用：重算asset ready；不因修订降低registered。

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

权限候选：editor / content；system：无。权限行索引：`(role, claim_block, submit)`。

校验：作者；draft；四问、L1/L2、整篇必配与自包含校验；judging-spec未冻结不实现正则。

审计事件：claim_block.submit。副作用：创建waiting队列条目，通知FactCheck。

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

权限候选：factcheck；system：无。权限行索引：`(role, claim_block, approve)`。

校验：仅pending_review，waiting队列条目未结算；FactCheck≠作者；L3禁入、四问与必配校验通过。

审计事件：claim_block.approve。副作用：approve/reject原子结算队列；retract追同源块并重算asset。

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

### claim_block.reject

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行索引：`(role, claim_block, reject)`。

校验：仅pending_review，waiting队列条目未结算；reason必填。

审计事件：claim_block.reject。副作用：approve/reject原子结算队列；retract追同源块并重算asset。

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

### claim_block.retract

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/retract` · 语义 write · destructive=true · 幂等=24h

权限候选：factcheck；system：无。权限行索引：`(role, claim_block, retract)`。

校验：仅approved；reason与说错工单必填；FactCheck执行下线。

审计事件：claim_block.retract。副作用：approve/reject原子结算队列；retract追同源块并重算asset；registered→ready后按必配条件继续ready→draft，同事务同cause逐跳审计。

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

### claim_block.citations

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}/citations` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, claim_block, citations)`。

校验：关联任务，返回聚合不含全文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

## probe

### probe.read

`GET /tenants/{tid}/brands/{bid}/probes/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, probe, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "p1",
    "batch_id": "bt1",
    "model": "T14待核实"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe.append

`POST /internal/probes/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行索引：`(role, probe, append)`。

校验：running批次且锁定配置/簇锚定；使用冻结问句原文。

审计事件：probe.append。副作用：仅所属批次追加。

请求JSON（另带Idempotency-Key）：

```json
{
  "batch_id": "bt1",
  "cluster_id": "c1",
  "question_id": "q1",
  "model": "T14待核实",
  "temperature": 0,
  "round": 1,
  "attempt_no": 1
}
```

响应JSON：

```json
{
  "data": {
    "id": "p1"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## probe_result

### probe_result.read

`GET /tenants/{tid}/brands/{bid}/probe-results/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行索引：`(role, probe_result, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### probe_result.read_raw

`GET /tenants/{tid}/brands/{bid}/probe-results/{id}/raw-answer` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, probe_result, read_raw)`。

校验：内部租户级或任务关联对象级；每次审计，不提供列表/导出。

审计事件：probe_result.read_raw。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：admin；system：无。权限行索引：`(role, probe_result, access)`。

校验：Admin默认deny；本次显式调阅必填理由+审计；不授予永久read_raw。

审计事件：probe_result.access。副作用：单条理由调阅留痕，不改变业务判定。

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

### probe_result.append

`POST /internal/probe-results/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行索引：`(role, probe_result, append)`。

校验：probe所属running batch；全文按不可信数据；禁止当作指令；完整citation元数据/正文URL归一化抽取，不丢路径。

审计事件：probe_result.append。副作用：按batch追加；不覆盖旧回答。

请求JSON（另带Idempotency-Key）：

```json
{
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

### probe_result.judge

`POST /tenants/{tid}/brands/{bid}/probe-results/{id}/judgments` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行索引：`(role, probe_result, judge)`。

校验：judging-spec先人审冻结；refused排除所有分母；样例不定义判定算法。

审计事件：probe_result.judge。副作用：保留判定审计；已出分需重新判定则换judge配置与基线。

请求JSON（另带Idempotency-Key）：

```json
{
  "blank_i": 0,
  "error_i": 0,
  "generic_i": 0.5,
  "competitor_i": 0,
  "spec_score": 3,
  "note": "人工示例"
}
```

响应JSON：

```json
{
  "data": {
    "id": "r1",
    "judged": true
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

权限候选：strategist / factcheck / cs / owner / viewer / editor；system：无。权限行索引：`(role, metric_snapshot, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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
    "citation_rate": 0.25
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### metric_snapshot.compare

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/compare` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / owner / viewer / editor；system：无。权限行索引：`(role, metric_snapshot, compare)`。

校验：同snapshot_id+同簇同锚定版本+question_id集合一致；否则422 incomparable无delta。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### metric_snapshot.export

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/{id}/report` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / viewer / cs；system：无。权限行索引：`(role, metric_snapshot, export)`。

校验：报告脱敏，不含raw_answer；披露我方生产+对照组；不可比不出差值报告。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：人类九角色全部deny；system：metric_aggregate。权限行索引：`(role, metric_snapshot, append)`。

校验：按批次追加，历史不可变；拒答排除；显式/隐式引用计算层推导；citation_rate仅规范化URL全等explicit；指纹及仅域名命中只内部分析；仅completed批次选定完整尝试，禁止从failed批次或多次部分尝试拼样本。

审计事件：metric_snapshot.append。副作用：不写cluster_score；触发回流扫描。

请求JSON（另带Idempotency-Key）：

```json
{
  "batch_id": "bt2",
  "snapshot_id": "snp1",
  "cluster_id": "c1",
  "committed_attempt_no": 1
}
```

响应JSON：

```json
{
  "data": {
    "id": "m2"
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

权限候选：strategist；system：无。权限行索引：`(role, industry_score, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, industry_score, revise)`。

校验：仅内部排产，版本化；不进对外报价报告。

审计事件：industry_score.revise。副作用：无业务副作用。

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

## audit_log

### audit_log.read

`GET /tenants/{tid}/audit-logs` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行索引：`(role, audit_log, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### audit_log.append

`POST /internal/audit-logs/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：audit_middleware。权限行索引：`(role, audit_log, append)`。

校验：仅服务层审计中间件；不允许人类/Agent提交伪造审计；job_name必须注册表枚举；探针类batch必填，非探针可null且trigger_source与对象必填；audit_middleware继承调用者actor。

审计事件：audit_log.append。副作用：只追加，禁止更新/删除；敏感访问也记录。

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

## review_queue

### review_queue.read

`GET /tenants/{tid}/brands/{bid}/review-queue` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：factcheck；system：无。权限行索引：`(role, review_queue, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：evidence / strategist；system：无。权限行索引：`(role, review_queue, submit)`。

校验：作者本人；只收三个MVP类型；plan_draft仅预留不接受。

审计事件：review_queue.submit。副作用：入waiting，通知FactCheck。

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

### review_queue.approve

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行索引：`(role, review_queue, approve)`。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人。

审计事件：review_queue.approve。副作用：原子修改对象态及队列终态；无通用裸状态update。

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

权限候选：factcheck；system：无。权限行索引：`(role, review_queue, reject)`。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人。

审计事件：review_queue.reject。副作用：原子修改对象态及队列终态；无通用裸状态update。

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

### review_queue.withdraw

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/withdraw` · 语义 write · destructive=false · 幂等=24h

权限候选：editor / content / evidence / strategist；system：无。权限行索引：`(role, review_queue, withdraw)`。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人；Editor/Content只能撤回本人claim_block，入口属于内容工作台。

审计事件：review_queue.withdraw。副作用：原子修改对象态及队列终态；无通用裸状态update。

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

权限候选：owner / editor / viewer / cs / factcheck；system：无。权限行索引：`(role, objection, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：owner / editor / viewer；system：无。权限行索引：`(role, objection, create)`。

校验：本品牌已可见结论，指名单probe且reason非空；owner按§9.3，editor/viewer仅diagnosis档唯一写入口候选，随矩阵审阅。

审计事件：objection.create。副作用：3个工作日内响应；异议状态与查看会话分开。

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

### objection.approve

`POST /tenants/{tid}/brands/{bid}/objections/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：cs / factcheck；system：无。权限行索引：`(role, objection, approve)`。

校验：submitted；CS处理，敏感升级FactCheck；必须记录处理人/时间。

审计事件：objection.approve。副作用：granted不返回原文或开启客户直接读raw权限。

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

### objection.reject

`POST /tenants/{tid}/brands/{bid}/objections/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：cs / factcheck；system：无。权限行索引：`(role, objection, reject)`。

校验：submitted；CS处理，敏感升级FactCheck；必须记录处理人/时间。

审计事件：objection.reject。副作用：granted不返回原文或开启客户直接读raw权限。

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

### objection.view

`POST /tenants/{tid}/brands/{bid}/objections/{id}/view` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行索引：`(role, objection, view)`。

校验：CS账号发起；granted→viewed；session唯一且同异议probe只一次；客户仅只读查看器。

审计事件：objection.view。副作用：审计CS/调阅人/时间/session；24h会话；查看器水印。

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

### objection.excerpt

`GET /tenants/{tid}/brands/{bid}/objections/{id}/excerpt` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / editor / viewer / cs；system：无。权限行索引：`(role, objection, excerpt)`。

校验：仅POST已建会话，申请人本人或发起CS；24h内只读查看；每次GET留审计但不改状态；禁下载/批量。

审计事件：objection.excerpt。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

## backflow_ticket

### backflow_ticket.read

`GET /tenants/{tid}/brands/{bid}/backflow-tickets/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, backflow_ticket, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：人类九角色全部deny；system：backflow_scan。权限行索引：`(role, backflow_ticket, create)`。

校验：§8五信号；cited_wrong urgent且deadline24h；证据链必填。

审计事件：backflow_ticket.create。副作用：出工单通知责任角色。

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

### backflow_ticket.assign

`POST /tenants/{tid}/brands/{bid}/backflow-tickets/{id}/assign` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行索引：`(role, backflow_ticket, assign)`。

校验：open→assigned；受理人任务授权内。

审计事件：backflow_ticket.assign。副作用：通知责任人。

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

### backflow_ticket.complete

`POST /tenants/{tid}/brands/{bid}/backflow-tickets/{id}/complete` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行索引：`(role, backflow_ticket, complete)`。

校验：assigned或expired；本人负责的工单；resolution_note必填。

审计事件：backflow_ticket.complete。副作用：保留超时历史，写resolved_at；补办不覆盖expired审计。

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

权限候选：人类九角色全部deny；system：ticket_deadline。权限行索引：`(role, backflow_ticket, expire)`。

校验：open/assigned且超过deadline。

审计事件：backflow_ticket.expire。副作用：超时告警，保留原责任人。

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

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行索引：`(role, evidence_package, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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
    "status": "sealed"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_package.create

`POST /tenants/{tid}/brands/{bid}/evidence-packages` · 语义 draft · destructive=false · 幂等=24h

权限候选：evidence；system：无。权限行索引：`(role, evidence_package, create)`。

校验：任务关联；作者created_by留痕。

审计事件：evidence_package.create。副作用：无业务副作用。

请求JSON（另带Idempotency-Key）：

```json
{
  "brand_id": "b1"
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

权限候选：evidence；system：无。权限行索引：`(role, evidence_package, revise)`。

校验：新行，新version；sealed不可变。

审计事件：evidence_package.revise。副作用：旧版保留；新队列重新审核。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "补充证据"
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

### evidence_package.approve

`POST /tenants/{tid}/brands/{bid}/evidence-packages/{id}/approve` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行索引：`(role, evidence_package, approve)`。

校验：对应waiting；非created_by；仅一次approve，不另设seal。

审计事件：evidence_package.approve。副作用：同时结算队列approved，写sealed_by/sealed_at。

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

权限候选：editor / owner / cs；system：无。权限行索引：`(role, evidence_package, export)`。

校验：仅sealed包的结论/来源元数据及模板；不含模型回答全文或受限摘录；模板属于包投影。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

## evidence_item

### evidence_item.read

`GET /tenants/{tid}/brands/{bid}/evidence-items/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行索引：`(role, evidence_item, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "ei1",
    "package_id": "ev1",
    "probe_id": "p1",
    "source_level": "L1",
    "conclusion_text": "可复核结论"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### evidence_item.create

`POST /tenants/{tid}/brands/{bid}/evidence-packages/{id}/items` · 语义 draft · destructive=false · 幂等=24h

权限候选：evidence；system：无。权限行索引：`(role, evidence_item, create)`。

校验：任务关联；仅draft包；excerpt不经普通read/export泄露。

审计事件：evidence_item.create。副作用：条目经父包继承tenant；sealed版不改。

请求JSON（另带Idempotency-Key）：

```json
{
  "conclusion_text": "结论示例",
  "probe_id": "p1",
  "source_level": "L1",
  "excerpt": "受限单条摘录"
}
```

响应JSON：

```json
{
  "data": {
    "id": "ei1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

## api_token

### api_token.read

`GET /tenants/{tid}/api-tokens` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行索引：`(role, api_token, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### api_token.create

`POST /tenants/{tid}/api-tokens` · 语义 write · destructive=false · 幂等=24h

权限候选：admin；system：无。权限行索引：`(role, api_token, create)`。

校验：per-user；scopes与该用户权限相交；只存token_hash，日志不含明文。

审计事件：api_token.create。副作用：创建令牌；不引入MCP能力。

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

### api_token.revoke

`POST /tenants/{tid}/api-tokens/{id}/revoke` · 语义 write · destructive=true · 幂等=24h

权限候选：admin；system：无。权限行索引：`(role, api_token, revoke)`。

校验：显式撤销，重复幂等；撤销后不允许请求。

审计事件：api_token.revoke。副作用：写revoked_at，不删除审计。

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

### api_token.record_use

`POST /internal/api-tokens/{id}/record-use` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：audit_middleware。权限行索引：`(role, api_token, record_use)`。

校验：认证服务层在成功认证后显式记录使用；只更改该token时间，不改业务对象状态。

审计事件：api_token.record_use。副作用：记录凭证元数据，不在日志中放明文。

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

## probe_batch

### probe_batch.read

`GET /tenants/{tid}/probe-batches/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs；system：无。权限行索引：`(role, probe_batch, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "bt1",
    "type": "baseline",
    "snapshot_id": "snp1",
    "status": "pending"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### probe_batch.create

`POST /tenants/{tid}/probe-batches` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：event_schedule。权限行索引：`(role, probe_batch, create)`。

校验：冻结配置；事件3目标+3对照，锚定版本未变；baseline/event/monthly；保存各簇锚定清单，执行/比较不得读取最新池替代该清单。

审计事件：probe_batch.create。副作用：独立batch_id；复测共用snapshot，probe_result可追加。

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

权限候选：cs；system：无。权限行索引：`(role, probe_batch, cancel)`。

校验：仅pending；其他状态409。

审计事件：probe_batch.cancel。副作用：终态保留不覆盖。

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

### probe_batch.compensate

`POST /tenants/{tid}/probe-batches/{id}/compensate` · 语义 write · destructive=false · 幂等=24h

权限候选：cs；system：无。权限行索引：`(role, probe_batch, compensate)`。

校验：仅failed；整批补偿；新batch同配置，禁止局部补跑。

审计事件：probe_batch.compensate。副作用：原批次保留dead-letter及告警；新批次全量执行；完整复制原批次范围/锚定清单，禁止混入旧批次部分成功结果。

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

### probe_batch.start

`POST /internal/probe-batches/{id}/start` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行索引：`(role, probe_batch, start)`。

校验：start仅pending，其余仅running；completed/failed/cancelled终态。

审计事件：probe_batch.start。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

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

### probe_batch.complete

`POST /internal/probe-batches/{id}/complete` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：probe_execute。权限行索引：`(role, probe_batch, complete)`。

校验：start仅pending，其余仅running；completed/failed/cancelled终态。

审计事件：probe_batch.complete。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

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

权限候选：人类九角色全部deny；system：probe_execute。权限行索引：`(role, probe_batch, fail)`。

校验：start仅pending，其余仅running；completed/failed/cancelled终态；整批尝试编号/结果提交草案：≤3次整批重试，成功只选完整一次尝试，不合并多次部分结果。

审计事件：probe_batch.fail。副作用：失败指数退避≤3次后整批failed+dead-letter告警；不得部分重试。

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

## publish_registration

### publish_registration.read

`GET /tenants/{tid}/brands/{bid}/publish-registrations/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / owner；system：无。权限行索引：`(role, publish_registration, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### publish_registration.register

`POST /tenants/{tid}/brands/{bid}/publish-registrations` · 语义 write · destructive=false · 幂等=24h

权限候选：editor；system：无。权限行索引：`(role, publish_registration, register)`。

校验：full本品牌；ready且全部当前必配块approved；仅记录不验证远端URL。

审计事件：publish_registration.register。副作用：排D+3/14/30；重新登记更新URL/时间，旧历史audit；不代发。

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

### publish_registration.advance

`POST /internal/publish-registrations/{id}/advance` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：publication_lifecycle。权限行索引：`(role, publish_registration, advance)`。

校验：registered→retesting：登记排期执行；retesting→reported：相关报告完成；reported终态不改。

审计事件：publish_registration.advance。副作用：重登记新增登记事件/审计历史，asset单独registered。

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

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行索引：`(role, diagnosis_report, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, diagnosis_report, create)`。

校验：结论能回到probe与来源；覆盖样本及§14门槛。

审计事件：diagnosis_report.create。副作用：交付前须FactCheck放行。

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

权限候选：factcheck；system：无。权限行索引：`(role, diagnosis_report, approve)`。

校验：对应waiting且非作者；样本与证据门槛通过。

审计事件：diagnosis_report.approve。副作用：同一步定稿+队列approved，不另设seal。

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

权限候选：owner / editor / cs；system：无。权限行索引：`(role, diagnosis_report, export)`。

校验：本品牌sealed，无模型原文或批量摘录；结论附probe_id/来源等级。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

权限候选：strategist；system：无。权限行索引：`(role, diagnosis_report, revise)`。

校验：作者Strategist；新行新版本，旧sealed不改；重新入通用审核队列。

审计事件：diagnosis_report.revise。副作用：新的waiting条目人工提交后再放行。

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

权限候选：admin；system：无。权限行索引：`(role, offboarding, read)`。

校验：按租户/品牌/任务范围查询；不返回raw_answer或C类原文。

审计事件：普通只读无业务审计。副作用：无业务副作用。GET不迁移对象状态；访问审计不算对象状态变更。

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

### offboarding.execute

`POST /tenants/{tid}/offboarding` · 语义 write · destructive=true · 幂等=24h

权限候选：admin；system：offboarding。权限行索引：`(role, offboarding, execute)`。

校验：显式解约；删除C类原文及raw_answer；合同可另定保留期。

审计事件：offboarding.execute。副作用：30天内删C原文/raw_answer，保留聚合及audit；2年在线后只读冷归档，不自动删；显式清理另走cleanup并独立ledger。

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

权限候选：admin；system：无。权限行索引：`(role, offboarding, cleanup)`。

校验：human人工执行；合同/法务明确授权；无自动到期清理；仅指定范围；不可删除ledger；Admin身份只代表配置履约职责，仍必须校验本次合同/法务授权依据，不能万能绕过。

审计事件：offboarding.cleanup。副作用：先可靠追加独立tombstone再清理，tombstone不随源消失；记录执行人/时间范围/依据。

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

## deletion_ledger

### deletion_ledger.read

`GET /tenants/{tid}/deletion-ledger` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：admin；system：无。权限行索引：`(role, deletion_ledger, read)`。

校验：同租户配置/审计职责；ledger不含原文或令牌。

审计事件：普通只读无业务审计。副作用：只读，不提供ledger删除操作。GET不迁移对象状态；访问审计不算对象状态变更。

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

### deletion_ledger.append

`POST /internal/deletion-ledger/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：offboarding。权限行索引：`(role, deletion_ledger, append)`。

校验：仅显式offboarding链路，独立追加；按合同/法务授权，不允许自由伪造actor。

审计事件：deletion_ledger.append。副作用：独立tombstone，生命周期不随源删除。

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

## 全部端点共享的错误示例

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
