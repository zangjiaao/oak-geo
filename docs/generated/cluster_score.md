# cluster_score 支撑端点

> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。

[返回主入口](../spec-map.md)

### cluster_score.append

`POST /internal/cluster-scores/append` · 语义 write · destructive=false · 幂等=24h

权限候选：人类九角色全部deny；system：baseline_scoring。权限行：`(role, cluster_score, append)`。审阅风险：承重动作。

校验：仅基线评分；(cluster,snapshot)唯一；不足样本分数null；同一事务先写问句分数再写簇分数，保留原question_score内部表，不再有独立API族。

审计：cluster_score.append。副作用：服务层追加，不覆盖配置下已有分数。

请求JSON（另带Idempotency-Key）：

```json
{
  "cluster_id": "c1",
  "snapshot_id": "snp1",
  "question_scores": [
    {
      "question_id": "q1",
      "snapshot_id": "snp1"
    }
  ]
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

