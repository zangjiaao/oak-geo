# API 契约与状态机设计规格

> 状态：草案，未冻结 · T02 已开始，待业务决策与人审。不得据此实现未批准的状态、权限或判定规则。
> 输入：`GEO产品文档.md` v3.4 §3–4、§6、§8–9、§11–14、§16–19；`api-spec-template.md`。
> 本稿区分“事实源已定”与“待批准建议”。路径及事件名是接口设计草案，均需人审。AGENTS.md 标注事实源已冻结，但产品文件页首仍写评审稿，本稿不修改其状态。

## 0. 冻结流程与审阅 checklist

- [ ] §9.3 角色 × 资源 × 操作矩阵完整，未覆盖项有人工决策
- [ ] 各对象状态枚举、出边、终态全部批准
- [ ] 所有写操作显式定义权限、审计、幂等、副作用
- [ ] 差值接口口径一致性与簇级问句集例外明确
- [ ] 语义分级及 destructive 标记完整
- [ ] 客户原文访问仅异议单条调阅，原文无批量导出端点
- [ ] §6 阻塞问题全部关闭；人审人、日期及冻结版本补齐

审阅人：待填；冻结日期：待填；当前不满足冻结条件。

## 1. 全局约定

### 1.1 鉴权与隔离（已定）

Web 会话与 per-user API Token（PAT）并存，解析 `(user, role, tenant, actor_type)`，权限矩阵同源。所有资源查询验证 tenant_id 与品牌归属；路径中的 tid/bid 不是授权凭证。所有写操作经 `src/server/api`，jobs 也只能调用服务层；路由只转发。没有权限定义的组合不开放，待人审，禁止默认允许。

角色为 owner/editor/viewer/strategist/content/evidence/factcheck/cs/admin；actor_type 为 human/agent/external_agent，与角色正交。MVP 不实现 Agent Runtime/MCP。决策动作须人确认；外部内容仅作数据、不进入指令位。

### 1.2 请求与响应（模板约定）

基础路径草案：`/tenants/{tid}/brands/{bid}`；租户资源位于 `/tenants/{tid}`。下表路径以品牌前缀为相对基准，例外注明。

列表使用 cursor，响应不超过 20KB；大对象摘要加下钻，不以截断原文绕过访问校验。所有响应包含 `meta: { snapshot_id, data_as_of, pool_version? }`，无快照时 snapshot_id 为 null；来源结论携带 probe_id 与来源等级。时间格式、cursor 编码与错误体 schema 待人审定稿。

写请求携带 `Idempotency-Key`。建议作用域为租户、操作者、操作和目标对象；同 key 同载荷复用结果，异载荷拒绝；保存时长待批准。审计和副作用必须随业务成功可靠落地，重放不重复排期、计费或发通知。具体事务/事件投递实现属后续任务。

错误：403 权限；409 非法状态迁移；422 字段校验；429 配额。模板 `409002 incomparable` 是业务码，不是 HTTP 状态码，其 HTTP 映射待批准。

### 1.3 审计、审核与配额（已定）

所有写操作、所有原始回答和 C 类数据访问记录 audit_log，含 user_id、tenant_id、action、object_type、object_id、at，以及 actor_type、agent_run_id、prompt_version；后两字段 human 的空值语义待定，字段不可省。审核队列使用 object_type + object_id，不写死两类；作者与状态分别表达。FactCheck 唯一放行，作者不得放行自己产物。

按 `(tenant, operation_type)` 分 probe/judge/drafting 计数，并保留按 token 限流；超额 429 + 告警。实际配额由配置明确，禁止编造默认额度。成本降级必须披露，不静默改采样参数。

### 1.4 口径及不可变性（已定）

