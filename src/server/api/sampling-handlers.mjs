import { assignmentPredicate } from "./assignment-scope.mjs";
import { pageQuery } from "./pagination.mjs";
import { randomUUID } from "node:crypto";
import {
  required,
  insertRow,
  getRow,
  change,
  conflict,
  json,
  event,
  scoreIdentity,
} from "./domain-common.mjs";
import { permission, validation, ServiceError } from "./errors.mjs";
const dimensions = ["blank", "error", "generic", "competitor"];
const mean = (values) => {
  const valid = values.filter((v) => v != null).map(Number);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
};
const bucket = (value) =>
  value == null ? null : value < 0.25 ? 0 : value < 0.75 ? 0.5 : 1;
export const normalizeCitation = (value) =>
  String(value)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./, "")
    .split(/[?#]/)[0]
    .replace(/\/$/, "");
export async function judgmentBasis(ctx, brandId, version) {
  const tid = ctx.principal.tenant_id;
  const lex = (
    await ctx.client.query(
      `SELECT max(l.version)::integer AS version FROM brand_lexicon l WHERE l.tenant_id=$1 AND l.brand_id=$2 AND ($3::integer IS NULL OR l.version=$3)
 AND EXISTS(SELECT 1 FROM brand_lexicon head JOIN review_queue q ON q.tenant_id=head.tenant_id AND q.object_id=head.id AND q.object_type='brand_lexicon' AND q.status='approved' WHERE head.tenant_id=l.tenant_id AND head.brand_id=l.brand_id AND head.version=l.version)`,
      [tid, brandId, version ?? null],
    )
  ).rows[0].version;
  const facts = (
    await ctx.client.query(
      "SELECT id FROM official_fact WHERE tenant_id=$1 AND brand_id=$2 AND status='approved' AND source_level='L1' AND effective_from<=$3",
      [tid, brandId, new Date(ctx.now()).toISOString()],
    )
  ).rows;
  if (!lex || !facts.length)
    throw new ServiceError(
      422,
      "judgment_basis_missing",
      "sealed lexicon and effective official facts required",
    );
  return { lexicon_version: lex, fact_ids: facts.map((f) => f.id) };
}
export function samplingHandlers() {
  const h = {};
  h["probe_batch.create"] = async (ctx) => {
    required(ctx.body, [
      "type",
      "snapshot_id",
      "scheduled_at",
      "cluster_question_sets",
    ]);
    const snapshot = await getRow(
      ctx,
      "scoring_snapshot",
      ctx.body.snapshot_id,
      { key: "snapshot_id" },
    );
    if (!snapshot.frozen) throw validation("snapshot must be frozen");
    const sets = ctx.body.cluster_question_sets;
    if (!sets.length) throw validation("empty measurement set");
    let brand;
    for (const set of sets) {
      const cluster = await getRow(ctx, "intent_cluster", set.cluster_id);
      brand ??= cluster.brand_id;
      if (brand !== cluster.brand_id) throw validation("one brand per batch");
      if (
        cluster.status === "archived" &&
        ctx.now() - new Date(cluster.archived_at).getTime() >= 90 * 86400_000
      )
        throw validation("archive transition ended");
      if (set.question_pool_version !== cluster.question_pool_version)
        throw validation("question anchor mismatch");
      const qs = (
        await ctx.client.query(
          "SELECT id FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 AND frozen=true AND archived_at IS NULL ORDER BY id",
          [ctx.principal.tenant_id, cluster.id, set.question_pool_version],
        )
      ).rows;
      if (
        qs.length !== 3 ||
        JSON.stringify(qs.map((q) => q.id).sort()) !==
          JSON.stringify([...new Set(set.question_ids)].sort())
      )
        throw validation("frozen question ID set mismatch");
    }
    const basis = await judgmentBasis(ctx, brand);
    if (ctx.body.type !== "baseline") {
      const baseline = await getRow(
        ctx,
        "probe_batch",
        ctx.body.baseline_batch_id,
      );
      if (
        baseline.type !== "baseline" ||
        baseline.status !== "completed" ||
        baseline.brand_id !== brand ||
        baseline.snapshot_id !== snapshot.snapshot_id
      )
        throw validation("retest requires baseline snapshot");
    }
    const row = await insertRow(ctx, "probe_batch", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      brand_id: brand,
      type: ctx.body.type,
      scheduled_at: ctx.body.scheduled_at,
      snapshot_id: snapshot.snapshot_id,
      lexicon_version: basis.lexicon_version,
      status: "pending",
      cluster_question_sets: json(sets),
      baseline_batch_id: ctx.body.baseline_batch_id ?? null,
    });
    return { data: row };
  };
  h["probe_batch.read"] = async (ctx) => {
    const batch = await getRow(ctx, "probe_batch", ctx.params.id);
    const restricted = ["content", "evidence"].includes(ctx.principal.role);
    const page = await pageQuery(ctx, {
      table:
        "probe p JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id",
      columns:
        "p.id,p.batch_id,p.intent_cluster_id,p.question_id,p.model,p.model_version,p.temperature,p.round,p.run_at",
      where: `p.tenant_id=$1 AND p.batch_id=$2 AND ($3::boolean=false OR ${assignmentPredicate({ user: "$4" })})`,
      values: [
        ctx.principal.tenant_id,
        batch.id,
        restricted,
        ctx.principal.user_id,
      ],
      order: [["p.id", "ASC"]],
    });
    if (restricted) {
      const ids = batch.cluster_question_sets.flatMap(
        (set) => set.question_ids,
      );
      const visible = (
        await ctx.client.query(
          `SELECT q.id FROM question_pool q WHERE q.tenant_id=$1 AND q.id=ANY($2::text[]) AND ${assignmentPredicate({ tenant: "q.tenant_id", cluster: "q.cluster_id", source: "q.source_word_id", user: "$3" })}`,
          [ctx.principal.tenant_id, ids, ctx.principal.user_id],
        )
      ).rows.map((q) => q.id);
      batch.cluster_question_sets = batch.cluster_question_sets
        .map((set) => ({
          ...set,
          question_ids: set.question_ids.filter((id) => visible.includes(id)),
        }))
        .filter((set) => set.question_ids.length);
    }
    return {
      data: {
        ...batch,
        probes: page.items,
        next_cursor: page.next_cursor,
        restricted_projection: restricted,
      },
    };
  };
  h["probe_batch.start"] = async (ctx) => {
    const batch = await getRow(ctx, "probe_batch", ctx.params.id, {
      lock: true,
    });
    if (batch.status !== "pending")
      throw conflict("only pending batch can start");
    await judgmentBasis(ctx, batch.brand_id, batch.lexicon_version);
    return {
      data: await change(ctx, "probe_batch", batch.id, {
        status: "running",
        started_at: new Date(ctx.now()).toISOString(),
      }),
    };
  };
  h["probe_batch.execute"] = async (ctx) => {
    required(ctx.body, ["probe", "result"]);
    const b = await getRow(ctx, "probe_batch", ctx.params.id, { lock: true });
    if (b.status !== "running") throw conflict("batch not running");
    const input = ctx.body.probe,
      result = ctx.body.result;
    required(input, [
      "batch_id",
      "cluster_id",
      "question_id",
      "model",
      "temperature",
      "round",
      "attempt_no",
    ]);
    if (input.batch_id !== b.id || input.attempt_no !== b.attempt_no)
      throw validation("batch attempt mismatch");
    const snapshot = await getRow(ctx, "scoring_snapshot", b.snapshot_id, {
      key: "snapshot_id",
    });
    const set = b.cluster_question_sets.find(
      (s) => s.cluster_id === input.cluster_id,
    );
    if (
      !set?.question_ids.includes(input.question_id) ||
      !snapshot.model_set.includes(input.model) ||
      !snapshot.temperature_set.map(Number).includes(input.temperature) ||
      input.round < 1 ||
      input.round > snapshot.rounds
    )
      throw validation("probe outside frozen manifest");
    if (
      typeof result.raw_answer !== "string" ||
      typeof result.refused !== "boolean"
    )
      throw validation("transport answer required");
    const question = await getRow(ctx, "question_pool", input.question_id);
    const capability = await ctx.modelCapabilities(
      input.model,
      snapshot.grounding_mode,
    );
    if (
      !capability ||
      snapshot.model_version_manifest?.[input.model] !==
        capability.modelVersion ||
      capability.searchEnabled !== (snapshot.grounding_mode === "search_on")
    )
      throw validation("unknown or changed model adapter version");
    const p = await insertRow(ctx, "probe", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      batch_id: b.id,
      intent_cluster_id: input.cluster_id,
      question_id: question.id,
      question: question.question,
      model: input.model,
      model_version: capability.modelVersion,
      temperature: input.temperature,
      round: input.round,
      attempt_no: b.attempt_no,
      run_at: new Date(ctx.now()).toISOString(),
    });
    const row = await insertRow(ctx, "probe_result", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      probe_id: p.id,
      refused: result.refused,
      raw_answer: result.raw_answer,
      cited_claim_ids: [],
      cited_urls: result.cited_urls ?? [],
      cited_domains: result.cited_domains ?? [],
      lexicon_version: b.lexicon_version,
    });
    event(ctx, "probe_batch.execute_probe", "probe", p.id);
    return {
      data: { id: row.id, probe_id: p.id, batch_id: b.id },
      objectId: row.id,
      usage: "probe",
      snapshot_id: b.snapshot_id,
    };
  };
  h["probe_result.judge"] = async (ctx) => {
    required(ctx.body, ["batch_id", "lexicon_version", "official_fact_ids"]);
    const row = (
      await ctx.client.query(
        "SELECT r.id,r.probe_id,r.refused,r.blank_i,p.batch_id,p.intent_cluster_id,b.brand_id,b.lexicon_version FROM probe_result r JOIN probe p ON p.tenant_id=r.tenant_id AND p.id=r.probe_id JOIN probe_batch b ON b.tenant_id=p.tenant_id AND b.id=p.batch_id WHERE r.tenant_id=$1 AND r.id=$2",
        [ctx.principal.tenant_id, ctx.params.id],
      )
    ).rows[0];
    if (!row) throw permission();
    if (row.refused) throw validation("refused answers have no judgments");
    if (
      row.batch_id !== ctx.body.batch_id ||
      row.lexicon_version !== ctx.body.lexicon_version
    )
      throw validation("judgment batch/lexicon mismatch");
    const batch = await getRow(ctx, "probe_batch", row.batch_id);
    if (batch.status !== "running")
      throw conflict("closed batch judgments immutable");
    const available = (
      await ctx.client.query(
        "SELECT id FROM official_fact WHERE tenant_id=$1 AND brand_id=$2 AND status='approved' AND source_level='L1' AND effective_from<=$3",
        [
          ctx.principal.tenant_id,
          row.brand_id,
          new Date(ctx.now()).toISOString(),
        ],
      )
    ).rows.map((r) => r.id);
    if (ctx.body.official_fact_ids.some((id) => !available.includes(id)))
      throw validation("official fact is not approved/effective");
    if (available.length && !ctx.body.official_fact_ids.length)
      throw validation("explicit official fact IDs required");
    const competitors = ctx.body.competitor_mentions ?? [];
    const valid = (
      await ctx.client.query(
        "SELECT id FROM brand_lexicon WHERE tenant_id=$1 AND brand_id=$2 AND version=$3 AND kind='competitor'",
        [ctx.principal.tenant_id, row.brand_id, row.lexicon_version],
      )
    ).rows.map((r) => r.id);
    if (
      new Set(competitors).size !== competitors.length ||
      competitors.some((id) => !valid.includes(id))
    )
      throw validation("competitor labels require pinned lexicon entries");
    for (const key of ["blank_i", "generic_i", "competitor_i"])
      if (![0, 0.5, 1].includes(ctx.body[key]))
        throw validation("manual judgment level invalid", { field: key });
    if (available.length && ![0, 0.5, 1].includes(ctx.body.error_i))
      throw validation("manual error judgment level invalid");
    const fields = {
      blank_i: ctx.body.blank_i,
      error_i: available.length ? ctx.body.error_i : null,
      generic_i: ctx.body.generic_i,
      competitor_i: ctx.body.competitor_i,
      brand_mentioned: ctx.body.brand_mentioned ?? false,
      competitor_mentions: competitors,
      spec_score: ctx.body.spec_score ?? null,
      note: ctx.body.note ?? null,
      official_fact_ids: ctx.body.official_fact_ids,
    };
    const columns = Object.keys(fields);
    await ctx.client.query(
      `UPDATE probe_result SET ${columns.map((k, i) => k + "=$" + (i + 3)).join(",")} WHERE tenant_id=$1 AND id=$2`,
      [ctx.principal.tenant_id, row.id, ...Object.values(fields)],
    );
    return {
      data: {
        id: row.id,
        judged: true,
        lexicon_version: row.lexicon_version,
        official_fact_ids: ctx.body.official_fact_ids,
      },
      usage: "judge",
    };
  };
  h["probe_batch.complete"] = async (ctx) => {
    const batch = await getRow(ctx, "probe_batch", ctx.params.id, {
      lock: true,
    });
    if (batch.status !== "running") throw conflict();
    const snapshot = await getRow(ctx, "scoring_snapshot", batch.snapshot_id, {
      key: "snapshot_id",
    });
    const counts = (
      await ctx.client.query(
        "SELECT count(*)::integer AS total,count(*) FILTER(WHERE NOT r.refused AND (r.blank_i IS NULL OR r.generic_i IS NULL OR r.competitor_i IS NULL))::integer AS unjudged FROM probe p JOIN probe_result r ON r.tenant_id=p.tenant_id AND r.probe_id=p.id WHERE p.tenant_id=$1 AND p.batch_id=$2 AND p.attempt_no=$3",
        [ctx.principal.tenant_id, batch.id, batch.attempt_no],
      )
    ).rows[0];
    const expected =
      batch.cluster_question_sets.length *
      3 *
      snapshot.model_set.length *
      snapshot.temperature_set.length *
      snapshot.rounds;
    if (counts.total !== expected || counts.unjudged)
      throw validation("incomplete batch attempt");
    return {
      data: await change(ctx, "probe_batch", batch.id, {
        status: "completed",
        committed_attempt_no: batch.attempt_no,
        finished_at: new Date(ctx.now()).toISOString(),
      }),
    };
  };
  h["probe_result.read"] = async (ctx) => {
    const row = (
      await ctx.client.query(
        "SELECT id,probe_id,brand_mentioned,refused,cited_claim_ids,cited_urls,cited_domains,blank_i,error_i,generic_i,competitor_i,lexicon_version FROM probe_result WHERE tenant_id=$1 AND id=$2",
        [ctx.principal.tenant_id, ctx.params.id],
      )
    ).rows[0];
    if (!row) throw permission();
    return { data: row };
  };
  const raw = async (ctx) => {
    const row = (
      await ctx.client.query(
        "SELECT id,probe_id,raw_answer FROM probe_result WHERE tenant_id=$1 AND id=$2",
        [ctx.principal.tenant_id, ctx.params.id],
      )
    ).rows[0];
    if (!row) throw permission();
    return { data: row, sensitive: true };
  };
  h["probe_result.read_raw"] = raw;
  h["probe_result.access"] = async (ctx) => {
    required(ctx.body, ["reason"]);
    return raw(ctx);
  };
  h["cluster_score.append"] = async (ctx) => {
    required(ctx.body, ["cluster_id", "snapshot_id"]);
    const batch = await getRow(ctx, "probe_batch", ctx.principal.batch_id);
    if (
      batch.type !== "baseline" ||
      batch.status !== "completed" ||
      batch.snapshot_id !== ctx.body.snapshot_id
    )
      throw validation("only completed baseline can score");
    const set = batch.cluster_question_sets.find(
      (s) => s.cluster_id === ctx.body.cluster_id,
    );
    if (!set) throw validation("cluster absent in batch");
    const rows = await sampleRows(ctx, batch, ctx.body.cluster_id);
    const valid = rows.filter((r) => !r.refused);
    const n_valid = valid.length,
      coverage = new Set(valid.map((r) => r.model)).size,
      insufficient = n_valid < 10 || coverage < 3;
    const rawValues = {};
    const questionRows = [];
    for (const id of set.question_ids) {
      const qs = rows.filter((r) => r.question_id === id),
        vs = qs.filter((r) => !r.refused);
      const q = {
        id: randomUUID(),
        tenant_id: ctx.principal.tenant_id,
        question_id: id,
        snapshot_id: batch.snapshot_id,
        n_valid: vs.length,
        n_refused: qs.length - vs.length,
      };
      for (const dimension of dimensions) {
        const m = mean(vs.map((r) => r[dimension + "_i"]));
        q[dimension + "_q"] = m == null ? null : Number(m.toFixed(4));
      }
      questionRows.push(q);
    }
    for (const dimension of dimensions)
      rawValues[dimension] = mean(questionRows.map((r) => r[dimension + "_q"]));
    rawValues.whitespace = Object.values(rawValues).some((x) => x == null)
      ? null
      : mean(Object.values(rawValues));
    // Insert the unique cluster identity first; a second append fails atomically.
    const score = {
      id: scoreIdentity(ctx.body.cluster_id, batch.snapshot_id),
      tenant_id: ctx.principal.tenant_id,
      cluster_id: ctx.body.cluster_id,
      snapshot_id: batch.snapshot_id,
      n_valid,
      model_coverage: coverage,
    };
    for (const [dimension, value] of Object.entries(rawValues)) {
      score[dimension + "_raw"] = value;
      score[dimension + "_score"] = insufficient ? null : bucket(value);
    }
    const row = await insertRow(ctx, "cluster_score", score);
    for (const question of questionRows) {
      await insertRow(ctx, "question_score", question);
      event(
        ctx,
        "cluster_score.append_question",
        "question_score",
        question.id,
      );
    }
    return {
      data: { id: row.id, recorded: true },
      objectId: row.id,
      snapshot_id: batch.snapshot_id,
    };
  };
  h["cluster_score.read"] = async (ctx) => {
    const row = await getRow(ctx, "cluster_score", ctx.params.id);
    const questions = (
      await ctx.client.query(
        "SELECT s.id,s.question_id,s.snapshot_id,s.blank_q,s.error_q,s.generic_q,s.competitor_q,s.n_valid,s.n_refused FROM question_score s JOIN question_pool q ON q.tenant_id=s.tenant_id AND q.id=s.question_id WHERE s.tenant_id=$1 AND s.snapshot_id=$2 AND q.cluster_id=$3 ORDER BY s.question_id",
        [ctx.principal.tenant_id, row.snapshot_id, row.cluster_id],
      )
    ).rows;
    return {
      data: {
        ...numericScores(row),
        question_scores: questions.map(numericScores),
      },
    };
  };
  h["metric_snapshot.append"] = async (ctx) => {
    required(ctx.body, [
      "batch_id",
      "snapshot_id",
      "cluster_id",
      "committed_attempt_no",
      "lexicon_version",
    ]);
    const batch = await getRow(ctx, "probe_batch", ctx.body.batch_id);
    if (
      batch.status !== "completed" ||
      batch.committed_attempt_no !== ctx.body.committed_attempt_no ||
      batch.snapshot_id !== ctx.body.snapshot_id ||
      batch.lexicon_version !== ctx.body.lexicon_version
    )
      throw validation(
        "metric requires one committed completed attempt and pinned basis",
      );
    const rows = (await sampleRows(ctx, batch, ctx.body.cluster_id)).filter(
      (r) => !r.refused,
    );
    const all = (await sampleRows(ctx, batch)).filter(
      (r) => !r.refused && r.eligible,
    );
    const own = all.filter((r) => r.brand_mentioned).length,
      competitor = all.reduce(
        (sum, r) => sum + r.competitor_mentions.length,
        0,
      );
    const assets = (
      await ctx.client.query(
        "SELECT id,url,originated_by_internal FROM content_asset WHERE tenant_id=$1 AND brand_id=$2",
        [ctx.principal.tenant_id, batch.brand_id],
      )
    ).rows;
    const urls = new Set(
      assets.filter((a) => a.url).map((a) => normalizeCitation(a.url)),
    );
    const explicit = rows.filter((r) =>
      r.cited_urls.some((url) => urls.has(normalizeCitation(url))),
    ).length;
    const produced =
      (
        await ctx.client.query(
          "SELECT a.id FROM content_asset a JOIN opportunity_card o ON o.tenant_id=a.tenant_id AND o.id=a.opportunity_card_id WHERE a.tenant_id=$1 AND o.intent_cluster_id=$2 AND a.originated_by_internal=true",
          [ctx.principal.tenant_id, ctx.body.cluster_id],
        )
      ).rowCount > 0;
    const controls = ctx.body.control_cluster_ids ?? [];
    if (produced && !controls.length)
      throw validation("our production needs control clusters");
    for (const id of controls) {
      const control = await getRow(ctx, "intent_cluster", id);
      if (
        control.brand_id !== batch.brand_id ||
        !batch.cluster_question_sets.some((s) => s.cluster_id === id)
      )
        throw validation("control outside batch brand");
      const touched = (
        await ctx.client.query(
          "SELECT a.id FROM content_asset a JOIN opportunity_card o ON o.tenant_id=a.tenant_id AND o.id=a.opportunity_card_id WHERE a.tenant_id=$1 AND o.intent_cluster_id=$2",
          [ctx.principal.tenant_id, id],
        )
      ).rowCount;
      if (touched) throw validation("control received production");
    }
    const row = await insertRow(ctx, "metric_snapshot", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      brand_id: batch.brand_id,
      intent_cluster_id: ctx.body.cluster_id,
      snapshot_id: batch.snapshot_id,
      batch_id: batch.id,
      lexicon_version: batch.lexicon_version,
      date: new Date(ctx.now()).toISOString(),
      mention_rate: rows.length
        ? rows.filter((r) => r.brand_mentioned).length / rows.length
        : null,
      citation_rate: rows.length ? explicit / rows.length : null,
      accuracy: null,
      sov: own + competitor ? own / (own + competitor) : null,
      avg_position: null,
      leads: null,
      produced_by_us: produced,
      control_cluster_ids: controls,
      denominator_changes: json(
        [
          ...new Set(
            all
              .filter((r) => r.status === "archived")
              .map((r) => r.intent_cluster_id),
          ),
        ].map((cluster_id) => ({ cluster_id, transition_days: 90 })),
      ),
    });
    return { data: numericScores(row) };
  };
  h["metric_snapshot.read"] = async (ctx) => ({
    data: numericScores(await getRow(ctx, "metric_snapshot", ctx.params.id)),
  });
  h["metric_snapshot.export"] = async (ctx) => {
    const row = await getRow(ctx, "metric_snapshot", ctx.params.id);
    if (row.produced_by_us && !row.control_cluster_ids.length)
      throw validation("disclosure/control incomplete");
    return {
      data: {
        ...numericScores(row),
        disclosure: row.produced_by_us ? "内容由我方生产" : null,
      },
    };
  };
  h["cluster_score.compare"] = async (ctx) => {
    const query = ctx.query;
    required(query, ["baseline_batch_id", "retest_batch_id", "cluster_id"]);
    const base = await getRow(ctx, "probe_batch", query.baseline_batch_id),
      retest = await getRow(ctx, "probe_batch", query.retest_batch_id);
    const a = base.cluster_question_sets.find(
        (s) => s.cluster_id === query.cluster_id,
      ),
      b = retest.cluster_question_sets.find(
        (s) => s.cluster_id === query.cluster_id,
      );
    if (
      !a ||
      !b ||
      base.brand_id !== ctx.scope.brand_id ||
      retest.brand_id !== ctx.scope.brand_id
    )
      throw permission();
    if (
      base.snapshot_id !== retest.snapshot_id ||
      a.question_pool_version !== b.question_pool_version ||
      JSON.stringify([...a.question_ids].sort()) !==
        JSON.stringify([...b.question_ids].sort())
    )
      throw new ServiceError(
        422,
        "incomparable",
        "snapshot/cluster anchor/question ID set differ",
        { snapshot_id: base.snapshot_id },
      );
    const rows = (
      await ctx.client.query(
        "SELECT batch_id,mention_rate,citation_rate,accuracy,sov FROM metric_snapshot WHERE tenant_id=$1 AND intent_cluster_id=$2 AND batch_id=ANY($3::text[])",
        [ctx.principal.tenant_id, query.cluster_id, [base.id, retest.id]],
      )
    ).rows;
    const first = rows.find((r) => r.batch_id === base.id),
      second = rows.find((r) => r.batch_id === retest.id);
    if (!first || !second) throw validation("comparison metrics missing");
    const delta = {};
    for (const key of ["mention_rate", "citation_rate", "accuracy", "sov"])
      delta[key] =
        first[key] == null || second[key] == null
          ? null
          : Number(second[key]) - Number(first[key]);
    return {
      data: { baseline_batch_id: base.id, retest_batch_id: retest.id, delta },
      snapshot_id: base.snapshot_id,
    };
  };
  return h;
}
async function sampleRows(ctx, batch, cluster) {
  return (
    await ctx.client.query(
      `SELECT p.id AS probe_id,p.question_id,p.intent_cluster_id,p.model,r.refused,r.blank_i,r.error_i,r.generic_i,r.competitor_i,r.brand_mentioned,r.competitor_mentions,r.cited_urls,c.status,
 (c.status='active' OR c.archived_at > $5::timestamptz-interval '90 days') AS eligible
 FROM probe p JOIN probe_result r ON r.tenant_id=p.tenant_id AND r.probe_id=p.id JOIN intent_cluster c ON c.tenant_id=p.tenant_id AND c.id=p.intent_cluster_id
 WHERE p.tenant_id=$1 AND p.batch_id=$2 AND p.attempt_no=$3 AND ($4::text IS NULL OR p.intent_cluster_id=$4)`,
      [
        ctx.principal.tenant_id,
        batch.id,
        batch.committed_attempt_no,
        cluster ?? null,
        new Date(ctx.now()).toISOString(),
      ],
    )
  ).rows;
}
function numericScores(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string" &&
      /(?:_raw|_score|_q|_rate|^accuracy$|^sov$|avg_position)/.test(key) &&
      /^-?\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : value,
    ]),
  );
}
