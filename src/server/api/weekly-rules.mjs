import { createHash } from "node:crypto";
import { normalizeKeyword } from "./keyword-normalization.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { validation } from "./errors.mjs";

// PROPOSAL ONLY. Deployment has no approval record; human review must freeze it.
export const weeklyRulesDraft = Object.freeze({
  version: "t10_rules_draft_v1",
  window_mode: "previous_complete_utc_week",
  source_aggregation: "latest_per_series_then_mean",
  fusion_mode: "source_percent_rank_uniform_available_channels",
  minimum_population: 2,
  minimum_c_tenants: 5,
  overlap_threshold: 0.5,
  channel_weights: { A: 0.3, B: 0.15, C: 0.3, D: 0.25 },
  intent_rules: [
    {
      type: "替代/否定",
      terms: ["替代", "平替", "alternative", "不值得", "智商税", "不推荐"],
    },
    {
      type: "排障",
      terms: [
        "报错",
        "故障",
        "失败",
        "没效果",
        "怎么办",
        "troubleshoot",
        "error",
      ],
    },
    {
      type: "价格",
      terms: ["多少钱", "价格", "费用", "收费", "price", "pricing", "cost"],
    },
    {
      type: "选型对比",
      terms: ["对比", "比较", "哪个好", "怎么选", "vs", "versus", "compare"],
    },
    {
      type: "场景方案",
      terms: ["怎么做", "如何", "方案", "用于", "适合", "解决", "how to"],
    },
    { type: "认知", terms: ["是什么", "什么是", "定义", "原理", "what is"] },
  ],
});
export const weeklyRuleDigest = (rules) =>
  createHash("sha256").update(canonicalJson(rules)).digest("hex");
export function requireFrozenWeeklyRules(record, now) {
  const rules = record?.rules,
    approval = record?.approval;
  if (
    !rules ||
    approval?.status !== "frozen" ||
    typeof approval.approved_by !== "string" ||
    !approval.approved_by.trim() ||
    !Number.isFinite(Date.parse(approval.approved_at)) ||
    Date.parse(approval.approved_at) > now ||
    approval.rules_digest !== weeklyRuleDigest(rules)
  )
    throw validation("T10规则尚未人审冻结，真实周批未启用", {
      reason: "weekly_rules_not_frozen",
    });
  const types = ["认知", "选型对比", "价格", "场景方案", "排障", "替代/否定"];
  if (
    typeof rules.version !== "string" ||
    !rules.version.trim() ||
    rules.window_mode !== "previous_complete_utc_week" ||
    rules.source_aggregation !== "latest_per_series_then_mean" ||
    rules.fusion_mode !== "source_percent_rank_uniform_available_channels" ||
    rules.minimum_population !== 2 ||
    rules.minimum_c_tenants !== 5 ||
    !Number.isFinite(rules.overlap_threshold) ||
    rules.overlap_threshold <= 0 ||
    rules.overlap_threshold > 1 ||
    !Array.isArray(rules.intent_rules) ||
    rules.intent_rules.length !== 6 ||
    new Set(rules.intent_rules.map((r) => r.type)).size !== 6 ||
    rules.intent_rules.some(
      (r) =>
        !types.includes(r.type) ||
        !Array.isArray(r.terms) ||
        !r.terms.length ||
        r.terms.some((s) => typeof s !== "string" || !s.trim()),
    ) ||
    Object.keys(rules.channel_weights ?? {})
      .sort()
      .join("") !== "ABCD" ||
    Object.values(rules.channel_weights).some(
      (v) => !Number.isFinite(v) || v <= 0,
    ) ||
    Math.abs(
      Object.values(rules.channel_weights).reduce((a, b) => a + b, 0) - 1,
    ) > 1e-12
  )
    throw validation("周批规则记录无效");
  return structuredClone(rules);
}
export function previousWeek(now) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  return {
    start: new Date(end.getTime() - 7 * 86400_000).toISOString(),
    end: end.toISOString(),
  };
}
export const publicClusterKey = (root, intent) =>
  JSON.stringify([root, intent]);
