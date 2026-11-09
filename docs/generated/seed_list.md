# seed_list 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### seed_list.read

`GET /tenants/{tid}/seed-lists` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs；system：无。权限行：`(role, seed_list, read)`。审阅风险：承重动作。

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
        "id": "s1",
        "maintainer": "张三",
        "seed_version": 1
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

### seed_list.create

`POST /tenants/{tid}/seed-lists` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, seed_list, create)`。审阅风险：承重动作。

校验：维护人具体人名、复核时间必填；word_type产品枚举。

审计：seed_list.create。副作用：新版本；无maintainer不开管道。

请求JSON（另带Idempotency-Key）：

```json
{
  "word": "排产",
  "word_type": "场景",
  "maintainer": "张三",
  "last_reviewed_at": "2026-11-09T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "id": "s1",
    "seed_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### seed_list.revise

`POST /tenants/{tid}/seed-lists/{id}/revisions` · 语义 draft · destructive=false · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, seed_list, revise)`。审阅风险：承重动作。

校验：新版本，旧版保留。

审计：seed_list.revise。副作用：生成语法只造词，预览确认后调用本操作。

请求JSON（另带Idempotency-Key）：

```json
{
  "word": "自动排产",
  "maintainer": "张三",
  "last_reviewed_at": "2026-11-09T00:00:00Z"
}
```

响应JSON：

```json
{
  "data": {
    "id": "s2",
    "seed_version": 2
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

