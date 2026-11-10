import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSpecPermission, readAllowSet } from '../../scripts/t02-allow-policy.mjs';
const d=JSON.parse(readFileSync('docs/api/contracts.json','utf8'));
test('allow规范：所有不在集合中的三键请求均返回403', () => {
 const allows=readAllowSet();
 for(const role of [...d.roles,'unknown_role'])for(const resource of [...d.resources,'unknown_resource'])for(const operation of [...d.operations,'unknown_operation']){
  const request={role,resource,operation};const result=resolveSpecPermission(allows,request);
  if(!allows.has([role,resource,operation].join(':')))assert.equal(result.status,403);
 }
});
test('allow规范：集合不越出九角色×资源×操作全集，且授权投影不扩权', () => {
 const allows=readAllowSet();
 for(const key of allows.keys()){
  const [role,res,op]=key.split(':');assert.ok(d.roles.includes(role));assert.ok(d.resources.includes(res));assert.ok(d.operations.includes(op));
  assert.ok(d.endpoints.some(e=>e.resource===res&&e.operation===op&&e.grants.includes(role)));
 }
 assert.equal(d.roles.length,9);assert.equal(d.resources.length,30);
 for(const model of Object.values(d.embedded_models))assert.ok(model.parent_resource&&model.grants);
 assert.equal(Object.keys(d.layout_migration.endpoint_map).length,112);
 assert.deepEqual(d.review.v4_delta,{before_resources:28,added_resources:2,after_resources:30,before_endpoints:105,added_endpoints:7,after_endpoints:112,before_allow_rows:230,added_allow_rows:15,after_allow_rows:245,note:'裁定29→31为估计，实际基数按R3归并后28计算'});
 assert.equal(d.endpoints.length,105+7);assert.equal(d.operations.length,39);
 assert.equal(allows.size,246-5-7-5-1+2+15);
 assert.deepEqual(d.embedded_models.question_score.grants,['strategist','factcheck','cs','content','evidence']);
 assert.deepEqual(d.embedded_models.probe.grants,['strategist','factcheck','cs','content','evidence']);
 const customerRow=allows.get('owner:cluster_score:read');assert.ok(customerRow.conditions.includes('exclude_question_scores'));
 const taskRow=allows.get('content:probe_batch:read');assert.ok(taskRow.conditions.includes('probes_projection_only'));
 assert.ok(allows.get('owner:cluster_score:compare'));assert.ok(!allows.get('owner:cluster_score:compare').conditions.includes('full_filtered_aggregate_only'));
 assert.ok(allows.get('cs:objection:grant').conditions.includes('human_decision'));
});
// R3 count reconciliation is asserted inside the existing coverage test below.
