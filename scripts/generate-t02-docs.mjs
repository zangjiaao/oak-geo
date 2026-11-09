// Documentation artifacts only; no database access or product runtime policy.
import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('docs/t02-contracts.json', 'utf8'));
const emit = (path, value) => { if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== value) throw new Error(`${path} is stale; regenerate documentation`); } else writeFileSync(path, value); };
const scope = (role, e) => role==='owner' && e.resource==='user_member' ? 'tenant' : ['owner','editor','viewer'].includes(role) ? 'brand' : ['content','evidence'].includes(role) ? 'assigned_object' : 'tenant';
const conditions = (role,e) => {
 const rules=['tenant_match','pat_intersection','actor_role_policy'];
 if(['owner','editor','viewer'].includes(role)){if(e.resource!=='user_member')rules.push('own_brand');rules.push('diagnosis_readonly_except_objection_create');}
 if(['content','evidence'].includes(role))rules.push('assigned_opportunity_cluster_source');
 if(e.method==='POST'&&['owner','editor','viewer'].includes(role)&&e.id!=='objection.create')rules.push('mode_full');
 if(['approve','confirm','retire','upgrade','anchor','cleanup'].includes(e.operation))rules.push('human_decision');
 if(['revise','submit','withdraw'].includes(e.operation))rules.push('author_self_when_object_authored');
 if(e.operation==='approve'&&['claim_block','evidence_package','diagnosis_report','review_queue'].includes(e.resource))rules.push('not_author');
 if(e.resource==='backflow_ticket'&&e.operation==='complete')rules.push('assigned_user_self');
 if(e.resource==='objection'&&e.operation==='read')rules.push('applicant_or_cs_or_sensitive_factcheck');
 if(e.resource==='objection'&&e.operation==='create'&&['editor','viewer'].includes(role))rules.push('diagnosis_only_proposed');
 if(e.resource==='objection'&&e.operation==='excerpt')rules.push('applicant_or_initiating_cs','live_session_24h');
 if(e.resource==='objection'&&['approve','reject'].includes(e.operation))rules.push(role==='factcheck'?'sensitive_escalated_only':'ordinary_cs');
 if(role==='admin'&&e.operation==='access')rules.push('reason_required','single_raw_audit');
 if(['intent_cluster','opportunity_card','cluster_score','cluster_platform_signal'].includes(e.resource)&&['owner','editor','viewer'].includes(role))rules.push('full_filtered_aggregate_only');
 if(['content_asset','claim_block'].includes(e.resource)&&['owner','editor','viewer'].includes(role))rules.push('mode_full');
 if(['evidence_package','evidence_item','diagnosis_report'].includes(e.resource)&&['owner','editor','viewer'].includes(role))rules.push('sealed_only','exclude_raw_and_restricted_excerpt');
 if(role==='editor'&&e.resource==='review_queue')rules.push('claim_block_only','content_workbench_entry');
 rules.push('endpoint_validation');return rules.join(';');
};
const rows=['role,resource,operation,effect,scope,basis,conditions'];
for(const role of d.roles)for(const resource of d.resources)for(const operation of d.operations){
 const e=d.endpoints.find(x=>x.resource===resource&&x.operation===operation);
 const allow=!!e?.grants.includes(role);
 rows.push([role,resource,operation,allow?'allow':'deny',allow?scope(role,e):'none',allow?'产品文档§9.3;裁定一轮2/6/7;二轮③':'裁定一轮2默认deny',allow?conditions(role,e):'no_explicit_grant'].join(','));
}
emit('docs/t02-permissions.csv',rows.join('\n')+'\n');
const pretty=x=>JSON.stringify(x,null,2);
let out='# T02 逐端点契约与请求响应示例\n\n> 未冻结；由 `node scripts/generate-t02-docs.mjs` 从 `docs/t02-contracts.json` 生成。字段示例均为虚构，不能直接发起模型调用。完整权限以 `t02-permissions.csv` 的三键行及全局条件为准，不在此简写列表中隐含授权。所有POST携带Idempotency-Key（24h）；元数据包括无快照时的null。\n\n';
for(const resource of d.resources){
 out+=`## ${resource}\n\n`;
 for(const e of d.endpoints.filter(x=>x.resource===resource)){
  const response={data:e.response,meta:{snapshot_id:e.response.snapshot_id??( ['scoring_snapshot','question_score','cluster_score','cluster_platform_signal','probe','probe_result','metric_snapshot','probe_batch','opportunity_card'].includes(resource)?'snp1':null),data_as_of:'2026-11-09T00:00:00Z'}};
  if(Array.isArray(e.response.items)){response.next_cursor=e.response.next_cursor??null;delete response.data.next_cursor;}
  out+=`### ${e.id}\n\n\`${e.method} ${e.path}\` · 语义 ${e.semantic} · destructive=${e.destructive} · 幂等=${e.idempotency_hours===null?'不适用':'24h'}\n\n权限候选：${e.grants.join(' / ')||'人类九角色全部deny'}；system：${e.system_job??'无'}。权限行索引：\`(role, ${e.resource}, ${e.operation})\`。\n\n校验：${e.validation}。\n\n审计事件：${e.audit??'普通只读无业务审计'}。副作用：${e.side_effects}。${e.method==='GET'?'GET不迁移对象状态；访问审计不算对象状态变更。':''}\n\n请求${e.method==='GET'?'查询参数':'JSON（另带Idempotency-Key）'}：\n\n\`\`\`json\n${pretty(e.request)}\n\`\`\`\n\n响应JSON：\n\n\`\`\`json\n${pretty(response)}\n\`\`\`\n\n`;
 }
}
out+='## 全部端点共享的错误示例\n\n'+Object.entries({permission_denied:403,state_conflict:409,validation_failed:422,incomparable:422,quota_exceeded:429}).map(([code,http])=>`HTTP ${http}\n\n\`\`\`json\n${pretty({error:{code,message:code==='incomparable'?'采样配置或簇问句口径不一致':'请求未满足契约条件',details:code==='incomparable'?{baseline_snapshot_id:'snp1',retest_snapshot_id:'snp2'}:{}},meta:{snapshot_id:null,data_as_of:'2026-11-09T00:00:00Z'}})}\n\`\`\`\n`).join('\n');
emit('docs/t02-endpoints.md',out);
let states='# T02 状态迁移表\n\n> 未冻结。枚举来源：一轮/二轮裁定优先，其次 api-spec-template §3；不增加裁定外状态。表内系统触发通过服务层执行。终态“不可改”作用于该行/版本，不禁止创建新行。\n\n';
for(const [name,s]of Object.entries(d.states)){
 states+=`## ${name}\n\n状态：${s.states.map(x=>'`'+x+'`').join(' / ')}。终态：${s.terminal.join(' / ')||'无永久终态（按裁定修订新版本）'}。\n\n| 迁移 | 显式触发 | 执行者 | 前置条件 | 副作用 |\n|---|---|---|---|---|\n`;
 for(const t of s.transitions)states+=`| ${t.from} → ${t.to} | ${t.trigger} | ${t.actor} | ${t.condition} | ${t.effect} |\n`;
 states+='\n';
}
emit('docs/t02-states.md',states);
console.log(`${d.resources.length} resources; ${d.endpoints.length} endpoints; ${rows.length-1} permission rows`);
