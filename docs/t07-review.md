# T07 简报

状态：待人审，PR #8未合并。基于已合并PR #6/#7的main，新分支task/t07-seed-management；T06已按负责人确认记done，产品决策记录仅追加指定一行。

## 本轮交付

服务层CRUD＋行业共享读写路径＋④页面字段/交互契约。负责人已确认网页界面后续单独排期；生成语法面板归T08、C类回灌归T09，本轮不扩功能。

状态草案为`active / deprecated`，默认active，旧NULL回填active；随本PR人审，agent未自行冻结。所有修改（含停用条目的资料校正）、软停用、重新采用均通过现有`seed_list.revise`追加新版本；旧行不可update/delete。维护人和UTC复核时间每次写必填。

## 改动文件

| 文件组 | 改动 |
|---|---|
| [seed-handlers](../src/server/api/seed-handlers.mjs)、catalog/domain/provisioning | 三个种子操作集中实现，删除T04/T05旧种子写路径；复用固定六层权限、事务审计、幂等与分页 |
| [0009迁移](../migrations/0009_seed_lifecycle.sql) | NULL→active逐行审计、非空默认/CHECK；logical_id/previous_id版本链；旧记录按行业/类型/公共词根串联；数据库禁止改删历史 |
| [功能测试](../tests/rules/t07-seeds.test.mjs)、[迁移回放](../tests/db/seed-lifecycle.test.mjs) | CRUD/校验/跨租户共享权限与隐私、旧NULL迁移及数据库不可变回归 |
| [共享投影](../src/server/api/shared-industry.mjs) | 聚合平面保持原有公共词根/数值白名单，不携带维护人；管理字段只在鉴权种子管理接口返回，并拦截夹带已知客户标识 |
| tests/support/fixture-registry.mjs | fixture消费服务返回的版本；A02为新增实现的既有revise端点准备真实合法请求，协议/断言不改 |
| 原T04/T05/T02测试 | T04过渡NULL/禁止状态输入预期由新默认及未知状态拒绝接管；产品字节守卫只豁免负责人指定T06决策行；docs只为授权的本简报扩容 |
| backlog、t02-decisions、产品文末记录 | T06 done、合并记录、T07范围/状态草案；产品其余字节不改 |

## 与 §13.2 ④ 的对应

| 页面设计项 | 服务契约/行为 |
|---|---|
| 词根表格：词/类型/维护人/复核时间/状态 | read返回word/word_type/maintainer/last_reviewed_at/status、id/logical_id/previous_id/seed_version/created_at；默认只显示各逻辑链当前行，含停用行 |
| 行级编辑、无维护人红色警示 | create/revise缺维护人或复核时间422，错误details.field可供界面定位；仅Strategist写，FactCheck/CS只读，其余deny |
| 版本历史 | read查询view=history＋logical_id；seed_version查询可还原指定行业版本时的行集合；默认20/上限100、data.next_cursor |
| 停用/重新采用 | revise传status=deprecated/active，追加新行；陈旧版本id返回409，不覆盖旧内容 |
| 行业共享 | 无tenant_id；内部跨租户策略可维护同一公共词根，审计仍带发起租户/人。只接收受信许可公共词根；客户厂牌/竞品名单/品线/C原句不得写入或经共享读路径泄漏 |
| word_type | 产品五值保持；共享入口继续仅准品类/场景/问题。品牌专属竞品/品线用brand_lexicon，不借种子CRUD扩共享边界 |
| 生成语法、C回灌、实际网页 | 分属T08/T09及后续网页排期，未用占位界面宣称完成 |

写入示例（Web/PAT同权限、沿用24h Idempotency-Key；industry由所选行业传入）：

```json
{"word":"许可公共词根","industry":"B2B","word_type":"场景","maintainer":"张三","last_reviewed_at":"2026-11-11T00:00:00Z"}
```

修订引用当前id；每次显式传maintainer/last_reviewed_at，可传word/word_type/status。逻辑身份由服务维护；行业不能通过修订更换；seed_version在行业锁内递增，客户端不能指定占号。同词根create追加原逻辑链的新版本，不生成重复当前行。

读取示例：`query={industry:"B2B",status:"active",limit:20}`；历史：`{industry:"B2B",logical_id:"…",view:"history"}`；还原：`{industry:"B2B",seed_version:3}`。冻结read/create/revise端点、权限集合、contracts.json与T03断言/协议字节不变，新增实现1个既有端点，注册77→78。

## 测试增量与结果

- 先红：新增CRUD/共享测试因旧服务强制客户端seed_version、无生命周期/修订而失败；增加历史版本还原后也先发现读到当前行，再修复为按版本切片读取。
- 新增4项：CRUD/历史/停用、字段/枚举/幂等、跨租户共享/allow/隐私、迁移NULL回填/重复/不可变。迁移回放仅通过管理迁移服务构造旧schema历史；runtime fixture/call仍为普通geo_app且无bypass。
- 原74项全部保留（只按授权更新T04临时schema/状态预期，隐私断言未删）：checks 55/55、product 23/23均已通过；代码收尾后的最终product回归也已23/23通过（约390秒），均0 skip/todo。新增4项，合计78项；A02覆盖78个注册操作。
- typecheck、生成器--check（仍30资源/112端点/245 allow）、Workers构建、doctor通过；doctor现有theme提示保留、0失败。

未运行生产迁移、未部署；状态草案及diff等待负责人审阅合并。
