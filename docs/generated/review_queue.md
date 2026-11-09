# review_queue 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### review_queue.read

`GET /tenants/{tid}/brands/{bid}/review-queue` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：factcheck；system：无。权限行：`(role, review_queue, read)`。审阅风险：承重动作。

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
        "id": "rv1",
        "object_type": "claim_block",
        "object_id": "cl1",
        "status": "waiting"
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

### review_queue.submit

`POST /tenants/{tid}/brands/{bid}/review-queue/submit` · 语义 write · destructive=false · 幂等=24h

权限候选：evidence / strategist；system：无。权限行：`(role, review_queue, submit)`。审阅风险：承重动作。

校验：作者本人；只收三个MVP类型；plan_draft仅预留不接受。

审计：review_queue.submit。副作用：入waiting，通知FactCheck。

请求JSON（另带Idempotency-Key）：

```json
{
  "object_type": "evidence_package",
  "object_id": "ev1"
}
```

响应JSON：

```json
{
  "data": {
    "id": "rv2",
    "status": "waiting"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### review_queue.withdraw

`POST /tenants/{tid}/brands/{bid}/review-queue/{id}/withdraw` · 语义 write · destructive=false · 幂等=24h

权限候选：editor / content / evidence / strategist；system：无。权限行：`(role, review_queue, withdraw)`。审阅风险：承重动作。

校验：waiting唯一出发态；approve非作者；reject理由必填；withdraw作者本人；Editor/Content只能撤回本人claim_block，入口属于内容工作台。

审计：review_queue.withdraw。副作用：原子修改对象态及队列终态；无通用裸状态update。

请求JSON（另带Idempotency-Key）：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "id": "rv1",
    "status": "withdrawn"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

