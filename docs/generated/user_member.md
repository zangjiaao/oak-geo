# user_member 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

