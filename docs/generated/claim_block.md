# claim_block 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### claim_block.read

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / editor / content；system：无。权限行：`(role, claim_block, read)`。审阅风险：承重动作。

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
    "id": "cl1",
    "version": 1,
    "status": "draft",
    "source_level": "L1"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.reject

`POST /tenants/{tid}/brands/{bid}/claim-blocks/{id}/reject` · 语义 write · destructive=false · 幂等=24h

权限候选：factcheck；system：无。权限行：`(role, claim_block, reject)`。审阅风险：承重动作。

校验：仅pending_review，waiting队列条目未结算；reason必填。

审计：claim_block.reject。副作用：approve/reject原子结算队列；retract追同源块并重算asset。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "来源需补充"
}
```

响应JSON：

```json
{
  "data": {
    "id": "cl1",
    "status": "draft"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### claim_block.citations

`GET /tenants/{tid}/brands/{bid}/claim-blocks/{id}/citations` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence；system：无。权限行：`(role, claim_block, citations)`。审阅风险：承重动作。

校验：关联任务，返回聚合不含全文。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "probe_ids": [
      "p1"
    ],
    "cited_claim_ids": [
      "cl1"
    ]
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