const contains = (word, term) => {
  let at = word.indexOf(term);
  while (at >= 0) {
    const left = word[at - 1] ?? "",
      right = word[at + term.length] ?? "";
    if (
      (!/^[a-z0-9]/.test(term) || !/[a-z0-9]/.test(left)) &&
      (!/[a-z0-9]$/.test(term) || !/[a-z0-9]/.test(right))
    )
      return true;
    at = word.indexOf(term, at + 1);
  }
  return false;
};
export function classifyWords(words, roots, rules) {
  const groups = new Map(),
    pending = [];
  const normalizedRoots = roots.map((root) => ({
    root,
    value: normalizeKeyword(root),
  }));
  for (const row of words) {
    const word = normalizeKeyword(row.keyword);
    const found = normalizedRoots.filter((r) => contains(word, r.value));
    const longest = Math.max(0, ...found.map((r) => r.value.length));
    const matches = found.filter((r) => r.value.length === longest);
    const intent = rules.intent_rules.find((r) =>
      r.terms.some((term) => contains(word, normalizeKeyword(term))),
    )?.type;
    if (matches.length !== 1 || !intent) {
      pending.push({
        brand_id: row.brand_id,
        members: [row],
        reason:
          matches.length > 1
            ? "root_ambiguous"
            : !matches.length
              ? "root_unmatched"
              : "intent_unmatched",
      });
      continue;
    }
    const root = matches[0].root;
    const key = canonicalJson([row.brand_id, root, intent]);
    if (!groups.has(key))
      groups.set(key, {
        brand_id: row.brand_id,
        root,
        intent_type: intent,
        public_cluster_key: publicClusterKey(root, intent),
        members: [],
        representatives: [],
      });
    const group = groups.get(key);
    group.members.push(row);
    if (!group.representatives.includes(word)) group.representatives.push(word);
  }
  return { groups: [...groups.values()], pending };
}
function jaccard(a, b) {
  const left = new Set(a),
    right = new Set(b),
    union = new Set([...a, ...b]);
  return union.size
    ? [...left].filter((s) => right.has(s)).length / union.size
    : 0;
}
export function matchClusters(groups, previous, rules) {
  const edges = groups.map((group) =>
    previous.filter(
      (old) =>
        old.status === "active" &&
        old.brand_id === group.brand_id &&
        old.intent_type === group.intent_type &&
        jaccard(group.representatives, old.representatives ?? []) >=
          rules.overlap_threshold,
    ),
  );
  const degree = new Map();
  for (const matches of edges)
    for (const old of matches)
      degree.set(old.id, (degree.get(old.id) ?? 0) + 1);
  const matched = [],
    pending = [];
  groups.forEach((group, i) => {
    const matches = edges[i];
    const sameKey = previous.filter(
      (old) =>
        old.brand_id === group.brand_id &&
        old.public_cluster_key === group.public_cluster_key,
    );
    if (matches.length === 1 && degree.get(matches[0].id) === 1)
      matched.push({ ...group, cluster_id: matches[0].id });
    else if (matches.length || sameKey.length)
      pending.push({
        ...group,
        reason:
          !matches.length && sameKey.every((old) => old.status === "archived")
            ? "archived_cluster"
            : "split_merge_review",
        old_cluster_ids: [
          ...new Set([...matches, ...sameKey].map((old) => old.id)),
        ],
      });
    else matched.push({ ...group, cluster_id: null });
  });
  return { matched, pending };
}
function percentile(value, population) {
  return population.length < 2
    ? null
    : population.filter((n) => n < value).length / (population.length - 1);
}
function sourceIndex(observation, window) {
  if (!Object.hasOwn(observation, "samples")) return observation.demand_index;
  if (
    observation.demand_index != null ||
    !Array.isArray(observation.samples) ||
    !observation.samples.length
  )
    throw validation("指数与数值时间序列只能选一种");
  const latest = new Map();
  for (const sample of observation.samples) {
    const at = Date.parse(sample?.collected_at);
    if (
      !sample ||
      Object.keys(sample).some(
        (k) => !["series_key", "collected_at", "demand_index"].includes(k),
      ) ||
      typeof sample.series_key !== "string" ||
      !/^[a-f0-9-]{16,64}$/.test(sample.series_key) ||
      typeof sample.collected_at !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(sample.collected_at) ||
      !Number.isFinite(at) ||
      new Date(at).toISOString().slice(0, 19) !== sample.collected_at.slice(0, 19) ||
      at < Date.parse(window.start) ||
      at >= Date.parse(window.end) ||
      !Number.isFinite(sample.demand_index)
    )
      throw validation("只接受窗口内的匿名公共数值序列，不接受原文");
    const old = latest.get(sample.series_key);
    if (
      old &&
      Date.parse(old.collected_at) === at &&
      old.demand_index !== sample.demand_index
    )
      throw validation("同一序列同一时点指数冲突");
    if (!old || Date.parse(old.collected_at) < at)
      latest.set(sample.series_key, sample);
  }
  return [...latest.values()].reduce(
    (sum, sample) => sum + sample.demand_index / latest.size,
    0,
  );
}
export function publicDemandMetrics(receipt, industry, window, catalog, rules) {
  if (
    !receipt ||
    receipt.industry !== industry ||
    receipt.complete !== true ||
    Object.keys(receipt).some(
      (k) =>
        ![
          "industry",
          "window_start",
          "window_end",
          "source_ref",
          "complete",
          "rows",
        ].includes(k),
    ) ||
    receipt.window_start !== window.start ||
    receipt.window_end !== window.end ||
    typeof receipt.source_ref !== "string" ||
    !receipt.source_ref.trim() ||
    !Array.isArray(receipt.rows) ||
    !receipt.rows.length
  )
    throw validation("缺少本行业同窗口的完整公共观测回执");
  receipt = structuredClone(receipt);
  const types = rules.intent_rules.map((r) => r.type),
    keys = new Set(),
    sourceNames = {};
  for (const row of receipt.rows) {
    if (
      !row ||
      Object.keys(row).some(
        (k) => !["root", "intent_type", "channels"].includes(k),
      ) ||
      !catalog.has(industry + "\0" + row.root) ||
      !types.includes(row.intent_type) ||
      !row.channels ||
      Array.isArray(row.channels) ||
      Object.keys(row.channels).some((c) => !["A", "B", "C", "D"].includes(c))
    )
      throw validation("行业回执只允许许可公共词根、六类意图及数值信号");
    const key = publicClusterKey(row.root, row.intent_type);
    if (keys.has(key)) throw validation("公共簇键重复");
    keys.add(key);
    for (const [channel, observation] of Object.entries(row.channels)) {
      if (observation == null) continue;
      if (
        Object.keys(observation).some(
          (k) =>
            !["source", "demand_index", "tenant_count", "samples"].includes(k),
        ) ||
        typeof observation.source !== "string" ||
        !observation.source.trim() ||
        (observation.demand_index != null &&
          !Number.isFinite(observation.demand_index)) ||
        (channel === "C" &&
          (!Number.isSafeInteger(observation.tenant_count) ||
            observation.tenant_count < 5))
      )
        throw validation("公共指数口径无效；C聚合必须至少5租户，不能携带原文");
      if (sourceNames[channel] && sourceNames[channel] !== observation.source)
        throw validation("同一渠道不能混排不同工具或平台的指数");
      sourceNames[channel] = observation.source;
      observation.demand_index = sourceIndex(observation, window);
    }
  }
  const populations = Object.fromEntries(
    ["A", "B", "C", "D"].map((c) => [
      c,
      receipt.rows
        .map((r) => r.channels[c]?.demand_index)
        .filter((v) => typeof v === "number" && Number.isFinite(v)),
    ]),
  );
  // Every cluster in this publication uses exactly the same source coverage.
  // A partly populated source is excluded globally, never zero-filled per row.
  const channels = ["A", "B", "C", "D"].filter(
    (c) =>
      populations[c].length >= rules.minimum_population &&
      populations[c].length === receipt.rows.length,
  );
  const totalWeight = channels.reduce(
    (sum, c) => sum + rules.channel_weights[c],
    0,
  );
  const coverage = {
    channels,
    weights: Object.fromEntries(
      channels.map((c) => [c, rules.channel_weights[c] / totalWeight]),
    ),
    source_fingerprints: Object.fromEntries(
      channels.map((c) => [
        c,
        createHash("sha256").update(sourceNames[c]).digest("hex"),
      ]),
    ),
    partial: channels.length !== 4,
  };
  const source_coverage = { ...coverage, digest: weeklyRuleDigest(coverage) };
  const metrics = receipt.rows.map((row) => {
    const channel_percentiles = Object.fromEntries(
      ["A", "B", "C", "D"].map((channel) => {
        const index = row.channels[channel]?.demand_index;
        return [
          channel,
          channels.includes(channel)
            ? percentile(index, populations[channel])
            : null,
        ];
      }),
    );
    const missing_channels = Object.keys(channel_percentiles).filter(
      (c) => channel_percentiles[c] === null,
    );
    return {
      root: row.root,
      intent_type: row.intent_type,
      public_cluster_key: publicClusterKey(row.root, row.intent_type),
      channel_percentiles,
      missing_channels,
      source_coverage,
      demand_score: !channels.length
        ? null
        : Object.entries(coverage.weights).reduce(
            (sum, [c, w]) => sum + w * channel_percentiles[c],
            0,
          ),
    };
  });
  const overall = metrics.map((m) => m.demand_score).filter((v) => v !== null);
  return metrics.map((m) => {
    const rank =
      m.demand_score === null ? null : percentile(m.demand_score, overall);
    return {
      ...m,
      percentile: rank,
      demand_tier:
        rank === null
          ? null
          : rank >= 0.9
            ? "S"
            : rank >= 0.75
              ? "A"
              : rank >= 0.5
                ? "B"
                : "C",
    };
  });
}
