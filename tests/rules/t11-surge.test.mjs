import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keywordHash,
  normalizationVersion,
} from "../../src/server/api/keyword-normalization.mjs";

const end = Date.parse("2026-11-16T00:00:00Z");
const window = {
  start: "2026-11-09T00:00:00.000Z",
  end: new Date(end).toISOString(),
};
const row = (id, at, overrides = {}) => ({
  id,
  keyword: "提示词工具价格",
  channel: "A",
  collected_at: at,
  first_seen_at: "2026-11-04T00:00:00Z",
  demand_index: id === "prior" ? 10 : 20,
  trend_dir: "up",
  normalized_hash: keywordHash("提示词工具价格"),
  normalization_version: normalizationVersion,
  raw_payload: { source_id: "public-tool:global:weekly:v1" },
  ...overrides,
});
const pair = () => [
  row("prior", "2026-11-04T00:00:00Z"),
  row("current", "2026-11-11T00:00:00Z"),
];

test("T11首见严格<14天且两完整周来源趋势up；同周重复、边界与缺项不凑上涨", async () => {
  const { findSurgeCandidates } = await import(
    "../../src/server/api/surge-alerts.mjs"
  );
  assert.equal(findSurgeCandidates(pair(), window, end).candidates.length, 1);
  for (const first_seen_at of ["2026-11-02T00:00:00Z", "2026-11-01T23:59:59Z"])
    assert.equal(
      findSurgeCandidates(
        pair().map((r) => ({ ...r, first_seen_at })),
        window,
        end,
      ).candidates.length,
      0,
    );
  const oneWeek = [
    row("one", "2026-11-10T00:00:00Z"),
    row("two", "2026-11-11T00:00:00Z"),
  ];
  assert.equal(findSurgeCandidates(oneWeek, window, end).candidates.length, 0);
  const latestFlat = [
    ...pair(),
    row("flat", "2026-11-12T00:00:00Z", { trend_dir: "flat" }),
  ];
  assert.equal(
    findSurgeCandidates(latestFlat, window, end).candidates.length,
    0,
  );
  const noTrend = pair().map((r) => ({ ...r, trend_dir: null }));
  assert.equal(findSurgeCandidates(noTrend, window, end).candidates.length, 0);
  const noSource = pair().map((r) => ({ ...r, raw_payload: {} }));
  const missing = findSurgeCandidates(noSource, window, end);
  assert.equal(missing.candidates.length, 0);
  assert.ok(missing.skipped.missing_source_identity);
});

test("T11不跨来源/渠道拼接趋势；冲突数值、同时间冲突与未索引历史不触发", async () => {
  const { findSurgeCandidates } = await import(
    "../../src/server/api/surge-alerts.mjs"
  );
  const changedSource = pair();
  changedSource[1].raw_payload.source_id = "another-tool";
  assert.equal(
    findSurgeCandidates(changedSource, window, end).candidates.length,
    0,
  );
  const changedChannel = pair();
  changedChannel[1].channel = "B";
  assert.equal(
    findSurgeCandidates(changedChannel, window, end).candidates.length,
    0,
  );
  const contradiction = pair();
  contradiction[1].demand_index = 5;
  assert.equal(
    findSurgeCandidates(contradiction, window, end).candidates.length,
    0,
  );
  const sameTimeConflict = [
    ...pair(),
    row("other", "2026-11-11T00:00:00Z", { trend_dir: "down" }),
  ];
  assert.equal(
    findSurgeCandidates(sameTimeConflict, window, end).candidates.length,
    0,
  );
  const unindexed = pair().map((r) => ({ ...r, normalized_hash: null }));
  assert.equal(
    findSurgeCandidates(unindexed, window, end).candidates.length,
    0,
  );
  const normalized = pair();
  normalized[0].keyword = "提示詞工具價格";
  assert.equal(
    findSurgeCandidates(normalized, window, end).candidates.length,
    1,
  );
});
