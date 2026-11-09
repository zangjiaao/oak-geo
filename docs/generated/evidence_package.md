# evidence_package 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

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

