# intent_cluster 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### intent_cluster.read

`GET /tenants/{tid}/brands/{bid}/clusters/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / content / evidence / owner / editor / viewer；system：无。权限行：`(role, intent_cluster, read)`。审阅风险：承重动作。

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
    "id": "c1",
    "question_pool_version": 1,
    "status": "active"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.archive

`POST /tenants/{tid}/brands/{bid}/clusters/{id}/archive` · 语义 write · destructive=true · 幂等=24h

权限候选：strategist；system：无。权限行：`(role, intent_cluster, archive)`。审阅风险：承重动作。

校验：只能active→archived；§8三条件；保留90天分母。

审计：intent_cluster.archive。副作用：软删除；过渡补位，单期变化>20%暂停复核。

请求JSON（另带Idempotency-Key）：

```json
{
  "reason": "需求消退",
  "evidence_probe_ids": [
    "p1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "id": "c1",
    "status": "archived"
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### intent_cluster.transition

`POST /internal/clusters/transition` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：weekly_pool。权限行：`(role, intent_cluster, transition)`。审阅风险：承重动作。

校验：词池周批稳定ID匹配与规则归簇；只新增active或更新需求快照引用，不改已锚定question_pool_version，不恢复archived；只允许本资源状态表命名事件，不接受任意status裸更新。

审计：intent_cluster.refresh。副作用：周快照与双筛候选联动；拆并只提案，人工upgrade后重开基线，不自动换题。

请求JSON（另带Idempotency-Key）：

```json
{
  "pool_version": 2,
  "representative_word_ids": [
    "k1"
  ]
}
```

响应JSON：

```json
{
  "data": {
    "cluster_id": "c1",
    "status": "active",
    "pool_version": 2,
    "question_pool_version": 1
  },
  "meta": {
    "snapshot_id": null,
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

