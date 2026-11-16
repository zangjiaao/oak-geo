# GEO 产品文档

> 版本 v4.0 ｜ 状态：方法论验证方向已获负责人授权，文档调整待 PR 人审；不是规格冻结。
> 当前入口：[文档地图](README.md)；执行排期：[backlog](backlog.md)。原 v3.5 全文见[历史快照](archive/GEO产品文档-v3.5.md)。
> 本次方向：先用真实案例验证方法论，再根据证据细化产品。已有 API、权限、状态机与采样契约不因路线调整自动变更。

# 第一部分 · 方法论

GEO 要验证的是：能否找到与产品真实能力匹配的用户需求，识别 AI 回答中的问题，提出值得执行的内容动作，再用同口径复测观察变化。不承诺增长。

流程：**理解产品 → 收集真实用户任务 → 形成候选需求簇 → 选测量问句 → API 实测 → Agent 分析与人工复核 → 内容动作 → 复测与复盘**。

## 1. GEO 和 SEO 差在哪

测量对象是 AI 答案中的品牌提及、事实准确性与来源引用。搜索趋势和搜索结果是上游证据，不能直接代表 AI 问答需求或推荐概率。不同模型、联网模式和网页产品的行为可能不同，测试结果只对记录的条件负责。

当前 MVP 是方法论实验工具。先验证判断是否可靠、建议是否可用，再细化完整后台、商业套餐与规模化运营。页面齐全、规则测试通过、内容已发布，都不能单独证明 GEO 有效。

## 2. 找需求：从产品事实与用户任务开始

### 2.1 理解产品

从负责人提供的资料、官网、接口文档、SDK 等许可来源建立轻量产品档案。采集优先使用可用 API；无适用 API 时用人工整理或授权导出，不为验证先建通用爬虫。

Agent 提取产品能力、适用对象、限制、价格与服务承诺，并列出冲突、缺项和资料日期。每个事实候选保留来源 URL／资料定位与采集时间；人工确认后，经既有服务与独立审核形成官方口径。第三方描述可用于观察外界认知，不能直接替代官方事实。

产品档案还应解释：谁在什么条件下，借助哪些能力完成什么任务，以及还需要哪些工具。先用轻量研究记录承载，不新增知识库平台或专用数据库。产品事实是诊断输入，事实块是面向发布的表达，两者不能混用；错误判定仍只使用有效 approved official_fact。

### 2.2 收集需求证据

| 类别 | 证据 | 可以说明什么 | 边界 |
|---|---|---|---|
| A 检索类 | Trends、指数、相关搜索与结果页 | 搜索兴趣、表述与供给变化 | 不等于 AI 问答量；指数不能换算搜索次数 |
| B 平台类 | 公开问题、讨论、平台搜索表述 | 用户任务、条件与障碍 | API 按授权使用，人工／半自动导出可替代；不自建自动爬虫 |
| C 自有一手 | 获授权且脱敏的客服、反馈与搜索日志 | 真实客户语言与决策条件 | 只覆盖已有客户；无 C 类反哺不对外引用行业留白结论 |
| D AI 实测 | 官方联网 API 回答及披露的来源 | 本次模型如何回答 | AI 自己提出的问题不是市场需求证据 |

先结合产品能力提出研究假设，再寻找独立需求材料验证；也允许从材料发现未预想到的任务。缺少证据就保留缺口，不用模型生成的问题填充。原 A/B/C/D 权重和行业排名留作历史假设，研究阶段不做综合需求分数。

### 2.3 需求簇如何形成

Agent 从真实材料识别“用户／任务／条件／障碍／期望结果”，解释哪些表述应归在一起、哪些需要拆开，并关联产品能力与原始证据。策略人员确认相关性、代表性和边界。词语相似不能单独决定归簇。

需求簇表示用户要完成的任务；六类意图表示认知、选型、价格等决策角度；具体问句是测量资产。三者分别记录。行业种子与模板扩词只用于检索线索，不能充当市场需求证明。

例如，okdata 的“小红书评论获取”“用户差评调研”“AI 助手接入社媒数据”可作为研究假设。它们是否存在、是否归并、是否值得测，都要由真实材料确认；不预设它们是已有机会。

Trends 为候选需求补充趋势证据。研究试跑不把热度高、SERP 真空或完整行业周批作为唯一准入条件，低频但任务明确的需求也可研究。没有趋势数据不解释成没有需求。

## 3. 出题：从需求证据选出测量问句

Agent 可整理、去重和忠实改写真实表述，必须保留原文关联与改写理由；人确认代表性、产品相关性和中立性。不能拼接只有本产品满足的条件来制造优势。

意图仍为认知、选型对比、价格、场景方案、排障、替代/否定六类，不新增状态或意图枚举。正式 question_pool 五项溯源必填：source_word_id、intent_type、source_channel、collected_at、maintainer；候选研究笔记不冒充已入池数据。

