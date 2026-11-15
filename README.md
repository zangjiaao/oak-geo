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
- ✅ T04 数据库迁移与服务层开发 fixture 已合并（PR #6）
- ✅ T05 权限/RLS/审计已合并（PR #7）；T06 审计由 T05 吸收完成
- ✅ T07 种子表服务层 CRUD 与行业共享路径已合并（PR #8）
- ✅ T08 生成语法面板已按负责人授权合并（PR #9）
- ✅ T09 CSV 导入与模板下载已合并（PR #10）
- ✅ T10 词池周批代码已合并（PR #11）；规则草案尚未冻结，真实周批默认关闭
- ✅ T11 飙升信号与策略站内通知已合并（PR #12）；首轮真实试跑目标为工作室自营工具/产品。当前登录入口尚未交付，网页写入仍需有效会话

- T12 问句池管理已提交人审，入口：`/library/questions`。
- ✅ T37 全局应用框架已合并（PR #13）：顶栏、八组导航、独立路由和角色/品牌上下文；生成与导入已归词库。

## Setup

Next.js App Router + OpenNext Workers，全局框架按产品§13.1与astryx AppShellTopNavWithSideNav构建。首页是工作台，生成语法在`/library/generation`，CSV导入在`/library/import`，问句池在`/library/questions`；尚未实现的业务页面显示待交付。未登录可看无数据布局与原公开预览，不能入库。

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

`build` 是 Next.js 构建，`build:worker` 再生成 `.open-next/worker.js` 与静态资源。发布前必须先构建；`npm run deploy` 会发布到 Cloudflare，仅在人审授权后执行。当前无需 Cloudflare 账号即可本地构建/预览，尚未配置线上 Neon/Hyperdrive 绑定；T05提供服务层Web/PAT统一鉴权与审计，没有公开业务HTTP路由。

