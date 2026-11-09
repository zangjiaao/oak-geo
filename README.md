# oak-geo

> **让 AI 抄你，且抄得对。**
> Full-stack GEO (Generative Engine Optimization) platform — measure, fix, and verify how AI answers about your brand: demand pipeline → claim-block production → probe-based verification, one closed loop.

AI 时代用户不再搜索，而是提问。oak-geo 让品牌在模型回答里"被提到、被说对、被引到正确的场景"：

- **需求层**：从检索趋势与真实问句里找机会——热度档 + 结果页真空度双筛，词池周更、评分月批、事件复测三条时钟咬合；
- **生产层**：把内容切成模型愿意原样摘抄的**事实块**（Claim Block）——可引用四问校验、来源三级灯（L3 拦截）、意图必配闸门、独立 FactCheck 放行；
- **验证层**：冻结问句池 + 多模型探针复测——检索轨 / 记忆轨双口径，引用判定四步管道（指纹 + 显式链接），SOV 与事实准确率的可复核差值。

不代写代发、不承诺排名——只承诺**每条结论可回溯 `probe_id`，每次复测可比**。别人往模型里灌口径，我们做答案侧的测量与事实纪律。

```
┌────────────┐   机会卡    ┌────────────┐   内容资产   ┌────────────┐
│ 需求层      │ ─────────► │ 生产层      │ ─────────► │ 验证层      │
│ 找机会      │            │ 做内容      │            │ 测效果      │
└────────────┘ ◄───────── └────────────┘ ◄───────── └────────────┘
                缺口回流：弃簇重算 / 改稿补来源
```

## 文档导航

| 文件 | 内容 | 状态 |
|---|---|---|
| [`AGENTS.md`](./AGENTS.md) | 开发宪法：技术栈（已拍板）、行为铁律、架构硬约束、astryx UI 工作流 | v1.1 |
| [`docs/GEO产品文档.md`](./docs/GEO产品文档.md) | 产品唯一事实源：方法论 / 产品设计（含界面与用户旅程）/ 数据建模 / 决策记录 | v3.4 |
| [`docs/backlog.md`](./docs/backlog.md) | 33 个开发任务切片，带完成定义 | v1.0 |
| [`docs/api-spec-template.md`](./docs/api-spec-template.md) | API 契约与状态机设计模板（任务 T02 的输入） | 模板就绪 |

## 开发方式

本项目采用 **Agent 开发 + 人工关卡**：所有编码会话以 `AGENTS.md` 为第一读取物（含"歧义即停"清单与测试先红后绿纪律），任务从 `docs/backlog.md` 认领，**合并权在人**。MVP 不做清单与 13 条架构预留（Agent / MCP 预留）见 AGENTS.md §7 与产品文档 §15–16。

## 状态

- ✅ 产品设计定稿（v3.4，评审稿）
- ✅ 技术栈拍板：Next.js（App Router）+ astryx + Cloudflare Workers + Neon Postgres
- ⬜ 脚手架初始化（backlog T01）
- ⬜ API 契约与状态机（T02，agent 产出 → 人审冻结）

## Setup

> 脚手架尚未初始化（T01）。初始化后此处将补充安装与运行说明。UI 依赖 astryx：安装 `@astryxdesign/core` 后，须在应用入口 import `reset.css` 与 `astryx.css`（详见 `AGENTS.md` §11）。

## License

Private — 内部产品仓库。