冻结后不原地改题。簇入测锚定 question_pool_version；升级锚定须由人显式确认并重开该簇基线。新增其他簇不改变已有簇锚定。相同快照、相同簇锚定版本和相同问句 ID 集合才可比较；跨版本即使文本相同也不可比。

## 4. 测留白：API 采样，Agent 辅助诊断

先分清两种活动：

- **研究试跑**：核对资料、检查问题、查看真实回答、形成诊断假设。记录实际调用条件、数量与成本；不声称正式基线完成，不产出未经批准判据的正式分数。正式探针调用仍走已批准配置；拟改变模型、温度、轮次或规模，先单独提审，不通过研究标签绕过服务校验。
- **正式测量**：按冻结契约及已批准模型清单采样、判定、聚合和复测。既有检索轨为每簇 3 问句 × 4 模型 × 温度 0/0.7 × 3 轮，共 72 条回答。模型 ID 和原生联网能力执行前复核；名单未批准不调用。记忆轨为 36 条/簇，与检索轨分别配置和报告。

主轨通过官方 API 原生联网工具采集，网页端只作半自动、人工陪同校准。API 结果不能冒充消费端网页表现；不使用账号池，不把浏览器直采改成主轨。

程序保存问题、模型与版本、联网方式、温度、轮次、时间、引用、失败和用量。Agent 分析品牌提及、任务匹配、事实差异和引用来源，提出解释及替代解释；人复核重要结论。

空白度、错答度、泛化度、竞品占位度保留为已有正式测量维度。未提品牌不自动意味着应该推荐品牌；认知答案未点名厂商可能合理。Agent 的定性诊断不重定义四项评分，不直接代替 judge。

错误判定只与同品牌、L1、已批准生效的 official_fact 比对；缺基准不猜分。拒答不进分母；n_valid < 10 或模型覆盖 < 3 时 *_score=null、insufficient_sample=true。判据未审阅冻结不自动评分。

## 5. 排机会：先解释为什么值得做

研究建议至少回答：用户任务是什么、需求证据在哪里、产品是否适用、AI 实测发现什么、现有来源缺什么、建议动作与验证方式是什么。证据不足、产品不适用、暂不执行也是有效结果。

Agent 提出有证据的优先级与不确定性，人决定是否执行。先比较需求真实性、产品适配、诊断证据和执行成本，不先训练固定机会权重。热度、SERP 构成与竞品信号是辅助证据，不能从“未提及”直接跳到“多写文章”。

**研究建议与正式机会卡分开**：研究笔记可保留待核实／证据不足的描述，这不是新增数据库状态。现有正式 opportunity_card 进生产前的 demand_tier、demand_source 等服务校验及 §19 第7条继续有效。若试跑证明门槛应改，另提交契约与实现变更；不填造指数，也不绕过现有闸门发布。

## 6. 写内容：先有事实，再形成事实块

根据诊断先检查已有内容：事实不存在、事实冲突、说明不清、模型误读，需要不同动作。产品无法支持的任务不能靠文案包装成支持；资料已充分时也可决定暂不新增内容。

Agent 基于已核实资料起草能力说明、边界、操作教程或对比内容，每条挂来源和适用条件，供人修改与独立审核。事实块不能反过来充当 official_fact 的错误判定基准。

沿用来源纪律：L1 一手、L2 可信二手、L3 不可用；L3 不进 claim_block。数字必须带单位、时点、范围和出处；不为让内容显得具体而编造数字。既有提交服务的必配块、段落自包含与跨平台口径一致校验保留；是否调整模板在试跑后另提审。

既有对外市场规模口径若使用，仍只用 28–29 亿，并附机构、统计口径、时点和链接；不能沿用无可核验出处的历史示例直接发布。内部试跑不需要以市场规模说明产品价值。

## 7. 分发：渠道建议必须附证据

Agent 结合该需求下的模型引用 URL／域名、SERP 构成、现有内容和可发布条件提出建议。品牌推荐、来源引用、目录收录分开解释。模型引用某渠道不代表新内容发布后必然被引用。

优先检查官方资产是否准确、一致、可访问；其他渠道按具体证据选择，不固定跨行业排行榜。输出渠道建议、证据、成本与未知项；人工决定，发布仍由客户／自营渠道负责人完成，不做代发。

## 8. 验证与回流：观察变化并允许否定假设

内容动作前留 T0；发布记录包括 URL、时间、修改内容、目标簇、对照簇及对应来源。正式复测沿用既有 D+3、D+14、D+30 及月度口径，目标与对照分开记录。日历到期后才采真实结果，不能用模拟未来回答冒充复测。

既有正式事件复测为目标3簇＋对照3簇，每轮432条；月度30簇、2,160条。它们是正式交付配置，不是开始整理产品资料、研究需求或分析样例前必须先完成的工程清单。改变正式样本配置仍须单独批准。