配置参考：[OpenNext 官方接入说明](https://opennext.js.org/cloudflare/get-started)、[Cloudflare Next.js 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)。未启用 ISR/R2 缓存或数据库绑定，后续按任务接入。

测试采用 Node 内置测试运行器；隔离关闭以适应本地受限环境。checks与product分开报告，只有两者全部通过才满足任务测试完成条件。

T03 已建立真实服务层验收的红灯基线：`npm run test:checks`验证当前规格和静态架构守卫，`npm run test:product`运行产品硬规则及运行时鉴权检查，`npm test`包含两者。T05的 `tests/support/runtime-driver.mjs` 已连接真实服务操作，fixture通过同一普通连接与服务入口准备；用例与负责任务的映射见 `tests/rules/product-rule-cases.mjs`。R11按裁定读取机器周批分位，缺行/stale=data_pending且不得归档；审阅入口见 [T05 review](docs/t05-review.md)。

## 数据库（T04）

`migrations/0001_core.sql` 至 `0004_opportunity_status.sql`覆盖产品§18T04的29张业务表（原18为历史计数），另有迁移账本`schema_migration`。使用原生`pg`驱动，不引入ORM。所有列有注释；版本/分数唯一约束、租户复合外键、冻结与终态守卫在数据库兜底。四个API投影不被擅自扩成四张业务表。机会卡英文存储码与冻结API中文值经服务层映射，表见`t02-decisions.md`；0004仅重编码，原迁移校验和保留。

`db:migrate` 与 `db:fixture` 会加载项目根目录的 `.dev.vars`，终端已设置的同名环境变量优先。`DATABASE_URL` 填目标开发库的迁移管理连接，`GEO_APPLICATION_DATABASE_URL` 填普通 `geo_app` 连接；`.dev.vars` 不提交仓库。

配置后执行：

```sh
# DATABASE_URL = 目标开发库的直连 Postgres URL；GEO_MIGRATION_ACTOR = 执行人标识
npm run db:migrate
# fixture另需GEO_APPLICATION_DATABASE_URL（普通geo_app，非owner）与GEO_SESSION_SECRET（至少32字符）
# GEO_MIGRATION_ACTOR需与迁移登记的安装管理员主体一致
npm run db:fixture
npm run test:db
```

迁移由服务层加锁、按文件事务执行，账本校验SHA-256；重复运行跳过已应用文件，已应用内容变更会拒绝，失败回滚DDL与账本。`db:fixture`使用普通geo_app连接及签名身份，只调用服务层按操作事务创建虚构“简造 ERP”租户、独立写/审成员、已封版词表v1（含exclusion）、已批准L1测试口径和公共词根；重复载入不复制数据。fixture不含真实客户原文，也不代表T31全链路已完成。

三张行业共享表没有`tenant_id`；原始词及品牌级表保持租户归属。共享服务仅接受受信公共词根目录，拒绝已知客户标识与私有词句，输出限定为公共词根及数值聚合；自由文本备注不进入投影，对外基准出口暂不开放。T07/T10接入真实词池时仍须遵守这一边界。

T05的0005–0008迁移为原25张租户表、tenant及辅助租户表强制RLS；geo_app无owner/superuser/BYPASSRLS，未设置事务租户时默认deny。仅迁移阶段使用管理连接，fixture/call均使用普通连接；Web/PAT共同走六层服务端策略，业务写入与审计同事务。线上Workers后续通过Hyperdrive绑定传入`connectionString`，直连URL仅用于管理命令；驱动依据[Cloudflare官方pg接入方式](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)。

`test:db`使用生产依赖树中按平台安装的真实PostgreSQL18.6，在Linux/macOS临时目录启动Unix socket，结束后销毁，不读取`DATABASE_URL`。`test:checks`包含该集成测试；T03的23个产品/运行时鉴权验收仍单独执行，不能把数据库检查通过写成全产品测试通过。

## License

Private — 内部产品仓库。

生成语法面板使用既有Web会话（HTTP-only的geo_session cookie）或per-user PAT；本轮不提供登录/签发接口。身份提供方需沿用服务层签名密钥与身份声明；未登录可本地预览，确认写入要求有效身份与Strategist权限。普通运行连接与公共词根许可目录由服务端配置，目录格式为`[["行业","公共词根"],…]`，默认空目录拒绝确认；实际部署使用Hyperdrive，Next开发环境可用GEO_APPLICATION_DATABASE_URL。GEO_SESSION_SECRET需至少32字符随机值，示例文件不提供默认密钥。


导入页提供按当前渠道切换的 CSV 空白模板（UTF-8 BOM，仅表头，下载无需登录）与字段说明；keyword、collected_at 在该页面必填。C 类模板不索取来源 URL。系统仅按固定列名及已有中文别名读取，外部平台原始导出表需先整理，不会自动猜测列映射。

CSV导入使用`POST /api/tenants/{tid}/keyword-imports`，JSON含`industry`、`channel`、`csv`文本；界面选择本地CSV后走相同服务，单文件1MiB。表头示例：`keyword,collected_at,demand_index`，时间示例`2026-01-01T00:00:00Z`。重复文件不会新增同次观测，跨采集时点保留记录；source_word_id不因归一化被改写。简繁转换锁定[OpenCC JS](https://github.com/nk2028/opencc-js)版本，升级需显式处理归一化版本。

C类需服务端受信授权登记`GEO_C_IMPORT_AUTHORIZATIONS`（真实姓名/地址词典用secret binding，不提交仓库）。登记形如`{tenant_id,ref,document_ref,active,redaction_policy:{version,verified,dictionary_complete,reviewed_by,reviewed_at,names:[],addresses:[]}}`；配置为空或未核验时拒收。C身份列不入库，文本按审核词典及规则自动脱敏；拒绝记录只回序号/原因，不回原文。`csv_ref`仅对接受信的租户文件适配器；本轮浏览器直接发送内存CSV，不保留原始文件。


T10周批入口为`src/server/jobs/weekly-pool.mjs`，通过既有keyword_pool_snapshot.append服务触发完整pipeline，再同事务执行受控intent_cluster.transition。算法与审核项见[backlog的T10人审入口](docs/backlog.md#t10-执行与人审入口)。默认`GEO_WEEKLY_POLICY_RECORD=null`，禁止真实运行；`GEO_INDUSTRY_POPULATIONS=[]`只留受信公共数值回执适配入口，不能用私有CSV假扮行业基准。调度需要已有签名weekly_pool身份、耐久dead-letter和告警接收器；本轮不安装cron、不提供一键启用、不绕过登录或RLS。


T11在周批事务内创建飙升信号、候选预筛和策略个人站内收件记录。触发需首见<14天且两个完整周各自来源趋势up，来源口径一致；缺项不触发，不从两个指数编造两次环比。A/B/D可在导入页面为整个文件填一次可选source_id（平台/地区/指数口径），C沿用已核验授权。来源标识不回写已存在观测，旧数据不覆盖。服务层读取支撑视图为keyword_pool_snapshot.read的surge_alerts/surge_notifications；收件箱页面随T18，不新增公开HTTP接口或外部消息。T10冻结闸门仍关闭，真实源与规则价值留待自营试跑验证。


T37全局框架补排与验收记录见[backlog](docs/backlog.md#t37-全局应用框架执行记录)。登录后的品牌/行业选项来自服务端当前权限校验；菜单按角色和合同档位显隐。品牌与行业随URL跨页保留，未接入的指标、刷新时间与通知数不伪造。应用框架不代表工作台KPI、设置页或其他业务页已完成。


T12问句池在`/library/questions`：选择真实来源配问句、冻结整个品牌版本、开新版本修订、显式锚定升级与归档。冻结后历史只读，修订不会自动换题；归档仅停止新锚定。来源/渠道/时间自动预填，维护人填具体人名。实际管理需要有效内部会话和已有意图簇，登录入口仍未提供；不因T12交付而启用真实周批或探针。新迁移0014通过原`npm run db:migrate`服务应用。
