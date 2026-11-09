# cluster_platform_signal 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### cluster_platform_signal.read

`GET /tenants/{tid}/brands/{bid}/cluster-platform-signals` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, cluster_platform_signal, read)`。审阅风险：承重动作。

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
        "cluster_id": "c1",
        "platform": "官网",
        "model_citation_count": 1
      }
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  },
  "next_cursor": null
}
```

### cluster_platform_signal.append

`POST /internal/platform-signals/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行：`(role, cluster_platform_signal, append)`。审阅风险：承重动作。

校验：基线评分顺带产生；计数可回溯probe。

审计：cluster_platform_signal.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "snapshot_id": "snp1"
}
```

响应JSON：

```json
{
  "data": {
    "recorded": true
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