指标按冻结定义计算：提及率、显式 URL 引用率、事实准确率、SOV 等。指纹或语义疑似引用只作内部分析，不能升级成正式显式引用。不可比不给差值；不足样本不填0。

Agent 解读目标和对照变化，检查模型版本、来源变化等替代解释。不把发布后上涨直接当作因果证明；零增长、负增长、证据不足如实记录。分别评价“研究判断是否可用”和“发布后效果是否有证据”，不能相互替代。

# 第二部分 · 验证工具与执行

## 9. 产品总览

当前交付是可复核的案例链：产品资料 → 需求原文 → 簇与问句 → 原始回答及引用 → 诊断与行动 → 发布 → 复测 → 复盘。记录失败、人工纠正和成本，决定下一轮继续、调整或停止什么。

### 9.1 当前边界

先跑 okdata，再用 OKSocial 检查方法能否复用。两品牌分资料、权限、配置与基线；不据此引入多行业模板。先用轻量研究记录与已有网页／服务完成闭环，不先建设完整知识库、任务中心、通用 Agent Runtime、自动发布平台或商业套餐后台。

### 9.2 不因验证而取消的约束

事实审核独立，作者不能自审；我方生产内容需披露并带对照。所有入库写操作走 src/server/api 的显式操作，服务端权限、审计、配额、租户隔离、冻结与不可比校验继续执行。研究材料也遵守数据授权、脱敏和敏感原文访问边界，不把原始回答批量导出给 Agent。

### 9.3 角色与权限

| 角色 | 归属 | 能干什么 |
|---|---|---|
| 客户-决策者 Owner | 品牌 | 维护本品牌名称和描述、确认事实候选；看本品牌诊断包 / SOV / 准确率 / 复测史；确认 3 个优先簇；提异议；续费 |
| 客户-执行者 Editor | 品牌 | 用事实块编辑器撰写与提交；下载模板与证据包；在自己渠道发布后回填登记 |
| 客户-只读 Viewer | 品牌 | 只读品牌资料与知识库；看报表与趋势，导出 |
| 我方-策略 Strategist | 我方 | 建机会卡、定词池版本、出缺口清单与 3 簇建议 |
| 我方-内容 Content | 我方 | 撰写事实块（服务档），受审核放行约束 |
| 我方-证据 Evidence | 我方 | 建证据包与模板、来源初检 |
| 我方-审核 FactCheck | 我方 | 唯一放行权：证据包、诊断结论、进分发的事实块 |
| 我方-客户成功 CS | 我方 | 排复测、出交付包、处理异议与工单 |
| 我方-管理员 Admin | 我方 | 租户、模型配额、审计日志 |

**竞品数据可见性**：聚合层（SOV 分母、占位度评分、被引域名分布）全员可见；竞品原始回答全文只限我方内部；客户对某条结论有异议时，可指名 `probe_id` 单条调阅（CS 陪同、水印、不可导出、写审计日志）——**单条可查，批量不可导**。

当前第一步验收默认以 Owner 完成新增品牌、资料维护、调查和核对候选，内部策略／内容／证据分工不作为操作前置。需要生效官方口径时，再执行送审和独立放行，作者与放行者分离。默认测试入口的调整不扩大既有服务权限。

**租户**：一份合同 = 一个租户，租户下多品牌；本轮按品牌逐个验收，支持同一 Owner 创建及切换其授权品牌，技术上多租户单库、`tenant_id` 行级隔离；跨租户只出脱敏行业基准，样本少于 5 个租户不出基准；私有化部署不在 V1。

**合规五条**：C 类数据要客户书面授权 + 入库自动脱敏 + 解约 30 天内删除；D 类只走官方 API，不搞账号池；B 类只取公开内容、遵守平台条款；所有原始回答与 C 类数据的访问写审计日志；对外材料不得出现"排名 / 引用率承诺"字样。

## 10. 需求层设计

首轮输入：产品官方资料与能力边界、品牌及竞品词表、真实用户问题材料、可获得的趋势／SERP 证据及数据授权。先检查资料能否支撑判断，不要求所有渠道接齐。

API／程序处理可重复的获取、归一化、存储与证据关联；Agent 负责产品理解、任务识别、归簇和证据缺口分析；人确认事实与测量题。完整行业种子管道、周批、飙升告警可后置，已有代码复用但不充当方法有效性的证明。

研究产出先保留来源、时间、输入依据、Agent／prompt 版本、解释、人工修改与未知项。公共来源与 C 类私有资料分离；原文及 C 类访问必须按既有服务审计。新增持久对象和契约另提任务，不将研究字段悄悄塞进冻结状态机。

## 11. 生产层设计

