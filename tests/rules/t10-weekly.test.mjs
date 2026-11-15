import { test } from "node:test";
import assert from "node:assert/strict";

test("T10草案：UTC上一完整周、规则打标/无命中待确认、稳定ID只作唯一一对一匹配", async () => {
  const { previousWeek, classifyWords, matchClusters, weeklyRulesDraft } =
    await import("../../src/server/api/weekly-rules.mjs");
  assert.deepEqual(previousWeek(Date.parse("2026-11-10T12:00:00Z")), {
    start: "2026-11-02T00:00:00.000Z",
    end: "2026-11-09T00:00:00.000Z",
  });
  const result = classifyWords(
    [
      { id: "k1", keyword: "ERP多少钱", brand_id: "b" },
      { id: "k2", keyword: "erp价格", brand_id: "b" },
      { id: "k3", keyword: "ERP", brand_id: "b" },
      { id: "k4", keyword: "serp多少钱", brand_id: "b" },
    ],
    ["erp"],
    weeklyRulesDraft,
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].intent_type, "价格");
  assert.equal(result.groups[0].members.length, 2);
  assert.deepEqual(result.pending.map((row) => row.reason).sort(), [
    "intent_unmatched",
    "root_unmatched",
  ]);
  const group = result.groups[0];
  const old = {
    ...group,
    id: "old",
    status: "active",
    representatives: ["erp多少钱", "erp价格", "erp费用"],
  };
  assert.equal(
    matchClusters([group], [old], weeklyRulesDraft).matched[0].cluster_id,
    "old",
  );
  assert.equal(
    matchClusters([group], [old, { ...old, id: "other" }], weeklyRulesDraft)
      .pending[0].reason,
    "split_merge_review",
  );
  assert.equal(
    matchClusters([group], [{ ...old, status: "archived" }], weeklyRulesDraft)
      .pending[0].reason,
    "archived_cluster",
  );
});

test("T10草案：源内分位后按统一覆盖加权；缺源不填0，C聚合少于5租户拒绝", async () => {
  const { publicDemandMetrics, previousWeek, weeklyRulesDraft } = await import(
    "../../src/server/api/weekly-rules.mjs"
  );
  const window = previousWeek(Date.parse("2026-11-10T12:00:00Z"));
  const receipt = {
    industry: "B2B",
    window_start: window.start,
    window_end: window.end,
    source_ref: "public-weekly-fixture",
    complete: true,
    rows: [1, 2, 3, 4].map((i) => ({
      root: "公开词根" + i,
      intent_type: "价格",
      channels: Object.fromEntries(
        ["A", "B", "C", "D"].map((channel) => [
          channel,
          {
            source: "public-" + channel,
            demand_index: i * 10,
            ...(channel === "C" ? { tenant_count: 5 } : {}),
          },
        ]),
      ),
    })),
  };
  const catalog = new Set(receipt.rows.map((r) => "B2B\0" + r.root));
  const metrics = publicDemandMetrics(
    receipt,
    "B2B",
    window,
    catalog,
    weeklyRulesDraft,
  );
  assert.equal(metrics[0].percentile, 0);
  assert.equal(metrics[3].percentile, 1);
  assert.equal(metrics[3].demand_tier, "S");
  const missing = structuredClone(receipt);
  delete missing.rows[0].channels.C;
  const incomplete = publicDemandMetrics(
    missing,
    "B2B",
    window,
    catalog,
    weeklyRulesDraft,
  );
  assert.equal(incomplete[0].channel_percentiles.C, null);
  assert.equal(incomplete[3].channel_percentiles.C, null);
  assert.deepEqual(incomplete[0].source_coverage.channels, ["A", "B", "D"]);
  assert.equal(incomplete[0].source_coverage.partial, true);
  assert.equal(incomplete[0].demand_score, 0);
  assert.ok(
    incomplete.every(
      (row) =>
        row.source_coverage.digest === incomplete[0].source_coverage.digest,
    ),
  );
  assert.deepEqual(incomplete[0].missing_channels, ["C"]);
  const noSignals = structuredClone(receipt);
  for (const row of noSignals.rows) row.channels = {};
  assert.ok(
    publicDemandMetrics(
      noSignals,
      "B2B",
      window,
      catalog,
      weeklyRulesDraft,
    ).every((row) => row.demand_score === null && row.demand_tier === null),
  );
  const privateC = structuredClone(receipt);
  privateC.rows[0].channels.C.tenant_count = 1;
  assert.throws(() =>
    publicDemandMetrics(privateC, "B2B", window, catalog, weeklyRulesDraft),
  );
  const badSource = structuredClone(receipt);
  badSource.rows[0].channels.A.source = "different-source";
  assert.throws(() =>
    publicDemandMetrics(badSource, "B2B", window, catalog, weeklyRulesDraft),
  );
  const series = structuredClone(receipt);
  delete series.rows[0].channels.A.demand_index;
  series.rows[0].channels.A.samples = [
    {
      series_key: "a".repeat(32),
      collected_at: "2026-11-02T01:00:00Z",
      demand_index: 0,
    },
    {
      series_key: "a".repeat(32),
      collected_at: "2026-11-06T01:00:00Z",
      demand_index: 90,
    },
    {
      series_key: "b".repeat(32),
      collected_at: "2026-11-04T01:00:00Z",
      demand_index: 10,
    },
  ];
  assert.equal(
    publicDemandMetrics(series, "B2B", window, catalog, weeklyRulesDraft)[0]
      .channel_percentiles.A,
    1,
  );
  series.rows[0].channels.A.samples[0].collected_at = "2026-11-01T00:00:00Z";
  assert.throws(() =>
    publicDemandMetrics(series, "B2B", window, catalog, weeklyRulesDraft),
  );
  series.rows[0].channels.A.samples[0].collected_at = "2026-11-04Z";
  assert.throws(() => publicDemandMetrics(series, "B2B", window, catalog, weeklyRulesDraft));
});