- 问句溯源五字段任一为空不入库。§18 列有 source_word_id、source_channel、collected_at、maintainer、question_pool_version 等字段，但未明确“五字段”的准确映射，见 §6 待确认；不据此编写入库逻辑。冻结修改开新版本。
- 检索轨 MVP：3 问句 × 4 国内厂商模型 × 温度 0/0.7 × 3 轮 = 72 条/簇。具体模型 ID/版本待 T14 当日核实，当前不调用。
- scoring_snapshot 必含 judge_version=`rule_manual_v1`、grounding_mode、模型与采样参数、问句原文和版本引用；换模型/判定/轨道开新快照并重建基线。同快照不覆盖，冻结参数不得改。
- refused 不进任何分母；n_valid < 10 或 model_coverage < 3 时 *_score=null、insufficient_sample=true；模型覆盖如实记，不补齐。
- 同一 `(cluster_id, snapshot_id)` 只写一次。机会卡引用 cluster_score，不复制四分与留白分。
- 对比读取基线/复测的测量口径；不一致返回 incomparable，省略差值，不进入差值报告。整池新版本若老簇问句集未变，不自动废弃该簇基线（§3、§19.17）。具体一致性字段与标识关系见阻塞问题。
- 归档簇软删除，SOV 分母保留 90 天过渡；我方生产内容报告必须披露且有对照组。
- 无 search_volume 业务字段，不输出绝对搜索次数或承诺。C 类数据需书面授权及入库自动脱敏，解约后 30 天内删除；无全量原文导出接口。

## 2. 资源清单

以下列全模板资源与已明确动作。每行都是待审接口设计，不表示已存在实现。所有写操作幂等、服务端鉴权并审计；“待定”处阻塞对应实现。读取均继承全局口径元数据；除敏感数据访问外普通读取无需业务审计。

### tenant

基础路径：`/tenants/{tid}（不使用品牌前缀）`。

合同、mode(full/diagnosis/self)、plan；MVP 单租户单品牌单行业。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取/配置租户 | GET /；POST /configure | read-only / write | admin | tenant.configure | 配置变更；生命周期和删除流程待定 |

### brand

基础路径：`/tenants/{tid}/brands`。

品牌、行业、市场；所有权绑定租户。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取/配置品牌 | GET /{bid}；POST /{bid}/configure | read-only / write | 配置权限待定 | brand.configure | 品牌词表/官方口径维护边界待定 |

### user_member

基础路径：`/tenants/{tid}/members`。

九种角色与品牌归属，PAT 与会话使用同一成员身份。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 成员配置 | POST /configure | write | 待定（建议 admin） | member.configure | 角色变更、撤权及自撤权边界待定 |

### seed_list

基础路径：`/seed-lists`。

word_type 为品类/场景/问题/竞品/品线；行级 maintainer 与 last_reviewed_at 必填，无维护人不开管道。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取版本 | GET /{id}/versions | read-only | strategist；其他待定 | — | 返回版本历史 |
| 建立/修订种子版本 | POST /；POST /{id}/revisions | draft | strategist | seed.create / seed.revise | 旧版保留；生成语法先预览再确认 |

### keyword_raw

基础路径：`/keyword-imports`。

A/B/C/D 渠道；B 类 CSV 人工/半自动；C 类先授权和脱敏，raw_payload 访问须审计。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 导入 CSV | POST / | write | 导入权限待定 | keyword.import | 归一化去重；新增/重复/拒绝计数；不写自动爬虫 |
| 导入结果摘要 | GET /{id} | read-only | 导入人读取边界待定 | — | 不夹带原始 C 类数据 |

### intent_cluster

基础路径：`/clusters`。

六意图；稳定 cluster_id，拆并开新版本；只软删除。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取簇 | GET /{id} | read-only | 内部；full 客户本品牌只读，具体角色待定 | — | diagnosis 客户无机会页 |
| 归档 | POST /{id}/archive | write | 待定（建议 strategist） | cluster.archive | 归档原因/时间，SOV 分母保留 90 天；destructive=true |
| 拆并提案 | POST /{id}/migration-proposals | proposal | 待定 | cluster.propose_migration | 人工确认后迁移，禁止自动换题 |