只实现执行已确认动作必需的编辑、来源绑定、独立放行与发布登记。Agent 起草与人修改的版本关系保留；复用既有服务，不先细化模板库和完整编辑器。动作可以是修订已有文档，不预设每个需求都必须新增文章。

## 12. 验证层设计

API 执行正式采样；程序保存真实结果、失败、用量和配置身份；Agent 分析答案与竞争来源，人工核查重要诊断。正式 judge 与分析建议分开，judge 规则／prompt 变更需版本化并重开基线。

回答与 C 类数据单条授权访问并留痕，不提供批量原文导出。错误判定唯一基准仍为 approved、生效的 official_fact。正式引用率只计规范化 URL 全等的显式引用；同域、指纹或语义相似只作为弱证据。复测配置与簇锚定不一致返回 incomparable，无差值。

## 13. 界面与工作方式

### 13.1 最小入口

T42第一步是独立 `/welcome` 欢迎页，不嵌入工作台或主导航。首次进入只要求品牌名称与描述；已有当前资料后不重复强制引导。系统内 `/settings/brand` 维护当前资料，`/knowledge` 展示用户原话、Agent拆解的事实、来源、待核实项与审核状态。资料直接修改，无版本选择或资料历史管理；Agent调查按当前资料执行，运行期间资料变动时不覆盖新资料。Agent发现的官方页面可由Owner明确确认来源，再送FactCheck独立放行。

按当前实验需要提供资料／需求证据、真实回答与引用、诊断建议、发布登记、复测读数的最小可用入口。已存在页面复用；没有页面的研究步骤可先用受控文档承载，不先做全套导航与管理后台。UI 延续 astryx、必要字段标签和错误／权限／口径提示，删除重复解释。

### 13.2 审核与追溯

结论能回到需求原文、资料来源及 probe_id。清楚区分已核实事实、研究假设、Agent 建议和已批准判定；这些是展示和研究描述，不是新状态枚举。缺数据说明缺什么，不显示伪造分数。现有角色权限以冻结 API 为准，不新增越权写入口。

### 13.3 客户试跑

确认产品资料 → 核查真实需求 → 确认测量问句与已批准配置 → 查看回答 → 复核建议 → 执行动作 → 同口径复测 → 记录方法论结论。每阶段允许因证据不足而停止并补资料，不能为了进入下一页而补造数据。

### 13.4 工作室自运营剧本（dogfood）

okdata 是首个验证案例；其接口数、平台数、价格、上线状态都在试跑时核对，不复制历史介绍当实时事实。OKSocial 在首轮方法可用后复现，分品牌留证。自营可以验证工作流，不替代正式外部客户验收；对外案例披露生产方及证据局限。

## 14. MVP：先验证，再细化

### 14.0 当前验收

| 阶段 | 要验证什么 | 留下什么证据 | 不满足怎么办 |
|---|---|---|---|
| V0 产品与需求研究 | 产品能力能否对应真实任务 | 带来源的产品档案、需求原文、簇建议与待核实项 | 补资料、纠正定位或停止候选 |
| V1 真实回答 | 能否用已批准配置获得可查结果 | 问句出处、API回答、引用、配置、失败与用量 | 排查接入；不标正式基线完成 |
| V2 诊断可用 | 建议是否相关、有证据、可执行 | Agent分析、人工修订、执行／不执行理由 | 修订分析方法，避免堆评分规则 |
| V3 动作执行 | 能否基于真实事实补足缺口 | T0、审核、内容差异、发布登记、对照与排期 | 补足前置证据，不先发后审 |
| V4 效果复盘 | 可比结果是否支持原假设 | 真实到期复测、指标、替代解释、成本与局限 | 零／负增长照录，决定继续、调整或停止 |

方法可用后才细化稳定对象、模板、自动化和规模化流程。当前只做必要 API 接入、Agent 分析、人审及证据查看；不以完整后台、全行业管道、固定机会权重或通用 Runtime 作为启动条件。不提前宣称流程、分析能力或真实联调已经实现。

### 14.1 验收标准

| 验收项 | 阈值 | 怎么验 |
|---|---|---|
| 基线覆盖 | 30 簇中 ≥ 25 簇 `n_valid ≥ 70`（结构 72 条/簇，拒答不计分母） | 查 `probe_result` 计数 |
| 3 簇建议样本充分 | 每簇 `n_valid ≥ 70` | 交付包逐簇抽样 |
| 诊断可复核率 | 抽 30 条结论，100% 能回到 `probe_id` + 来源；口径复核通过率 ≥ 95% | 人工抽样 + 审计日志 |
| 判定一致性 | 同问句同模型 3 轮判定一致率 ≥ 85% | 自动比对 + 10% 人工抽检 |
| 网页端偏差抽检 | 月度抽 5–10% 问句网页版复跑（Playwright 半自动 + 人工复核），与 API 检索轨的提及判定一致率记录并披露；连续两月 <70% 触发口径复核 | 半自动抽样 + 报告附录 |
| 客户可用性 | 客户 3 位评审对"3 个簇能否直接开工"打分均值 ≥ 4/5 | 交付后回访 |
| 交付时延 | 基线 10 个工作日内；D+3 当日、D+14/D+30 ± 2 天 | 工单时间戳 |
| 承诺合规 | 合同、报价、交付包中"排名 / 推荐 / 引用率承诺"字样 0 处 | 交付前 checklist 逐份签 |
| 成本上限 | 单客户月 API ≤ ¥300 | 配额告警 |

