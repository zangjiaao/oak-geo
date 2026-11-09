# API 契约与状态机设计规格

> 状态：草案，未冻结 · T02 人审候选稿。不得自行冻结。
> 事实依据：[产品文档](GEO产品文档.md) §3–4、§6、§8–9、§11–14、§16–19；[三轮负责人裁定原文](t02-decisions.md)。裁定覆盖早期模板及本稿旧版本的冲突描述；产品文档仅按授权修改 §18 和决策记录，其余原文保留。
> 人审从[一页地图](spec-map.md)进入，再读[核心集](api/core-set.md)和[allow权限规范](api/permissions.csv)；[支撑端点](api/generated/endpoints.md)默认抽检。[结构化源](api/contracts.json)用于生成与机器校验，不要求人逐行审。

## 0. 冻结流程与审阅 checklist

以下为 agent 自查结果，不替代负责人冻结签字：

- [x] allow即规范，未出现三键即deny；每个allow保留 §9.3 或裁定依据，测试穷举全集验证默认拒绝
- [x] 三轮定稿状态落表；出边或明确终态，修订通过新版本承接
- [x] 写操作均为显式服务层动作，禁止PATCH状态与页面/脚本直写库
- [x] 每端点有权限三键、语义、幂等、审计、副作用、请求响应示例
- [x] 差值端点校验配置身份和簇锚定口径，不一致422 incomparable且无差值
- [x] read-only/draft/proposal/write 及 destructive 全量标注
- [x] 原文仅内部按职责单条访问或异议通道查看；没有批量导出端点
- [ ] 人审allow规范、核心集、字段草案，抽检支撑件，确认可以冻结

冻结人：待人审填写；冻结日期：未填写；冻结版本：未分配。自动化检查只验证规格内部约束与授权改动范围，不表示业务功能通过验收。

## 1. 全局约定

### 1.1 鉴权与权限求值

Web 会话 + per-user PAT，解析 `(user, role, tenant, actor_type)`；PAT scopes 与用户实时权限取交集，不能提升角色权限。服务端先校验租户，再校验品牌或关联任务，再查权限矩阵三键，最后执行端点前置条件。顺序中的任何deny或条件不满足均403 permission_denied；未知三键默认deny。URL中的tid/bid/对象ID不是授权凭证。所有写操作经 `src/server/api`，路由和jobs只调用该层，不直接修改数据库。

九角色：owner/editor/viewer/strategist/content/evidence/factcheck/cs/admin。actor_type 独立于角色：human/agent/system/external_agent；MVP不实现Agent Runtime或MCP。人类决策动作（放行、确认、升级问句、人工下线等）必须human，agent/external_agent无绿色通道。作者不等于状态属性。

权限矩阵中allow是“该角色可在条件满足时执行”，不是无条件开放。每行conditions与以下规则共同强制，deny优先：

- strategist/factcheck/cs：本租户全品牌范围，但只执行各自角色职责操作；“租户级”不等于拥有其他角色操作权。
- content/evidence：仅分派机会卡、簇、来源及可沿ID链验证关联的对象；不得凭猜测ID或读取父对象获得其他任务权限。
- admin：配置及审计全量；Admin 不默认读取原文。`probe_result.read_raw`明确deny；单条`admin-access`为显式POST，必须reason且写审计，不授予永久原文权限。
- owner/editor/viewer：本品牌（Owner读取本租户成员为产品§13.2⑫明确的租户级例外，仅成员信息，不扩张业务读写）；竞品原文无直接读取权。Editor可读本品牌诊断、证据包、模板和复测判定摘要；仅在full模式内容工作台写块草稿/提交与发布登记。
- diagnosis档：客户全只读，唯一写入口是异议申请；不确认优先簇、不编辑、不登记、不人工下线。内部履约操作仍按内部角色职责，不因合同模式被误禁。
- 客户原文通路唯一为异议查看器；先鉴权单条会话，再返回摘录；证据包普通read/download不得夹带受限excerpt或raw_answer。
- full客户机会视图仅本品牌簇的筛选只读投影；diagnosis档不提供机会视图。聚合竞品信号不泄露全文。