### question_pool

基础路径：`/question-pools`。

溯源五字段非空，簇级真实问句集；冻结不可原地修订。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取版本 | GET /{id} | read-only | 待定 | — | 返回问句及溯源 |
| 建立版本/冻结 | POST /；POST /{id}/freeze | draft / write | 待定（建议 strategist） | question.create / question.freeze | 锁定簇问句集 |
| 升级提案 | POST /{id}/upgrade-proposals | proposal | strategist 决定，人工确认 | question.propose_upgrade | 新版本+受影响簇重建基线，不自动废弃其他簇基线 |

### opportunity_card

基础路径：`/opportunity-cards`。

pool_version/snapshot_id/来源 ID；进生产 demand_tier 与 demand_source 必填；只读 cluster_score 与渠道信号。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取 | GET /{id} | read-only | strategist；full 客户本品牌只读边界待定 | — | 返回分数引用及渠道建议 |
| 建卡/建议 | POST /；POST /recommendations | draft / proposal | strategist | opportunity.create / opportunity.recommend | 建议 3 簇及证据，不自动决策 |
| 确认优先簇 | POST /confirm-priorities | write | owner，human | opportunity.confirm | 确认 3 簇；状态迁移待定 |

### scoring_snapshot

基础路径：`/scoring-snapshots`。

版本链及 judge_version 必填；聚合 question_score→cluster_score，非机会卡复制出数。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取 | GET /{id} | read-only | 待定 | — | 参数、覆盖率、数据截至 |
| 启动评分/冻结 | POST /；POST /{id}/freeze | write | 触发评分权限待定 | scoring.start / scoring.freeze | 调用服务层排探针/聚合，失败重试与冻结时点待定 |

### claim_block

基础路径：`/claim-blocks`。

四问校验 number/unit/scope/source_url；L3 不入库；版本化、自包含检查、跨平台数字口径一致；判定细节等 judging-spec 冻结。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取 | GET /{id} | read-only | 按 §9.3，细分待定 | — | 版本及来源等级 |
| 创建/修订草稿 | POST /；POST /{id}/revisions | draft | editor/content（本人编辑） | claim.create / claim.revise | 修订开新版本，旧版只读 |
| 提交审核 | POST /{id}/submit | write | 作者本人 editor/content | claim.submit | 四问/来源/整篇必配块闸门通过，入通用队列 |
| 放行 | POST /{id}/approve | write | factcheck 且非作者 | claim.approve | 通过后可登记发布 |
| 驳回 | POST /{id}/reject | write | factcheck | claim.reject | reason 必填，回作者 |
| 下线修正 | POST /{id}/retract | write | 模板为 factcheck，边界待批准 | claim.retract | 关联说错工单及同源追溯；destructive=true |
| 引用查询 | GET /{id}/citations | read-only | 内部具体范围待定 | — | cited_claim_ids 聚合 |

### content_asset

基础路径：`/content-assets`。

关联 opportunity_card、事实块版本、作者；平台适配建议，不代发。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 撰写/修订 | POST /；POST /{id}/revisions | draft | editor/content | content.create / content.revise | 仅内容工作台写入口 |
| 提交整篇 | POST /{id}/submit | write | 作者本人 | content.submit | 按意图必配块校验，来源及自包含校验；状态枚举待定 |
| 审核放行 | POST /{id}/approve | write | factcheck 且非作者 | content.approve | 涉及事实块的整体审核关系待定 |
| 读取 | GET /{id} | read-only | 待定 | — | 摘要下钻，不暴露受限原文 |

### probe_result

基础路径：`/probe-results`。

