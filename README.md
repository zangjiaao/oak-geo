# oak-geo

GEO 方法论验证 MVP：从产品事实与真实用户任务出发，通过 API 获取模型回答，由 Agent 分析、人复核，执行内容动作后同口径复测。

当前从 [docs/README.md](docs/README.md) 开始，只按[产品文档](docs/GEO产品文档.md)与[backlog](docs/backlog.md)推进。先跑 okdata，再用 OKSocial 复现；尚未验证方法有效，不承诺增长。

旧详设、接口模板、审批与阶段报告已移到[归档](docs/archive/README.md)，不作为启动研究的前置清单。需要修改具体服务时，按需查[API约束索引](docs/api-spec.md)。`docs/api/contracts.json` 与权限CSV继续供现有代码／测试使用。

开发前读 [AGENTS.md](AGENTS.md)，复用既有服务与权限、审计、数据隔离；不直接写库，不自行合并。完整后台、固定机会评分和通用 Agent Runtime 后置。

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

测试通过只证明工程约束，不证明方法论有效。真实联调、Agent分析质量和发布后的效果分别留证；历史接线与测试背景按需从[归档](docs/archive/README.md)查阅。

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

生成语法面板使用既有Web会话（HTTP-only的geo_session cookie）或per-user PAT；开发机可通过下述本地验收命令登录，正式环境不开放该入口。身份提供方需沿用服务层签名密钥与身份声明；未登录可本地预览，确认写入要求有效身份与Strategist权限。普通运行连接与公共词根许可目录由服务端配置，目录格式为`[["行业","公共词根"],…]`，默认空目录拒绝确认；实际部署使用Hyperdrive，Next开发环境可用GEO_APPLICATION_DATABASE_URL。GEO_SESSION_SECRET需至少32字符随机值，示例文件不提供默认密钥。


导入页提供按当前渠道切换的 CSV 空白模板（UTF-8 BOM，仅表头，下载无需登录）与字段说明；keyword、collected_at 在该页面必填。C 类模板不索取来源 URL。系统仅按固定列名及已有中文别名读取，外部平台原始导出表需先整理，不会自动猜测列映射。

