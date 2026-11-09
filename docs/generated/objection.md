# objection 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