回答级判定 {0,0.5,1}；拒答不计分母。链接元数据与正文链接归一化，显式/隐式引用分开记；语义疑似入人工抽检，不直接计数。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 判定摘要 | GET /{id} | read-only | 内部/本品牌客户；具体边界待定 | — | 不含 raw_answer |
| 单条原文 | GET /{id}/raw-answer | read-only | 内部细分待定；客户只能走 objection | probe.raw_access | 水印和审计，无批量导出 |
| 写入/修订判定 | POST /{id}/judgments | write | 判定角色待定 | probe.judge | judging-spec 冻结前不得实现判定；不覆盖冻结快照 |

### publish_registration

基础路径：`/publish-registrations`。

客户渠道发布后登记时间/URL/平台，系统只记不代发、不验证发布。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 登记 | POST / | write | editor（内容工作台） | publication.register | 已放行内容；D+3/D+14/D+30 目标3簇+对照3簇排期 |
| 读取登记/复测 | GET /{id} | read-only | 待定 | — | 偏离建议渠道记录供回流分析；撤销/更正待定 |

### evidence_package

基础路径：`/evidence-packages`。

证据包与模板，封版只读。可下载包与受限原始回答必须隔离。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 建立包/模板 | POST / | draft | evidence | evidence.create | 构建人留痕，审核入列时点待定 |
| 放行封版 | POST /{id}/seal | write | factcheck 且非建包人 | evidence.seal | 封版只读；诊断结论独立放行关系待定 |
| 下载 | GET /{id}/download | read-only | editor；其他角色待定 | — | 不得包含原始回答全文批量导出 |

### objection

基础路径：`/objections`。

客户对指定 probe_id 的单条异议申请；CS 陪同、水印、不可导出，全量审计。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 申请 | POST / | write | owner | objection.submit | 单 probe_id，通知 CS |
| 批准调阅 | POST /{id}/grant | write | 处理人为 cs，批准权边界待定 | objection.grant | 限定单条访问，时效待定 |
| 单条查看 | GET /{id}/excerpt | read-only | 申请人+CS 陪同条件待定 | objection.view | 单条水印摘录，无导出；viewed 状态写入方式待定 |

### metric_snapshot

基础路径：`/metric-snapshots`。

mention_rate/citation_rate/avg_position/accuracy/sov；leads 表字段预留，不做线索归因看板。显式引用为客户硬指标，隐式引用内部分析。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 报表/趋势 | GET /；GET /{id} | read-only | owner/viewer；其他角色待定 | — | 本品牌；我方生产披露+对照组 |
| 比较 | GET /compare | read-only | 有两端读取权限的报表角色 | — | 口径不同 incomparable，省略差值 |
| 报告导出 | GET /{id}/report | read-only | viewer；其他角色待定 | — | 无原文批量导出；不可比不进差值报告 |

### backflow_ticket

基础路径：`/backflow-tickets`。

五类回流信号，证据 probe_id、责任角色、时限；说错红色 24h；周一评审，月度批次报告后 3 工作日完成。

| 操作 | 方法+路径（草案） | 语义级 | 允许角色/待定边界 | 审计事件 | 副作用/校验 |
|---|---|---|---|---|---|
| 读取 | GET /{id} | read-only | 责任角色/CS，细分待定 | — | 信号与来源可回溯 |
| 派单/完成 | POST /{id}/assign；POST /{id}/complete | write | CS 处理，责任角色权限待定 | ticket.assign / ticket.complete | 需求/生产两路回流；超时升级接收人待定 |

## 2.18 补充数据资源映射

产品 §18 实际列出 19 张表（backlog/模板文字仍称 18）。除上列外：keyword_pool_snapshot 为周批只读输出；question_score/cluster_score/cluster_platform_signal 为聚合只读输出，禁止前端单独写分数；probe 为调度服务输出；industry_score 只供内部排产留档，不进对外报告；audit_log 仅追加，Admin 可查看日志，不以日志接口泄露原始回答/C 类全文。上述写入必须经服务层。模板中的 publish_registration/evidence_package/objection/backflow_ticket 不在 §18 表定义内，表结构待 T04 前人审补齐，不擅自造表。

