import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import {
  requireFrozenWeeklyRules,
  weeklyRuleDigest,
  previousWeek,
  classifyWords,
  matchClusters,
  publicDemandMetrics,
} from "./weekly-rules.mjs";
import { normalizeKeyword } from "./keyword-normalization.mjs";
import { assertPublicRoot, privateMarkers } from "./shared-industry.mjs";
import { conflict, event, json, required } from "./domain-common.mjs";
import { permission, validation } from "./errors.mjs";
import { assignmentPredicate } from "./assignment-scope.mjs";

const digest = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const numeric = (value) => (value == null ? null : Number(value));

// Private support projections follow the same cluster/card/source assignments.
// Reject mixed-scope candidate rows rather than revealing unrelated member IDs.
export function weeklyPrivatePredicate(runs) {
  const allowed = (cluster, source) =>
    assignmentPredicate({
      tenant: "p.tenant_id",
      cluster,
      source,
      user: "$3",
    });
  if (runs)
    return `EXISTS(
    SELECT 1 FROM weekly_cluster_snapshot s CROSS JOIN LATERAL unnest(s.representative_word_ids) m(word_id)
    WHERE s.tenant_id=p.tenant_id AND s.industry=p.industry AND s.pool_version=p.pool_version
    AND ${allowed("s.cluster_id", "m.word_id")})`;
  const allOld = `NOT EXISTS(SELECT 1 FROM unnest(p.old_cluster_ids) c(cluster_id)
    WHERE NOT ${allowed("c.cluster_id", "NULL::text")})`;
  const allSources = `cardinality(p.source_word_ids)>0 AND NOT EXISTS(
    SELECT 1 FROM unnest(p.source_word_ids) m(word_id) WHERE NOT EXISTS(
      SELECT 1 FROM (
        SELECT NULL::text AS cluster_id
        UNION SELECT s.cluster_id FROM weekly_cluster_snapshot s WHERE s.tenant_id=p.tenant_id AND m.word_id=ANY(s.representative_word_ids)
        UNION SELECT q.cluster_id FROM question_pool q WHERE q.tenant_id=p.tenant_id AND q.source_word_id=m.word_id
      ) related WHERE ${allowed("related.cluster_id", "m.word_id")}))`;
  return `${allOld} AND (cardinality(p.old_cluster_ids)>0 OR (${allSources}))`;
}