前三项（覆盖、样本、可复核）未达标不得交付，按内部返工处理。

### 14.2 研究与正式交付的边界

上表是保留的正式外部交付验收，不作为 V0 研究启动清单，也不能通过少量探索样本宣称达标。既有正式采样配置、阈值和成本上限继续有效；不因“轻量”静默减采样。

每轮记录实际 API 调用、probe／judge／drafting 分类费用、Agent 分析时间、人工核查与返工成本。原预算是历史估算，不能当成已验证成本；改变预算或正式样本配置须明确提审。

### 14.3 迭代决策

优先补阻碍本轮研究判断的缺项，随后补动作与复测所需能力。完整报告、模板库、行业情报墙、运营自动化、通用 Runtime 与 MCP 都等待验证证据再排期。不预设必须完成原十周详设才算 MVP。

# 15. Agent：从首轮研究开始介入

### 15.1 分工

| 环节 | API／程序 | Agent | 人 |
|---|---|---|---|
| 产品理解 | 获取许可资料、保存定位与时间 | 提取能力与边界、发现冲突 | 确认事实、独立放行官方口径 |
| 需求研究 | 导入真实问题与趋势证据 | 识别任务、归簇、匹配产品能力 | 确认相关性与代表性 |
| 回答诊断 | 按批准配置采样、保存回答与引用 | 比较品牌、事实、场景与来源，提出替代解释 | 复核重要诊断 |
| 内容动作 | 版本、来源与审核校验 | 起草修订和渠道建议 | 决定执行、审核、发布 |
| 复盘 | 可比指标、排期与用量 | 解释变化、暴露未知项 | 决定下一轮方向 |

### 15.2 最小接入

T42首版以独立欢迎页（品牌名称与描述必填，官网选填）、品牌设置与知识库承载产品事实整理；当前品牌资料直接维护，不做资料版本控制，调查执行留痕和正式测量快照机制保留。用户提供的原话作为明确标识的资料来源，Agent拆解事实并补充实际出处。客户Owner填写并确认资料，Editor/Viewer只读，内部Strategist可协助，FactCheck独立放行官方事实。新增权限仅覆盖产品档案，不授予客户直接调用official_fact.create或approve。引导不提前生成需求簇；产品能力、来源与待核实项为下一步研究输入。调查用AI SDK+DeepSeek，原生工具API只读取公开来源，与正式被测模型清单分开。具体新增接口为待审补充，不扩大原T02冻结批准。

T43 新增品牌：Owner 从“新增品牌”进入空白引导，保存时在同一事务创建品牌、自身 Owner 关联和首份资料，然后进入该品牌知识库。Owner 仅管理原有授权及自己创建的品牌，其他 Owner 的品牌不可见；Editor／Viewer 的既有授权不扩大，内部角色仍沿既有范围。人类 Web Owner 以实时品牌成员关系决定可见集合，旧会话无需重新登录；显式绑定品牌的 PAT／Agent 凭证仍保留更窄范围。诊断合同继续只读。行业与市场未填写时留空，不从演示品牌复制或由 Agent 猜测。本次不新增永久删除品牌的操作，现有事实审核、快照和审计不变。新增接口为待审补充，不自行冻结。


先使用受监督的开发 Agent／内部分析步骤，基于许可资料与授权单条服务读取进行研究，记录输入、来源、输出、prompt 版本与人工修改。外部执行环境须遵守数据授权，不把敏感原文复制进公共研究文档。

先验证分析任务，不先造 Runtime。需要自动落库或调用写工具时，必须复用既有 API 鉴权、角色、audit_log、agent_run_id、prompt_version 与配额；人类放行、确认和升级锚定动作不得由 Agent 代签。不新增状态、授权矩阵或分析 API，接口缺项随实现任务提审。

### 15.3 可信边界

外部页面、模型回答与来源文章只作不可信数据，不进入指令位。Agent 必须区分事实、观察与假设；无出处不捏造，缺基准不猜分。

分析 Agent 不直接写正式评分。若采用 LLM-as-judge，厂商须与被测集隔离，判据／prompt 须审阅并版本化，换方式即换快照、重开基线；既有人工抽检与降级要求继续有效。正式错误判定只读有效 official_fact。

