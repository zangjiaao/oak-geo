# AGENTS.md — GEO 产品开发宪法

> 本文件是所有 Agent 开发会话的**第一读取物**。与产品文档冲突时，以 `docs/GEO产品文档.md`（唯一事实源）为准；两者都没写的事，按 §3"歧义即停"处理。
> 版本：v1.1 ｜ 事实源：`docs/GEO产品文档.md` v3.4

## 1. 项目是什么

GEO：让品牌在 AI 回答里"被提到、被说对、被引到正确场景"的全链路产品（需求层找机会 → 生产层做内容 → 验证层测效果）。**开发前必读**：产品文档 §9（总览）、§17–19（数据建模与硬规则）、§13（页面）、§14（MVP 范围与验收）。

## 2. 技术栈（已拍板 v1.1——agent 不准改）

```
前端框架：      Next.js（App Router）
UI 组件体系：    astryx（@astryxdesign/core，官方块见 §11）
后端运行时：     Cloudflare Workers
数据库：        Postgres（Neon，经 Hyperdrive 连接池；迁移文件进 migrations/）
模型 API 层：    通义（enable_search）、豆包/Volcano（联网插件）、智谱（web_search）、混元（搜索增强）四家 + 适配器抽象（T14）。选型硬标准：**API 必须原生支持联网检索**（产品文档 §4 双轨口径）；T14 动工当日以各家当期文档复核一遍，能力变动即停下问人；无联网的不进被测集。judge 从非被测厂商另选（厂商隔离，§15.3）
SERP API：      SerpAPI（支持 Google 与 Baidu 引擎；采购时核实当期价格与 Baidu 引擎支持）
部署：          Cloudflare Workers（Next.js 经 @opennextjs/cloudflare 适配）；本地 wrangler dev
```

技术栈一经拍板，写死在此处。**任何会话不得引入新框架、新状态管理库、新 ORM**；确有必要时停下问人。

## 3. 五条行为铁律（对 agent 自身）

1. **事实源优先**：产品口径（采样参数、数字、阈值、承诺用语）只准引用产品文档，**不准自行编造或"优化"**。改产品口径 = 停下问人。
2. **歧义即停**：遇到以下清单内的问题没在文档里写死，**停下来输出问题清单，不准猜**：
   - 采样参数（问句数 / 模型清单 / 温度 / 轮次）
   - 对外数字与口径（28–29 亿等口径纪律，产品文档 §6）
   - 权限规则的边界案例（§9.3 矩阵没覆盖的组合）
   - 状态枚举与迁移（以冻结的 `docs/api-spec.md` 为准，没写的不准发明）
   - 判定规则细节（以冻结的 `docs/judging-spec.md` 为准）
3. **测试先红后绿**：每个任务先让硬规则测试变红，再实现到绿。**测试清单全绿是任务完成的必要条件**，"我觉得写完了"不算。
4. **写操作必须走服务层**：任何数据变更必须经过 `src/server/api` 层的显式状态迁移操作；**禁止任何直写数据库的路径**（包括脚本、seed、临时修复）。架构测试会扫，扫到即打回。
5. **不越"不做清单"**：见 §7。遇到"顺手实现一下"的诱惑，拒绝并记录到任务备注。

## 4. 架构硬约束（13 条预留的代码级表述，全文见产品文档 §16.3）

1. 所有写操作：服务层 API + **服务端**权限校验（权限矩阵是服务端的，前端只是展示）。
2. 状态迁移 = 显式 API 操作（`draft → pending_review → approved → …`），禁止裸 update 字段改状态。
3. `audit_log` 三字段**从第一天就写**：`actor_type(human/agent/external_agent)`、`agent_run_id`、`prompt_version`。所有写操作与所有原始回答 / C 类数据访问必须留痕。
4. `scoring_snapshot.judge_version` 从第一行代码就存在且必填（MVP 填 `rule_manual_v1`）。
5. 审核队列是通用结构（`object_type + object_id`），**不准写死两种类型**。
6. 配额计量按操作类型分粒度（probe / judge / drafting），从第一版就分开计数。
7. API 响应必带口径元数据：`snapshot_id` / `data_as_of`；对比类接口两端口径不一致时返回 `incomparable` 标记，**不给差值**。
8. 鉴权双凭证：Web 会话 + per-user API Token（PAT），同一权限矩阵；PAT 为 §16 MCP 预留。

