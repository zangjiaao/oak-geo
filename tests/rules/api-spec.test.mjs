import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('T02 草案覆盖模板各节且不得自行冻结', () => {
 const spec = readFileSync('docs/api-spec.md', 'utf8');
 assert.match(spec, /状态：草案，未冻结/);
 for (const title of ['0. 冻结流程', '1. 全局约定', '2. 资源清单', '3. 状态机规格', '4. 批处理与事件', '5. 语义分级汇总', '6. 阻塞问题']) assert.ok(spec.includes(title), title);
 for (const resource of ['tenant','brand','user_member','seed_list','keyword_raw','intent_cluster','question_pool','opportunity_card','scoring_snapshot','claim_block','content_asset','probe_result','publish_registration','evidence_package','objection','metric_snapshot','backflow_ticket']) assert.ok(spec.includes(resource), resource);
 assert.match(spec, /incomparable/);
 assert.match(spec, /object_type \+ object_id/);
 assert.match(spec, /rule_manual_v1/);
});
test('人审决定与剩余未冻结规则明确分开', () => {
 const spec = readFileSync('docs/api-spec.md', 'utf8');
 assert.match(spec, /### 1\.5 已批准决策/);
 assert.match(spec, /记忆轨：3 问句 × 4 模型 × 温度 0 × 3 轮 = 36 条\/簇/);
 assert.match(spec, /Admin 不默认读取原文/);
 assert.match(spec, /事实块管理审核状态，发布进度另行记录；修订开新版本/);
 assert.doesNotMatch(spec, /人审前不排记忆轨任务|建议尚未获批准/);
 assert.match(spec, /状态：草案，未冻结/);
});
