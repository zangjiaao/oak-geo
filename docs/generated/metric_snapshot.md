# metric_snapshot 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### metric_snapshot.read

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/{id}` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：strategist / factcheck / cs / owner / viewer / editor；system：无。权限行：`(role, metric_snapshot, read)`。审阅风险：承重动作。

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
    "id": "m1",
    "snapshot_id": "snp1",
    "batch_id": "bt1",
    "mention_rate": 0.5,
    "citation_rate": 0.25
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### metric_snapshot.export

`GET /tenants/{tid}/brands/{bid}/metric-snapshots/{id}/report` · 语义 read-only · destructive=false · 幂等=不适用

权限候选：owner / viewer / cs；system：无。权限行：`(role, metric_snapshot, export)`。审阅风险：承重动作。

校验：报告脱敏，不含raw_answer；披露我方生产+对照组；不可比不出差值报告。

审计：普通只读无业务审计。副作用：无业务副作用。GET不迁移业务对象状态。

请求查询参数：

```json
{}
```

响应JSON：

```json
{
  "data": {
    "download_ref": "短时报告引用",
    "produced_by_us": true,
    "control_cluster_ids": [
      "c4",
      "c5",
      "c6"
    ]
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

### metric_snapshot.append

`POST /internal/metric-snapshots/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：metric_aggregate。权限行：`(role, metric_snapshot, append)`。审阅风险：承重动作。

校验：按批次追加，历史不可变；拒答排除；显式/隐式引用计算层推导；citation_rate仅规范化URL全等explicit；指纹及仅域名命中只内部分析；仅completed批次选定完整尝试，禁止从failed批次或多次部分尝试拼样本。

审计：metric_snapshot.append。副作用：不写cluster_score；触发回流扫描。

请求JSON（另带Idempotency-Key）：

```json
{
  "batch_id": "bt2",
  "snapshot_id": "snp1",
  "cluster_id": "c1",
  "committed_attempt_no": 1
}
```

响应JSON：

```json
{
  "data": {
    "id": "m2"
  },
  "meta": {
    "snapshot_id": "snp1",
    "data_as_of": "2026-11-09T00:00:00Z"
  }
}
```