矩阵条件采用分号连接的逻辑AND；`applicant_or_initiating_cs`等or词表示其名称内的条件分支。完整条件的人类语义在本节及端点validation中定义。CSV中的allow集合为授权规范的唯一三键清单；JSON grants为生成输入，--check保证二者一致。测试解析器仅验证规范，T05仍须实现真实服务端鉴权，不能把条件allow当成无条件200。未经配置的scope/角色/资源/操作拒绝；系统身份不占用九角色任一行。

### 1.2 路径、时间、分页与响应

除明确以`/tenants/{tid}`起始的路径外，普通路径均以`/tenants/{tid}/brands/{bid}`为前缀；租户级members/api-tokens/audit-logs/industry-scores/offboarding/deletion-ledger/keyword-pool-snapshots/seed-lists/keyword-imports以及scoring-snapshots/probe-batches在`/tenants/{tid}`下。`/internal`路径为服务层内部调用契约，不挂载为Web/PAT可访问路由。所有对象仍检查归属，不能借租户前缀绕过任务或品牌限制。

时间一律UTC ISO-8601，例如`2026-11-09T00:00:00Z`。列表请求`cursor`可选、`limit`默认20上限100；超上限422 validation_failed；按稳定ID游标分页，响应含顶层next_cursor，末页null。cursor为不透明值，必须绑定租户、资源、筛选及数据口径，不能跨查询重用。

成功响应：`{ "data": {...}, "meta": { "snapshot_id": "snp1 或 null", "data_as_of": "UTC时间", "pool_version": 1 }, "next_cursor": null }`。next_cursor仅列表必填，pool_version仅适用时携带；所有响应含snapshot_id与data_as_of。结论返回probe_id与source_level回溯链。单响应≤20KB；服务端减少列表数量（即使不足limit也给next_cursor），大对象摘要下钻。不可用拆页方式形成原始回答批量导出。单条摘录亦受20KB限制，查看器按授权单条分段下钻，不截断后冒充完整证据。

所有POST要求Idempotency-Key，保存24h。作用域为租户+身份+端点+目标；同键同载荷返回原结果，不重复排期/计费/业务审计；同键异载荷409 state_conflict。24h后重新校验对象状态及业务唯一约束，不能据此覆盖不可变记录。同一异议会话内的读取每次另写访问审计。业务数据、审计与副作用须可靠原子提交/投递，不能存在成功写入却漏审计的路径。

### 1.3 错误体

错误固定`{"error":{"code":"<string>","message":"...","details":{}},"meta":{"snapshot_id":null,"data_as_of":"2026-11-09T00:00:00Z"}}`；details为对象，校验错误列字段路径与原因，但不泄露未授权对象是否存在或原文。

| code | HTTP | 条件 |
|---|---|---|
| permission_denied | 403 | 身份、租户、scope、角色或操作权限不满足 |
| state_conflict | 409 | 非法迁移、不可变冲突、幂等键载荷冲突 |
| validation_failed | 422 | 必填/枚举/格式/来源/样本交付闸门失败 |
| incomparable | 422 | 比较端点两端口径不一致；details列口径原因，不含delta |
| quota_exceeded | 429 | token或操作类别配额超限并告警 |

废弃模板的数字业务码；不使用HTTP409002。未新增其他业务错误枚举。

### 1.4 快照配置、批次与问句锚定

scoring_snapshot是采样配置身份，不是一次执行。冻结模型集合及版本、温度/轮次、judge_version、grounding_mode；MVP judge_version=`rule_manual_v1`。问句口径按二轮④由各簇锚定question_pool_version承载，scoring_snapshot原question_pool_version字段保留配置创建记录，不用整池当前版本替换簇锚。

