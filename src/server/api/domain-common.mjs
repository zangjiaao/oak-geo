import { createHash, randomUUID } from "node:crypto";
import { permission, validation, ServiceError } from "./errors.mjs";
const tables = new Set([
  "tenant",
  "brand",
  "user_member",
  "intent_cluster",
  "question_pool",
  "scoring_snapshot",
  "question_score",
  "cluster_score",
  "cluster_platform_signal",
  "opportunity_card",
  "content_asset",
  "claim_block",
  "probe_batch",
  "probe",
  "probe_result",
  "metric_snapshot",
  "audit_log",
  "review_queue",
  "objection",
  "backflow_ticket",
  "evidence_package",
  "evidence_item",
  "api_token",
  "brand_lexicon",
  "official_fact",
  "keyword_raw",
  "archive_review_evidence",
  "task_assignment",
  "diagnosis_record",
  "operation_usage",
  "idempotency_record",
]);
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("invalid internal SQL identifier");
  return '"' + value + '"';
};
export const json = (value) => JSON.stringify(value);
export const scoreIdentity = (cluster, snapshot) =>
  "score-" +
  createHash("sha256")
    .update(cluster + "\0" + snapshot)
    .digest("hex")
    .slice(0, 32);
export function required(body, fields) {
  for (const key of fields)
    if (
      body[key] == null ||
      (typeof body[key] === "string" && !body[key].trim())
    )
      throw validation("required field missing", { field: key });
}
export const conflict = (message = "state conflict") =>
  new ServiceError(409, "state_conflict", message);
export async function insertRow(ctx, table, row) {
  if (!tables.has(table)) throw new Error("unknown internal table");
  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  const values = entries.map(([, v]) => v);
  return (
    await ctx.client.query(
      `INSERT INTO ${identifier(table)} (${entries.map(([k]) => identifier(k)).join(",")}) VALUES (${entries.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      values,
    )
  ).rows[0];
}
export async function getRow(
  ctx,
  table,
  id,
  { lock = false, key = "id" } = {},
) {
  if (!tables.has(table) || table === "probe_result" || table === "keyword_raw")
    throw new Error("use explicit projection for raw-bearing table");
  const row = (
    await ctx.client.query(
      `SELECT * FROM ${identifier(table)} WHERE tenant_id=$1 AND ${identifier(key)}=$2${lock ? " FOR UPDATE" : ""}`,
      [ctx.principal.tenant_id, id],
    )
  ).rows[0];
  if (!row) throw permission("object outside accessible scope");
  return row;
}
export async function change(ctx, table, id, fields, { key = "id" } = {}) {
  if (!tables.has(table)) throw new Error("unknown internal table");
  const pairs = Object.entries(fields);
  return (
    await ctx.client.query(
      `UPDATE ${identifier(table)} SET ${pairs.map(([k], i) => identifier(k) + "=$" + (i + 3)).join(",")} WHERE tenant_id=$1 AND ${identifier(key)}=$2 RETURNING *`,
      [ctx.principal.tenant_id, id, ...pairs.map(([, v]) => v)],
    )
  ).rows[0];
}
export function event(ctx, action, object_type, object_id, extra = {}) {
  ctx.audit.add({ action, object_type, object_id, ...extra });
}
export async function queueObject(
  ctx,
  type,
  id,
  author = ctx.principal.user_id,
) {
  const row = await insertRow(ctx, "review_queue", {
    id: randomUUID(),
    tenant_id: ctx.principal.tenant_id,
    object_type: type,
    object_id: id,
    submitted_by: author,
    status: "waiting",
    submitted_at: new Date(ctx.now()).toISOString(),
  });
  event(ctx, "review_queue.submit", "review_queue", row.id);
  return row;
}
export const requiredSections = Object.freeze({
  认知: ["定义", "边界", "与相邻概念区别", "常见误解"],
  选型对比: ["维度表", "适用/不适用场景", "价格区间", "参数"],
  价格: ["区间", "计价单位", "影响因素", "隐藏成本"],
  场景方案: ["步骤", "角色分工", "周期", "可量化目标"],
  排障: ["症状—原因—动作三段式"],
  "替代/否定": ["反面证据", "失败案例", "什么情况别做"],
});
export async function assetRequirements(ctx, assetId) {
  const row = (
    await ctx.client.query(
      "SELECT c.intent_type FROM content_asset a JOIN opportunity_card o ON o.tenant_id=a.tenant_id AND o.id=a.opportunity_card_id JOIN intent_cluster c ON c.tenant_id=o.tenant_id AND c.id=o.intent_cluster_id WHERE a.tenant_id=$1 AND a.id=$2",
      [ctx.principal.tenant_id, assetId],
    )
  ).rows[0];
  if (!row) throw permission();
  return requiredSections[row.intent_type];
}
export async function currentBlocks(ctx, assetId) {
  return (
    await ctx.client.query(
      "SELECT DISTINCT ON(logical_id) id,logical_id,version,status,block_kind,text FROM claim_block WHERE tenant_id=$1 AND content_asset_id=$2 ORDER BY logical_id,version DESC",
      [ctx.principal.tenant_id, assetId],
    )
  ).rows;
}
export async function reconcileAsset(
  ctx,
  assetId,
  { triggerClaimId, retractId, cause = ctx.rootEventId ?? randomUUID() } = {},
) {
  if (ctx.operation !== "content_asset.transition")
    return ctx.runJob("content_reconcile", "content_asset.transition", {
      content_asset_id: assetId,
      trigger_claim_id: triggerClaimId ?? retractId,
      cause_event_id: cause,
      retract_id: retractId,
    });
  let asset = await getRow(ctx, "content_asset", assetId, { lock: true });
  if (asset.review_status === "retired") return;
  const blocks = await currentBlocks(ctx, assetId);
  const req = await assetRequirements(ctx, assetId);
  const ready =
    req.every((kind) =>
      blocks.some((b) => b.block_kind === kind && b.status === "approved"),
    ) &&
    blocks
      .filter((b) => req.includes(b.block_kind))
      .every((b) => b.status === "approved");
  const transition = async (to) => {
    const before = asset.review_status;
    asset = await change(ctx, "content_asset", asset.id, { review_status: to });
    event(ctx, `content_asset.${before}_to_${to}`, "content_asset", asset.id, {
      cause_event_id: cause,
      actor: {
        actor_type: "system",
        job_name: "content_reconcile",
        trigger_source: { event_id: cause },
      },
    });
  };
  if (
    asset.review_status === "registered" &&
    retractId &&
    asset.published_claim_versions.some((x) => x.id === retractId)
  )
    await transition("ready");
  if (asset.review_status === "ready" && !ready) await transition("draft");
  if (asset.review_status === "draft" && ready) await transition("ready");
}
