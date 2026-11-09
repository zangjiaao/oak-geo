T02 阻塞项裁定（产品负责人已批准，逐项对应你的报告，按此继续）

1. 状态闭合
- 模板可作起点，以下枚举为定稿，不得再发明：
- claim_block：draft → pending_review → approved → retracted；驳回 pending_review → draft（理由必填）；retracted → draft（重新修订 = 开新版本号）。删除 published 与 revision_needed——发布进度不记在块上。
- content_asset：draft → ready → registered → retired。ready 为系统计算态（全部必配块 approved 时自动迁移，非人工操作）；registered = Editor 回填 URL/时间后；补迁移 registered → ready（触发条件：任一已发布块被 retract）；retired = 人工下线。迁移表必须全闭合、无死路。

2. 权限边界
- 内部：Strategist / FactCheck / CS = 租户级（本租户全品牌）；Content / Evidence = 任务关联对象级（仅分派给它的机会卡/簇/来源）；Admin = 配置与审计全量，原始回答默认不可读，调阅需理由 + 审计。
- 客户 Editor：本品牌诊断 / 证据包 / 模板 / 复测判定结果可读，竞品原文不可读；写入口仅内容工作台（块草稿/提交）与发布登记。
- diagnosis 档：全只读，唯一写入口 = 异议申请单；无编辑器、无发布登记。
- 权限矩阵生成规则：默认 deny；按 角色×资源×操作 三键全量生成；每行必须引用产品文档 §9.3 或本裁定作为依据；矩阵随 T02 一起提交人审，不逐条预批。

3. 记忆轨：已闭合。按已批准的 3 问句 × 4 模型 × 温度 0 × 3 轮 = 36 条/簇写入规格；模型 ID 留 T14 当日复核标记；本任务不实施探针调用。

4. 快照身份（语义澄清 + 授权字段补充）
- scoring_snapshot = 采样配置身份（冻结：问句池版本 / 模型集 / 温度轮次 / judge_version / grounding_mode）。基线与复测共用同一 snapshot_id，可比性由此保证。
- 执行批次身份：新增 probe_batch 表（id, tenant_id, type(baseline/event/monthly), scheduled_at, snapshot_id, status），probe 挂 batch_id；复测批次引用基线 snapshot_id，产出写 metric_snapshot。
- "同 snapshot 只写一次"的适用对象明确为 cluster_score（分数）；probe_result 每批次照常追加。
- metric_snapshot 补 snapshot_id、batch_id 两字段（授权补充，依据 = 硬规则 5 的口径校验要求）。
- 簇级问句等价判定 = 同一 question_pool_version 下该簇 question_id 集合一致；不做文本比对。

5. 数据定义（T04 前定稿；授权修改产品文档 §18，仅限以下内容）
- 新增六表：review_queue（id, tenant_id, object_type, object_id, submitted_by, submitted_at, status, decided_by, decided_at, reject_reason）、objection、backflow_ticket、evidence_package、api_token（只存 token_hash + scopes + created_at / last_used_at / revoked_at）、probe_batch（见第 4 条）。
- 溯源五字段定稿：source_word_id → keyword_raw.id；intent_type → 产品文档 §3.2 六类枚举；source_channel → A/B/C/D；collected_at；maintainer 为具体人名。
- 引用两级不新增字段：显式 = cited_domains 命中登记 URL，隐式 = 指纹命中；在指标计算层推导。
- API 资源清单以更新后的 §18 为准补齐（工单 / 异议 / 证据包 / 令牌 / 批次均入）。

6. 审核与异议
- review_queue 的 object_type 枚举：claim_block / evidence_package / diagnosis_report（P1 预留 plan_draft）。
- 放行 = 封版，同一步：approve 即 sealed / 定稿；修订开新版本；不做两步。
- 异议：批准权 CS（敏感升级 FactCheck）；3 个工作日响应；调阅会话 24h 内完成；陪同判据 = 调阅会话由 CS 账号发起、客户账号仅出现在只读查看器；水印 = 查看器叠加调阅人 + 时间戳，audit_log 全记（含会话 id）；同一 probe_id 同一异议单仅可调阅一次，重复需新异议单 + 理由。
- viewed 状态只能经显式 POST 迁移写入；GET 一律不改状态。