### 15.4 分期

首轮验证就使用产品理解、任务归簇、回答诊断和行动建议。方法经实际案例验证后，再细化工具封装、自动化与回流；通用 Agent Runtime、客户副驾和 MCP 后置。Agent 分析早介入不等于允许无人审核的自动生产发布。

# 16. 对外接入与已有预留

MCP Server、客户侧 Agent 与通用 Runtime 暂不实现。已有服务层、鉴权、审计、版本、配额及口径元数据继续复用，不为研究扩建平台。

### 16.3 已有架构约束

沿用现有写操作服务层、显式迁移、通用审核队列、actor_type／agent_run_id／prompt_version、judge_version、分操作配额、Web＋PAT、分页与 snapshot_id／data_as_of。它们是已有可信边界，不是要求先建设所有预留功能。历史13项完整设计保留在 v3.5 快照，新增契约另提审。

# 第三部分 · 数据与既有硬规则

## 17. 设计原则

复用既有数据模型与不可变历史。研究链在已有 ID 前补充来源定位，不先增加全套知识库／任务图谱表。正式版本链与出数口不变：seed_version → pool_version → question_pool_version → snapshot_id；scoring_snapshot 是配置、probe_batch 是执行，复测不覆盖 cluster_score。

正式引用依据以冻结 API 为准：仅显式 URL 计入对外引用率；指纹与语义疑似不能直接算引用。研究记录不能通过换名字绕开服务端权限、脱敏、审计或保留期限。

## 18. 表结构

