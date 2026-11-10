# T05 人审入口

状态：待负责人抽验，未合并。PR #7 堆叠于未合并的 PR #6；接线依据见 [t05-wiring.md](t05-wiring.md)，负责人原文见 [t02-decisions.md](t02-decisions.md)。请先抽查下表埋点与敏感读顺序，再看测试证据。

## 审计埋点 → AGENTS.md §4

| 埋点位置 | 行为与事务边界 | 对应硬约束 | 抽验入口 |
|---|---|---|---|
| `application.execute/authorizeRequest` | 每次调用固定六层：认证→租户→品牌/任务→allow→凭证/人工/合同档→业务；未知三键deny；写与审计同事务 | §4.1、§4.2 | [application](../src/server/api/application.mjs)、[authorization](../src/server/api/authorization.mjs)；A02逐注册操作正/负例 |
| `audit-transaction.commitEvents` | 每个事件显式写actor_type/agent_run_id/prompt_version；只追加；异常回滚业务，commit后才交付 | §4.3 | [审计事务](../src/server/api/audit-transaction.mjs)；故障注入验证写入回滚及敏感读无数据返回 |
| `question_pool/scoring_snapshot/probe_batch`服务 | 五溯源、冻结及批次写入均进统一审计；judge_version必填；批次固定词表与模型版本；原始回答只当数据 | §4.2、§4.3、§4.4 | [catalog](../src/server/api/catalog-handlers.mjs)、[sampling](../src/server/api/sampling-handlers.mjs)；R01/R14/R15/R19 |
| `claim_block/decideQueue/queueObject` | 作者、对象、队列分别留痕；5种通用审核对象；同作者即使换成FactCheck也不得放自己的版本 | §4.2、§4.3、§4.5 | [content](../src/server/api/content-handlers.mjs)、[domain-common](../src/server/api/domain-common.mjs)；R08/R09/R16/R18及词表/口径驳回重提回归 |
| `ctx.runJob/reconcileAsset` | 控制因果图只准注册子job，重新六层鉴权；system记job/触发事件，探针job带batch；状态逐跳记同cause，与父操作同事务 | §4.1、§4.2、§4.3 | [application](../src/server/api/application.mjs)、[domain-common](../src/server/api/domain-common.mjs)；不以job身份绕过权限 |
| `probe_result.read_raw/access` | 先查询范围过滤，再读单条原文；Admin仅access且理由必填；审计提交成功后交付；普通read不投影raw_answer | §4.1、§4.3 | [sampling](../src/server/api/sampling-handlers.mjs)；敏感读故障注入、持有效无权凭证、来源/卡分派回归 |
| `keyword_raw.read/read_raw` | C类摘要/原文访问逐对象审计；本轮C类导入关闭，等待T09脱敏管道 | §4.1、§4.3 | [catalog](../src/server/api/catalog-handlers.mjs)；禁止未脱敏数据借fixture入库 |
| `operation_usage`与PAT元数据 | probe/judge/drafting独立计量，与业务同事务；按token限流；last_used_at用受控audit_middleware留痕 | §4.3、§4.6、§4.8 | [application](../src/server/api/application.mjs)；配额429、PAT限scope/撤销/限流回归 |
| `idempotency_record` | 24h同主体/操作/目标/键同载荷重放原响应；不再计业务配额/业务审计；变更载荷409；缓存AES-GCM加密，不存PAT明文 | §4.3、§4.6、§4.8 | 同上；额度用尽后原键重放仍成功，对象/计量/业务日志均一次 |
| `cluster_score/metric_snapshot`及响应封装 | 分数只追加；样本不足null；每个响应含snapshot_id/data_as_of；不同快照/锚/问句ID集合返回422 incomparable且无delta | §4.4、§4.7 | [sampling](../src/server/api/sampling-handlers.mjs)；R02–R05/R10/R17 |
| `api_token.create/revoke` | 只保存hash；Web/PAT同策略；请求不能自报角色或绕过标记；原文权限不因Admin/PAT升级 | §4.1、§4.3、§4.8 | [identity](../src/server/api/identity.mjs)、[content](../src/server/api/content-handlers.mjs)；真实PAT回归 |
| `archive/appendMachinePercentiles` | 人工最终归档及证据、机器建议、机器分位各对象审计；Strategist不能写分位；缺行/stale观察、不归档 | §4.1、§4.2、§4.3 | [archive](../src/server/api/archive-handlers.mjs)、[机器投影](../src/server/api/industry-percentiles.mjs)；R11与新增data_pending负例 |
| 安装/迁移、开发fixture | 仅schema/安装目录使用管理连接；fixture与call普通geo_app；安装身份仅配置入口，无原文万能权限 | §4.1、§4.3、§4.8 | [runtime环境](../tests/support/runtime-environment.mjs)、[开发fixture](../src/server/api/fixture-service.mjs)；RLS架构测试及T04集成 |

## RLS 与权限抽验

