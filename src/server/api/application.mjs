import { canonicalJson } from "./canonical-json.mjs";
import contracts from "../../../docs/api/contracts.json" with { type: "json" };
import {
  createHash,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { createIdentityAuthority, hashToken } from "./identity.mjs";
import {
  authenticate,
  checkTenant,
  checkScope,
  checkAllow,
  checkCredentialAndMode,
  permissionEvaluationOrder,
} from "./authorization.mjs";
import {
  assertRuntimeConnection,
  inspectRuntimeConnection,
} from "./runtime-connection.mjs";
import { createAuditUnit } from "./audit-transaction.mjs";
import { resourceScope } from "./resource-scope.mjs";
import { createDomainHandlers } from "./domain-handlers.mjs";
import { normalizeDatabaseError, permission, ServiceError } from "./errors.mjs";

const applications = new WeakSet();
export const isRuntimeApplication = (value) => applications.has(value);
const runtimeAllowSet = new Set(
  contracts.endpoints.flatMap((e) =>
    e.grants.map((role) => `${role},${e.resource},${e.operation}`),
  ),
);
const endpointMap = new Map(contracts.endpoints.map((e) => [e.id, e]));
export const policyTriples = () => Object.freeze([...runtimeAllowSet]);
export async function createApplication({
  client,
  secret,
  now = Date.now,
  modelCapabilities = () => null,
  publicRootCatalog = new Set(),
  limits = () => ({}),
  beforeAudit,
  observe,
}) {
  await assertRuntimeConnection(client);
  const identity = createIdentityAuthority({ secret, now });
  const handlers = Object.freeze(createDomainHandlers());
  for (const id of Object.keys(handlers))
    if (!endpointMap.has(id)) throw new Error("uncontracted handler: " + id);
  const cacheKey = createHash("sha256")
    .update(secret + "idempotency")
    .digest();
  const encrypt = (value) => {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", cacheKey, nonce);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return {
      encrypted: data.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  };
  const decrypt = (value) => {
    if (!value.encrypted) return value;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cacheKey,
      Buffer.from(value.nonce, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(value.encrypted, "base64")),
        decipher.final(),
      ]).toString(),
    );
  };

  const sideEffects = Object.freeze({
    "claim_block.create": ["content_reconcile:content_asset.transition"],
    "claim_block.revise": ["content_reconcile:content_asset.transition"],
    "claim_block.approve": ["content_reconcile:content_asset.transition"],
    "claim_block.reject": ["content_reconcile:content_asset.transition"],
    "claim_block.retract": ["content_reconcile:content_asset.transition"],
    "review_queue.approve": ["content_reconcile:content_asset.transition"],
    "review_queue.reject": ["content_reconcile:content_asset.transition"],
    "intent_cluster.archive": ["backflow_scan:backflow_ticket.create"],
  });
  async function authorizeRequest(operation, request) {
    const endpoint = endpointMap.get(operation);
    if (!endpoint || !handlers[operation])
      throw permission("operation not registered");
    observe?.("authentication");
    const principal = await authenticate({
      client,
      identity,
      actor: request.actor,
      operation,
      now,
    });
    Object.freeze(principal);
    observe?.("tenant");
    checkTenant(principal, request);
    observe?.("brand_or_assignment");
    const scope = await resourceScope(client, endpoint, request, principal);
    await checkScope({ client, principal, scope, operation, request });
    observe?.("allow");
    checkAllow({
      principal,
      endpoint,
      allow: runtimeAllowSet,
      jobs: contracts.jobs,
    });
    observe?.("credential_and_human_mode");
    await checkCredentialAndMode({ client, principal, endpoint, request });
    observe?.("business");
    return {
      client,
      principal,
      body: request.body ?? {},
      params: request.params ?? {},
      query: request.query ?? {},
      scope,
      now,
      operation,
      modelCapabilities,
      identity,
      publicRootCatalog,
      registeredOperations: Object.keys(handlers),
      rootEventId: randomUUID(),
    };
  }
  function attachUnit(ctx, units) {
    const audit = createAuditUnit({
      client,
      principal: ctx.principal,
      now,
      beforeAudit,
    });
    ctx.audit = audit;
    units.push(audit);
    ctx.runJob = async (jobName, operation, body, params = {}) => {
      if (!sideEffects[ctx.operation]?.includes(jobName + ":" + operation))
        throw permission("undeclared causal side effect");
      const claims = {
        user_id: "job-" + jobName,
        tenant_id: ctx.principal.tenant_id,
        role: "system",
        actor_type: "system",
        job_name: jobName,
        trigger_source: { event_id: body.cause_event_id ?? ctx.rootEventId },
      };
      const actor = { ...claims, credential: identity.issue(claims, "job") };
      const nested = await authorizeRequest(operation, { actor, body, params });
      const nestedAudit = attachUnit(nested, units);
      const result = await handlers[operation](nested);
      const endpoint = endpointMap.get(operation);
      nestedAudit.add({
        id: nested.rootEventId,
        action: operation,
        object_type: endpoint.resource,
        object_id:
          result.objectId ?? result.data?.id ?? ctx.principal.tenant_id,
        ...result.auditMeta,
      });
      return result.data;
    };
    return audit;
  }

  let tail = Promise.resolve();
  async function execute(operation, request = {}, transport = {}) {
    const endpoint = endpointMap.get(operation),
      handler = handlers[operation];
    const meta = {
      snapshot_id: null,
      data_as_of: new Date(now()).toISOString(),
    };
    let begun = false;
    try {
      if (!endpoint || !handler) throw permission("operation not registered");
      if (
        !request ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        Object.keys(request).some(
          (key) => !["actor", "body", "params", "query"].includes(key),
        )
      )
        throw permission("untrusted transport authority declaration");
      await assertRuntimeConnection(client);
      await client.query("BEGIN");
      begun = true;
      await client.query("SET LOCAL search_path TO public,pg_catalog,pg_temp");
      const ctx = await authorizeRequest(operation, request);
      const principal = ctx.principal,
        scope = ctx.scope;
      const units = [];
      const audit = attachUnit(ctx, units);
      const policy = await limits(principal.tenant_id);
      if (principal.pat && policy.perToken) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["rate:" + principal.pat.id],
        );
        const count = Number(
          (
            await client.query(
              "SELECT count(*) AS n FROM audit_log WHERE tenant_id=$1 AND object_type='api_token' AND object_id=$2 AND action='api_token.record_use' AND at>$3",
              [
                principal.tenant_id,
                principal.pat.id,
                new Date(now() - policy.perToken.windowMs).toISOString(),
              ],
            )
          ).rows[0].n,
        );
        if (count >= policy.perToken.maxCalls)
          throw new ServiceError(
            429,
            "quota_exceeded",
            "PAT rate quota exceeded",
          );
      }
      const usageType = {
        "probe_batch.execute": "probe",
        "probe_result.judge": "judge",
        "claim_block.create": "drafting",
        "claim_block.revise": "drafting",
      }[operation];
      const target =
        request.params?.id ?? scope.brand_id ?? principal.tenant_id;
      const principalKey = `${principal.user_id}:${principal.actor_type}:${principal.role}:${principal.credential_kind}`;
      const key = transport.idempotencyKey;
      const payloadHash = createHash("sha256")
        .update(canonicalJson([ctx.body, ctx.params, ctx.query]))
        .digest("hex");
      let cached;
      if (key && endpoint.mutates_state) {
        if (typeof key !== "string" || key.length > 256)
          throw new ServiceError(
            422,
            "validation_failed",
            "invalid Idempotency-Key",
          );
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [principal.tenant_id + principalKey + operation + target + key],
        );
        cached = (
          await client.query(
            "SELECT payload_hash,response FROM idempotency_record WHERE tenant_id=$1 AND principal_key=$2 AND operation=$3 AND target=$4 AND key=$5 AND expires_at>$6",
            [
              principal.tenant_id,
              principalKey,
              operation,
              target,
              key,
              new Date(now()).toISOString(),
            ],
          )
        ).rows[0];
        if (cached && cached.payload_hash !== payloadHash)
          throw new ServiceError(
            409,
            "state_conflict",
            "idempotency payload changed",
          );
      }
      let data;
      if (cached) {
        const original = decrypt(cached.response);
        data = original.data;
        Object.assign(meta, original.meta);
      } else {
        if (usageType && policy[usageType]) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["usage:" + principal.tenant_id + ":" + usageType],
          );
          const n = Number(
            (
              await client.query(
                "SELECT count(*) AS n FROM operation_usage WHERE tenant_id=$1 AND operation_type=$2 AND at>$3",
                [
                  principal.tenant_id,
                  usageType,
                  new Date(now() - policy[usageType].windowMs).toISOString(),
                ],
              )
            ).rows[0].n,
          );
          if (n >= policy[usageType].maxCalls)
            throw new ServiceError(
              429,
              "quota_exceeded",
              "operation quota exceeded",
            );
        }
        const result = await handler(ctx);
        data = JSON.parse(JSON.stringify(result.data));
        meta.snapshot_id =
          result.snapshot_id ??
          data?.snapshot_id ??
          ctx.scope.snapshot_id ??
          ctx.body.snapshot_id ??
          null;
        const id = result.objectId ?? data?.id ?? data?.snapshot_id ?? target;
        if (endpoint.mutates_state || result.sensitive)
          audit.add({
            id: ctx.rootEventId,
            action: operation,
            object_type: endpoint.resource,
            object_id: id,
            reason: ctx.body.reason ?? null,
            ...result.auditMeta,
          });
        if (result.usage) {
          await client.query(
            "INSERT INTO operation_usage(id,tenant_id,operation_type,object_id,at) VALUES($1,$2,$3,$4,$5)",
            [
              randomUUID(),
              principal.tenant_id,
              result.usage,
              id,
              new Date(now()).toISOString(),
            ],
          );
        }
        if (key && endpoint.mutates_state) {
          await client.query(
            `INSERT INTO idempotency_record(tenant_id,principal_key,operation,target,key,payload_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(tenant_id,principal_key,operation,target,key) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,
            [
              principal.tenant_id,
              principalKey,
              operation,
              target,
              key,
              payloadHash,
              JSON.stringify(encrypt({ data, meta })),
              new Date(now() + 24 * 3600_000).toISOString(),
            ],
          );
        }
      }
      if (principal.pat) {
        await client.query(
          "UPDATE api_token SET last_used_at=$1 WHERE tenant_id=$2 AND id=$3",
          [
            new Date(now()).toISOString(),
            principal.tenant_id,
            principal.pat.id,
          ],
        );
        audit.add({
          action: "api_token.record_use",
          object_type: "api_token",
          object_id: principal.pat.id,
          actor: {
            actor_type: "system",
            job_name: "audit_middleware",
            trigger_source: { event_id: "auth-" + randomUUID() },
          },
        });
      }
      for (const unit of units) await unit.commitEvents();
      observe?.("audit_written");
      await client.query("COMMIT");
      begun = false;
      observe?.("committed");
      meta.snapshot_id ??=
        data?.snapshot_id ??
        ctx.scope.snapshot_id ??
        ctx.body.snapshot_id ??
        null;
      observe?.("delivered");
      return { status: 200, data, meta };
    } catch (error) {
      observe?.("failure", {
        operation,
        code: error.code,
        message: error.message,
      });
      if (begun) await client.query("ROLLBACK");
      const e =
        error?.code === "42501"
          ? permission("database row policy denied")
          : normalizeDatabaseError(error);
      return {
        status: e instanceof ServiceError ? e.status : 500,
        error: {
          code: e instanceof ServiceError ? e.code : "internal_error",
          message:
            e instanceof ServiceError
              ? e.status === 403
                ? "permission denied"
                : e.message
              : "service transaction failed",
          details: e instanceof ServiceError ? e.details : {},
        },
        meta,
      };
    }
  }
  function call(operation, request, transport) {
    const work = tail.then(() => execute(operation, request, transport));
    tail = work.catch(() => {});
    return work;
  }
  // Identity issuance is an installation/provider capability, never a public route.
  function issueActor(
    claims,
    kind = claims.actor_type === "system" ? "job" : "web",
  ) {
    const credential = identity.issue(claims, kind);
    return { ...claims, credential };
  }
  const application = Object.freeze({
    call,
    issueActor,
    registeredOperations: () => Object.keys(handlers),
    inspectSecurity: () => inspectRuntimeConnection(client),
    evaluationOrder: permissionEvaluationOrder,
  });
  applications.add(application);
  return application;
}
