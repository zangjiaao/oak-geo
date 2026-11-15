import { test } from "node:test";
import assert from "node:assert/strict";
test("T09 CSV：BOM/CRLF/逗号/转义引号/跨行字段；坏引号拒绝", async () => {
  const { parseCsv } = await import("../../src/server/api/csv.mjs");
  assert.deepEqual(
    parseCsv(
      '\uFEFFkeyword,collected_at\r\n"a,b","2026-01-01T00:00:00Z"\r\n"say ""hi""\nnext",date\r\n',
    ),
    [
      ["keyword", "collected_at"],
      ["a,b", "2026-01-01T00:00:00Z"],
      ['say "hi"\nnext', "date"],
    ],
  );
  for (const csv of [
    'keyword\n"unclosed',
    'keyword\nabc"x',
    'keyword\n"abc"bad',
  ])
    assert.throws(() => parseCsv(csv));
});
test("T09 归一化：全半角/大小写/简繁/标点归一，保持词边界", async () => {
  const { normalizeKeyword } = await import(
    "../../src/server/api/keyword-normalization.mjs"
  );
  assert.equal(normalizeKeyword("  ＥＲＰ，系統！ "), "erp 系统");
  assert.equal(normalizeKeyword("臺灣\t漢語"), "台湾 汉语");
  assert.equal(normalizeKeyword("ERP－系统"), normalizeKeyword("erp-系统"));
  assert.notEqual(normalizeKeyword("C++"), normalizeKeyword("C"));
  assert.notEqual(normalizeKeyword("C#"), normalizeKeyword("C"));
});