- 原25张tenant_id业务表、tenant及新增租户辅助表强制RLS。当前角色与登录角色均为geo_app，不拥有业务表且无superuser/BYPASSRLS；每次call验证，事务租户局部设置，复用不泄漏。
- 有效凭证负例覆盖：同租户跨品牌Owner、未分派Content、真实跨租户已存在对象、diagnosis写入、真实external_agent审核、撤销/缺scope PAT。不是仅靠篡改role被拒证明全部权限。
- Content/Evidence按机会卡、簇或来源关联；批次、证据与诊断的任务过滤在SQL查询层完成，再做投影。普通证据/报告不回原文excerpt；异议专用出口未实现时保持关闭。
- fixture注册表与driver不引用pg、不执行SQL、不含管理连接或bypass开关。真实PostgreSQL18.6运行于/tmp Unix socket，测试结束销毁；不连接生产数据库。

## 产品 §16.3 十三项预留

| 编号 | 本轮证据/边界 |
|---|---|
| 1–6 | 对应上表审计三字段、judge_version、统一服务/状态、通用队列、分粒度配额 |
| 7–9 | 前端队列/作者状态/告警扩展留后续页面任务；本轮没有新增页面或AI按钮 |
| 10 | Web/PAT双凭证同策略；不实现MCP Server |
| 11 | snapshot_id/data_as_of统一响应；列表cursor默认20、上限100，摘要页预算小于20KB；单条原文专用通道，不批量导出 |
| 12 | 冻结contracts已有semantic/destructive信息，注册操作直接引用，不改契约或新增工具运行时 |
| 13 | PAT限流按配置执行，未发明套餐额度；回归使用明确测试额度 |

## 数据草案与授权边界

- 0005–0008新增：安装目录、任务分派、幂等账本、用量账本、诊断封版身份、私有归档证据，以及负责人授权的共享w_pool_percentile。辅助表字段属于行为已裁定的实现草案，随PR人审。
- 补实现列：block_kind、competitor_mentions、originated_by_internal、model_version_manifest、backflow_ticket.archive_evidence_id；no_demand建议工单deadline可空，未发明SLA，cited_wrong仍强制期限。
- 产品正文仅§18的industry_score.c_delete_threshold、w_pool_percentile及两条决策行；intent_cluster字段/状态未改。共享分位无tenant_id，只收许可公共词根和机器数值，producer仅weekly_batch，basis_note绑定周批id。
- stale采用版本证据：必须同时匹配簇pool_version与行业最新pool_version；未发明天数TTL。当前仅承接能唯一映射许可公共词根的簇，无法映射也data_pending；T10负责完整映射与真实周批采集，不设人工补位。
- contracts.json与application-port、T03验收入口字节不变；ruleCases只改负责人授权R11块，其余字节有独立SHA守卫。AGENTS.md未改。

## 覆盖与限制

注册77/112个冻结操作，A02直接枚举实际注册表。其余35个默认关闭：种子修订、渠道信号读写、问句归档、机会卡推荐/确认/迁移、内容下线、引用查询、证据包修订/导出、异议全链、发布登记全链、诊断excerpt/导出/修订、工单分派/完成/超时、批次取消/失败/补偿、解约/清理、删除账本及两个仅内部埋点操作audit_log.append/api_token.record_use。

不等于T07–T29完成：无公开HTTP路由、无生产迁移/部署、无真实模型/Serp调用；T14当日联网复核未执行。judge使用独立FactCheck人工标签，正则/spec_score/指纹算法仍待judging-spec冻结。accuracy/排位/线索没有足够明细时返回null，不编造读数。模型传输回执可录制，业务校验、状态、聚合、审计均真实执行。T31双剧本金路径尚待其任务完整验收。

## 验证记录

- 先红：T03既定23项红灯；本轮RLS/普通连接测试、R11缺行负例、额度耗尽幂等重放均记录了真实失败后修复。
- `npm run test:checks`：51/51通过；`npm run test:product`：23/23通过（22场景+A02），均0 skip/todo。A02遍历77个注册操作；完整product约340秒。
- `npm run typecheck`、`node scripts/generate-t02-docs.mjs --check`、`npm run build:worker`、`npm run doctor`通过。生成器仍为30资源/112端点/245 allow；doctor两轮均0失败，现有theme包缺失提示保留，未额外安装主题。
- contracts SHA256：`4dbcb6dd247d4e3d236f3404069d9cef19620045f5746f2ef8e033d97d5d550d`；application-port：`79b35bd69fbdba8052ba77216fb3f96952d2b66281c6fc3e9ce1a1597c1b8488`。产品授权范围外逐字校验与T03除R11外字节校验均通过。
- 新增回归：敏感读commit顺序/审计故障回滚、有效凭证权限边界、PAT、幂等、来源/卡分派与cursor、通用审核驳回重提、机器分位缺行/stale及禁止人工写。

人审抽查后才能合并；本文件不批准冻结新规格或开始生产探针。