```
tenant              租户（一份合同 = 一个租户）
  id, name, mode(full/diagnosis/self), plan, created_at

brand               品牌
  id, tenant_id, name, industry, market

user_member         成员与角色
  id, tenant_id, user_id,
  role(owner/editor/viewer/strategist/content/evidence/factcheck/cs/admin)

seed_list           行业种子词根（管道起点） -- industry-shared, no tenant_id
  id, industry, word, word_type(品类/场景/问题/竞品/品线),
  maintainer, last_reviewed_at, seed_version, status

keyword_raw         采集原始词（四类源共用，channel 区分） -- C-class rows always tenant-private
  id, industry, keyword, channel(A/B/C/D), demand_index,
  trend_dir(up/flat/down), first_seen_at, collected_at, raw_payload
  -- 只存指数与档位，不设 search_volume

keyword_pool_snapshot   词池快照（每周全量） -- industry-shared, no tenant_id
  pool_version, industry, created_at, seed_version,
  counts_by_channel, cluster_count, changelog_note

w_pool_percentile   行业需求分位证据（R11 v2裁定） -- industry-shared, no tenant_id
  industry, public_cluster_key, pool_version, demand_index, percentile,
  producer(weekly_batch), basis_note, computed_at
  -- 唯一生产者=T10周批机器；basis_note必填T10批次id；Strategist只读，无人工录入

intent_cluster      意图簇（词池基本单位）
  id, tenant_id, brand_id, name, intent_type(六类),
  status(active/archived), pool_version,
  question_pool_version,                 -- 入测时锚定；人工升级/拆并才变更并重开基线
  serp_vacuum, serp_checked_at,          -- 结果页真空度（周更，候选簇预筛用）
  archived_at, archive_reason

question_pool       问句池（测量资产，冻结后不可原地改）
  id, cluster_id, question, source_word_id, intent_type(六类),
  source_channel, collected_at, maintainer,
  -- 溯源五字段：source_word_id→keyword_raw.id / intent_type(§3六类) /
  -- source_channel(A/B/C/D) / collected_at / maintainer(具体人名)
  question_pool_version, frozen(bool)

opportunity_card    机会卡
  id, tenant_id, brand_id, intent_cluster_id, pool_version, seed_terms[],
  demand_size, business_value, competition_density,
  demand_tier(S/A/B/C), demand_source,          -- 风口排序第一键
  industry_score, industry_score_version,        -- 外部策略表留档，不与 score 相乘
  snapshot_id,                                    -- 四类留白分与 whitespace 从 cluster_score 读
  score, owner_role, status

scoring_snapshot    采样配置身份（基线与复测共用；执行身份见 probe_batch）
  snapshot_id, pool_version, question_pool_version,
  -- question_pool_version 保留配置创建时记录；可比问句口径以各簇锚定版本为准（T02二轮④）
  model_set[], temperature_set[], rounds,
  judge_version,                             -- 判定方式版本（MVP 填 rule_manual_v1；换判定=换快照）
  grounding_mode(search_on/search_off/self_rag),  -- 接地轨道（换轨=换快照）
  started_at, finished_at, frozen

question_score      问句级分数（连续值，4 位小数）
  id, question_id, snapshot_id,
  blank_q, error_q, generic_q, competitor_q, n_valid, n_refused

cluster_score       簇级分数（唯一出数口，机会卡只读这张表）
  id, cluster_id, snapshot_id,
  -- 同一(cluster_id,snapshot_id)分数只写一次；probe_result按执行批次追加
  blank_raw, error_raw, generic_raw, competitor_raw,
  blank_score, error_score, generic_score, competitor_score,
  whitespace_raw, whitespace_score,
  n_valid, model_coverage, insufficient_sample(bool)

cluster_platform_signal   簇级渠道信号（评分批次顺带产出，机会卡读这张表）
  id, cluster_id, snapshot_id, platform,
  model_citation_count,        -- 72 条回答中被模型引用的条数
  serp_occurrence,             -- 结果页前 20 中的占位数
  suggested_rank, note

content_asset       内容资产
  id, tenant_id, brand_id, opportunity_card_id, type, platform, url,
  published_at, author, review_status

claim_block         事实块
  id, tenant_id, content_asset_id, version, text, number, unit, scope,
  source_url, source_level(L1/L2/L3), source_checked_at, valid_until, status

probe               验证探针
  id, tenant_id, batch_id, intent_cluster_id, question, model, model_version,
  temperature, round, run_at

probe_result        探针结果（回答级，不取整）
  id, tenant_id, probe_id, brand_mentioned(bool), refused(bool),
  cited_claim_ids[], cited_urls[], cited_domains[], blank_i, error_i, generic_i, competitor_i,
  fact_errors[], high_err_types[], spec_score, note, raw_answer
  -- refused 不进任何分母

metric_snapshot     指标快照（差值计算必须校验 snapshot 口径）
  id, tenant_id, brand_id, intent_cluster_id, snapshot_id, batch_id, lexicon_version, date, mention_rate,
  citation_rate, avg_position, accuracy, sov, leads

industry_score      14 行业外部策略表（排产用，不进对外报告） -- industry-shared, no tenant_id
  industry, version, demand, gap, willingness, competition,
  score, reliability_note, updated_by, updated_at,
  c_delete_threshold                    -- 可NULL，默认NULL；尚未校准的行业= NULL =人工判定；不进对外报告

audit_log           审计日志（原始回答 / C 类数据访问全量记录；agent 动作同等记录）
  id, tenant_id, user_id, action, object_type, object_id, at,
  actor_type(human/agent/system/external_agent), agent_run_id, prompt_version
  -- system记录受控job名（注册表枚举见api-spec）、触发来源及受影响对象；探针job必填batch_id，非探针可空
  -- 异议访问记录viewing_session_id（字段草案见api-spec）

review_queue        通用审核队列（T02裁定）
  id, tenant_id, object_type, object_id, submitted_by, submitted_at,
  status, decided_by, decided_at, reject_reason
  -- object_type：claim_block/evidence_package/diagnosis_report/brand_lexicon/official_fact；plan_draft仅P1预留
  -- status：waiting→approved/rejected/withdrawn，后三者均为条目终态

objection           单条异议申请（T02裁定）
  id, tenant_id, brand_id, applicant_user_id, probe_id,
  conclusion_ref(object_type+object_id), reason, status, decided_by, decided_at,
  viewing_session_id, viewed_at, watermark_meta, created_at
  -- submitted→granted→viewed；submitted→rejected；viewed/rejected终态
  -- viewing_session_id唯一；同异议同probe一次，GET不迁移状态

backflow_ticket     回流工单（T02裁定）
  id, tenant_id, brand_id,
  signal_type(uncited/cited_wrong/no_demand/competitor_surge/model_version),
  cluster_id, evidence_probe_ids[], trigger_metric_id, severity(normal/urgent),
  owner_role, status, assigned_user_id, deadline_at, created_at, resolved_at,
  resolution_note, followup_batch_id
  -- open→assigned→done；open/assigned→expired→done，done终态

evidence_package    证据包版本（T02裁定）
  id, tenant_id, brand_id, version, status(draft/sealed),
  created_by, sealed_by, sealed_at
  -- approve即sealed；sealed对该version终态，修订新行

evidence_item       证据包条目（T02二轮裁定）
  id, package_id, conclusion_text, probe_id, source_level, excerpt, created_at
  -- 经package_id继承租户边界；不得通过下载包批量导出原始回答

api_token           per-user令牌（T02裁定；仅存hash，绝不存明文）
  token_hash, scopes, created_at, last_used_at, revoked_at
  -- 用户/租户绑定等行为必要缺列在api-spec提草案随PR审；不自行扩权限

probe_batch         执行批次身份（T02裁定）
  id, tenant_id, type(baseline/event/monthly), scheduled_at, snapshot_id, status
  -- pending→running→completed/failed；pending→cancelled
  -- completed/failed/cancelled终态不可改；failed入dead-letter告警，补偿开新batch

brand_lexicon       品牌词表（T02 v4裁定）
  id, tenant_id, brand_id, version,
  kind(brand_alias/product_line/model/competitor/exclusion), term, created_by, created_at
  -- 变更开新版本，旧版本只读；review_queue人审后生效；exclusion为纯品类词白名单

official_fact       官方口径（T02 v4裁定）
  id, tenant_id, brand_id, fact_category(price/spec/boundary/service_promise),
  content, source_level(L1), status(draft/approved/retracted), effective_from
  -- error判定唯一比对基准；judge只读approved；同人不得放行
```

