# backflow_ticket 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### backflow_ticket.read

`GET /tenants/{tid}/brands/{bid}/backflow-tickets/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, backflow_ticket, read)`。审阅风险：承重动作。

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
    "id": "tk1",
    "status": "open",
    "signal_type": "cited_wrong"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.create

`POST /internal/backflow-tickets` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：backflow_scan。权限行：`(role, backflow_ticket, create)`。审阅风险：承重动作。

校验：§8五信号；cited_wrong urgent且deadline24h；证据链必填。

审计：backflow_ticket.create。副作用：出工单通知责任角色。

请求JSON（另带Idempotency-Key）：

```json
{
  "signal_type": "cited_wrong",
  "cluster_id": "c1",
  "evidence_probe_ids": [
    "p1"
  ],
  "trigger_metric_id": "m1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "open"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.complete

`POST /tenants/{tid}/brands/{bid}/backflow-tickets/{id}/complete` · 语义 write · destructive=false · 幂等=24h

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, backflow_ticket, complete)`。审阅风险：承重动作。

校验：assigned或expired；本人负责的工单；resolution_note必填。

审计：backflow_ticket.complete。副作用：保留超时历史，写resolved_at；补办不覆盖expired审计。

请求JSON（另带Idempotency-Key）：

```json
{
  "resolution_note": "已修正并安排复测",
  "followup_batch_id": "bt2"
}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "done"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### backflow_ticket.expire

`POST /internal/backflow-tickets/{id}/expire` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：ticket_deadline。权限行：`(role, backflow_ticket, expire)`。审阅风险：承重动作。

校验：open/assigned且超过deadline。

审计：backflow_ticket.expire。副作用：超时告警，保留原责任人。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "tk1",
    "status": "expired"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

