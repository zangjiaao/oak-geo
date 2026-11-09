// Documentation artifacts only; no database access or product runtime policy.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { requiredReviewRisks } from './t02-review-policy.mjs';
const outputs = new Set();
const d = JSON.parse(readFileSync('docs/api/contracts.json', 'utf8'));
const emit = (path, value) => { outputs.add(path); if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== value) throw new Error(`${path} is stale; regenerate documentation`); } else writeFileSync(path, value); };
const scope = (role, e) => role==='owner' && e.resource==='user_member' ? 'tenant' : ['owner','editor','viewer'].includes(role) ? 'brand' : ['content','evidence'].includes(role) ? 'assigned_object' : 'tenant';
const conditions = (role,e) => {
 const rules=['tenant_match','pat_intersection','actor_role_policy'];
 if(['owner','editor','viewer'].includes(role)){if(e.resource!=='user_member')rules.push('own_brand');rules.push('diagnosis_readonly_except_objection_create');}
 if(['content','evidence'].includes(role))rules.push('assigned_opportunity_cluster_source');
 if(e.method==='POST'&&['owner','editor','viewer'].includes(role)&&e.id!=='objection.create')rules.push('mode_full');
 if(['approve','grant','confirm','retire','upgrade_anchor','cleanup'].includes(e.operation))rules.push('human_decision');
 if(['revise','submit','withdraw'].includes(e.operation))rules.push('author_self_when_object_authored');
 if(e.operation==='approve'&&['claim_block','evidence_package','diagnosis_report','review_queue','official_fact'].includes(e.resource))rules.push('not_author');
 if(e.resource==='backflow_ticket'&&e.operation==='complete')rules.push('assigned_user_self');
 if(e.resource==='objection'&&e.operation==='read')rules.push('applicant_or_cs_or_sensitive_factcheck');
 if(e.resource==='objection'&&e.operation==='create'&&['editor','viewer'].includes(role))rules.push('diagnosis_only_proposed');
 if(e.operation==='excerpt')rules.push('applicant_or_initiating_cs','live_session_24h');
 if(e.resource==='objection'&&['grant','reject'].includes(e.operation))rules.push(role==='factcheck'?'sensitive_escalated_only':'ordinary_cs');
 if(role==='admin'&&e.operation==='access')rules.push('reason_required','single_raw_audit');
 if((['intent_cluster','opportunity_card','cluster_platform_signal'].includes(e.resource)||(e.resource==='cluster_score'&&e.operation==='read'))&&['owner','editor','viewer'].includes(role))rules.push('full_filtered_aggregate_only');
 if(['content_asset','claim_block'].includes(e.resource)&&['owner','editor','viewer'].includes(role))rules.push('mode_full');
 if(['evidence_package','diagnosis_report'].includes(e.resource)&&e.operation!=='excerpt'&&['owner','editor','viewer'].includes(role))rules.push('sealed_only','exclude_raw_and_restricted_excerpt');
 if(role==='editor'&&e.resource==='review_queue')rules.push('claim_block_only','content_workbench_entry');
 if(e.resource==='probe_batch'&&e.operation==='read'&&['content','evidence'].includes(role))rules.push('probes_projection_only');
 if(e.resource==='cluster_score'&&e.operation==='read'&&['owner','editor','viewer'].includes(role))rules.push('exclude_question_scores');
 if(e.resource==='brand_lexicon'&&e.operation==='submit')rules.push('version_author_self');
 if(e.resource==='brand_lexicon'&&e.operation==='create')rules.push('new_version_only');
 rules.push('endpoint_validation');return rules.join(';');
};
for(const e of d.endpoints)if(JSON.stringify(e.risk_tags)!==JSON.stringify(requiredReviewRisks(e)))throw new Error(`Risk routing stale: ${e.id}`);
const rows=['# 未出现 (role, resource, operation) allow 行即 deny','role,resource,operation,effect,scope,basis,conditions'];
for(const e of d.endpoints)for(const role of e.grants){
 rows.push([role,e.resource,e.operation,'allow',scope(role,e),('产品文档§9.3;裁定一轮2/6/7;二轮③;整改R1/R3'+(['brand_lexicon','official_fact'].includes(e.resource)?';裁定v4':'')),conditions(role,e)].join(','));
}
emit('docs/api/permissions.csv',rows.join('\n')+'\n');
const pretty=x=>JSON.stringify(x,null,2);
const anchor=id=>id.toLowerCase().replace(/[^\w\u4e00-\u9fff-]/g,'');
const link=(id,path='api/core-set.md')=>`[${id}](${path}#${anchor(id)})`;
const intro='> 未冻结。所有POST携带Idempotency-Key（24h），响应含snapshot_id/data_as_of；完整权限依据allow规范与全局条件，未出现三键即deny。例子为虚构数据，不能直接执行模型调用。\n\n';
function render(e){
 const response={data:structuredClone(e.response),meta:{snapshot_id:e.response.snapshot_id??(['scoring_snapshot','cluster_score','cluster_platform_signal','probe_result','metric_snapshot','probe_batch','opportunity_card'].includes(e.resource)?'snp1':null),data_as_of:'2026-11-09T00:00:00Z'}};
 if(Array.isArray(response.data.items)&&Object.hasOwn(response.data,'next_cursor')){response.next_cursor=response.data.next_cursor;delete response.data.next_cursor;}
 return `### ${e.id}\n\n\`${e.method} ${e.path}\` · 语义 ${e.semantic} · destructive=${e.destructive} · 幂等=${e.idempotency_hours===null?'不适用':'24h'}\n\n权限候选：${e.grants.join(' / ')||'人类九角色全部deny'}；system：${e.system_job??'无'}。权限行：\`(role, ${e.resource}, ${e.operation})\`。审阅风险：${e.risk_tags.join(' / ')||'承重动作'}。\n\n校验：${e.validation}。\n\n审计：${e.audit??'普通只读无业务审计'}。副作用：${e.side_effects}。${e.method==='GET'?'GET不迁移业务对象状态。':''}\n\n请求${e.method==='GET'?'查询参数':'JSON（另带Idempotency-Key）'}：\n\n\`\`\`json\n${pretty(e.request)}\n\`\`\`\n\n响应JSON：\n\n\`\`\`json\n${pretty(response)}\n\`\`\`\n\n`;
}
const errors='## 共享错误示例\n\n'+Object.entries({permission_denied:403,state_conflict:409,validation_failed:422,incomparable:422,quota_exceeded:429}).map(([code,http])=>`HTTP ${http}\n\n\`\`\`json\n${pretty({error:{code,message:code==='incomparable'?'采样配置或簇问句口径不一致':'请求未满足契约条件',details:code==='incomparable'?{baseline_snapshot_id:'snp1',retest_snapshot_id:'snp2'}:{}},meta:{snapshot_id:null,data_as_of:'2026-11-09T00:00:00Z'}})}\n\`\`\`\n`).join('\n');
const coreSet=new Set(d.review.core_endpoint_ids);
let core='# 核心审阅集\n\n'+intro+'从[一页地图](../spec-map.md)进入；20个承重审阅项中的组合动作逐接口展开，每个接口示例只出现一次。其余raw_answer/C类/配额风险接口也必须审，支撑件合并为[抽检附录](generated/endpoints.md)。\n\n| 项 | 承重项 | 端点 |\n|---|---|---|\n';
for(const g of d.review.core_groups)core+=`| ${g.number} | ${g.title} | ${g.endpoint_ids.map(id=>link(id,'core-set.md')).join(' / ')} |\n`;
core+='\n';for(const id of d.review.core_endpoint_ids){const e=d.endpoints.find(e=>e.id===id);if(!e)throw new Error(`Missing core ${id}`);core+=render(e);}
core+=errors;core=core.replaceAll('20个',`${d.review.core_groups.length}个`);emit('docs/api/core-set.md',core);
if(!process.argv.includes('--check'))mkdirSync('docs/api/generated',{recursive:true});
let supporting='# 支撑端点抽检附录\n\n'+intro+'[返回主入口](../../spec-map.md)。本文件只含非核心端点，默认抽检；涉及原文/C类/配额的端点不得下沉。\n\n';
for(const resource of d.resources){
 const endpoints=d.endpoints.filter(e=>e.resource===resource&&!coreSet.has(e.id));
 if(endpoints.length)supporting+=`## ${resource}\n\n`+endpoints.map(render).join('');
}
emit('docs/api/generated/endpoints.md',supporting);
let map='# API 规格审阅地图\n\n> 状态：草案，未冻结。先审本页→[核心集](api/core-set.md)→[allow权限](api/permissions.csv)；[支撑件](api/generated/endpoints.md)默认抽检。\n\n## 三层架构与资源归属\n\n```mermaid\nflowchart LR\n  D[需求层：找机会] -->|机会卡| P[生产层：做事实块]\n  P -->|发布登记| V[验证层：探针与复测]\n  V -->|需求/生产两路回流| D\n  X[横切：租户/权限/审计/令牌/解约] -.-> D\n  X -.-> P\n  X -.-> V\n```\n\n| 层 | API资源（归并后28个，原31个全部有归宿） |\n|---|---|\n';
for(const [layer,resources]of Object.entries(d.review.resource_layers))map+=`| ${layer} | ${resources.map(r=>r+(r==='cluster_score'?'（内含question_score）':r==='evidence_package'?'（内含evidence_item）':r==='probe_batch'?'（内含probe）':'')).join('、')} |\n`;
map+='\n仅合并API边界，27张物理表不变；snapshot是配置、batch是执行，簇级问句锚定规则不变。\n\n## 九角色\n\n| 角色 | 职责和范围 |\n|---|---|\n';
const duties={owner:'本品牌诊断/报表、full确认优先簇及人工下线；diagnosis仅只读与异议。',editor:'本品牌内容工作台草稿/提交及发布登记；diagnosis禁编辑/登记。',viewer:'本品牌报表/趋势及导出；diagnosis异议申请按矩阵条件。',strategist:'本租户全品牌需求策略、问句锚定、诊断建议；人工决策留痕。',content:'仅分派机会卡/簇/来源关联对象的内容撰写，不能放行。',evidence:'仅任务关联证据包/来源初检；封版须独立FactCheck。',factcheck:'本租户全品牌唯一放行，审核人≠作者；敏感异议升级。',cs:'本租户全品牌复测排期、异议授权与陪同、工单派发。',admin:'配置与审计；原文默认不可读，单次理由调阅+审计。'};
for(const role of d.roles)map+=`| ${role} | ${duties[role]} |\n`;
map+='\n## 20个承重审阅项\n\n组合动作按负责人R4逐接口展开；不是把不同职责压成20个HTTP接口。\n\n| 项 | 审什么 | 完整接口示例 |\n|---|---|---|\n';
for(const g of d.review.core_groups)map+=`| ${g.number} | ${g.title} | ${g.endpoint_ids.map(id=>link(id)).join(' / ')} |\n`;
map+='\n## 一个事实块的旅程\n\n```mermaid\nflowchart LR\n  C[claim_block.create] --> S[claim_block.submit]\n  S --> A[claim_block.approve]\n  A --> R[content_asset.transition 自动ready]\n  R --> P[publish_registration.register]\n  P --> B[probe_batch.start / execute]\n  B --> J[probe_result.judge 复测命中]\n  J --> M[cluster_score.compare 可比才出差值]\n```\n\n[修订](api/core-set.md#claim_blockrevise)、[撤回下线](api/core-set.md#claim_blockretract)及同事务链式回退不绕过独立审核。\n\n## 13个状态机索引\n\n| 对象 | 完整迁移表 |\n|---|---|\n';
for(const name of Object.keys(d.states))map+=`| ${name} | [状态/出边/终态](api/states.md#${anchor(name)}) |\n`;
map+='\n[全局约定](api-spec.md) · [裁定原文](t02-decisions.md) · [归并/行数说明](api-spec.md#2-资源清单)；本次不实现API、不合并、不自行冻结。\n';
map=map.replaceAll('20个',`${d.review.core_groups.length}个`).replace('归并后28个，原31个全部有归宿',`${d.resources.length}个；原资源归并并补v4判定输入`).replace('27张物理表不变','v4补齐后29张物理表').replaceAll('13个',`${Object.keys(d.states).length}个`);
if(map.trimEnd().split('\n').length>120)throw new Error('spec-map exceeds 120 lines');
emit('docs/spec-map.md',map);
let states='# T02 状态迁移表\n\n> 未冻结。枚举来源：各轮负责人裁定及v4优先，其次 api-spec-template §3；不增加裁定外状态。表内系统触发通过服务层执行。终态“不可改”作用于该行/版本，不禁止创建新行。\n\n';
for(const [name,s]of Object.entries(d.states)){
 states+=`## ${name}\n\n状态：${s.states.map(x=>'`'+x+'`').join(' / ')}。终态：${s.terminal.join(' / ')||'无永久终态（按裁定修订新版本）'}。\n\n| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |\n|---|---|---|---|---|\n`;
 for(const t of s.transitions)states+=`| ${t.from} → ${t.to} | ${t.trigger} | ${t.actor} | ${t.condition} | ${t.effect} |\n`;
 states+='\n';
}
states+='## brand_lexicon版本审核（不新增状态枚举）\n\ncreate生成完整新version（不生效）；submit创建waiting队列；FactCheck非版本作者approve后该版本生效。rejected/withdrawn按既有队列规则退回未生效草稿，旧版本始终只读。词表表不增加status列，审核结果由review_queue承载。\n';
emit('docs/api/states.md',states);
for(const file of readdirSync('docs/api/generated')){const path=`docs/api/generated/${file}`;if(!outputs.has(path)){if(process.argv.includes('--check'))throw new Error(`Unexpected generated file ${path}`);unlinkSync(path);}}
console.log(`${d.resources.length} resources; ${d.endpoints.length} endpoints; ${rows.length-2} allow rows`);