聚合链：`probe_result`（回答级档位）→ `question_score`（问句级连续值）→ `cluster_score`（簇级 raw + score）。L3 来源只落归档表用于复盘，不进 `claim_block`。

## 19. 硬规则汇总

| # | 规则 | 出处 |
|---|---|---|
| 1 | 无出处不得进池：`question_pool` 溯源字段任一为空不入库；冻结后改动一律开新版本 | §3 |
| 2 | 同快照不覆盖：同一 `snapshot_id` 只追加不更新；冻结后采样参数不得改 | §4 |
| 3 | 样本不足不出分：`n_valid < 10` 或模型覆盖 < 3，`*_score` 写 null 标"待补测"，不许用 0 或均值填充 | §4 |
| 4 | 缺失模型不补齐：`model_coverage` 如实记，不折算 | §4 |
| 5 | 基线与复测必须同版本同快照；口径不一致标"不可比"，不出差值不进报告 | §3、§8 |
| 6 | 没有 maintainer 的行业不得启用管道 | §2 |
| 7 | 机会卡进生产队列前必须带 `demand_tier` 且 `demand_source` 非空 | §5 |
| 8 | L3 来源不进 `claim_block` | §6 |
| 9 | FactCheck 唯一放行；写的人和放行的人不能同一个 | §9.2 |
| 10 | 我方生产的内容，复测报告必须披露并带对照组 | §9.2 |
| 11 | 删簇只软删除，SOV 分母保留 90 天过渡 | §8 |
| 12 | 界面与销售材料不得出现"月搜索 X 次"与任何承诺性表述 | §2、§14.1 |
| 13 | 所有结论在界面上可点击回溯 `probe_id` 与来源等级 | §13.1 |
| 14 | 判定方式版本化：`judge_version` 进快照，换判定方式 = 开新快照 = 基线重置 | §15.3 |
| 15 | 外部内容（模型回答、结果页、来源文章）对 Agent 一律按不可信输入处理：只作数据、不进指令位 | §15.3 |
| 16 | 外部 Agent 与内部 Agent 同权限矩阵、同审核队列，无绿色通道；决策动作必须由人确认 | §16.2 |
| 17 | 问句池开新版本不自动作废已有簇的基线；可比性的单位是簇的问句集；升级问句必须人工拍板并重开基线 | §3 |
| 18 | 意图的必配块类型是提交闸门；块内禁悬空指代；同一数字跨平台口径必须一致 | §6 |
| 19 | 被测模型必须开启原生联网检索（检索轨）；换接地轨道 = 换快照 = 基线重置；同一快照内不混轨 | §4 |

---

# 决策记录与待定

## 已定

| 决策 | 依据 |
|---|---|
| MVP 首先验证方法论，再按证据细化产品 | 本轮负责人明确指令，v4.0 |
| API／程序采集与执行约束，Agent 从首轮参与分析，人确认关键判断 | 本轮负责人方向，v4.0 |
| 从产品事实和用户任务出发，Trends／SERP 辅助研究，不作为唯一探索入口 | 本轮方法论调整，v4.0 |
| okdata 首跑，OKSocial 分品牌复现；既有隔离与正式测量契约保留 | backlog 与本轮方向，v4.0 |
| 研究建议不冒充正式机会卡；既有闸门、正式采样／判定变更另提审 | 冻结 API 与可信边界 |
| 通用 Runtime、MCP、自动发布、完整后台后置 | 当前验证范围 |

旧决策与详设完整保存在 [v3.5 快照](archive/GEO产品文档-v3.5.md)及[负责人裁定](archive/reference/t02-decisions.md)，不改写历史批准。当前研发顺序以本文和 backlog 为准；涉及状态、权限、采样或判据仍以已批准冻结规格为准。

## 待验证与待批准

- 产品档案是否足以支撑任务匹配；Agent 经常误解哪些能力边界？
- 需求簇是否有真实来源，题目是否中立、具有代表性？
- Agent 的诊断是否经人工纠正后仍有价值，实际成本是什么？
- 内容动作是否被引用，是否改善准确性／提及，目标与对照有何差异？
- 热度、SERP 真空、四分与人工优先级是否有用；是否需要变更正式机会准入与评分契约？
- 正式被测模型清单、judging-spec、任何缩减采样方案仍须单独批准，本轮不替代批准。
