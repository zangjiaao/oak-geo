import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { requiredReviewRisks } from '../../scripts/t02-review-policy.mjs';
import { createHash } from 'node:crypto';
const read = p => readFileSync(p, 'utf8');
const data = () => JSON.parse(read('docs/t02-contracts.json'));
test('授权范围外的产品文档逐字保留', () => {
 const text = read('docs/GEO产品文档.md').replace(/## 18\. 表结构[\s\S]*?(?=## 19\. 硬规则汇总)/,'').replace(/^\| T02 阻塞项 10 条裁定：.*\n/m,'');
 assert.equal(createHash('sha256').update(text).digest('hex'), '89324b8af488a76230a65152b31986b181dc4226658e948fa014901ff8531121');
});
test('六表及快照双身份只在授权处补充', () => {
 const section=read('docs/GEO产品文档.md').split('## 18. 表结构')[1].split('## 19.')[0];
 for(const name of ['review_queue','objection','backflow_ticket','evidence_package','api_token','probe_batch']) assert.match(section,new RegExp(`^${name}\\s`,'m'));
 assert.match(section,/actor_type\(human\/agent\/system\/external_agent\)/);
 assert.match(section,/id, tenant_id, probe_id/);
 assert.match(section,/snapshot_id, batch_id/);
});
test('全资源端点均有独立请求响应及语义和审计定义', () => {
 const d=data(); const product=read('docs/GEO产品文档.md').split('## 18. 表结构')[1].split('```')[1];
 const tables=[...product.matchAll(/^(\w+)\s{2,}/gm)].map(m=>m[1]);
 for(const table of tables) assert.ok(d.resources.includes(table)||d.embedded_models?.[table],table);
 assert.equal(d.resources.length,28);
 const map=read('docs/spec-map.md');assert.ok(map.trimEnd().split('\n').length<=120);assert.equal(d.review.core_groups.length,20);
 const core=read('docs/core-set.md');for(const id of d.review.core_endpoint_ids)assert.ok(core.includes('### '+id),id);
 for(const e of d.endpoints){assert.deepEqual(e.risk_tags,requiredReviewRisks(e));if(e.risk_tags.length)assert.ok(d.review.core_endpoint_ids.includes(e.id),e.id);}
 const files=['docs/core-set.md',...readdirSync('docs/generated').filter(f=>f.endsWith('.md')).map(f=>'docs/generated/'+f)];
 const documented=files.flatMap(f=>[...read(f).matchAll(/^### ([a-z_]+\.[a-z_]+)$/gm)].map(m=>m[1]));
 assert.equal(documented.length,d.endpoints.length);assert.equal(new Set(documented).size,d.endpoints.length);
 const ids=new Set();
 for(const e of d.endpoints){assert.ok(!ids.has(e.id));ids.add(e.id);assert.ok(d.resources.includes(e.resource));assert.ok(d.operations.includes(e.operation));assert.ok(e.request && e.response && e.validation && e.side_effects);assert.ok(['read-only','draft','proposal','write'].includes(e.semantic));assert.equal(typeof e.destructive,'boolean');if(e.method==='POST'){assert.ok(e.audit);assert.equal(e.idempotency_hours,24);}if(e.method==='GET')assert.equal(e.mutates_state,false);}
});
test('权限规范仅含allow且每行有依据，默认拒绝不再展开', () => {
 const d=data();const lines=read('docs/t02-permissions.csv').trim().split('\n');
 assert.equal(lines[0],'# 未出现 (role, resource, operation) allow 行即 deny');
 const rows=lines.slice(2).map(x=>x.split(','));assert.equal(rows.length,d.endpoints.reduce((n,e)=>n+e.grants.length,0));
 const keys=new Set();for(const [role,resource,operation,effect,scope,basis,condition]of rows){const k=[role,resource,operation].join(':');assert.ok(!keys.has(k),k);keys.add(k);assert.equal(effect,'allow');assert.ok(basis.includes('§9.3')||basis.includes('裁定'));assert.ok(scope&&condition);}
 for(const role of ['admin','owner','editor','viewer'])assert.ok(!keys.has(`${role}:probe_result:read_raw`));
 const registration=rows.find(r=>r[0]==='editor'&&r[1]==='publish_registration'&&r[2]==='register');assert.ok(registration[6].includes('full'));
});
test('定稿的块状态不携带发布进度且GET异议访问不改状态', () => {
 const d=data();assert.deepEqual(d.states.claim_block.states,['draft','pending_review','approved','retracted']);
 assert.deepEqual(d.states.content_asset.states,['draft','ready','registered','retired']);
 const edges=d.states.claim_block.transitions.map(t=>[t.from,t.to]);
 for(const edge of [['draft','pending_review'],['pending_review','approved'],['pending_review','draft'],['approved','retracted'],['retracted','draft']])assert.ok(edges.some(e=>e[0]===edge[0]&&e[1]===edge[1]));
 assert.ok(d.endpoints.some(e=>e.resource==='objection'&&e.operation==='view'&&e.method==='POST'));
 assert.match(read('docs/api-spec.md'),/状态：草案，未冻结/);
});
test('所有状态均有合法出边或声明终态，终态行不可再迁移', () => {
 const current=data();
 const projection=d=>({states:Object.fromEntries(Object.entries(d.states).map(([k,v])=>[k,{states:v.states,terminal:v.terminal,edges:v.transitions.map(({trigger,...x})=>x)}])),citation:d.citation_policy,retraction:d.content_retraction_policy,retention:d.retention_policy});
 assert.equal(createHash('sha256').update(JSON.stringify(projection(current))).digest('hex'),'04d009ffa5f00c1462242db5e7444d36580684ace6a054226e1a1803bc6ea7b7');
 for(const [name,s] of Object.entries(current.states)) {
  for(const t of s.transitions){assert.ok(s.states.includes(t.from),name);assert.ok(s.states.includes(t.to),name);assert.ok(!s.terminal.includes(t.from),`${name}:${t.from}`);}
  for(const state of s.states)assert.ok(s.terminal.includes(state)||s.transitions.some(t=>t.from===state),`${name}:${state}`);
 }
 const d=data();assert.deepEqual(d.states.probe_batch.terminal,['completed','failed','cancelled']);
 assert.deepEqual(d.states.review_queue.terminal,['approved','rejected','withdrawn']);
 assert.ok(!d.states.content_asset.transitions.some(t=>t.from==='registered'&&t.to==='draft'));
});
test('三轮引用与链式状态规则为明确契约，弱命中不混入对外引用', () => {
 const d=data();assert.deepEqual(d.citation_policy.normalization,['remove_protocol','remove_www','remove_query','remove_fragment','remove_trailing_slash']);
 assert.equal(d.citation_policy.external_citation_rate,'explicit_only');
 assert.equal(d.content_retraction_policy.same_transaction,true);
 assert.equal(d.content_retraction_policy.shared_cause_event_id,true);
 assert.match(read('docs/GEO产品文档.md'),/cited_urls\[\]/);
 assert.ok(d.endpoints.some(e=>e.resource==='offboarding'&&e.operation==='cleanup'&&e.grants.includes('admin')&&!e.system_job));
});
test('job名注册表与内部端点白名单一致，不授予人类system权限', () => {
 const d=data();for(const e of d.endpoints.filter(e=>e.system_job)){assert.ok(d.jobs[e.system_job]?.endpoints.includes(e.id),e.id);if(e.path.startsWith('/internal/'))assert.deepEqual(e.grants,[]);}
 for(const job of Object.values(d.jobs))for(const id of job.endpoints)assert.ok(d.endpoints.some(e=>e.id===id));
 assert.ok(d.jobs.probe_execute.batch_required);
 assert.equal(d.jobs.weekly_pool.batch_required,false);
 assert.ok(d.endpoints.some(e=>e.resource==='deletion_ledger'&&e.operation==='append'&&e.system_job==='offboarding'));
});
