import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('T03覆盖产品实际19条硬规则，验收用例不以skip或占位断言冒充实现', async () => {
 const { ruleCases }=await import('./product-rule-cases.mjs');
 const product=readFileSync('docs/GEO产品文档.md','utf8').split('## 19. 硬规则汇总')[1].split('# 决策记录')[0];
 const ids=[...product.matchAll(/^\| (\d+) \|/gm)].map(m=>Number(m[1]));
 assert.deepEqual([...new Set(ruleCases.map(c=>c.rule))].sort((a,b)=>a-b),ids);
 const seen=new Set();for(const c of ruleCases){assert.ok(!seen.has(c.id));seen.add(c.id);assert.equal(typeof c.run,'function');assert.ok(c.tasks.length);assert.ok(c.source);assert.ok(c.title);}
 const pkg=JSON.parse(readFileSync('package.json','utf8'));assert.match(pkg.scripts.test,/test:product/);
 const operationIds=new Set(JSON.parse(readFileSync('docs/api/contracts.json','utf8')).endpoints.map(e=>e.id));
 for(const match of readFileSync('tests/rules/product-rule-cases.mjs','utf8').matchAll(/call\(app,'([^']+)'/g))assert.ok(operationIds.has(match[1]),`验收调用未冻结操作${match[1]}`);
 const source=readFileSync('tests/rules/product-hard-rules.red.mjs','utf8');assert.doesNotMatch(source,/\b(?:skip|todo)\s*[:(]/);
});
test('T02冻结来自负责人明确批准，附录生成不能退回草案', () => {
 const d=JSON.parse(readFileSync('docs/api/contracts.json','utf8'));
 assert.equal(d.status,'frozen');assert.equal(d.freeze.approved_by,'产品负责人');assert.equal(d.freeze.source_pr,4);
 const {status,freeze,...content}=d;assert.equal(createHash('sha256').update(JSON.stringify(content)).digest('hex'),d.freeze.content_sha256);
 assert.match(d.freeze.approval_quote,/同时批准冻结当前 API 规格/);
 for(const p of ['docs/api-spec.md','docs/spec-map.md','docs/api/core-set.md','docs/api/states.md','docs/api/generated/endpoints.md'])assert.match(readFileSync(p,'utf8'),/已冻结/);
});
