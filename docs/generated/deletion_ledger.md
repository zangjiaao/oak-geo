# deletion_ledger 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

