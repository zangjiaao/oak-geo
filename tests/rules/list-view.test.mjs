import { test } from "node:test";
import assert from "node:assert/strict";

test("列表搜索与筛选后分页：归一化匹配、空结果、页码收敛且不改变完整业务集合", async () => {
  const { listWindow } = await import("../../src/lib/list-view.mjs");
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    name: `ＥＲＰ ${i}`,
    state: i % 2 ? "ok" : "blocked",
  }));
  const original = structuredClone(rows);
  const result = listWindow(rows, {
    query: "erp",
    fields: ["name"],
    matches: (row) => row.state === "ok",
    page: 5,
    pageSize: 10,
  });
  assert.equal(result.total, 12);
  assert.equal(result.page, 2);
  assert.deepEqual(
    result.items.map((r) => r.id),
    [21, 23],
  );
  assert.deepEqual(
    listWindow(rows, {
      query: "没有匹配",
      fields: ["name"],
      page: 8,
      pageSize: 10,
    }),
    { items: [], total: 0, page: 1 },
  );
  assert.deepEqual(
    rows,
    original,
    "UI不能用分页/筛选集合替代冻结或锚定的完整业务集合",
  );
});
