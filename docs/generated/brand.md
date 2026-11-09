# brand 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

