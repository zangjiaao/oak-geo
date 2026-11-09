import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
test('App Router 入口先 reset 再载入 astryx 样式', () => {
  const layout = read('src/app/layout.tsx');
  assert.match(layout, /import "@astryxdesign\/core\/reset.css";/);
  assert.match(layout, /import "@astryxdesign\/core\/astryx.css";/);
  assert.ok(layout.indexOf('/reset.css') < layout.indexOf('/astryx.css'));
});
test('Workers 入口、资源绑定和 Node 兼容配置正确', () => {
  const config = JSON.parse(read('wrangler.jsonc'));
  assert.equal(config.main, '.open-next/worker.js');
  assert.equal(config.assets.directory, '.open-next/assets');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  assert.ok(config.compatibility_date >= '2024-09-23');
});
test('固定技术栈并提供本地 Workers 开发命令及服务层目录', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const dependency of ['next', 'react', 'react-dom', '@astryxdesign/core', '@opennextjs/cloudflare']) {
    assert.ok(pkg.dependencies[dependency], dependency);
  }
  assert.match(pkg.scripts['dev:worker'], /wrangler dev/);
  for (const dir of ['src/server/api', 'src/server/jobs', 'migrations']) assert.ok(existsSync(dir), dir);
  assert.match(read('.gitignore'), /\.open-next\//);
});
