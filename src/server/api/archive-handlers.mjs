import { readArchivePercentile } from "./industry-percentiles.mjs";
import { pageQuery } from "./pagination.mjs";
import { randomUUID, createHash } from "node:crypto";
import {
  required,
  insertRow,
  getRow,
  change,
  event,
  json,
  conflict,
} from "./domain-common.mjs";
import { permission, validation, ServiceError } from "./errors.mjs";

export function archiveHandlers() {
  return {
    "industry_score.revise": async (ctx) => {
      required(ctx.body, ["industry"]);
      if (
        ![...ctx.publicRootCatalog].some((key) =>
          key.startsWith(ctx.body.industry + "\0"),
        )
      )
        throw validation("unlicensed shared industry");
      if (
        ctx.body.c_delete_threshold != null &&
        (!Number.isFinite(ctx.body.c_delete_threshold) ||
          ctx.body.c_delete_threshold < 0)
      )
        throw validation("monthly threshold must be nonnegative or NULL");
      await ctx.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["industry:" + ctx.body.industry],
      );
      const version = Number(
        (
          await ctx.client.query(
            "SELECT coalesce(max(version),0)+1 AS v FROM industry_score WHERE industry=$1",
            [ctx.body.industry],
          )
        ).rows[0].v,
      );
      const row = (
        await ctx.client.query(
          "INSERT INTO industry_score(industry,version,demand,gap,willingness,competition,score,updated_by,c_delete_threshold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING industry,version,c_delete_threshold",
          [
            ctx.body.industry,
            version,
            ctx.body.demand ?? null,
            ctx.body.gap ?? null,
            ctx.body.willingness ?? null,
            ctx.body.competition ?? null,
            ctx.body.score ?? null,
            ctx.principal.user_id,
            ctx.body.c_delete_threshold ?? null,
          ],
        )
      ).rows[0];
      return { data: row, objectId: row.industry + ":" + version };
    },
    "industry_score.read": async (ctx) => ({
      data: await pageQuery(ctx, {
        table: "industry_score",
        columns:
          "industry,version,demand,gap,willingness,competition,score,c_delete_threshold,updated_at",
        where: "industry=$1",
        values: [ctx.query.industry ?? "B2B"],
        order: [["version", "DESC"]],
      }),
    }),
    "intent_cluster.archive": async (ctx) => {
      required(ctx.body, ["reason"]);
      const cluster = await getRow(ctx, "intent_cluster", ctx.params.id, {
        lock: true,
      });
      if (cluster.status !== "active")
        throw conflict("only active cluster can archive");
      if (ctx.body.prepare_evidence === true) {
        required(ctx.body, ["statistics_window", "channel_scope"]);
        const proof = await evaluateArchive(
          ctx,
          cluster,
          ctx.body.statistics_window,
          ctx.body.channel_scope,
        );
        const id = randomUUID(),
          auditId = randomUUID();
        const row = await insertRow(ctx, "archive_review_evidence", {
          id,
          tenant_id: ctx.principal.tenant_id,
          brand_id: cluster.brand_id,
          cluster_id: cluster.id,
          requested_by: ctx.principal.user_id,
          created_at: new Date(ctx.now()).toISOString(),
          status: "manual_review_required",
          condition1_met: proof.condition1_met,
          condition1_status: proof.condition1_status,
          condition2_met: proof.condition2_met,
          condition3_met: proof.condition3_met,
          source_word_percentiles: json(proof.source_word_percentiles),
          probe_batch_id: proof.probe_batch_id,
          b_source_excerpts: json(proof.b_source_excerpts),
          statistics_window: json(ctx.body.statistics_window),
          channel_scope: ctx.body.channel_scope,
          observed_count: proof.observed_count,
          industry_threshold: proof.industry_threshold,
          threshold_version: proof.threshold_version,
          audit_event_id: auditId,
          digest: proof.digest,
        });
        event(
          ctx,
          "intent_cluster.archive_evidence",
          "intent_cluster",
          cluster.id,
          { id: auditId },
        );
        if (
          proof.condition1_met &&
          proof.condition2_met &&
          proof.condition3_met === true
        )
          await ctx.runJob("backflow_scan", "backflow_ticket.create", {
            signal_type: "no_demand",
            cluster_id: cluster.id,
            archive_evidence_id: id,
            cause_event_id: auditId,
          });
        return {
          data: {
            id: cluster.id,
            status: cluster.status,
            archive_evidence: publicProof(row),
            can_archive:
              proof.condition1_met &&
              proof.condition2_met &&
              (proof.industry_threshold == null ||
                proof.condition3_met === true),
          },
        };
      }
      required(ctx.body, ["archive_evidence_id"]);
      if (ctx.body.manual_confirmation !== true)
        throw validation("explicit strategist human confirmation required");
      const evidence = await getRow(
        ctx,
        "archive_review_evidence",
        ctx.body.archive_evidence_id,
      );
      if (evidence.cluster_id !== cluster.id)
        throw permission("evidence outside requested cluster");
      const proof = await evaluateArchive(
        ctx,
        cluster,
        evidence.statistics_window,
        evidence.channel_scope,
      );
      if (proof.condition1_status === "data_pending")
        throw new ServiceError(
          422,
          "data_pending",
          "manual gate not met: industry percentile data pending",
          { condition1_status: "data_pending" },
        );
      if (evidence.digest !== proof.digest)
        throw conflict("archive evidence changed; regenerate package");
      if (
        !proof.condition1_met ||
        !proof.condition2_met ||
        (proof.industry_threshold != null && proof.condition3_met !== true)
      )
        throw validation("machine conditions not met");
      const row = await change(ctx, "intent_cluster", cluster.id, {
        status: "archived",
        archived_at: new Date(ctx.now()).toISOString(),
        archive_reason: ctx.body.reason,
      });
      return {
        data: row,
        auditMeta: { cause_event_id: evidence.audit_event_id },
      };
    },
    "backflow_ticket.create": async (ctx) => {
      required(ctx.body, ["signal_type", "cluster_id", "archive_evidence_id"]);
      if (ctx.body.signal_type !== "no_demand")
        throw validation("only assessed archive advice is implemented here");
      const evidence = await getRow(
          ctx,
          "archive_review_evidence",
          ctx.body.archive_evidence_id,
        ),
        cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id);
      if (
        evidence.cluster_id !== cluster.id ||
        !evidence.condition1_met ||
        !evidence.condition2_met ||
        evidence.condition3_met !== true
      )
        throw validation("three machine conditions required for suggestion");
      const existing = (
        await ctx.client.query(
          "SELECT id,status FROM backflow_ticket WHERE tenant_id=$1 AND archive_evidence_id=$2",
          [ctx.principal.tenant_id, evidence.id],
        )
      ).rows[0];
      if (existing) return { data: existing };
      const probes = (
        await ctx.client.query(
          "SELECT id FROM probe WHERE tenant_id=$1 AND batch_id=$2 AND intent_cluster_id=$3",
          [ctx.principal.tenant_id, evidence.probe_batch_id, cluster.id],
        )
      ).rows;
      const row = await insertRow(ctx, "backflow_ticket", {
        id: randomUUID(),
        tenant_id: ctx.principal.tenant_id,
        brand_id: cluster.brand_id,
        signal_type: "no_demand",
        cluster_id: cluster.id,
        evidence_probe_ids: probes.map((p) => p.id),
        severity: "normal",
        owner_role: "strategist",
        status: "open",
        deadline_at: null,
        archive_evidence_id: evidence.id,
      });
      return {
        data: { id: row.id, status: "open", signal_type: "no_demand" },
        auditMeta: { cause_event_id: ctx.body.cause_event_id },
      };
    },
    "backflow_ticket.read": async (ctx) => ({
      data: await getRow(ctx, "backflow_ticket", ctx.params.id),
    }),
  };
}
async function evaluateArchive(ctx, cluster, window, channelScope) {
  required(window, ["from", "to"]);
  const from = Date.parse(window.from),
    to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw validation("statistics window invalid");
  const brand = await getRow(ctx, "brand", cluster.brand_id),
    tid = ctx.principal.tenant_id;
  const demand = await readArchivePercentile(ctx, cluster, brand.industry);
  const sourceIds = (
    await ctx.client.query(
      "SELECT DISTINCT source_word_id FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 ORDER BY source_word_id",
      [tid, cluster.id, cluster.question_pool_version],
    )
  ).rows.map((r) => r.source_word_id);
  const sourcePercentiles = demand.rows;
  const condition1 = demand.met;
  const batch = (
    await ctx.client.query(
      "SELECT b.id FROM probe_batch b JOIN probe p ON p.tenant_id=b.tenant_id AND p.batch_id=b.id WHERE b.tenant_id=$1 AND p.intent_cluster_id=$2 AND b.status='completed' ORDER BY b.finished_at DESC,b.created_at DESC LIMIT 1",
      [tid, cluster.id],
    )
  ).rows[0];
  if (!batch) throw validation("completed probe evidence required");
  const probeLabels = (
    await ctx.client.query(
      "SELECT p.id,r.refused,r.generic_i FROM probe p JOIN probe_result r ON r.tenant_id=p.tenant_id AND r.probe_id=p.id WHERE p.tenant_id=$1 AND p.intent_cluster_id=$2 AND p.batch_id=$3",
      [tid, cluster.id, batch.id],
    )
  ).rows;
  const condition2 =
    probeLabels.length > 0 &&
    probeLabels.every(
      (r) => r.refused || (Number(r.generic_i) === 1 && r.generic_i != null),
    );
  const sources = (
    await ctx.client.query(
      "SELECT id,raw_payload FROM keyword_raw WHERE tenant_id=$1 AND id=ANY($2::text[]) AND channel='B' ORDER BY id",
      [tid, sourceIds],
    )
  ).rows;
  if (sources.length !== sourceIds.length || !sources.length)
    throw validation("complete B-class source excerpts required");
  const excerpts = sources.map((s) => {
    const p = s.raw_payload;
    required(p ?? {}, [
      "url",
      "excerpt",
      "observed_count",
      "statistics_window",
      "channel_scope",
    ]);
    if (
      !Number.isFinite(p.observed_count) ||
      p.observed_count < 0 ||
      p.statistics_window.from !== window.from ||
      p.statistics_window.to !== window.to ||
      p.channel_scope !== channelScope
    )
      throw validation("B evidence window/channel/count incomplete");
    return {
      source_word_id: s.id,
      source_url: p.url,
      excerpt: p.excerpt,
      observed_count: p.observed_count,
    };
  });
  const config = (
    await ctx.client.query(
      "SELECT version,c_delete_threshold FROM industry_score WHERE industry=$1 ORDER BY version DESC LIMIT 1",
      [brand.industry],
    )
  ).rows[0];
  const threshold =
      config?.c_delete_threshold == null
        ? null
        : Number(config.c_delete_threshold),
    count = excerpts.reduce((sum, s) => sum + s.observed_count, 0);
  const proof = {
    condition1_met: condition1,
    condition1_status: demand.status,
    condition2_met: condition2,
    condition3_met: threshold == null ? null : count < threshold,
    source_word_percentiles: sourcePercentiles,
    probe_batch_id: batch.id,
    b_source_excerpts: excerpts,
    observed_count: count,
    industry_threshold: threshold,
    threshold_version: config?.version ?? null,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(proof))
    .digest("hex");
  return { ...proof, digest };
}
function publicProof(row) {
  return {
    id: row.id,
    status: row.status,
    condition1_met: row.condition1_met,
    condition1_status: row.condition1_status,
    condition2_met: row.condition2_met,
    condition3_met: row.condition3_met,
    source_word_percentiles: row.source_word_percentiles,
    b_source_excerpts: row.b_source_excerpts,
    statistics_window: row.statistics_window,
    channel_scope: row.channel_scope,
    requested_by: row.requested_by,
    industry_threshold: row.industry_threshold,
    threshold_version: row.threshold_version,
  };
}
