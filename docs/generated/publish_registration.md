# publish_registration 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

