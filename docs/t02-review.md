# T02 人审冻结候选稿自查

状态：待人审冻结，未冻结。依据附件为三轮负责人裁定 `t02-decisions.md`；产品文档页首版本保持原样，仅追加授权的v3.5决策记录，不代人修改冻结标识。

## 人审顺序（R1–R4整改后）

1. `spec-map.md`：100行主入口，三层架构/横切支撑、28资源（含原31资源归宿）、九角色、20个承重审阅项、事实块旅程、13状态机索引。
2. `core-set.md`：20项组合动作逐接口展开，及所有原文/C类/配额风险接口，共52个接口完整示例。组合项可以关联多个接口，同一示例仅出现一次。
3. `t02-permissions.csv`：allow即规范，230个条件allow + 1行默认规则 + 1行列头，共232行；无deny行。每个allow保留依据及条件。
4. `generated/README.md`：其余53个支撑接口，按资源分文件，人审默认抽检；敏感/配额端点不能下沉。
5. `api-spec.md`：全局约定；`t02-states.md`：13对象完整迁移表；`t02-contracts.json`仅作为生成与校验源，不要求人逐行审阅。

`t02-endpoints.md`保留为导航，旧链接不会落到整本接口示例。裁定原文包括本次R1–R4整改要求。

## 行数与边界变化（可复算）

| 材料 | 整改前 | 整改后 | 原因 |
|---|---|---|---|
| API资源 | 31 | 28 | question_score→cluster_score.question_scores；evidence_item→evidence_package.items；probe→probe_batch.probes |
| 物理表 | 27 | 27 | 不修改产品文档或数据库结构，归并仅发生于API边界 |
| 端点 | 112 | 105 | 移除question_score两条、evidence_item两条、probe两条；原anchor/upgrade合并一条，合计减少7条 |
| 操作名 | 41 | 39 | 移除advance/anchor/upgrade/refresh/reconcile五名；新增transition/upgrade_anchor/grant三名；execute原已存在 |
| allow三键 | 246 | 230 | question_score.read减少5；evidence_item读写减少7；probe.read减少5；锚定入口合并减少1；batch.read新增两任务角色投影+2 |
| deny行 | 11,193 | 0 | 全由“未出现 (role, resource, operation) allow 行即 deny”表达 |
| 权限规范总行 | 11,440（含列头） | 232 | R1先压缩deny，R3进一步合并原allow的资源/操作身份 |

230 = 246 − 5 − 7 − 5 − 1 + 2；仅三键表示改变，不撤销或扩大原有行为权限。问句级分数只给原内部五角色；evidence items继承父包原范围；Content/Evidence的batch.read只允许原分派probe投影，不能读整批配置/其他任务。

20项是负责人R4的审阅单元，包含start/execute、freeze/upgrade_anchor及资产多个迁移等组合动作；不同职责没有强压为20个HTTP接口。`layout_migration.endpoint_map`保存全部112个旧接口归宿；被合并的写路径由父对象服务动作原子承接，原审计事件保留兼容。

## 验证结果

- 先红：新allow格式、主入口/核心层与资源归并测试因旧材料失败；新增403规范解析器缺失使架构检查失败。
- 后绿：原14项检查按新表示更新后通过；新增2项`tests/arch`检查，共16项通过。
- 默认拒绝检查穷举归并后的九角色×28资源×39操作及未知三键；不存在的三键一律403，allow不产生无条件200，仍须校验行条件。
- allow越界/重复检查、归并前后数量公式、子资源可见性护栏、敏感接口不得下沉、105端点唯一文档归属、主入口≤120行均有检查。
- 状态枚举、出边、终态、引用/链式回退/保留策略与整改前的哈希保持一致；仅触发动作命名变化不计入行为哈希。
- `node scripts/generate-t02-docs.mjs --check`验证所有文档产物，包含已不应存在的generated文件检测；生成器不输出deny行。
- `npm run typecheck`、`git diff --check`通过。本次只改文档、生成器与规格测试，不声称业务API已实现；真实请求的服务端403集成测试仍属T05。
- 产品文档与AGENTS.md本次未改；既有授权范围外逐字保护测试保持绿。

## 架构纪律自查（产品§16.3 / AGENTS§4）

| 纪律 | 规格落实 |
|---|---|
| 服务层写路径与服务端鉴权 | 所有POST显式动作，jobs仅调用内部服务契约；默认deny、PAT取交集 |
| 显式迁移 | 无PATCH状态；13对象表；registered回退逐跳同cause、同事务 |
| 审计不可回填字段 | human/agent/system/external_agent；agent_run_id/prompt_version始终存在；敏感GET审计；job受控名称/触发源/对象 |
| 判定方式版本化 | rule_manual_v1随配置冻结，换判定重开配置与基线 |
| 通用审核队列 | object_type+object_id；三MVP类型，plan_draft仅预留；不写生产UI |
| 操作分配额与token限流 | probe/judge/drafting分开；429+告警，未擅设额度 |
| 口径元数据与分页 | snapshot_id/data_as_of；列表cursor默认20上限100，≤20KB；不可比422无delta |
| 双凭证同权限 | 会话/PAT同身份权限，scopes不能扩权；只存hash，撤销显式 |
| 前端架构预留 | 仅定义作者/状态分离、通用object_type与扩展事件契约，不越任务实现页面 |
| 操作语义预留 | 105端点逐一分级+destructive；不实现MCP |

## 数据纪律映射（产品§19全部19条）

| 规则 | 规格覆盖 |
|---|---|
| 1/17 溯源、冻结与簇问句集 | 五字段已定；簇锚定版本，ID集合仅同锚定版本内比；新簇不改老簇 |
| 2 同配置不覆盖 | cluster_score(cluster,snapshot)唯一；执行开batch，probe_result/metric按批追加，失败新batch补偿 |
| 3/4 样本与模型 | n_valid<10或覆盖<3分数null+insufficient；拒答排分母，不折算覆盖 |
| 5 可比性 | 同snapshot/同簇/同锚定版本/同ID集合；不一致422 incomparable无差值 |
| 6/7 生产前置 | 种子维护人/复核时间，机会卡demand_tier与来源，交付样本闸门 |
| 8/9 来源与审核 | L3不入库，FactCheck非作者；approve即封版，通用队列原子结算 |
| 10 披露与对照 | 我方生产内容报告披露；事件目标3+对照3 |
| 11 软删除 | active→archived，保留90天SOV分母 |
| 12 对外用语 | 无搜索绝对次数业务字段、无效果承诺 |
| 13 回溯 | 结论携probe_id/来源等级；受限摘录只经单条异议会话 |
| 14 判定版本 | 采样配置冻结judge_version，换方式新配置+基线 |
| 15/16 外部输入/Agent | 外部数据不进指令位；同权限矩阵、人工决策，不实现Runtime/MCP |
| 18 块规范 | 必配当前版approved作为ready条件；自包含细则留judging-spec，跨平台口径冲突报警 |
| 19 双轨 | 检索72/记忆36分配置分报告；模型ID与联网能力T14当日复核 |

## 冻结前需审阅的实现字段草案

api_token用户/租户绑定、audit触发源/cause/session、批次锚定清单及重试尝试编号、probe.question_id、已发布块版本清单、通用诊断/发布/解约投影及独立deletion ledger存储方案。按二轮②授权随PR审，不因此自行引入迁移或新功能。角色矩阵也是本次统一人审的材料，不能因为自动化全绿就视为权限已启用。

人审冻结签字留空；本次不合并PR、不自行冻结规格。
