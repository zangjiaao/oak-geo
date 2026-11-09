# opportunity_card 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