async function publicPublication(ctx, industry, window, rules) {
  const existing = (
    await ctx.client.query(
      "SELECT * FROM weekly_pool_publication WHERE industry=$1 AND window_start=$2 AND window_end=$3 AND policy_version=$4",
      [industry, window.start, window.end, rules.version],
    )
  ).rows[0];
  const seedVersion =
    existing?.seed_version ??
    Number(
      (
        await ctx.client.query(
          "SELECT coalesce(max(seed_version),0) AS v FROM seed_list WHERE industry=$1",
          [industry],
        )
      ).rows[0].v,
    );
  if (!seedVersion) throw validation("行业没有已启用的公共种子");
  // Reconstruct the publication's seed version instead of silently taking newer edits.
  const seeds = (
    await ctx.client.query(
      `SELECT s.* FROM seed_list s WHERE s.industry=$1 AND s.seed_version<=$2 AND s.status='active'
     AND NOT EXISTS(SELECT 1 FROM seed_list n WHERE n.previous_id=s.id AND n.seed_version<=$2)`,
      [industry, seedVersion],
    )
  ).rows;
  const markers = await privateMarkers(ctx.client),
    roots = [];
  for (const seed of seeds) {
    assertPublicRoot(seed, ctx.publicRootCatalog, markers);
    if (!roots.includes(seed.word)) roots.push(seed.word);
  }
  if (!roots.length) throw validation("行业没有已启用的公共种子");
  const receipt = await ctx.loadIndustryPopulation({
    industry,
    window,
    policy_version: rules.version,
  });
  const metrics = publicDemandMetrics(
    receipt,
    industry,
    window,
    ctx.publicRootCatalog,
    rules,
  );
  for (const metric of metrics)
    if (!roots.includes(metric.root))
      throw validation("公共回执包含该种子版本未启用的词根");
  const sourceDigest = digest(receipt);
  if (existing) {
    if (
      existing.source_digest !== sourceDigest ||
      existing.policy_digest !== weeklyRuleDigest(rules)
    )
      throw conflict("同周公共观测已封版，不能覆盖；需人工审查口径变更");
    return { publication: existing, roots, metrics, receipt };
  }
  const poolVersion = Number(
    (
      await ctx.client.query(
        "SELECT coalesce(max(pool_version),0)+1 AS v FROM keyword_pool_snapshot WHERE industry=$1",
        [industry],
      )
    ).rows[0].v,
  );
  const counts = Object.fromEntries(
    ["A", "B", "C", "D"].map((c) => [
      c,
      receipt.rows.filter(
        (r) =>
          r.channels[c]?.demand_index != null || r.channels[c]?.samples?.length,
      ).length,
    ]),
  );
  await ctx.client.query(
    "INSERT INTO keyword_pool_snapshot(industry,pool_version,created_at,seed_version,counts_by_channel,cluster_count) VALUES($1,$2,$3,$4,$5,$6)",
    [
      industry,
      poolVersion,
      new Date(ctx.now()).toISOString(),
      seedVersion,
      json(counts),
      metrics.length,
    ],
  );
  event(
    ctx,
    "keyword_pool_snapshot.append",
    "keyword_pool_snapshot",
    industry + ":" + poolVersion,
    { cause_event_id: ctx.rootEventId },
  );
  const id = randomUUID();
  const publication = (
    await ctx.client.query(
      `INSERT INTO weekly_pool_publication(id,industry,pool_version,window_start,window_end,policy_version,policy_digest,source_digest,seed_version,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        industry,
        poolVersion,
        window.start,
        window.end,
        rules.version,
        weeklyRuleDigest(rules),
        sourceDigest,
        seedVersion,
        new Date(ctx.now()).toISOString(),
      ],
    )
  ).rows[0];
  for (const metric of metrics) {
    await ctx.client.query(
      `INSERT INTO weekly_public_metric(industry,pool_version,public_cluster_key,root,intent_type,demand_score,percentile,demand_tier,channel_percentiles,source_coverage)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        industry,
        poolVersion,
        metric.public_cluster_key,
        metric.root,
        metric.intent_type,
        metric.demand_score,
        metric.percentile,
        metric.demand_tier,
        json(metric.channel_percentiles),
        json(metric.source_coverage),
      ],
    );
    event(
      ctx,
      "weekly_public_metric.append",
      "weekly_public_metric",
      industry + ":" + poolVersion + ":" + metric.public_cluster_key,
      { cause_event_id: ctx.rootEventId },
    );
    if (metric.percentile !== null) {
      await ctx.client.query(
        `INSERT INTO w_pool_percentile(industry,pool_version,public_cluster_key,demand_index,percentile,producer,basis_note,computed_at)
         VALUES($1,$2,$3,$4,$5,'weekly_batch',$6,$7)`,
        [
          industry,
          poolVersion,
          metric.public_cluster_key,
          metric.demand_score,
          metric.percentile,
          id,
          new Date(ctx.now()).toISOString(),
        ],
      );
      event(
        ctx,
        "w_pool_percentile.append",
        "w_pool_percentile",
        industry + ":" + poolVersion + ":" + metric.public_cluster_key,
        { cause_event_id: ctx.rootEventId },
      );
    }
  }
  event(ctx, "weekly_pool_publication.append", "weekly_pool_publication", id, {
    cause_event_id: ctx.rootEventId,
  });
  return { publication, roots, metrics, receipt };
}

