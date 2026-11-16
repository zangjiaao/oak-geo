import contracts from "../../../docs/api/contracts.json" with { type: "json" };
import { createIdentityAuthority } from "./identity.mjs";
import {
  authenticate,
  checkTenant,
  checkAllow,
  checkCredentialAndMode,
} from "./authorization.mjs";
import { assertRuntimeConnection } from "./runtime-connection.mjs";
import { permission, ServiceError } from "./errors.mjs";

// Internal SSR bootstrap: only own identity/contract and candidate brand IDs.
// Brand data is delivered exclusively through existing brand.read (six layers).
// No raw data, business mutation, credential issuance or new public operation.
export async function readWorkspaceContext({
  client,
  application,
  secret,
  credential,
  now = Date.now,
}) {
  const identity = createIdentityAuthority({ secret, now });
  const claims = identity.verify(credential);
  if (
    !["web", "pat"].includes(claims.credential_kind) ||
    claims.actor_type !== "human"
  )
    throw permission();
  const actor = application.actorFromCredential(credential);
  await assertRuntimeConnection(client);
  let principal, mode, ids;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path TO public,pg_catalog,pg_temp");
    principal = await authenticate({
      client,
      identity,
      actor,
      operation: "brand.read",
      now,
    });
    checkTenant(principal, { actor });
    const endpoint = contracts.endpoints.find((e) => e.id === "brand.read");
    checkAllow({
      principal,
      endpoint,
      allow: new Set(endpoint.grants.map((r) => `${r},brand,read`)),
      jobs: contracts.jobs,
    });
    await checkCredentialAndMode({ client, principal, endpoint, request: {} });
    mode = (
      await client.query("SELECT mode FROM tenant WHERE id=$1", [
        principal.tenant_id,
      ])
    ).rows[0]?.mode;
    // These IDs never leave the service. The operation below applies brand and
    // task scope, PAT scope/revocation/rate limits, current roles and audit.
    ids = (
      await client.query(
        "SELECT id FROM brand WHERE tenant_id=$1 ORDER BY name,id",
        [principal.tenant_id],
      )
    ).rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const brands = [];
  for (const { id } of ids) {
    if (principal.brand_id && principal.brand_id !== id) continue;
    const result = await application.call("brand.read", {
      actor,
      params: { tid: principal.tenant_id, bid: id, id },
    });
    if (result.status === 403) continue;
    if (result.status !== 200)
      throw new ServiceError(
        result.status,
        result.error.code,
        "工作区暂不可用",
      );
    let has_profile=false;
    if(['owner','strategist'].includes(principal.role)){
      const profile=await application.call('product_profile.read',{actor,params:{tid:principal.tenant_id,bid:id}});
      has_profile=profile.status===200&&Boolean(profile.data.profile);
    }
    brands.push({
      has_profile,
      id: result.data.id,
      name: result.data.name,
      industry: result.data.industry,
      market: result.data.market,
    });
  }
  return {
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    role: principal.role,
    mode,
    can_write: principal.role === "strategist",
    brands,
  };
}
