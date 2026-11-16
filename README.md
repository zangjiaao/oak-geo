# oak-geo

GEO 方法论验证 MVP。先跑通一个真实案例，再按验证结果细化产品。

**当前只验收品牌事实：填写资料 → 可见的 Agent 联网检索 → 编辑确认 → 分类事实卡片。** 用户验证可用后，再做需求簇、问句和监控。执行计划见 [backlog](docs/backlog.md)，产品依据见[文档入口](docs/README.md)。

## 当前入口

| 页面 | 用途 |
|---|---|
| `/welcome` | 三步引导：填写资料、联网检索、编辑确认；前两步保留草稿 |
| `/settings/brand` | 修改一份当前品牌资料，无资料版本管理 |
| `/knowledge` | 按分类查看已确认的事实卡片、出处与审核状态 |

Owner／Strategist 尚未确认任何事实时进入欢迎页，可继续之前的引导草稿；确认事实后进入工作区。客户 diagnosis 档沿用只读边界。

当前流程按品牌组织，不要求行业分类，旧链接的行业筛选不再阻止进入品牌。下一步按已确认事实的 `fact_id` 提取并去重候选关键词，再查询 Google Trends／百度指数；这条新关键词流程尚未实现，待第一步验收后开发。

Owner 可新增品牌，管理原有授权及自己创建的品牌；其他 Owner 的品牌不可见。Owner 填写并确认，Editor／Viewer 只读，Strategist 可协助，FactCheck 独立放行。用户提供的描述明确标为品牌声明；Agent 发现的页面需要确认来源，第三方描述不会自动成为官方事实。确认只提交待审，独立放行后才可作为正式判错基准。

调查采用 **AI SDK + DeepSeek**，通过 Search／Fetch 工具检索并读取公开资料。当前资料直接修改；来源与调查执行留痕，正式测量的问句、快照、判定口径约束继续保留。

## 本地启动与验收

需要 Node.js 22.13.0 或更高版本、Postgres。使用下列本地方案还需 Docker Compose v2；已有可用开发数据库时复用它，填写对应连接后从迁移开始。先检查是否已有本项目开发服务，避免重复启动或不断换端口。

### 1. 安装并配置

```sh
npm ci
# 仅在尚无 .dev.vars 时复制；已有配置请保留
cp -n .dev.vars.postgres.example .dev.vars
```

在 `.dev.vars` 中设置：

| 配置 | 用途 |
|---|---|
| `DATABASE_URL` | 开发库迁移管理连接 |
| `GEO_APPLICATION_DATABASE_URL` | 同一数据库的普通 `geo_app` 连接，不能使用管理账号 |
| `GEO_MIGRATION_ACTOR` | 迁移执行人，与该库登记的安装管理员一致 |
| `GEO_SESSION_SECRET` | 自行生成的至少 32 字符随机会话密钥 |
| `DEEPSEEK_API_KEY` | 服务端调查凭证；未配置时仍可保存品牌资料 |
| `GEO_PRODUCT_RESEARCH_MODEL` | 默认 `deepseek-v4-flash`，不经过 AI Gateway |

会话密钥可用 `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'` 生成。不要提交填有真实凭证的 `.dev.vars`。

### 2. 启动数据库并迁移

本地 Compose 示例只在回环地址开放数据库，使用独立数据卷；迁移由服务层执行。

```sh
npm run db:up
npm run db:migrate
# 首次创建 geo_app 后设置普通账号密码
npm run db:password
```

`db:password` 交互设置的密码必须与 `GEO_APPLICATION_DATABASE_URL` 一致；使用示例时为 `oak_geo_app_local`。已配置好的普通账号无需重复设置。使用已有开发数据库时，跳过 Compose 启动，仍需应用仓库中尚未执行的迁移。

### 3. 以 Owner 验收

```sh
npm run dev:login -- --role=owner
# 已有开发服务时复用，无需重复启动
npm run dev
```

打开命令输出的本地登录链接。命令与开发服务必须使用同一数据库和会话密钥；更换地址时可加 `--origin=http://127.0.0.1:3000`，浏览器也使用该地址。

