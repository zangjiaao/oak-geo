import { canonicalJson } from "./canonical-json.mjs";
import { permission } from "./errors.mjs";
export const permissionEvaluationOrder = Object.freeze([
  "authentication",
  "tenant",
  "brand_or_assignment",
  "allow",
  "credential_and_human_mode",
  "business",
]);
const installerOperations = new Set([
  "tenant.configure",
  "brand.configure",
  "user_member.configure",
]);
const humanDecisions = new Set([
  "intent_cluster.archive",
  "claim_block.approve",
  "claim_block.reject",
  "claim_block.retract",
  "review_queue.approve",
  "review_queue.reject",
  "official_fact.approve",
  "official_fact.retract",
  "evidence_package.approve",
  "diagnosis_report.approve",
  "question_pool.upgrade_anchor",
  "opportunity_card.confirm",
  "content_asset.retire",
]);
export async function authenticate({
  client,
  identity,
  actor,
  operation,
  now,
}) {
  const actorFields = new Set([
    "credential",
    "user_id",
    "role",
    "actor_type",
    "tenant_id",
    "brand_id",
    "agent_run_id",
    "prompt_version",
    "job_name",
    "batch_id",
    "trigger_source",
  ]);
  if (!actor || Object.keys(actor).some((k) => !actorFields.has(k)))
    throw permission("untrusted runtime authority declaration");
  const principal = identity.verify(actor.credential);
  for (const key of ["user_id", "role", "actor_type"])
    if (actor[key] !== principal[key])
      throw permission("actor is not bound to credential");
  for (const key of [
    "agent_run_id",
    "prompt_version",
    "job_name",
    "batch_id",
    "trigger_source",
  ])
    if (
      Object.hasOwn(actor, key) &&
      canonicalJson(actor[key]) !== canonicalJson(principal[key])
    )
      throw permission("actor metadata is not bound to credential");
  if (
    !["human", "agent", "external_agent", "system"].includes(
      principal.actor_type,
    )
  )
    throw permission();
  if (
    ["agent", "external_agent"].includes(principal.actor_type) &&
    (!principal.agent_run_id || !principal.prompt_version)
  )
    throw permission();
  if (principal.actor_type === "system" && principal.credential_kind !== "job")
    throw permission();
  if (principal.credential_kind === "job" && principal.actor_type !== "system")
    throw permission();
  await client.query("SELECT set_config('geo.tenant_id',$1,true)", [
    principal.tenant_id,
  ]);
  const memberships = (
    await client.query(
      "SELECT role,brand_id FROM user_member WHERE tenant_id=$1 AND user_id=$2",
      [principal.tenant_id, principal.user_id],
    )
  ).rows;
  const installation =
    principal.role === "admin" &&
    principal.actor_type === "human" &&
    principal.credential_kind === "web" &&
    installerOperations.has(operation) &&
    Boolean(
      (
        await client.query(
          "SELECT user_id FROM auth_installation_admin WHERE user_id=$1",
          [principal.user_id],
        )
      ).rowCount,
    );
  if (
    principal.actor_type !== "system" &&
    !installation &&
    !memberships.some((m) => m.role === principal.role)
  )
    throw permission("role no longer granted");
  let pat;
  if (principal.credential_kind === "pat") {
    pat = (
      await client.query(
        "SELECT id,user_id,scopes,revoked_at FROM api_token WHERE tenant_id=$1 AND token_hash=$2",
        [principal.tenant_id, principal.credential_hash],
      )
    ).rows[0];
    if (!pat || pat.revoked_at || pat.user_id !== principal.user_id)
      throw permission("PAT revoked or not bound to user");
  }
  return { ...principal, memberships, pat, installation, now };
}
export function checkTenant(principal, request) {
  if (request.actor.tenant_id !== principal.tenant_id)
    throw permission("tenant mismatch");
  for (const tid of [
    request.params?.tid,
    request.body?.tenant_id,
    request.query?.tenant_id,
  ])
    if (tid != null && tid !== principal.tenant_id)
      throw permission("tenant mismatch");
}
export async function checkScope({
  client,
  principal,
  scope,
  operation,
  request,
}) {
  const claimed =
    request.params?.bid ?? request.body?.brand_id ?? request.actor.brand_id;
  if (principal.brand_id && claimed && claimed !== principal.brand_id)
    throw permission("brand mismatch");
  if (scope.brand_id && claimed && scope.brand_id !== claimed)
    throw permission("object outside requested brand");
  if (
    ["owner", "editor", "viewer"].includes(principal.role) &&
    operation !== "user_member.read"
  ) {
    if (
      !scope.brand_id ||
      !principal.memberships.some(
        (m) => m.role === principal.role && m.brand_id === scope.brand_id,
      )
    )
      throw permission("brand membership required");
  }
  if (["content", "evidence"].includes(principal.role)) {
    const assigned = (
      await client.query(
        "SELECT object_type,object_id FROM task_assignment WHERE tenant_id=$1 AND user_id=$2",
        [principal.tenant_id, principal.user_id],
      )
    ).rows;
    if (
      !(scope.keys ?? []).some((key) =>
        assigned.some((a) => `${a.object_type}:${a.object_id}` === key),
      )
    )
      throw permission("assigned object required");
  }
}
export function checkAllow({ principal, endpoint, allow, jobs }) {
  if (principal.actor_type === "system") {
    const job = jobs[principal.job_name];
    if (
      !job?.endpoints.includes(endpoint.id) ||
      !principal.trigger_source ||
      !Object.entries(principal.trigger_source).length ||
      Object.entries(principal.trigger_source).some(
        ([k, v]) =>
          !job.trigger_allowed.includes(k) ||
          typeof v !== "string" ||
          !v.trim(),
      )
    )
      throw permission("job outside registered contract");
    if (job.batch_required && !principal.batch_id)
      throw permission("probe job needs batch_id");
  } else if (
    !allow.has(`${principal.role},${endpoint.resource},${endpoint.operation}`)
  )
    throw permission("operation denied");
}
export async function checkCredentialAndMode({
  client,
  principal,
  endpoint,
  request,
}) {
  if (principal.pat && !principal.pat.scopes.includes(endpoint.id))
    throw permission("PAT scope denied");
  if (humanDecisions.has(endpoint.id) && principal.actor_type !== "human")
    throw permission("human decision required");
  if (principal.actor_type === "system" && principal.batch_id) {
    const batchId =
      request.params?.id && endpoint.resource === "probe_batch"
        ? request.params.id
        : (request.body?.batch_id ?? request.body?.probe?.batch_id);
    if (batchId && batchId !== principal.batch_id)
      throw permission("job bound to a different batch");
  }
  const tenant = (
    await client.query("SELECT mode FROM tenant WHERE id=$1", [
      principal.tenant_id,
    ])
  ).rows[0];
  if (!tenant && endpoint.id !== "tenant.configure")
    throw permission("tenant not registered");
  if (["owner", "editor", "viewer"].includes(principal.role)) {
    if (
      tenant.mode === "diagnosis" &&
      ((endpoint.mutates_state && endpoint.id !== "objection.create") ||
        endpoint.resource === "opportunity_card")
    )
      throw permission("diagnosis contract is read-only");
    if (
      principal.role === "editor" &&
      endpoint.mutates_state &&
      endpoint.id !== "objection.create" &&
      tenant.mode !== "full"
    )
      throw permission("full workbench required");
  }
}
