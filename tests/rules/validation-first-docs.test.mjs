import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');

test('验证入口覆盖证据链、Agent分工和未批准参数的边界', () => {
  const product = read('docs/GEO产品文档.md');
  for (const text of ['方法论验证', '产品事实', '用户任务', 'Agent', '研究试跑', '正式测量', '不承诺增长']) assert.ok(product.includes(text), text);
  assert.doesNotMatch(product, /只有"热度档高 \+ 结果页真空"的簇才花探针钱|Agent 不进 MVP 验收，实现后置|从 CSV 导入.*全链路系统内自动/);
  const backlog = read('docs/backlog.md');
  assert.ok(backlog.indexOf('V0') < backlog.indexOf('V1'));
  for (const text of ['T42', 'Agent', '待核实', '研究试跑', '正式测量', '原详细 DoD 不再作为研究试跑的前置清单']) assert.ok(backlog.includes(text), text);
});

test('所有文档入口明确当前方向或历史边界，本地文件链接有效', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  for (const file of walk('docs').filter(p => p.endsWith('.md') && p !== 'docs/archive/GEO产品文档-v3.5.md')) {
    const content = read(file);
    if (file !== 'docs/README.md') assert.match(content.slice(0, 1600), /README\.md/, file);
    for (const [, link] of content.replace(/```[\s\S]*?```/g, '').matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const target = link.split('#')[0];
      if (target && !/^(https?:|mailto:|\/)/.test(target)) assert.ok(existsSync(resolve(dirname(file), target)), `${file}: ${link}`);
    }
  }
});

// The direction changed, but implementation contracts and hard rules did not.
test('方法论重排保留全部既有数据模型与硬规则，不解除正式准入', () => {
  const current = read('docs/GEO产品文档.md');
  const legacy = read('docs/archive/GEO产品文档-v3.5.md');
  const dataAndRules = text => text.split('## 18. 表结构')[1].split('# 决策记录与待定')[0];
  assert.equal(dataAndRules(current), dataAndRules(legacy));
  for (const text of ['每簇 3 问句 × 4 模型 × 温度 0/0.7 × 3 轮', 'demand_tier', 'demand_source', 'approved official_fact', '不通过研究标签绕过服务校验']) assert.ok(current.includes(text), text);
});