probe_batch是执行身份，type=baseline/event/monthly；probe.batch_id关联批次；metric_snapshot保存snapshot_id、batch_id。baseline与其event/monthly复测共用冻结snapshot_id；只为执行重跑开新batch，不新建采样配置。cluster_score同`(cluster_id,snapshot_id)`只写一次；复测不重写它，probe_result按批次追加，metric_snapshot按批次追加。失败整批新batch补偿，旧记录保留。配置/判定/轨道或簇锚变更则重建基线，分数需新的snapshot身份，不借新batch覆盖旧分数。

簇入测通过question_pool.upgrade_anchor首次锚定动作写intent_cluster.question_pool_version；人工升级/拆并同样显式upgrade_anchor，重开该簇基线。新池版本仅新增其他簇，不改老簇锚；新簇锚当前版本。冻结问句版本只读，采样可还原原文。

可比性：同snapshot_id、同cluster_id、同锚定question_pool_version且该簇question_id集合一致；不同锚定版本一律不可比，即使原文字面相同。不做文本比对；不拿全池最新版本批量作废老簇。比较端点不可比时HTTP422、code=incomparable，不返回delta，不进差值报告。比较样例仅是结构，不承诺实际提升。

五溯源必填：source_word_id→keyword_raw.id；intent_type→产品§3六类（原文没有§3.2小标题，此引用指§3意图表）；source_channel=A/B/C/D；collected_at；maintainer为具体人名。question正文/版本仍必填但不替代五溯源。

probe_result保留cited_urls[]完整URL与cited_domains[]物化域名。显式引用=引用URL与登记content_asset.url分别去协议、去www、去query与fragment、去尾斜杠后，剩余字符串全等；不自行增加大小写/路径解码等规则。对外citation_rate只计explicit；指纹命中为隐式、仅域名相同为弱命中，二者只作内部分析。域名还用于cluster_platform_signal；不因同域就计入explicit。引用类别在指标层推导，不加类型字段；指纹阈值等仍等judging-spec冻结。refused不进任何分母；n_valid<10或model_coverage<3时*_score=null、insufficient_sample=true，覆盖率如实记。机会卡引用cluster_score，不复制四分。原始回答和来源文章只作为不可信数据，不进入指令位。

### 1.5 已批准决策

事实块管理审核状态，发布进度另行记录；修订开新版本。claim_block只用draft/pending_review/approved/retracted，完整迁移见§3；content_asset只用draft/ready/registered/retired。ready由当前必配块计算；registered是发布事实态，修订不降级，已发布块retract则回ready须重新发布；retired为不可逆终态。

记忆轨：3 问句 × 4 模型 × 温度 0 × 3 轮 = 36 条/簇，只对建议3簇加测；检索轨3问句×4模型×温度0/0.7×3轮=72条/簇。两轨分别配置/快照与报告；4家为通义/豆包/智谱/混元，具体模型ID及原生联网能力T14当日复核。模型ID未定前不执行探针；本任务不实施模型调用。

### 1.6 审计、异议与解约

审计字段自首版保留actor_type、agent_run_id、prompt_version；human/system不适用的后两者可为null（字段草案，待人审）；system额外受控job_name+trigger_source（cron/事件id）+受影响对象，多对象多行；探针评分/复测job必须batch_id，非探针可null；异议全记viewing_session_id、发起CS、实际调阅人和时间。日志不得保存令牌明文或额外复制待删除raw_answer。普通GET不改业务状态，敏感读取仍写访问审计；PAT last_used_at为凭证访问元数据，不触发业务状态迁移。

异议submitted→granted由CS通过grant批准，敏感升级FactCheck；3个工作日响应（不是3日自然日）。CS账号通过显式POST view发起会话并原子写viewed，客户仅作为申请人出现在只读查看器；24h会话，watermark_meta=调阅人+时间戳，叠加水印不可导出。viewing_session_id唯一，同异议同probe只建一次；POST幂等重放返回同会话，不算再次调阅；会话内GET不迁移状态。重复调阅须新异议+reason。过期只拒绝访问，不发明expired异议状态。