## 3. 状态机规格

以下“模板”均为设计输入，尚非冻结规则；产品文档明确事实优先。全部迁移继承 §1 审计、权限、幂等约束。

| 对象 | 输入中已有状态/迁移 | 触发、条件、副作用 | 尚未闭合的边界 |
|---|---|---|---|
| claim_block | 模板 draft→pending_review→approved；reject 回 draft；approved→retracted；重新修订开新版 draft | 作者 submit，四问/来源/必配过闸；FactCheck 非作者 approve，reject 理由必填；retract 关联工单 | published/revision_needed 无完整迁移；建议见 §6，不自行采用 |
| content_asset | 产品仅给 review_status，未给枚举 | 作者提交、FactCheck 唯一放行，先审后发 | 全部状态枚举与块级审核关系待批准 |
| opportunity_card | 模板候选→评分→建议→确认→在测→归档 | Strategist 建卡/建议，Owner 人工确认3簇，生产前需求来源必填 | 英文枚举、失败/返工/撤销及终态待定 |
| intent_cluster | 产品 active→archived | 归档原因+时间；软删除，SOV 分母90天过渡 | 操作权限、拆并归档次序、恢复是否允许待定 |
| question_pool | 产品 frozen 布尔；模板 open→frozen→archived | 冻结后不可改；升级人工拍板开新版本，受影响簇重开基线 | archived 映射与拆并操作待定 |
| scoring_snapshot | 模板 open→frozen | 只追加、模型/温度/轮次/问句/判定/轨道冻结 | 冻结时点与失败/部分完成处理待定 |
| evidence_package | 模板 draft→sealed | FactCheck 非建包人放行；sealed 只读 | 提交/驳回/修订状态与诊断结论放行待定 |
| objection | 模板 submitted→granted→viewed | Owner 指名 probe_id，CS处理；查看水印/审计/禁止导出 | 拒绝/过期/撤销/重复查看权限与状态待定 |
| backflow_ticket | 模板 open→assigned→done | 信号扫描建单，责任人处理，超时升级；说错24h | 重开/误报/升级对象及指派权限待定 |
| publish_registration | 模板 none→registered→retesting→reported | Editor回填已放行发布；自动排D+3/14/30复测 | none 是否只表示对象不存在；更正、失败、迟到及 reported 条件待定 |

## 4. 批处理与事件

Job 不是直写库豁免；每个 job 调用 `src/server/api`，显式服务身份与租户授权待批准；禁止伪造普通用户跳过权限。

| Job | 触发 | 幂等边界（模板/产品） | 服务层副作用/校验 |
|---|---|---|---|
| 词池周批 | 周一 | pool_version 唯一 | 稳定簇ID、分位分档、周快照、首见<14天且连续两周上升告警、候选队列刷新 |
| C类导入 | 授权数据批次 | 批次去重细节待审 | 自动脱敏先于入库，访问留痕；回灌词池 |
| 评分批次 | 手动加急/月度 | (cluster_id,snapshot_id) 唯一 | 72回答同时产留白分与T0指标，不重复采样计费；不足样本不出分 |
| 事件复测排期 | 发布登记 | 登记与时点排期唯一 | D+3/D+14/D+30，目标3簇+对照3簇；D+3当日，D+14/30±2天 |
| 月度全量 | 每月 | 月度批次标识待审 | 30监测簇，冻结采样口径；不得混轨 |
| 引用判定 | 复测结果落库后 | probe_result级 | 品牌词→显式链接→指纹→语义疑似人工；显/隐引用分别记 |
| 指标聚合 | 判定完成 | 快照批次 | 拒答排除；同口径差值；披露与对照组 |
| 回流信号扫描 | metric_snapshot落库后 | 批次级 | 按§8五类规则出工单，不自行补阈值；周一评审 |
| 基线重置 | 模型主版本/判定方式/轨道变更 | 变更事件级 | 新快照、全量重跑与报告标注；簇问句升级只影响该簇 |
| 网页端校准 | 每月 | 抽样批次待审 | 5–10%半自动+人工复核，仅校准轨；连续两月<70%提及一致率触发复核 |
| 解约删除 | 合同解除 | 解约事件级待审 | 30天内删除C类；删除范围、备份与审计保留冲突待批准 |

