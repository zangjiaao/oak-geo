# 文档归档

> 当前工作从[文档入口](../README.md)开始。本目录按需查阅，不属于方法论验证的必读或待实现清单。

| 归档 | 用途 |
|---|---|
| [产品 v3.5 快照](GEO产品文档-v3.5.md) | 原详设全文，保留旧页面、数据模型、评分假设与决策上下文 |
| [API 规格](reference/api-spec.md)与[审阅地图](reference/spec-map.md) | 既有冻结调用约束；仅实现相关功能时查阅 |
| [核心端点](reference/api/core-set.md)、[状态机](reference/api/states.md)、[支撑端点](reference/api/generated/endpoints.md) | 从未改变的机器契约生成的详细视图 |
| [API 模板](reference/api-spec-template.md) | 历史设计模板，不覆盖已批准规格 |
| [T02 裁定](reference/t02-decisions.md) | 历史批准原文，不用旧任务执行边界覆盖当前用户授权 |
| [T05 接线](reference/t05-wiring.md)、[T05 审阅](reference/t05-review.md)、[T07 简报](reference/t07-review.md) | 当时实现、测试与审阅状态，不代表当前排期 |
| [T01 验证](T01-validation.md) | 历史脚手架验证，不证明GEO方法有效 |

归档保留批准依据，不改变运行时权限、状态、数据或采样。`docs/api/contracts.json` 与 `docs/api/permissions.csv` 仍由现有代码／测试消费，不搬迁、不改内容。新需求先由实验发现，再提出具体变更，不默认恢复归档功能。