async function priorClusters(ctx, industry) {
  const rows = (
    await ctx.client.query(
      `SELECT c.id,c.brand_id,c.intent_type,c.status,s.public_cluster_key,s.representative_word_ids
     FROM intent_cluster c JOIN brand b ON b.tenant_id=c.tenant_id AND b.id=c.brand_id
     JOIN LATERAL (SELECT * FROM weekly_cluster_snapshot s WHERE s.tenant_id=c.tenant_id AND s.cluster_id=c.id ORDER BY s.pool_version DESC LIMIT 1) s ON true
     WHERE c.tenant_id=$1 AND b.industry=$2 ORDER BY c.id`,
      [ctx.principal.tenant_id, industry],
    )
  ).rows;
  for (const row of rows) {
    const words = (
      await ctx.client.query(
        "SELECT id,keyword,channel FROM keyword_raw WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id",
        [ctx.principal.tenant_id, row.representative_word_ids],
      )
    ).rows;
    for (const word of words)
      if (word.channel === "C")
        event(ctx, "keyword_raw.weekly_read", "keyword_raw", word.id, {
          cause_event_id: ctx.rootEventId,
        });
    row.representatives = [
      ...new Set(words.map((word) => normalizeKeyword(word.keyword))),
    ];
  }
  return rows;
}

