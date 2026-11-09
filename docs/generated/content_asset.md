# content_asset 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

