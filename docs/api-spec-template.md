# API 契约与状态机设计规格 · 模板

> 这是任务 T02 的输入模板与输出框架：agent 按本模板产出 `api-spec.md` 全量条目，**人审通过后冻结**，此后所有会话只准实现、不准修改（改动 = 新任务 + 人审）。
> 输入事实源：`GEO产品文档.md` §9（角色与权限）、§12（验证层）、§17–19（数据建模与硬规则）、§13（页面与交互）。

## 0. 冻结流程与审阅 checklist

产出后按此清单人审，全部通过才冻结：

- [ ] 权限矩阵全覆盖：§9.3 每个 角色 × 资源 × 操作 组合都有明确 allow/deny，无"默认允许"
- [ ] 状态机无死路：每个对象的每个状态都有出边或明确终态；无环状漂移
- [ ] 所有写操作都是显式状态迁移操作（对照产品文档 §8 泳道图），无裸字段更新
- [ ] 每个写操作定义了：审计事件、幂等性、权限行、副作用（通知/排期/级联）
- [ ] 对比/差值类接口都带快照口径校验，不一致返回 `incomparable`
- [ ] 操作语义三级标注（read-only / draft / proposal / write）齐全——这是将来 MCP 注解的来源
- [ ] 原始回答与竞品原文的访问接口：客户角色仅异议通道单条，无批量导出端点

## 1. 全局约定（先定这些，再写资源）

**鉴权**：双凭证——Web 会话 + per-user API Token（PAT）。每个请求解析出 `(user, role, tenant, actor_type)`；权限校验在服务端策略层，路由只做转发。

**请求/响应**：
- 所有列表接口分页（`cursor`）；单响应 ≤ 20KB（MCP 预留），大对象走"摘要 + 下钻"两级
- 所有响应带口径元数据：`snapshot_id?`、`data_as_of`、`pool_version?`
- 错误码约定：`403 权限 / 409 状态冲突（非法迁移）/ 422 校验失败（附字段）/ 409002 incomparable / 429 配额`
- 幂等：写操作带 `Idempotency-Key`

**限流与配额**：按 `(tenant, operation_type)` 计数（probe / judge / drafting 分开）；超限 `429` + 告警事件。

## 2. 资源清单（从 18 张表映射，逐个填）

每个资源一节，按此模板（示例：`claim_block` 已填，其余照做）：

```
资源 claim_block（事实块）
  基础路径：/tenants/{tid}/brands/{bid}/claim-blocks

  操作（每个 = 一行，写操作必须是状态迁移）：
  | 操作 | 方法+路径 | 语义级 | 允许角色 | 幂等 | 审计事件 | 副作用 |
  |---|---|---|---|---|---|---|
  | 创建草稿 | POST /claim-blocks | draft | editor, content | 是 | claim.create | 进审核队列 |
  | 修改草稿 | POST /{id}/revisions | draft | 作者本人 | 是 | claim.revise | 旧版只读，新版本 |
  | 提交审核 | POST /{id}/submit | write | 作者本人 | 是 | claim.submit | 状态→pending_review；队列入列 |
  | 放行 | POST /{id}/approve | write | factcheck（≠作者） | 是 | claim.approve | 状态→approved；可进发布登记 |
  | 驳回 | POST /{id}/reject {reason} | write | factcheck | 是 | claim.reject | 回作者；理由必填 |
  | 下线修正 | POST /{id}/retract {reason} | write | factcheck | 是 | claim.retract | "说错"回流用；新版本走 re-submit |
  | 读取 | GET /{id} | read-only | 按 §9.3 | — | — | — |
  | 引用命中查询 | GET /{id}/citations | read-only | 内部 | — | — | 聚合 cited_claim_ids |

  校验规则（服务端强制）：
  - 四问校验：number/unit/scope/source_url 非空（§6）
  - 来源灯：source_level=L3 拒绝（§11）
  - 必配闸门：提交整篇文章时按意图查推导规则表（§6），缺配拒整个提交
  - 段落自包含：悬空指代正则清单（judging-spec 冻结后引用）
  - 口径冲突：同 number+unit 跨版本不一致 → 警告事件（不阻断，进回流分析）
```

需要产出条目的资源：`tenant`、`brand`、`user_member`、`seed_list`、`keyword_raw`（导入）、`intent_cluster`（含归档迁移）、`question_pool`（含版本冻结迁移）、`opportunity_card`、`scoring_snapshot`（触发评分批次）、`claim_block`（上例）、`content_asset`、`probe_result`（判定写入）、`publish_registration`、`evidence_package`（封版迁移）、`objection`（异议申请）、`metric_snapshot`（报告读取）、`backflow_ticket`（回流工单）。

## 3. 状态机规格（逐对象填写）

每个对象一张迁移表。示例（`claim_block`，其余照做）：

```
对象 claim_block
  状态：draft → pending_review → approved → published(登记后) → revision_needed / retracted

  | 迁移 | 触发 | 角色 | 前置条件 | 副作用 |
  |---|---|---|---|---|
  | draft→pending_review | submit | 作者 | 四问过、来源≠L3、必配齐 | 入审核队列，通知 factcheck |
  | pending_review→approved | approve | factcheck | 审核人≠作者 | 可发布登记 |
  | pending_review→draft | reject | factcheck | 理由非空 | 通知作者 |
  | approved→retracted | retract | factcheck | "说错"工单关联 | 触发同源追溯查询 |
  | retracted→draft | 重新修订 | 作者 | 新版本号 | 走正常 submit 流 |
```

需要状态机的对象清单：`claim_block`、`content_asset`、`opportunity_card`（候选→评分→建议→确认→在测→归档）、`intent_cluster`（active→archived，含 90 天分母过渡）、`question_pool`（open→frozen→archived，拆并迁移开新版本）、`scoring_snapshot`（open→frozen）、`evidence_package`（draft→sealed）、`objection`（submitted→granted→viewed，含水印审计）、`backflow_ticket`（open→assigned→done，超时升级）、`publish_registration`（none→registered→retesting→reported）。

## 4. 批处理与事件（jobs，不一定是 API 但要有契约）

| Job | 触发 | 幂等窗口 | 副作用 |
|---|---|---|---|
| 词池周批 | cron 周一 | pool_version 唯一 | 快照、告警、候选队列刷新 |
| 评分批次 | 手动/月度 | (cluster,snapshot) 只写一次 | cluster_score、渠道信号 |
| 事件复测排期 | 发布登记 | 排期唯一 | probe 批次 |
| 引用判定 | 复测批次落库后 | probe_result 级 | cited_claim_ids、cited_domains |
| 回流信号扫描 | metric_snapshot 落库后 | 批次级 | 工单生成 |
| 基线重置 | 模型版本变更事件 | 事件级 | 全量重跑 + 报告标注 |

## 5. 语义分级汇总表（MCP 注解的将来来源）

产出一张总表：`操作 → read-only / draft / proposal / write`，写操作同时标注 `destructive` 与否（retract、archive 是 destructive）。这张表冻结后，P2 的 MCP Server 直接映射 `readOnlyHint / destructiveHint`。