export async function appendWeeklyPool(ctx) {
  if (
    ctx.principal.actor_type !== "system" ||
    ctx.principal.job_name !== "weekly_pool"
  )
    throw permission("weekly_pool system credential required");
  // This record only comes from trusted server configuration, never ctx.body.
  const policyRecord = await ctx.loadWeeklyPolicy();
  const rules = requireFrozenWeeklyRules(policyRecord, ctx.now());
  required(ctx.body, ["industry"]);
  const industry = ctx.body.industry;
  if (typeof industry !== "string") throw validation("行业字段无效");
  const window = previousWeek(ctx.now());
  await ctx.client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    ["pool:" + industry],
  );
  const { publication, roots, metrics, receipt } = await publicPublication(
    ctx,
    industry,
    window,
    rules,
  );
  const brands = (
    await ctx.client.query(
      "SELECT id FROM brand WHERE tenant_id=$1 AND industry=$2 ORDER BY id",
      [ctx.principal.tenant_id, industry],
    )
  ).rows;
  const words = (
    await ctx.client.query(
      `SELECT id,keyword,channel,collected_at FROM keyword_raw
     WHERE tenant_id=$1 AND industry=$2 AND collected_at>=$3 AND collected_at<$4
     AND (channel<>'C' OR (authorization_ref IS NOT NULL AND redaction_policy_version IS NOT NULL))
     ORDER BY id`,
      [ctx.principal.tenant_id, industry, window.start, window.end],
    )
  ).rows;
  for (const word of words)
    if (word.channel === "C")
      event(ctx, "keyword_raw.weekly_read", "keyword_raw", word.id, {
        cause_event_id: ctx.rootEventId,
      });
  const inputDigest = digest({
    brands,
    words: words.map((row) => ({
      ...row,
      collected_at: new Date(row.collected_at).toISOString(),
    })),
  });
  const existing = (
    await ctx.client.query(
      "SELECT * FROM weekly_pool_run WHERE tenant_id=$1 AND industry=$2 AND window_start=$3 AND window_end=$4 AND policy_version=$5",
      [
        ctx.principal.tenant_id,
        industry,
        window.start,
        window.end,
        rules.version,
      ],
    )
  ).rows[0];
  if (existing) {
    if (
      existing.source_digest !== publication.source_digest ||
      existing.input_digest !== inputDigest
    )
      throw conflict("同周已完成产物的输入发生变化，不能覆盖");
    return {
      data: { ...existing.result, replayed: true },
      objectId: existing.id,
      auditMeta: {
        action: "weekly_pool.replay",
        object_type: "weekly_pool_run",
      },
    };
  }
  const privateWords = brands.flatMap((brand) =>
    words
      .filter((word) => word.channel !== "C" || brands.length === 1)
      .map((word) => ({ ...word, brand_id: brand.id })),
  );
  const classified = classifyWords(privateWords, roots, rules);
  const planned = matchClusters(
    classified.groups,
    await priorClusters(ctx, industry),
    rules,
  );
  const pending = [
    ...classified.pending,
    ...planned.pending,
    ...words
      .filter((word) => word.channel === "C" && brands.length !== 1)
      .map((word) => ({
        brand_id: null,
        members: [word],
        reason: "c_brand_unassigned",
      })),
  ];
  const clusters = [];
  let created = 0,
    updated = 0;
  for (const group of planned.matched) {
    const row = await ctx.runJob(
      "weekly_pool",
      "intent_cluster.transition",
      {
        brand_id: group.brand_id,
        name: group.root + " · " + group.intent_type,
        intent_type: group.intent_type,
        pool_version: publication.pool_version,
        representative_word_ids: group.members.map((r) => r.id),
        cause_event_id: ctx.rootEventId,
      },
      group.cluster_id ? { id: group.cluster_id } : {},
    );
    if (group.cluster_id) updated++;
    else created++;
    const metric = metrics.find(
      (m) => m.public_cluster_key === group.public_cluster_key,
    );
    const counts = Object.fromEntries(
      ["A", "B", "C", "D"].map((c) => [
        c,
        group.members.filter((m) => m.channel === c).length,
      ]),
    );
    await ctx.client.query(
      `INSERT INTO weekly_cluster_snapshot(tenant_id,cluster_id,industry,pool_version,public_cluster_key,representative_word_ids,channel_counts,demand_score,percentile,demand_tier,source_coverage,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ctx.principal.tenant_id,
        row.id,
        industry,
        publication.pool_version,
        group.public_cluster_key,
        [...new Set(group.members.map((m) => m.id))],
        json(counts),
        metric?.demand_score ?? null,
        metric?.percentile ?? null,
        metric?.demand_tier ?? null,
        metric ? json(metric.source_coverage) : null,
        new Date(ctx.now()).toISOString(),
      ],
    );
    event(
      ctx,
      "weekly_cluster_snapshot.append",
      "weekly_cluster_snapshot",
      row.id + ":" + publication.pool_version,
      { cause_event_id: ctx.rootEventId },
    );
    if (clusters.length < 20)
      clusters.push({
        id: row.id,
        brand_id: row.brand_id,
        demand_tier: metric?.demand_tier ?? null,
      });
  }
  for (const candidate of pending) {
    const id = randomUUID();
    await ctx.client.query(
      `INSERT INTO weekly_pool_candidate(id,tenant_id,brand_id,industry,pool_version,reason,source_word_ids,old_cluster_ids,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        ctx.principal.tenant_id,
        candidate.brand_id,
        industry,
        publication.pool_version,
        candidate.reason,
        [...new Set(candidate.members.map((m) => m.id))],
        candidate.old_cluster_ids ?? [],
        new Date(ctx.now()).toISOString(),
      ],
    );
    event(ctx, "weekly_pool_candidate.append", "weekly_pool_candidate", id, {
      cause_event_id: ctx.rootEventId,
    });
  }
  const id = randomUUID();
  const data = {
    id,
    industry,
    pool_version: publication.pool_version,
    seed_version: publication.seed_version,
    policy_version: rules.version,
    window_start: window.start,
    window_end: window.end,
    created_count: created,
    updated_count: updated,
    pending_count: pending.length,
    clusters,
    truncated: created + updated > clusters.length,
    replayed: false,
  };
  while (Buffer.byteLength(JSON.stringify(data)) > 18000 && clusters.length) {
    clusters.pop();
    data.truncated = true;
  }
  await ctx.client.query(
    `INSERT INTO weekly_pool_run(id,tenant_id,industry,pool_version,window_start,window_end,policy_version,policy_digest,policy_record,source_digest,input_digest,source_ref,source_receipt,result,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      ctx.principal.tenant_id,
      industry,
      publication.pool_version,
      window.start,
      window.end,
      rules.version,
      weeklyRuleDigest(rules),
      json(policyRecord),
      publication.source_digest,
      inputDigest,
      receipt.source_ref,
      json(receipt),
      json(data),
      new Date(ctx.now()).toISOString(),
    ],
  );
  return { data, objectId: id, auditMeta: { object_type: "weekly_pool_run" } };
}

export async function clusterDemand(ctx, clusterId, poolVersion) {
  const row = (
    await ctx.client.query(
      "SELECT industry,pool_version,public_cluster_key,channel_counts,demand_score,percentile,demand_tier,source_coverage FROM weekly_cluster_snapshot WHERE tenant_id=$1 AND cluster_id=$2 AND pool_version=$3",
      [ctx.principal.tenant_id, clusterId, poolVersion],
    )
  ).rows[0];
  return row
    ? {
        ...row,
        demand_score: numeric(row.demand_score),
        percentile: numeric(row.percentile),
      }
    : null;
}
