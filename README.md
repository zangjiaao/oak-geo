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
| [`docs/GEO产品文档.md`](./docs/GEO产品文档.md) | 产品唯一事实源：方法论 / 产品设计（含界面与用户旅程）/ 数据建模 / 决策记录 | v3.5 |
| [`docs/backlog.md`](./docs/backlog.md) | 36 个开发任务切片，带完成定义 | v1.0 |
| [`docs/api-spec-template.md`](./docs/api-spec-template.md) | API 契约与状态机设计模板（任务 T02 的输入） | 模板就绪 |

API 规格从 [`docs/spec-map.md`](./docs/spec-map.md) 开始审阅；核心集、权限、状态机和抽检附录集中在 `docs/api/`。历史验证记录放在 `docs/archive/`。

## 开发方式

本项目采用 **Agent 开发 + 人工关卡**：所有编码会话以 `AGENTS.md` 为第一读取物（含"歧义即停"清单与测试先红后绿纪律），任务从 `docs/backlog.md` 认领，**合并权在人**。MVP 不做清单与 13 条架构预留（Agent / MCP 预留）见 AGENTS.md §7 与产品文档 §15–16。

## 状态

- ✅ 产品设计定稿（v3.5）
- ✅ 技术栈拍板：Next.js（App Router）+ astryx + Cloudflare Workers + Neon Postgres
- ✅ T01 脚手架、T02 API 规格（t02_api_v1，人审冻结）、T03 测试红灯基线已合并
- T04 数据库迁移与服务层开发 fixture 待人审

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

`build` 是 Next.js 构建，`build:worker` 再生成 `.open-next/worker.js` 与静态资源。发布前必须先构建；`npm run deploy` 会发布到 Cloudflare，仅在人审授权后执行。当前无需 Cloudflare 账号即可本地构建/预览，尚未配置线上 Neon/Hyperdrive 绑定或 Web/PAT 业务鉴权；T04 仅提供受信开发环境中的迁移和 fixture 服务，没有公开业务路由。

配置参考：[OpenNext 官方接入说明](https://opennext.js.org/cloudflare/get-started)、[Cloudflare Next.js 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)。未启用 ISR/R2 缓存或数据库绑定，后续按任务接入。

测试采用 Node 内置测试运行器；隔离关闭以适应本地受限环境。当前可验证的规格与架构检查，以及T03产品验收红灯基线，分开报告；不能据此声称业务规则已验证。

T03 已建立真实服务层验收的红灯基线：`npm run test:checks`验证当前规格和静态架构守卫，`npm run test:product`运行产品硬规则及运行时鉴权检查，`npm test`包含两者。服务尚未接入时后者应失败；这表示业务能力未验收，不能用跳过或假实现转绿。后续任务在 `tests/support/runtime-driver.mjs` 连接真实服务操作并用服务API准备fixture；用例与负责任务的映射见 `tests/rules/product-rule-cases.mjs`。

## 数据库（T04）

`migrations/0001_core.sql` 至 `0004_opportunity_status.sql`覆盖产品§18当前29张业务表（原18为历史计数），另有迁移账本`schema_migration`。使用原生`pg`驱动，不引入ORM。所有列有注释；版本/分数唯一约束、租户复合外键、冻结与终态守卫在数据库兜底。四个API投影不被擅自扩成四张业务表。机会卡英文存储码与冻结API中文值经服务层映射，表见`t02-decisions.md`；0004仅重编码，原迁移校验和保留。

对明确指定的开发数据库执行（连接串由环境注入，不写进仓库）：

```sh
# DATABASE_URL = 目标开发库的直连 Postgres URL；GEO_MIGRATION_ACTOR = 执行人标识
npm run db:migrate
npm run db:fixture
npm run test:db
```

迁移由服务层加锁、按文件事务执行，账本校验SHA-256；重复运行跳过已应用文件，已应用内容变更会拒绝，失败回滚DDL与账本。`db:fixture`同样只调用服务层，事务内创建虚构“简造 ERP”租户、独立写/审成员、已封版词表v1（含exclusion）、已批准L1测试口径和公共词根；重复载入不复制数据。fixture不含真实客户原文，也不代表T31全链路已完成。

三张行业共享表没有`tenant_id`；原始词及品牌级表保持租户归属。共享服务仅接受受信公共词根目录，拒绝已知客户标识与私有词句，输出限定为公共词根及数值聚合；自由文本备注不进入投影，对外基准出口暂不开放。T07/T10接入真实词池时仍须遵守这一边界。

私有表已启用RLS且未放行策略：普通非owner角色默认拒绝；T05负责运行身份、完整权限矩阵及行级策略，T06负责通用审计。迁移/fixture需要库管理连接，不是Web/PAT鉴权替代品。线上Workers后续通过Hyperdrive绑定传入`connectionString`，直连URL仅用于管理命令；驱动依据[Cloudflare官方pg接入方式](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)。

`test:db`使用生产依赖树中按平台安装的真实PostgreSQL18.6，在Linux/macOS临时目录启动Unix socket，结束后销毁，不读取`DATABASE_URL`。`test:checks`包含该集成测试；T03的23个产品/运行时鉴权验收仍独立跑红，待负责任务接入真实服务后逐条转绿，不能把本次数据库检查通过写成全产品测试通过。

## License

Private — 内部产品仓库。
