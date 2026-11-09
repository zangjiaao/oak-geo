import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('T02 草案覆盖模板各节且不得自行冻结', () => {
 const spec = readFileSync('docs/api-spec.md', 'utf8');
 assert.match(spec, /状态：草案，未冻结/);
 for (const title of ['0. 冻结流程', '1. 全局约定', '2. 资源清单', '3. 状态机规格', '4. 批处理与事件', '5. 语义分级汇总', '6. 阻塞问题']) assert.ok(spec.includes(title), title);
 for (const resource of ['tenant','brand','user_member','seed_list','keyword_raw','intent_cluster','question_pool','opportunity_card','scoring_snapshot','claim_block','content_asset','probe_result','publish_registration','evidence_package','objection','metric_snapshot','backflow_ticket']) assert.ok(spec.includes(`### ${resource}`), resource);
 assert.match(spec, /incomparable/);
 assert.match(spec, /object_type \+ object_id/);
 assert.match(spec, /rule_manual_v1/);
});
