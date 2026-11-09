# diagnosis_report 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### diagnosis_report.read

`GET /tenants/{tid}/brands/{bid}/diagnosis-reports/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / evidence / owner / editor；system：无。权限行：`(role, diagnosis_report, read)`。审阅风险：承重动作。

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

权限候选：strategist；system：无。权限行：`(role, diagnosis_report, create)`。审阅风险：承重动作。

校验：结论能回到probe与来源；覆盖样本及§14门槛。

审计：diagnosis_report.create。副作用：交付前须FactCheck放行。

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

权限候选：factcheck；system：无。权限行：`(role, diagnosis_report, approve)`。审阅风险：承重动作。

校验：对应waiting且非作者；样本与证据门槛通过。

审计：diagnosis_report.approve。副作用：同一步定稿+队列approved，不另设seal。

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

权限候选：owner / editor / cs；system：无。权限行：`(role, diagnosis_report, export)`。审阅风险：承重动作。

校验：本品牌sealed，无模型原文或批量摘录；结论附probe_id/来源等级。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

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

权限候选：strategist；system：无。权限行：`(role, diagnosis_report, revise)`。审阅风险：承重动作。

校验：作者Strategist；新行新版本，旧sealed不改；重新入通用审核队列。

审计：diagnosis_report.revise。副作用：新的waiting条目人工提交后再放行。

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

