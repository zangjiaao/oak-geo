# industry_score 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

