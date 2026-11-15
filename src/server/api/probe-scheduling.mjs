import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { required, getRow, conflict, event } from "./domain-common.mjs";
import { validation, permission, ServiceError } from "./errors.mjs";
import { pageQuery } from "./pagination.mjs";
const hash = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export const schedulingAudit = (ctx, batchId) => ({
  actor: {
    actor_type: ctx.principal.actor_type,
    user_id: ctx.principal.user_id,
    agent_run_id: ctx.principal.agent_run_id,
    prompt_version: ctx.principal.prompt_version,
    job_name: ctx.principal.job_name,
    trigger_source: ctx.principal.trigger_source,
    batch_id: batchId,
  },
});
function utc(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(value)
  )
    throw validation("UTC ISO-8601 required");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw validation("invalid UTC date");
  return date.toISOString();
}
function ids(value, count) {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    value.some((v) => typeof v !== "string" || !v.trim()) ||
    new Set(value).size !== count
  )
    throw validation("distinct measurement IDs required");
  return [...value].sort();
}
export function planProbeSchedule(body) {
  required(body, [
    "type",
    "snapshot_id",
    "scheduled_at",
    "cluster_question_sets",
    "schedule",
  ]);
  if (!["baseline", "event", "monthly"].includes(body.type))
    throw validation("unknown batch type");
  const meta = body.schedule;
  if (!meta || typeof meta !== "object" || Array.isArray(meta))
    throw validation("schedule object required");
  const allowed = [
    "source_event_id",
    "expedited",
    ...(body.type === "event"
      ? ["published_at", "target_cluster_ids", "control_cluster_ids"]
      : body.type === "monthly"
        ? ["month"]
        : []),
  ];
  if (Object.keys(meta).some((key) => !allowed.includes(key)))
    throw validation("unsupported scheduling field");
  required(meta, ["source_event_id"]);
  if (
    typeof meta.source_event_id !== "string" ||
    meta.source_event_id.length > 256 ||
    (meta.expedited != null && typeof meta.expedited !== "boolean")
  )
    throw validation("invalid scheduling metadata");
  const count = body.type === "event" ? 6 : 30;
  if (
    !Array.isArray(body.cluster_question_sets) ||
    body.cluster_question_sets.length !== count
  )
    throw validation(`scheduled ${body.type} requires ${count} clusters`);
  const sets = body.cluster_question_sets
    .map((set) => {
      if (
        !set ||
        !Number.isSafeInteger(set.question_pool_version) ||
        set.question_pool_version < 1
      )
        throw validation("question anchor version required");
      return {
        cluster_id: set.cluster_id,
        question_pool_version: set.question_pool_version,
        question_ids: ids(set.question_ids, 3),
      };
    })
    .sort((a, b) => String(a.cluster_id).localeCompare(String(b.cluster_id)));
  ids(
    sets.map((s) => s.cluster_id),
    count,
  );
  if (
    body.cluster_ids &&
    canonicalJson(ids(body.cluster_ids, count)) !==
      canonicalJson(sets.map((s) => s.cluster_id).sort())
  )
    throw validation("cluster IDs do not match manifest");
  const at = utc(body.scheduled_at);
  let targets = [],
    controls = [],
    period,
    occurrences;
  const context = { source_event_id: meta.source_event_id };
  if (body.type === "event") {
    required(body, ["baseline_batch_id"]);
    const published = utc(meta.published_at);
    targets = ids(meta.target_cluster_ids, 3);
    controls = ids(meta.control_cluster_ids, 3);
    if (
      new Set([...targets, ...controls]).size !== 6 ||
      canonicalJson([...targets, ...controls].sort()) !==
        canonicalJson(sets.map((s) => s.cluster_id).sort())
    )
      throw validation("event requires 3 targets and 3 distinct controls");
    context.published_at = published;
    occurrences = [3, 14, 30].map((day) => ({
      offset_days: day,
      at: new Date(Date.parse(published) + day * 86400_000).toISOString(),
    }));
    if (at !== occurrences[0].at)
      throw validation("scheduled_at must match publication D+3");
    period = meta.source_event_id;
  } else {
    if (body.type === "monthly") {
      required(body, ["baseline_batch_id"]);
      if (
        typeof meta.month !== "string" ||
        !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(meta.month) ||
        at.slice(0, 7) !== meta.month
      )
        throw validation(
          "explicit monthly UTC time must fall in the named month",
        );
      context.month = meta.month;
      period = [body.baseline_batch_id, meta.month];
    } else period = body.snapshot_id;
    occurrences = [{ at }];
  }
  const expedited = meta.expedited ?? false;
  const normalized = {
    type: body.type,
    snapshot_id: body.snapshot_id,
    baseline_batch_id: body.baseline_batch_id ?? null,
    sets,
    targets,
    controls,
    expedited,
    context,
    occurrences,
  };
  const { source_event_id, ...periodContext } = context;
  return {
    ...normalized,
    period,
    digest: hash({
      ...normalized,
      context: body.type === "event" ? context : periodContext,
    }),
  };
}
export async function validateScheduleControls(ctx, brandId, controls) {
  for (const id of controls) {
    const cluster = await getRow(ctx, "intent_cluster", id);
    if (cluster.brand_id !== brandId) throw validation("control outside brand");
  }
  if (!controls.length) return;
  const touched = await ctx.client.query(
    "SELECT a.id FROM content_asset a JOIN opportunity_card o ON o.tenant_id=a.tenant_id AND o.id=a.opportunity_card_id WHERE a.tenant_id=$1 AND o.intent_cluster_id=ANY($2::text[]) LIMIT 1",
    [ctx.principal.tenant_id, controls],
  );
  if (touched.rowCount) throw validation("control received content action");
}
export async function createProbeSchedule(ctx, createOne) {
  const plan = planProbeSchedule(ctx.body);
  if (
    ctx.principal.actor_type === "system" &&
    ctx.principal.trigger_source.event_id &&
    ctx.principal.trigger_source.event_id !== plan.context.source_event_id
  )
    throw permission("scheduling event identity mismatch");
  const cluster = await getRow(ctx, "intent_cluster", plan.sets[0].cluster_id);
  const key = hash([cluster.brand_id, plan.type, plan.period]);
  const keys = plan.occurrences.map(
    (o) => `schedule:${key}:${o.offset_days ?? "once"}`,
  );
  await ctx.client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [ctx.principal.tenant_id + ":schedule:" + key],
  );
  const existing = (
    await ctx.client.query(
      "SELECT * FROM probe_batch WHERE tenant_id=$1 AND schedule_key=ANY($2::text[]) ORDER BY scheduled_at,id",
      [ctx.principal.tenant_id, keys],
    )
  ).rows;
  if (existing.length) {
    if (
      existing.length !== keys.length ||
      existing.some((b) => b.schedule_digest !== plan.digest)
    )
      throw conflict("schedule identity already has a different request");
    return {
      data: { ...existing[0], items: existing, reused: true },
      objectId: existing[0].id,
      auditMeta: {
        ...schedulingAudit(ctx, existing[0].id),
        cause_event_id: plan.context.source_event_id,
        reason: "schedule replay: reused existing batches",
      },
    };
  }
  if (plan.type !== "baseline") {
    const baseline = await getRow(ctx, "probe_batch", plan.baseline_batch_id);
    if (
      baseline.type !== "baseline" ||
      baseline.status !== "completed" ||
      baseline.brand_id !== cluster.brand_id ||
      baseline.snapshot_id !== plan.snapshot_id ||
      plan.sets.some(
        (set) =>
          !baseline.cluster_question_sets.some(
            (old) =>
              canonicalJson({
                cluster_id: old.cluster_id,
                question_pool_version: old.question_pool_version,
                question_ids: [...old.question_ids].sort(),
              }) === canonicalJson(set),
          ),
      )
    )
      throw new ServiceError(
        422,
        "incomparable",
        "retest must retain the completed baseline snapshot and anchored question IDs",
      );
  }
  await validateScheduleControls(ctx, cluster.brand_id, plan.controls);
  const items = [];
  for (const [i, occurrence] of plan.occurrences.entries()) {
    const result = await createOne(
      {
        ...ctx,
        body: {
          ...ctx.body,
          cluster_question_sets: plan.sets,
          scheduled_at: occurrence.at,
        },
      },
      {
        schedule_key: keys[i],
        schedule_digest: plan.digest,
        expedited: plan.expedited,
        schedule_meta: JSON.stringify({
          ...plan.context,
          ...(occurrence.offset_days
            ? { offset_days: occurrence.offset_days }
            : {}),
          target_cluster_ids: plan.targets,
          control_cluster_ids: plan.controls,
        }),
      },
    );
    items.push(result.data);
    if (i)
      event(ctx, "probe_batch.create", "probe_batch", result.data.id, {
        ...schedulingAudit(ctx, result.data.id),
        cause_event_id: plan.context.source_event_id,
      });
  }
  return {
    data: { ...items[0], items, reused: false },
    objectId: items[0].id,
    auditMeta: {
      ...schedulingAudit(ctx, items[0].id),
      cause_event_id: plan.context.source_event_id,
    },
  };
}
export async function readDueProbeSchedules(ctx) {
  if (
    !["cs", "strategist", "factcheck"].includes(ctx.principal.role) ||
    ctx.principal.actor_type === "system"
  )
    throw permission("batch-wide scheduling projection denied");
  const values = [ctx.principal.tenant_id];
  // Existing explicit single-batch creates also carry scheduled_at and must
  // remain discoverable; only durable dedup metadata is optional for them.
  let where = "tenant_id=$1 AND status='pending'";
  if (ctx.scope.brand_id) {
    values.push(ctx.scope.brand_id);
    where += ` AND brand_id=$${values.length}`;
  }
  if (ctx.query.due_only !== "false") {
    values.push(new Date(ctx.now()).toISOString());
    where += ` AND scheduled_at<=$${values.length}`;
  }
  return {
    data: await pageQuery(
      { ...ctx, operation: "probe_batch.read:scheduled" },
      {
        table:
          "(SELECT tenant_id,id,brand_id,type,status,scheduled_at,snapshot_id,schedule_key,expedited,schedule_meta,NOT expedited AS normal_order FROM probe_batch) scheduled",
        columns:
          "id,brand_id,type,status,scheduled_at,snapshot_id,expedited,schedule_meta,normal_order",
        where,
        values,
        order: [
          ["normal_order", "ASC"],
          ["scheduled_at", "ASC"],
          ["id", "ASC"],
        ],
        map: ({ normal_order, ...row }) => row,
      },
    ),
  };
}
