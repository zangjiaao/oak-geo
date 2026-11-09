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
- 待人审：脚手架初始化（本次 T01）
- ⬜ API 契约与状态机（T02，agent 产出 → 人审冻结）

## Setup

Next.js App Router + OpenNext Workers，首页来自 astryx AppShellContentOnly 模板。

本地需要 Node.js 22.13.0 或更高版本：

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

在 Workers 运行时预览：

```sh
npm run build:worker
npm run dev:worker
# 或 npm run preview（构建后启动 Wrangler）
```

检查：

```sh
npm test
npm run typecheck
npm run build:worker
npm run doctor
```

`build` 是 Next.js 构建，`build:worker` 再生成 `.open-next/worker.js` 与静态资源。发布前必须先构建；`npm run deploy` 会发布到 Cloudflare，仅在人审授权后执行。当前无需 Cloudflare 账号即可本地构建/预览，尚未配置 Neon/Hyperdrive 或业务鉴权，不提供任何业务数据写入口。

配置参考：[OpenNext 官方接入说明](https://opennext.js.org/cloudflare/get-started)、[Cloudflare Next.js 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)。未启用 ISR/R2 缓存或数据库绑定，后续按任务接入。

测试采用 Node 内置测试运行器；隔离关闭以适应本地受限环境。当前覆盖脚手架约束，完整产品硬规则及权限测试属 T03，不能据此声称业务规则已验证。

## License

Private — 内部产品仓库。