解约显式offboarding：30天内删除C类原文与raw_answer（含副本/缓存及受限摘录副本的删除清单草案）；聚合与audit不可变保留默认2年，合同可另定。默认2年为在线可查窗口，到期转只读冷归档，不自动删除；合同/法务可调取归档层。合同/法务要求删除时，只能由人显式执行offboarding清理，在独立deletion ledger留对象类型、时间范围、执行人、依据的tombstone，tombstone不随源数据删除消失。保留原始回答表的非原文判定与回溯ID，删全文不伪造回答或指标。

## 2. 资源清单

R3阶段将API由31资源归并为28资源；v4补齐brand_lexicon与official_fact后，现有29张物理表、30个API资源。question_score内嵌cluster_score，evidence_item内嵌evidence_package，probe仅经probe_batch访问；另含四个既有业务投影。以下按API边界索引，完整归并记录见`api/contracts.json.layout_migration`。31→28资源，112→105端点，41→39操作；权限230 = 246 − 问句分数5 − 证据条目7 − 探针读5 − 锚定合并1 + 批次任务投影2。这是R3阶段历史基数。v4增加7端点与15个allow，现为112端点、245个allow（CSV连规则与列头247行），操作名仍39种；裁定中的29→31为估计，本稿按实际28→30计算，不额外造第三个资源。

| API资源 | 契约位置 |
|---|---|
| `tenant` | [核心集](api/core-set.md) |
| `brand` | [支撑件](api/generated/endpoints.md) |
| `brand_lexicon` | [核心集](api/core-set.md) |
| `official_fact` | [核心集](api/core-set.md) |
| `user_member` | [支撑件](api/generated/endpoints.md) |
| `seed_list` | [支撑件](api/generated/endpoints.md) |
| `keyword_raw` | [核心集](api/core-set.md) |
| `keyword_pool_snapshot` | [支撑件](api/generated/endpoints.md) |
| `intent_cluster` | [支撑件](api/generated/endpoints.md) |
| `question_pool` | [核心集](api/core-set.md) |
| `opportunity_card` | [支撑件](api/generated/endpoints.md) |
| `scoring_snapshot` | [核心集](api/core-set.md) |
| `cluster_score` | [核心集](api/core-set.md) |
| `cluster_platform_signal` | [支撑件](api/generated/endpoints.md) |
| `content_asset` | [核心集](api/core-set.md) |
| `claim_block` | [核心集](api/core-set.md) |
| `probe_result` | [核心集](api/core-set.md) |
| `metric_snapshot` | [支撑件](api/generated/endpoints.md) |
| `industry_score` | [支撑件](api/generated/endpoints.md) |
| `audit_log` | [核心集](api/core-set.md) |
| `review_queue` | [核心集](api/core-set.md) |
| `objection` | [核心集](api/core-set.md) |
| `backflow_ticket` | [核心集](api/core-set.md) |
| `evidence_package` | [核心集](api/core-set.md) |
| `api_token` | [核心集](api/core-set.md) |
| `probe_batch` | [核心集](api/core-set.md) |
| `publish_registration` | [核心集](api/core-set.md) |
| `diagnosis_report` | [核心集](api/core-set.md) |
| `offboarding` | [核心集](api/core-set.md) |
| `deletion_ledger` | [核心集](api/core-set.md) |

嵌入并不扩权：question_scores节只给原内部五角色，客户簇级read仍不返回该节；evidence items继承原父包封版/任务/摘录限制；Content/Evidence仅可经batch读取原分派probe投影，不能查看完整批次或其他任务。子资源写入通过父对象的显式服务动作原子完成。

模板下载作为evidence_package投影，不新增模板表；完整客户包下载与受限原文/摘录分离。review_queue使用 object_type + object_id，动态按object_type处理，MVP接受claim_block/evidence_package/diagnosis_report/brand_lexicon/official_fact；plan_draft仅P1预留，MVP拒绝，不实现Agent产出。

### v4 接入判定输入

`strategy`沿用既有角色名`strategist`，不新增第十角色。新增权限按既有职责矩阵生成后随本PR审阅：两类资源各给内部五角色read（Content/Evidence仍限任务关联对象）；词表create/submit与口径create给Strategist；口径approve/retract给FactCheck，共15行allow。客户和Admin没有因此获得新写入口。