右上角应显示“客户 Owner”。“策略”账号没有新增品牌入口；切换时重新运行上面的 Owner 命令并打开新链接。Owner 登录后进入工作台，审核账号进入知识库。

`npm run dev:login` 默认使用 Owner。第一步验收用同一身份完成新增品牌、填写资料、调查和核对候选；需要生效官方口径时，再由独立审核者放行。

本地命令准备虚构演示租户和已有品牌，生成 24 小时签名登录链接；请勿分享链接。仅 development 回环入口可用，生产不开放角色选择。真实使用仍需已有账号及所属品牌，公开注册和正式身份提供方接入尚未完成。

按这个顺序验证：

1. Owner 点击“新增品牌”或打开 `/welcome?new=1`，填写名称和介绍，进入第二步。
2. 查看实际搜索词、读取页面和失败记录。检索结果是候选，知识库此时没有事实卡片；缺配置时保留草稿并提示。
3. 第三步逐条编辑陈述、分类和来源摘录，可保存本条草稿并刷新继续。数值、口径、边界适用时记录，不强制含数字。来源未匹配的候选可以修正或暂不选择。
4. 用户确认所选事实后，知识库显示事实卡片；不展示整段品牌介绍。相同陈述及口径重复确认复用事实 ID；正文和依据从唯一事实记录读取。
5. 品牌设置继续维护当前资料。资料变化后重新调查、确认新候选；既有已确认事实保留。需要正式判定基准时，切换 FactCheck 独立放行。

```sh
npm run dev:login -- --role=factcheck
```

## 当前验证边界

未配置 `DEEPSEEK_API_KEY` 时，系统明确提示尚未调查，不用模型记忆冒充联网结果。自动化测试和浏览器验收使用录制响应，真实 DeepSeek 联网仍需配置凭证后验证；测试通过不证明品牌资料准确或 GEO 方法有效。

调查失败会显示阶段和可用的 HTTP 状态码：401 检查凭证，402 检查余额，429 稍后重试；模型参数拒绝、网络、超时、JSON 与来源校验失败分别提示。上游响应正文、请求内容和凭证不显示在错误中。更新前保存的统一失败提示无法还原根因，需要更新后重新调查；原始资料仍保留。

调查资料会发送至 DeepSeek，只填写获授权的公开品牌信息。当前执行边界为每租户每小时最多 10 次、同时一个有效调查；单次最多 6 轮生成、10 次来源调用，90 秒超时。先持久记录执行用量，再调用外部接口；失败或未知用量如实保留。

品牌事实调查与正式监控分开。目前未启动真实问句监控，不输出正式 GEO 分数；正式被测模型清单和判据仍须单独确认。已有词库、采集和排期代码不作为当前第一步的必经入口。

## 检查与 Workers 预览

```sh
npm test
npm run typecheck
npm run build:worker
npm run doctor
```

`npm test` 包含常规／架构／数据库检查及产品硬规则；测试使用临时隔离 Postgres，不连接目标开发库。`build:worker` 生成 `.open-next/worker.js`，不执行部署。

本地 Workers 预览可用 `npm run preview`。本地演示登录入口只供 `npm run dev` 使用，不在生产预览开放。实际部署需要配置 Neon／Hyperdrive 和正式鉴权，发布须另获授权。

结束本地验收时停止自己启动的开发服务；`npm run db:down` 停止 Compose 数据库并保留数据卷。不要为结束测试删除数据卷或关闭共享服务。

## 文档与历史

- [AGENTS.md](AGENTS.md)：开发约束。
- [文档入口](docs/README.md)、[产品文档](docs/GEO产品文档.md)、[当前计划](docs/backlog.md)：当前方向与验收顺序。
- [API 约束索引](docs/api-spec.md)：修改已有服务时按需查阅。
- [历史归档](docs/archive/README.md)：旧详设、旧 README、任务与审批记录，不作为当前启动清单。

技术栈：Next.js App Router、astryx、Cloudflare Workers／OpenNext、Postgres／Neon／Hyperdrive。所有数据写操作走服务层；本仓库为内部项目。