CSV导入使用`POST /api/tenants/{tid}/keyword-imports`，JSON含`industry`、`channel`、`csv`文本；界面选择本地CSV后走相同服务，单文件1MiB。表头示例：`keyword,collected_at,demand_index`，时间示例`2026-01-01T00:00:00Z`。重复文件不会新增同次观测，跨采集时点保留记录；source_word_id不因归一化被改写。简繁转换锁定[OpenCC JS](https://github.com/nk2028/opencc-js)版本，升级需显式处理归一化版本。

C类需服务端受信授权登记`GEO_C_IMPORT_AUTHORIZATIONS`（真实姓名/地址词典用secret binding，不提交仓库）。登记形如`{tenant_id,ref,document_ref,active,redaction_policy:{version,verified,dictionary_complete,reviewed_by,reviewed_at,names:[],addresses:[]}}`；配置为空或未核验时拒收。C身份列不入库，文本按审核词典及规则自动脱敏；拒绝记录只回序号/原因，不回原文。`csv_ref`仅对接受信的租户文件适配器；本轮浏览器直接发送内存CSV，不保留原始文件。


T10周批入口为`src/server/jobs/weekly-pool.mjs`，通过既有keyword_pool_snapshot.append服务触发完整pipeline，再同事务执行受控intent_cluster.transition。算法与审核项见[backlog的T10人审入口](docs/backlog.md#t10-执行与人审入口)。默认`GEO_WEEKLY_POLICY_RECORD=null`，禁止真实运行；`GEO_INDUSTRY_POPULATIONS=[]`只留受信公共数值回执适配入口，不能用私有CSV假扮行业基准。调度需要已有签名weekly_pool身份、耐久dead-letter和告警接收器；本轮不安装cron、不提供一键启用、不绕过登录或RLS。


T11在周批事务内创建飙升信号、候选预筛和策略个人站内收件记录。触发需首见<14天且两个完整周各自来源趋势up，来源口径一致；缺项不触发，不从两个指数编造两次环比。A/B/D可在导入页面为整个文件填一次可选source_id（平台/地区/指数口径），C沿用已核验授权。来源标识不回写已存在观测，旧数据不覆盖。服务层读取支撑视图为keyword_pool_snapshot.read的surge_alerts/surge_notifications；收件箱页面随T18，不新增公开HTTP接口或外部消息。T10冻结闸门仍关闭，真实源与规则价值留待自营试跑验证。


T37全局框架补排与验收记录见[backlog](docs/backlog.md#t37-全局应用框架执行记录)。登录后的品牌/行业选项来自服务端当前权限校验；菜单按角色和合同档位显隐。品牌与行业随URL跨页保留，未接入的指标、刷新时间与通知数不伪造。应用框架不代表工作台KPI、设置页或其他业务页已完成。


T12问句池在`/library/questions`：选择真实来源配问句、冻结整个品牌版本、开新版本修订、显式锚定升级与归档。冻结后历史只读，修订不会自动换题；归档仅停止新锚定。来源/渠道/时间自动预填，维护人填具体人名。实际管理需要有效内部会话和已有意图簇；下述本地演示命令准备这两个前提。不因T12交付而启用真实周批或探针。新迁移0014通过原`npm run db:migrate`服务应用。


## 本地验收问句池

本机数据库可按下方“Docker Compose 本地数据库”配置；Neon开发库仍可沿用原连接。

先在 `.dev.vars` 配好 `DATABASE_URL`（开发库迁移管理连接）、`GEO_APPLICATION_DATABASE_URL`（同一开发库的普通 `geo_app` 连接）和 `GEO_SESSION_SECRET`（至少32字符随机值）。迁移执行人与 `GEO_MIGRATION_ACTOR` 保持一致。不要用管理连接充当应用连接。

```sh
npm run db:migrate
npm run dev:login
npm run dev
```

打开 `dev:login` 输出的 `http://localhost:3000/account#session=…` 链接，会自动登录并进入问句池。开发服务已运行时无需重复启动；命令与服务必须使用同一数据库和会话密钥，修改配置后需重启服务。若使用其他回环地址或端口，运行 `npm run dev:login -- --origin=http://127.0.0.1:3000`，浏览器也使用该地址。

命令通过原服务层准备虚构“简造 ERP”租户、策略账号、三条标有“演示”的B类来源和一个演示意图簇；不调用模型、不跑真实周批、不创建分数。重复执行不清空问句、版本和锚定，也不恢复被撤销的角色。链接是24小时有效的登录凭证，请勿分享；凭证片段会被页面立即移除，验证后写入HttpOnly会话cookie。此入口只在 `next dev` 的回环地址开放，线上和Wrangler生产预览均关闭，不能用于登录真实客户租户。

进入后可选择来源、填写三条问句与具体维护人 → 冻结v1 → 显式入测锚定 → 修订并补齐v2 → 冻结v2并显式升级；可归档旧版后验证历史仍可读取。它用于验收问句池操作，不代表真实行业规则或探针效果已验证。

若同时验收生成语法的确认写入，另需在 `.dev.vars` 的 `GEO_PUBLIC_ROOT_CATALOG` 配置已许可公共词根，例如演示词根 `[["B2B","ai 自动排产"]]`；默认空目录仍拒绝写入，登录不会绕过许可。

## Docker Compose 本地数据库

安装并启动 Docker Desktop（含 Compose v2）。数据库在容器内运行，Next和迁移命令仍在本机运行。

首次配置：没有 `.dev.vars` 时，执行 `cp -n .dev.vars.postgres.example .dev.vars`；已有该文件时，参考示例更新本地数据库配置，保留原会话密钥等设置，不要覆盖整份文件。`OAK_POSTGRES_*` 与两条连接URL保持一致；终端已导出的同名变量优先。生成会话密钥的命令如下，将输出填入 `GEO_SESSION_SECRET`：

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

启动并等待数据库就绪，然后迁移：

```sh
npm run db:up
npm run db:migrate
npm run db:password
```

`db:password` 会交互询问两次 `geo_app` 密码。使用示例配置时输入 `oak_geo_app_local`；自定义密码须与 `GEO_APPLICATION_DATABASE_URL` 一致（URL中的特殊字符需编码）。这一步首次设置即可，迁移不会重置密码。`postgres` 仅用于迁移，应用连接始终使用普通 `geo_app`，不能将两条URL都设为管理连接。

接着运行 `npm run dev:login`、`npm run dev` 并打开登录链接。首次进入的是新本地库，不会自动复制Neon数据；如果之前已在运行开发服务，切换配置后重启该服务。

日常使用：

```sh
npm run db:up
npm run dev
```

会话失效时重跑 `npm run dev:login`。有新迁移时重跑 `npm run db:migrate`。停止数据库用 `npm run db:down`，会保留数据卷；该命令不删除数据库数据。手动添加 `--volumes` 才会删除数据，不要用于日常停止。

Compose只向 `127.0.0.1` 发布5432端口，带健康检查；本机已有Postgres占用端口时，先明确选择复用还是使用独立端口，修改 `OAK_POSTGRES_PORT` 后同步两条URL。先前用 `docker run` 创建的容器/卷与本Compose独立，不会自动迁移或接管。

PostgreSQL18的数据卷挂在 `/var/lib/postgresql`，配置依据：[Postgres官方镜像](https://hub.docker.com/_/postgres)、[Compose服务与健康检查](https://docs.docker.com/reference/compose-file/services/)。环境变量只在空数据卷初始化时创建数据库/设置管理密码，已有数据卷不会因改环境变量而自动改密码；已有库改密码后还须同步连接配置。


## T13 探针排期（待人审）

先运行 `npm run db:migrate` 应用0015。T13建立排期与审计，不调用模型、不安装真实cron；执行侧接T14/T15，发布登记事件的真实生产者接T25。复测台网页属于T26，本轮没有新增表单页面。

现有 `probe_batch.create` 新增可选 `schedule` 实现草案；不传时保留既有独立批次用法。T13排期路径强制：基线/月度30簇，事件3目标＋3对照，各簇三条已冻结/已锚定问句。CS显式提供范围；系统核验同品牌、有效判定基准，以及复测与已完成基线的快照/问句一致。不同口径返回422 incomparable。

发布事件的调用结构（变量来自已核验的真实对象）：

```js
await application.call("probe_batch.create", {
  actor: csActor,
  body: {
    type: "event",
    snapshot_id: baseline.snapshot_id,
    baseline_batch_id: baseline.id,
    scheduled_at: new Date(Date.parse(publication.published_at) + 3 * 86400_000).toISOString(),
    cluster_question_sets: sixAnchoredQuestionSets,
    schedule: {
      source_event_id: publication.id,
      published_at: publication.published_at,
      target_cluster_ids: threeTargetIds,
      control_cluster_ids: threeControlIds,
      expedited: false,
    },
  },
});
```

一次事务生成D+3/14/30三批，响应保留首批字段并附 `items`。月度使用 `type: "monthly"`、完成的基线、30簇清单，schedule填 `source_event_id` 与 `month: "YYYY-MM"`；scheduled_at必须在该月，具体UTC时间由配置提供。首次基线使用已冻结snapshot与30簇清单，schedule只需source_event_id及可选expedited。字段草案在本PR人审，不自行冻结。

自然键持久去重：基线按品牌/配置，月度按品牌/基线/月，事件按品牌/登记事件/时点。相同请求不重复建任务，变更范围/时点等载荷返回409；取消后的旧身份不会重投复活。重登记必须使用新的登记事件id，旧pending保留，CS可走原cancel显式取消。旧批次、配置和历史不覆盖。

内部服务调用 `probe_batch.read` 的 `query: { view: "scheduled" }` 可查看本租户到期pending队列，仅CS/Strategist/FactCheck，按加急、到期时间、ID分页；`due_only: "false"`仅供查看未来pending。后台执行者须用受控probe_execute且绑定具体batch_id，start再次检查已到期、对照未做内容动作与判定基准。调度不消耗探针配额。

Web/PAT薄HTTP已接 `POST /api/tenants/{tid}/probe-batches`、`GET /api/tenants/{tid}/probe-batches/{id}`、`POST /api/tenants/{tid}/probe-batches/{id}/cancel`；不开放集合、内部队列或原始回答。Web写同源，角色与PAT scopes由原服务校验。`src/server/jobs/probe-scheduler.mjs`接受已签名event_schedule身份和准备好的请求，只调用服务；启用前须配置持久dead-letter与告警接收器，5xx整单指数退避≤3次，4xx不重试。
