import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? files(`${dir}/${item.name}`) : [`${dir}/${item.name}`]);
test('脚手架页面不引入数据库路径、裸布局或裸样式', () => {
  for (const path of files('src/app').filter((p) => /\.tsx?$/.test(p))) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /<(div|span)\b/, path);
    assert.doesNotMatch(source, /(?:from\s+["'](?:pg|postgres|.*server\/.*)["']|\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b)/i, path);
    assert.doesNotMatch(source, /#[\da-f]{3,8}\b|\b\d+px\b/i, path);
  }
});