brand_lexicon以`(tenant_id, brand_id, version)`表示完整词表版本，每条term带kind，exclusion是纯品类词不算点名的白名单。变更通过create新完整版本，旧行只读；submit入通用review_queue，FactCheck非版本作者放行即新版本生效。不向词表表追加status枚举。版本的review_queue.object_id引用create返回的version_object_id（该版本首行id）；该行解析至完整版本集合，不能只批准其中一条term。版本集合和作者从创建记录固定，不能通过重排条目或追加term绕过复核；所有条目归属同品牌、版本与创建人。该对象标识/完整集合约束作为实现草案随PR审。

official_fact仅L1准入，四类为price/spec/boundary/service_promise。create同事务创建draft及waiting审核条目（无需新增submit接口）；作者从创建审计与submitted_by验证。approve与通用review_queue.approve是同一原子动作：FactCheck≠创建者，approved后且effective_from到达才可用于judge；reject/withdraw不新增事实状态，仍保持draft。approved→retracted后不得再次用于judge输入；修订基准另建新事实记录并重新审核，历史指标不覆盖。

error唯一比对基准是同品牌、L1、approved、已生效的official_fact。judge请求必须显式带official_fact_ids与lexicon_version，不能把claim_block或外部文本当基准；引用retracted/draft/不存在/未生效口径时422 validation_failed，缺有效基准时error_i=null，不填0或猜分。错误判定正则、spec_score等仍留judging-spec，不在本任务实现。

判定job以batch_id记录实际lexicon_version，并将同版本写入metric_snapshot；后续词表生效不重写旧批次。旧批次按明确历史版本还原，不默认latest，也不把旧版本删除或替换；不存在或未审版本必须拒绝。job记录的lexicon_version、official_fact_ids与版本集合引用属于行为必要字段草案，依既有常设授权随PR审，metric_snapshot.lexicon_version已按本裁定补入§18。

这次补充记录判定输入，不额外修改既定快照可比性判据或判定算法。`scripts/t02-judge-inputs.mjs`仅为两项输入契约测试提供可执行示例，不是生产judge实现，不访问数据库或模型。

### 字段草案（依二轮②常设授权，随PR审）

以下只写规格，未自动扩改产品§18的明确列清单，T04定稿后才落迁移：

| 位置 | 草案字段/映射 | 行为依据 |
|---|---|---|
| api_token | id、tenant_id、user_id；只存token_hash/scopes/时间；hash唯一，创建响应明文只展示一次 | per-user PAT、租户隔离；一轮5/§16.3 |
| audit_log | job_name（受控枚举）、trigger_source、cause_event_id、batch_id、viewing_session_id、reason、viewer_user_id；null语义明确区分human/system | 一轮6/7、二轮异议会话 |
| probe_batch | cluster_question_sets（簇ID、锚定版本、question_id集合只读映射）、baseline_batch_id、retry_count、attempt_no、committed_attempt_no、compensates_batch_id、dead_letter_ref | 配置与执行双身份、问句锚定、整批补偿 |
| probe | question_id、attempt_no，与question原文一起还原冻结问句 | 二轮④集合可比性 |
| question_pool | archived_at作为模板archived投影，frozen不改回false | 冻结后只读与模板版本归档 |
| content_asset | review_status存四个裁定值；已发布块版本引用清单 | 一轮1、二轮③发布事实态 |
| diagnosis_report | object_id/版本/作者/封版/结论引用作为业务对象契约，持久化表方案另审 | 一轮6独立审核 |
| publish_registration | asset引用、URL/平台/发布时间/状态；重登记历史保留audit | 产品§11、三轮发布裁定 |
| offboarding | 合同引用、删除对象清单、执行时间、保留政策引用 | 一轮7显式解约 |
| deletion_ledger | 独立追加账本的object_type/time_range/executed_by/basis/deleted_at，独立存储生命周期 | 三轮保留策略，tombstone不随源数据删除 |
| 所有缺tenant_id业务表及evidence_item | 通过父对象验证租户；T04补tenant_id列与外键草案 | 产品§17.4，既有表列缺省不得当成共享数据 |