## 5. 语义分级汇总表

§2 的每个操作已逐行标记语义。此处汇总同类规则，未来映射 MCP 注解，目前不实现工具。

| 操作集合 | 语义级 | destructive |
|---|---|---|
| 资源摘要/列表/历史/引用聚合/报表/比较/模板及证据包下载 | read-only | false |
| 原文/异议摘录读取（审计必需） | read-only | false；若推进viewed需另定显式写动作 |
| seed/claim/content/evidence 草稿创建与版本修订、问句版本创建 | draft | false |
| 机会建议、拆并提案、问句升级提案 | proposal | false，决策另需人确认 |
| submit/approve/reject/seal/freeze/confirm、CSV导入、评分触发、判定、发布登记、异议申请批准、工单派发完成 | write | false；具体不可逆后果人审确认 |
| claim.retract / cluster.archive | write | true |
| 租户/品牌/成员配置 | write | 撤权/删除等子操作未定义前不开放，标记待定 |
| C类解约删除 | write | true，流程未定，不实现 |

## 6. 阻塞问题与待批准建议

这些不是已定规则。依据 AGENTS.md §3“歧义即停”，相关契约只能列问题，不能直接实现。

1. **状态闭合**：是否允许以模板作为状态机设计起点？claim_block 示例列 published/revision_needed 无完整迁移；content_asset 无枚举。建议事实块仅 draft/pending_review/approved/retracted，驳回回draft，修订创建新版本；发布进度归内容资产/发布登记，避免一块多平台发布冲突。content_asset 建议 draft/pending_review/approved/revision_needed/retracted，需另审全部出边及终态。
2. **权限边界**：建议原文 Strategist/FactCheck/CS 按职责读取；Content/Evidence 限关联任务；Admin 不因管理员身份默认读原文。成员和品牌基础配置归Admin，品牌词表/官方口径归Strategist。这些为建议，仍需补全逐操作 allow/deny 矩阵、内部跨品牌边界、客户Editor可读范围及diagnosis模式写权限。
3. **记忆轨采样**：§4给36条/簇未给完整参数。建议3问句×4模型×温度0×3轮=36；人审前不排记忆轨任务。检索轨模型ID需T14当天复核。
4. **快照身份**：同snapshot只写一次、重跑开新snapshot，与“前后同快照”需区分采样配置身份和执行批次身份；不得擅自增加状态/字段解决。建议人审明确比较字段及簇级问句原文等价判定。
5. **数据定义差异**：§18实际19张表，模板17资源，业务工单等缺表；溯源五字段的最终语义、通用审核队列表、PAT存储、批次/引用类型及指标口径字段需T04前定稿。
6. **审核与异议**：诊断结论的对象类型、证据包提交驳回路径、放行与封版是否同一步；异议批准权/时效/CS陪同技术判据/水印字段及重复调阅；viewed写入不能借GET裸改状态。
7. **权限与生命周期缺口**：导入、判定、评分冻结、归档、工单完成及后台job的服务身份；租户解约删除与不可变审计保留；不得把Admin解释为万能权限。
8. **判定**：悬空指代正则、词表匹配、spec_score与指纹阈值等留给judging-spec人审冻结，不在此发明。
9. **接口工程约定**：响应/错误体/时间与分页schema、409002的HTTP映射、幂等保存期、后台失败重试/取消/补偿契约仍待审；待定项不能作为可编码API承诺。

本稿已覆盖模板的资源及章节目录，不等于T02完成。待上述决策后补全逐端点请求/响应示例、权限矩阵与闭合迁移表，再提交人审冻结。