7. 权限与生命周期
- actor_type 枚举扩为 human / agent / system / external_agent（同步更新产品文档 §18 audit_log 注释）；后台 job 以 system 身份执行，审计记 job 名 + batch_id；job 只能执行其契约内操作，不是万能角色。
- 解约：删 C 类原文与 raw_answer；聚合指标与 audit_log 不可变保留，默认 2 年（合同可另定）；删除走显式 offboarding 流程。
- Admin 不解释为万能权限。

8. 判定：按你的判断执行——悬空指代正则、词表匹配、spec_score、指纹阈值全部留给 judging-spec 人审冻结，本任务不发明。

9. 接口工程约定
- 错误体：{ "error": { "code": "<string>", "message": "...", "details": {} } }；业务码为字符串：permission_denied / state_conflict / validation_failed / incomparable / quota_exceeded；HTTP 映射 403 / 409 / 422 / 422 / 429；废弃 409002 数字码。
- 时间一律 UTC ISO-8601；分页 cursor（默认 20、上限 100，响应含 next_cursor）；Idempotency-Key 保存 24h。
- 后台 job：失败指数退避重试 ≤3 次后入 dead-letter 并告警；取消仅限 pending；补偿为批次级（整批重跑开新 batch，禁止部分重试）。

10. 完成判据：按你的结论执行——补全逐端点请求/响应示例、全量权限矩阵、闭合迁移表后提交人审冻结（按 api-spec-template §0 checklist 自查）；本裁定之外的新歧义继续停下问。

执行边界：
- 将本裁定原文保存为 docs/t02-decisions.md（规格冻结的依据附件）。
- 授权修改 docs/GEO产品文档.md：仅限 §18（第 4/5/7 条所列新增表与字段）与文末决策记录追加一行（"T02 阻塞项 10 条裁定：状态机闭合 / 权限细化 / 快照双身份 / 六表补充 / 接口约定 | v3.5"）；其余章节一字不改。
- AGENTS.md 不改。
- 完成后停在"人审冻结"，不得自行冻结 api-spec.md。

T02 补充裁定（第 2 轮，对应你的 ①–④；执行边界同前：本裁定追加进 docs/t02-decisions.md，授权改动仅限产品文档 §18 与决策记录追加）

① probe_batch.status / review_queue.status 枚举与迁移
- probe_batch：pending → running → completed | failed；pending → cancelled（仅 pending 可取消，与上轮第 9 条一致）。completed / failed / cancelled 均为终态记录、不可改；failed 走批次级补偿（开新 batch），原批次保留并入 dead-letter 告警。
- review_queue：waiting → approved | rejected | withdrawn。withdrawn = 作者本人撤回（对象回 draft）；rejected = FactCheck 驳回（理由必填，对象回 draft）；approved = 对象 approved（证据包与诊断报告为 sealed）。三态均为该队列条目的终态；对象侧状态由上轮第 1 条的对象状态机承接。

② 三表字段定稿（今后"行为已裁定、字段属实现细节"级别的缺列，允许你提草案随 PR 人审，不算歧义即停——此为常设规则）
- objection：id, tenant_id, brand_id, applicant_user_id, probe_id, conclusion_ref(object_type+object_id), reason, status, decided_by, decided_at, viewing_session_id, viewed_at, watermark_meta, created_at。状态机：submitted → granted（CS 批准，3 个工作日内）→ viewed（CS 账号发起调阅会话后，显式 POST 写入；GET 不改状态）；submitted → rejected（CS，敏感升级 FactCheck）。viewed / rejected 终态。同一异议单同一 probe 仅一次调阅：viewing_session_id 唯一约束，重复需新异议单 + 理由。
- backflow_ticket：id, tenant_id, brand_id, signal_type(uncited / cited_wrong / no_demand / competitor_surge / model_version), cluster_id, evidence_probe_ids[], trigger_metric_id, severity(normal / urgent), owner_role, status, assigned_user_id, deadline_at, created_at, resolved_at, resolution_note, followup_batch_id。状态机：open → assigned → done（必填 resolution_note）；open / assigned → expired（系统超时标记，"说错"类 deadline 24h）→ done（补办完成，保留超时记录）。done 终态。
- evidence_package：id, tenant_id, brand_id, version, status(draft → sealed), created_by, sealed_by, sealed_at；子表 evidence_item：id, package_id, conclusion_text, probe_id, source_level, excerpt, created_at。sealed 对该 version 为终态；修订开新 version（新行）。