## 5. 数据与口径铁律（18 条全文见产品文档 §19，最易犯错的前 6 条）

1. 同一 `(cluster_id, snapshot_id)` 只写一次；重跑开新快照，旧数据不覆盖。
2. `n_valid < 10` 或模型覆盖 < 3 → `*_score` 必须为 null + `insufficient_sample=true`；**禁止 0 或均值填充**。
3. 不设 `search_volume` 字段；任何界面 / API 出现"月搜索 X 次"即 bug。
4. `refused=true` 的回答不进任何分母。
5. `question_pool` 溯源五字段任一为空不入库；冻结后修改一律开新版本。
6. L3 来源不进 `claim_block`；提交侧拦截，不是事后过滤。

## 6. 合规红线（代码级）

- C 类数据入库前必须过脱敏管道（PII 规则在 ETL 内，不靠人工）；解约删除任务 30 天期限。
- 原始回答全文：权限校验在服务端；客户角色只能经异议通道单条调阅，**不存在批量导出接口——连内部调试接口都不许有**。
- 竞品数据：聚合层与原文层分离（§9.3），分层校验在查询层实现。

## 7. MVP 不做清单（§14，实现了即打回）

Agent Runtime 与 MCP Server、自动爬虫（B 类采集是人工+半自动：CSV 导入）、代发 / 自动分发 / 一键群发、多行业模板、线索归因看板、私有化部署、客户端编辑权限之外的任何写入口（Editor 只能在内容工作台写）。

**13 条预留是纪律不是功能**：不实现 Agent，但字段、分层、通用队列必须按 §4 落地。

## 8. 工作流

```
认领 `docs/backlog.md` 中状态为 todo 的任务
→ 读关联的产品文档章节 + 冻结的规格文件（`docs/api-spec.md` / `docs/judging-spec.md`）
→ 先写/更新测试（红）
→ 实现（绿）
→ 自查：§4 §5 硬约束逐条过一遍
→ 停下：输出 diff 摘要 + 测试结果，等人审合并
```

**合并权在人**。agent 不准自行合并、不准自行改 AGENTS.md、不准自行冻结规格文件。

## 9. 代码与提交规范

- 目录约定：`src/server/api`（服务层）/ `src/server/jobs`（批处理）/ `src/app`（页面）/ `migrations/`（数据库迁移）/ `tests/rules`（硬规则测试）/ `tests/arch`（架构测试）
- 每任务一个分支 / 一个提交序列，提交信息格式：`[Txx] 一句话`。
- 数据库变更一律走迁移文件，禁止手改库。
- UI 采用 astryx：遵守 §11 官方块的工作流（模板起步、无裸 div、token 化样式、交付前 `astryx doctor`）。

## 10. 规格文件索引（冻结后即为法律）

| 文件 | 内容 | 状态 |
|---|---|---|
| `docs/GEO产品文档.md` | 产品唯一事实源 | v3.4 冻结 |
| `docs/api-spec.md` | API 契约 + 状态机 | 模板就绪（`docs/api-spec-template.md`），待 T02 产出并人审冻结 |
| `docs/judging-spec.md` | MVP 判定规则（正则+词表+spec_score） | 待 T16 前产出并人审冻结 |
| `docs/backlog.md` | 任务切片与完成定义 | v1.0 |

## 11. UI 组件体系（astryx 官方块，原样嵌入）

> 本仓库 UI 一律用 astryx（§2 已拍板）。以下块由 astryx 官方提供、由 astryx CLI 自动维护（**ASTRYX:START/END 标记内的内容不要手改**）。前提：安装 `@astryxdesign/core` 依赖，并在应用入口 import 块内 SETUP 的两行 CSS。

<!-- ASTRYX:START -->
Astryx v0.7.4 · 173 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