## 3. 状态机规格

[逐对象完整迁移表](api/states.md)覆盖模板10对象、probe_batch/review_queue/diagnosis_report及新增official_fact；brand_lexicon版本生效沿通用队列描述，不另造状态枚举。终态无出边是明确终态，非遗漏；claim_block的回draft由新版本行承接，旧版不改。只有声明的出边合法，其他状态组合一律409。

队列waiting不是给evidence_package增加pending_review状态：对象仍draft，但队列有waiting条目时不能修改被审版本；reject/withdraw后仍draft可修改，approve直接sealed。claim_block approve/reject与通用review_queue approve/reject为同一服务动作的两个入口，必须原子结算同一队列条目、同一对象，不能重复审核。队列三个终态条目不可重用；再提交新waiting条目。FactCheck≠作者在两入口都校验。

content_asset的registered块retract时，同事务先registered→ready，逐跳审计cause_event_id=该retract事件；再重算必配当前版本，条件不成立则ready→draft，记同一cause。非必配块retract且必配条件仍成立时停ready，由人决定重发；修复并approved后draft→ready自动恢复。禁止registered→draft直达路径；提交事务时所有不变量成立。普通修订不降低registered。人工retire只限策略或Owner且human（Owner受模式约束）。

同一版本sealed、batch三终态、queue三终态、asset retired不可改；证据包修订产生新行draft；asset“复活”创建新asset挂同机会卡。opportunity_card的中文状态沿用模板，不擅自翻译出新英文枚举；模板未明示的失败/撤销迁移不增加，执行失败留在batch或工单。

## 4. 批处理与事件

所有job以actor_type=system运行，携受控job_name、trigger_source（cron/事件id）与object_type/object_id；评分/复测携batch_id，非探针作业batch_id可空，多对象多行审计，只调用服务层。以下白名单不继承Admin权限。重试指数退避≤3次；这里的重试为整批执行尝试，失败结果不能进入成功指标分母；禁止只补失败问句/模型的部分重试。耗尽后batch failed、dead-letter告警，补偿另开batch，原batch终态保留。取消仅pending。

| job_name | 触发 | 允许服务动作 | 幂等/副作用 |
|---|---|---|---|
| weekly_pool | 周一 | keyword_pool_snapshot.append、intent_cluster.transition | pool_version唯一；稳定簇ID/分档/告警，产物需服务层授权，不修改冻结问句 |
| c_import | 已书面授权CSV批次 | keyword_raw.import | 入库前脱敏；新增/重复/拒绝计数；不写自动爬虫 |
| event_schedule | 发布登记、月度、首次评分排期或模型/判定/轨道变更事件 | probe_batch.create、scoring_snapshot.create/freeze | 按登记+时点/月份去重，D+3/14/30，目标3+对照3；baseline/月度30簇；模型主版本/判定/轨道变化新配置新基线，全量重跑与报告标注，不与旧期比较 |
| probe_execute | pending批次到期 | probe_batch.start/execute/complete/fail | 按冻结配置、簇锚定执行；批次追加，原文不进指令位 |
| judge | 批次回答待判定 | brand_lexicon.read、official_fact.read、probe_result.judge | 仅批准版本/口径；记录lexicon_version与基准IDs，无有效口径不出error分 |
| baseline_scoring | 基线判定完成 | cluster_score.append（内含question_scores）、cluster_platform_signal.append | cluster+snapshot唯一；拒答排除；不足样本不出分；复测不重写分数 |
| metric_aggregate | 全批判定完成 | metric_snapshot.append | 按batch追加；同口径比较；我方生产披露与对照组 |
| backflow_scan | 指标快照完成 | backflow_ticket.create | §8五信号；证据probe/责任角色/时限；说错24h红色 |
| ticket_deadline | 工单到期 | backflow_ticket.expire | open/assigned→expired，超时保留审计，不抹除原责任人 |
| content_reconcile | 块approve/retract/修订 | content_asset.transition | 系统派生态；注册与发布事实规则见§3 |
| audit_middleware | 任一写入/敏感读取/成功PAT认证 | audit_log.append、api_token.record_use | 只追加；继承原调用者身份，禁止对外调用伪造日志 |
| opportunity_lifecycle | 双筛评分/监测开始/簇归档事件 | opportunity_card.transition | 仅已列模板出边，不处理人工建议/确认 |
| publication_lifecycle | 登记排期与报告完成 | publish_registration.transition | 注册进度与资产状态分离，保留历史 |
| offboarding | 显式解约流程及获批人工清理 | offboarding.execute、deletion_ledger.append | 删除原文，保留聚合/审计及合同保留期；过程可追溯 |