③ content_asset 终态与 ready 条件破坏
- retired 为终态、不可逆；复活 = 新建 asset（挂同机会卡）。允许从 draft / ready / registered 进入（人工，策略或 Owner 发起）。
- ready 是派生态：成立条件 = 全部必配块的**当前版本** approved。条件破坏（任一必配块被 retract，或进入修订——即其新版本处于 draft / pending_review）→ 系统自动迁移 ready → draft；条件恢复 → draft → ready。两端均为系统计算，非人工操作。
- registered 是发布事实态：不因块修订降级；仅当任一已发布块被 retract → registered → ready（须重新发布）；重新发布后 Editor 再登记（url / published_at 更新，历史走 audit）。

④ 问句池版本锚定
- 锚定原则：簇入测时锚定其 question_pool_version——授权 intent_cluster 补 question_pool_version 字段（入测时写入）。变更锚定 = 显式人工动作（升级问句 / 簇拆并），随之重开基线（对应产品文档 §3 问法漂移人工阀门）。
- 跨版本一律不可比、不做等价判断：即使新版本中该簇问句一字未变，锚定版本不同即不可比——堵死"悄悄换题"的不可审计路径。ID 集合等价判定仅在"同簇同锚定版本"内进行。
- 新池版本仅新增其他簇时：不动任何已锚定簇；新簇锚定当前版本。月度评分批次的快照还原（问句原文）由"各簇锚定版本 + 问句池版本只读"共同满足；scoring_snapshot 冻结模型 / 温度 / 轮次 / judge / grounding，问句口径由各簇锚定承载。

授权补充汇总（产品文档 §18）：intent_cluster.question_pool_version；②中三表含 evidence_item；probe_batch 与 review_queue 的 status 字段说明。枚举与迁移表写在 api-spec 状态机章节（本就是它的归属）。

T02 补充裁定（第 3 轮，对应你的 ①–③ 与保留策略确认；执行边界同前：追加进 docs/t02-decisions.md，§18 授权范围见文末）

① registered 块 retract 的迁移顺序
- 是，同一事务内链式完成、逐跳审计：retract 事件触发 registered → ready（审计 cause = 该 retract 事件 id）；随即在同一事务内做派生条件重算，若"全部必配块当前版本 approved"不成立，继续 ready → draft（审计记同一 cause）。事务提交时各状态不变量成立。
- 非必配块被 retract 时，链条停在 ready（发布事实已破坏、必配条件仍成立，是否重新发布由人决定）。
- 修复后（新块版本 approved）draft → ready 由条件恢复自动触发，无需人工。
- 不做 registered → draft 直达捷径：降级统一走"事件降一级 + 派生重算"单一机制，避免双路径漂移。

② cited_domains 域名级 vs 精确命中
- 记录完整 URL：probe_result 增 cited_urls[]（授权补充）；cited_domains[] 保留（簇级渠道信号的物化字段，域名可由 URL 派生，保留是为避免重复计算）。
- 显式引用（explicit）= cited_urls 规范化后与登记的 content_asset.url 全等。规范化规则：去协议、去 www、去 query 与 fragment、去尾斜杠，剩余字符串全等。
- 域名级命中只作两用：簇级渠道信号（cluster_platform_signal）与弱命中标记；不计入 explicit 引用率。
- 对外 citation_rate 只算 explicit；隐式（指纹命中）与弱命中（仅域名级）进内部分析，不混入对外指标。

③ 非探针 job 的审计
- 可以：batch_id 可空，仅探针类 job（评分 / 复测批次）必填。
- 非探针 job（词池周批 / 信号扫描 / 解约 / 告警等）审计：actor_type = system + 受控 job 名（注册表枚举，不许自由字符串）+ 触发来源（cron / 事件 id）+ 受影响对象（沿用 object_type / object_id，多对象写多行）。

保留策略确认（"聚合 / 审计默认保留 2 年"到期后）
- 默认：到期转只读冷归档，不自动删除——2 年是在线可查窗口，归档层仍可按合同 / 法务调取。
- 删除只能显式：依合同或法务要求，人工执行 offboarding 清理；删除动作本身在独立 deletion ledger 留 tombstone（对象类型、时间范围、执行人、依据），tombstone 不随删除消失。

§18 授权补充：probe_result.cited_urls[]；audit 字段的 job 名注册表说明（枚举值写在 api-spec）。
