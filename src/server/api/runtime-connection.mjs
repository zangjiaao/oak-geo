import { permission } from "./errors.mjs";
export const tenantBusinessTables = Object.freeze([
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
]);
export async function inspectRuntimeConnection(client) {
  const identity = (
    await client.query(
      "SELECT current_user AS current_user, session_user AS session_user",
    )
  ).rows[0];
  const roles = (
    await client.query(`SELECT r.rolname AS name,r.rolsuper AS superuser,r.rolbypassrls AS bypassrls,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relowner=r.oid) AS "ownsBusinessTables"
 FROM pg_roles r WHERE r.rolname IN (current_user,session_user)`)
  ).rows;
  const tenantTables = (
    await client.query(
      `SELECT c.relname AS name,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [tenantBusinessTables],
    )
  ).rows;
  return {
    currentUser: identity.current_user,
    sessionUser: identity.session_user,
    roles,
    tenantTables,
  };
}
export async function assertRuntimeConnection(client) {
  const info = await inspectRuntimeConnection(client);
  if (
    info.currentUser !== "geo_app" ||
    info.sessionUser !== "geo_app" ||
    info.roles.some((r) => r.superuser || r.bypassrls || r.ownsBusinessTables)
  )
    throw permission(
      "management connection is forbidden for runtime fixture/call",
    );
  if (info.tenantTables.length !== 25 || info.tenantTables.some((t) => !t.rls))
    throw permission("tenant RLS is not installed");
}
