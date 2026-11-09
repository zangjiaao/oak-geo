# T02 人审冻结候选稿自查

状态：待人审冻结，未冻结。依据附件为三轮负责人裁定 `t02-decisions.md`；产品文档页首版本保持原样，仅追加授权的v3.5决策记录，不代人修改冻结标识。

## 审阅入口

- `api-spec.md`：全局口径、冲突覆盖顺序、模式/权限条件、审核/异议/解约、字段草案。
- `t02-endpoints.md`：112个端点的独立请求/响应、审计、幂等、副作用、语义与destructive。
- `t02-permissions.csv`：9角色×31资源×41操作=11,439行，246个条件allow，其余11,193个deny；包括不适用组合，禁止默认允许。每行标依据。31资源=产品§18的27表+4业务投影，投影不代表自动新增物理表。
- `t02-states.md`：13对象迁移表，出边与明确终态；无裁定外状态。系统reconcile的链式事务约束在主规格§3及JSON单独列明。
- `t02-contracts.json`：生成材料源；`node scripts/generate-t02-docs.mjs`重新生成CSV/端点/迁移表；`--check`验证生成材料未漂移。生成器只读写文档，无生产权限执行逻辑或数据库路径。

## 验证结果

- 第一轮红：6表/双身份、端点目录、矩阵、状态契约4项失败；对应文件/字段补齐后绿。
- 第三轮红：URL/同事务链及受控job契约2项失败；补齐后绿。
- `npm test`：14项通过；含授权范围外产品文档SHA-256逐字保护、全表覆盖、端点审计/幂等元数据、权限三键全笛卡尔积且无重复、定稿状态及终态、系统白名单、原文默认拒绝。
- `node scripts/generate-t02-docs.mjs --check`：生成产物一致。
- `npm run typecheck`：通过；`git diff --check`通过。
- 本次不改UI或运行时，无需重复Next.js/Workers构建与doctor；T01结果不冒充本次业务实现验收。

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
| 操作语义预留 | 112端点逐一分级+destructive；不实现MCP |

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
