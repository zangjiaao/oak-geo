# T02 状态迁移表

> 已冻结（t02_api_v1，产品负责人批准）。枚举来源：各轮负责人裁定及v4优先，其次 api-spec-template §3；不增加裁定外状态。表内系统触发通过服务层执行。终态“不可改”作用于该行/版本，不禁止创建新行。

## claim_block

状态：`draft` / `pending_review` / `approved` / `retracted`。终态：无永久终态（按裁定修订新版本）。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| draft → pending_review | submit | 作者 | 校验通过并入waiting | 审计并执行关联副作用 |
| pending_review → approved | approve | factcheck | 审核人≠作者 | 审计并执行关联副作用 |
| pending_review → draft | reject/withdraw | factcheck/作者 | 驳回理由必填；撤回仅作者 | 审计并执行关联副作用 |
| approved → retracted | retract | factcheck | 理由与工单 | 审计并执行关联副作用 |
| retracted → draft | revise | 作者 | 新版本新行，不覆盖旧retracted | 审计并执行关联副作用 |

## content_asset

状态：`draft` / `ready` / `registered` / `retired`。终态：retired。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| draft → ready | transition | system | 全部必配块当前版approved | 审计并执行关联副作用 |
| ready → draft | transition | system | 必配块retract或新版本draft/pending_review | 审计并执行关联副作用 |
| ready → registered | register | editor | 已在客户渠道发布；登记URL/时间 | 审计并执行关联副作用 |
| registered → ready | retract联动 | system | 任一已发布块被retract；须重新发布 | 审计并执行关联副作用 |
| draft → retired | retire | strategist/owner | human人工下线；不可逆 | 审计并执行关联副作用 |
| ready → retired | retire | strategist/owner | human人工下线；不可逆 | 审计并执行关联副作用 |
| registered → retired | retire | strategist/owner | human人工下线；不可逆 | 审计并执行关联副作用 |

## probe_batch

状态：`pending` / `running` / `completed` / `failed` / `cancelled`。终态：completed / failed / cancelled。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| pending → running | start | system | 排期到达且冻结配置 | 审计并执行关联副作用 |
| running → completed | complete | system | 整批完成 | 审计并执行关联副作用 |
| running → failed | fail | system | 指数退避≤3次用尽，dead-letter告警 | 审计并执行关联副作用 |
| pending → cancelled | cancel | cs | 仅pending可取消 | 审计并执行关联副作用 |

## review_queue

状态：`waiting` / `approved` / `rejected` / `withdrawn`。终态：approved / rejected / withdrawn。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| waiting → approved | approve | factcheck | 非作者；对象approved或sealed | 审计并执行关联副作用 |
| waiting → rejected | reject | factcheck | reason必填；对象回draft | 审计并执行关联副作用 |
| waiting → withdrawn | withdraw | 作者 | 对象回draft | 审计并执行关联副作用 |

## objection

状态：`submitted` / `granted` / `viewed` / `rejected`。终态：viewed / rejected。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| submitted → granted | grant | cs/敏感升级factcheck | 3工作日内响应 | 审计并执行关联副作用 |
| submitted → rejected | reject | cs/敏感升级factcheck | 说明理由 | 审计并执行关联副作用 |
| granted → viewed | POST view | cs | CS发起会话，单probe单次，24h内查看 | 审计并执行关联副作用 |

## backflow_ticket

状态：`open` / `assigned` / `expired` / `done`。终态：done。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| open → assigned | assign | cs | 指定责任人 | 审计并执行关联副作用 |
| assigned → done | complete | 责任人 | resolution_note必填 | 审计并执行关联副作用 |
| open → expired | expire | system | 超deadline；说错24h | 审计并执行关联副作用 |
| assigned → expired | expire | system | 超deadline | 审计并执行关联副作用 |
| expired → done | complete | 责任人 | 补办，保留超时记录，resolution_note必填 | 审计并执行关联副作用 |

## evidence_package

状态：`draft` / `sealed`。终态：sealed。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| draft → sealed | approve | factcheck | 队列waiting、非作者；放行即封版 | 审计并执行关联副作用 |

## diagnosis_report

状态：`draft` / `sealed`。终态：sealed。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| draft → sealed | approve | factcheck | 队列waiting、非作者；样本/证据过闸 | 审计并执行关联副作用 |

## intent_cluster

状态：`active` / `archived`。终态：archived。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| active → archived | archive | strategist | 原因/证据；软删除，90天分母过渡 | 审计并执行关联副作用 |

## question_pool

状态：`open` / `frozen` / `archived`。终态：archived。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| open → frozen | freeze | strategist | 五字段完整 | 审计并执行关联副作用 |
| frozen → archived | archive | strategist | 仍保留只读原文/历史锚定；停止新锚定 | 审计并执行关联副作用 |

## scoring_snapshot

状态：`open` / `frozen`。终态：frozen。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| open → frozen | freeze | cs | 首次执行前固定模型参数；簇锚定已记录 | 审计并执行关联副作用 |

## opportunity_card

状态：`候选` / `评分` / `建议` / `确认` / `在测` / `归档`。终态：归档。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| 候选 → 评分 | 基线评分 | system | 通过需求与真空度预筛 | 审计并执行关联副作用 |
| 评分 → 建议 | recommend | strategist | 满足样本及交付门槛 | 审计并执行关联副作用 |
| 建议 → 确认 | confirm | owner | human确认3簇 | 审计并执行关联副作用 |
| 确认 → 在测 | 批次启动 | system | 事件/监测批次 | 审计并执行关联副作用 |
| 在测 → 归档 | 关联簇归档 | system | 关联簇已软归档 | 审计并执行关联副作用 |

## publish_registration

状态：`none` / `registered` / `retesting` / `reported`。终态：reported。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| none → registered | register | editor | none表示未建记录 | 审计并执行关联副作用 |
| registered → retesting | 批次启动 | system | 登记排期开始 | 审计并执行关联副作用 |
| retesting → reported | 月报产出 | system | 相关批次指标和报告完成 | 审计并执行关联副作用 |

## official_fact

状态：`draft` / `approved` / `retracted`。终态：retracted。

| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |
|---|---|---|---|---|
| draft → approved | approve（同通用队列放行） | factcheck | L1；waiting；非创建者 | 生效且结算队列approved，judge还须校验effective_from |
| approved → retracted | retract | factcheck | 理由必填 | 后续judge拒绝引用，历史指标保持不变 |

## brand_lexicon版本审核（不新增状态枚举）

create生成完整新version（不生效）；submit创建waiting队列；FactCheck非版本作者approve后该版本生效。rejected/withdrawn按既有队列规则退回未生效草稿，旧版本始终只读。词表表不增加status列，审核结果由review_queue承载。