原始probe_result判定由人工FactCheck或本次v4明确的受控judge job，在judging-spec冻结后经同一服务层输入闸门操作；MVP规则计算如何经同一服务动作执行按T16冻结规则实现，不能将system解释为任意判定权限。引用匹配阈值、拒答判据、悬空指代正则、spec_score全部留judging-spec人审，本次不补算法。

配额按tenant+operation_type计数probe/judge/drafting并分token限流；没有新增Agent功能或默认配额。原始回答访问与C类访问全审计；没有raw批量读取/批量导出内部调试端点。

### 4.1 job_name受控注册表

受控枚举固定为上表job_name列：judge / weekly_pool / c_import / event_schedule / probe_execute / baseline_scoring / metric_aggregate / backflow_scan / ticket_deadline / content_reconcile / audit_middleware / opportunity_lifecycle / publication_lifecycle / offboarding。拒绝任意自由字符串；同一job只能执行其端点白名单。audit_middleware写原调用者actor_type，不以system掩盖human/agent/external_agent；仅后台job本身为system。

非探针job以trigger_source加对象追踪；探针类batch_id必须与端点目标及tenant一致。普通列表/GET可追加访问审计与凭证last_used_at，但绝不迁移被读取业务对象状态。

job白名单结构化定义同时保存于 `api/contracts.json.jobs`；执行参数必须携触发来源。publication_lifecycle与metric_aggregate需要batch_id，opportunity_lifecycle的归档事件可无batch_id，但评分/监测出边必须携batch_id。失败尝试与完整尝试选择字段为实现草案；禁止跨尝试拼凑有效样本。

## 5. 语义分级汇总表

承重及敏感端点见[核心集](api/core-set.md)，其他操作见[支撑件索引](api/generated/endpoints.md)，其每行同时列semantic与destructive；对应JSON为机器可审阅输入，未来MCP只映射注解，不在MVP实现。

| 语义 | 操作类型 | destructive |
|---|---|---|
| read-only | GET摘要、列表、受控单条读取、下载及compare | false；只访问审计，业务状态不变 |
| draft | 种子/问句/块/资产/证据/诊断草稿与新版本 | false |
| proposal | opportunity_card.recommend | false；Owner确认独立write |
| write | submit/approve/reject/withdraw/freeze/confirm/配置/导入/判定/排期/登记/调阅POST | false，受具体前置条件限制 |
| write | retract/archive/retire/cancel/revoke/offboarding | true；不可借通用update绕过 |

## 6. 阻塞问题关闭与人审说明

既有裁定与v4接入输入补充原文已全部存档，已知规则歧义已关闭。当前停止点为“人审冻结”，不是agent宣告冻结。

人审仍需确认核心集、allow规范及支撑件抽检中的候选细节：diagnosis下editor/viewer异议申请行、Admin的PAT配置管理、游标编码/排序、审计可空字段、批次锚定与失败尝试存储、diagnosis_report/publish_registration/offboarding/deletion_ledger持久化草案。它们属于本次提交人审的设计材料，不自动作为已实现权限或新增产品功能。

已定状态、采样参数、引用口径与审计生命周期不得在后续实现中优化或猜测。新增未覆盖的权限边界、状态枚举或判定规则继续停下询问；行为已裁定的字段缺列按二轮②常设授权提草案随PR审。
