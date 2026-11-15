import { randomUUID } from "node:crypto";
import {
  permission,
  validation,
  ServiceError,
  normalizeDatabaseError,
} from "./errors.mjs";
const policies = {
  "tenant.configure": ["admin"],
  "brand.configure": ["admin"],
  "user_member.configure": ["admin"],
  "brand_lexicon.create": ["strategist"],
  "brand_lexicon.submit": ["strategist"],
  "official_fact.create": ["strategist"],
  "official_fact.approve": ["factcheck"],
  "review_queue.approve": ["factcheck"],
};

// Trusted in-process service boundary for migration/fixture provisioning only.
// actor must come from a server authentication adapter, never an HTTP request body.
// Called inside the T05 authenticated transaction and its audit unit; not a
// public route. T07 seed writes are exclusively in seed-handlers.mjs.
export function provisioningOperations(client, { auditSink } = {}) {
  async function audit(actor, tenantId, operation, objectId) {
    if (auditSink)
      return auditSink({
        action: operation,
        object_type: operation.split(".")[0],
        object_id: objectId,
      });
    await client.query(
      `INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,actor_type,agent_run_id,prompt_version)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        tenantId,
        actor.user_id,
        operation,
        operation.split(".")[0],
        objectId,
        actor.actor_type,
        actor.agent_run_id ?? null,
        actor.prompt_version ?? null,
      ],
    );
  }
  async function queue(actor, tenantId, objectType, objectId) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO review_queue(id,tenant_id,object_type,object_id,submitted_by,status)
   VALUES($1,$2,$3,$4,$5,'waiting')`,
      [id, tenantId, objectType, objectId, actor.user_id],
    );
    await audit(actor, tenantId, "review_queue.submit", id);
    return id;
  }
  return async function execute(
    operation,
    { actor, tenant_id, body = {}, params = {} },
  ) {
    if (
      !actor?.user_id ||
      actor.actor_type !== "human" ||
      !policies[operation]?.includes(actor.role)
    )
      throw permission(
        "trusted principal cannot perform provisioning operation",
      );
    if (!tenant_id) throw validation("tenant_id required");
    const id = body.id ?? randomUUID();
    let result,
      objectId = id;
    try {
      if (operation === "tenant.configure") {
        await client.query(
          "INSERT INTO tenant(id,name,mode,plan) VALUES($1,$2,$3,$4)",
          [tenant_id, body.name, body.mode, body.plan],
        );
        objectId = tenant_id;
        result = { id: tenant_id };
      } else if (operation === "brand.configure") {
        await client.query(
          "INSERT INTO brand(id,tenant_id,name,industry,market) VALUES($1,$2,$3,$4,$5)",
          [id, tenant_id, body.name, body.industry, body.market],
        );
        result = { id };
      } else if (operation === "user_member.configure") {
        await client.query(
          "INSERT INTO user_member(id,tenant_id,user_id,brand_id,role) VALUES($1,$2,$3,$4,$5)",
          [id, tenant_id, body.user_id, body.brand_id ?? null, body.role],
        );
        result = { id };
      } else if (operation === "brand_lexicon.create") {
        if (!body.entries?.length)
          throw validation("complete lexicon entries required");
        // Lock the brand so concurrent version allocation cannot reuse a version.
        const brand = await client.query(
          "SELECT id FROM brand WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant_id, body.brand_id],
        );
        if (!brand.rowCount) throw permission();
        const version = Number(
          (
            await client.query(
              "SELECT coalesce(max(version),0)+1 AS version FROM brand_lexicon WHERE tenant_id=$1 AND brand_id=$2",
              [tenant_id, body.brand_id],
            )
          ).rows[0].version,
        );
        let head;
        for (const entry of body.entries) {
          const rowId = randomUUID();
          head ??= rowId;
          await client.query(
            "INSERT INTO brand_lexicon(id,tenant_id,brand_id,version,kind,term,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              rowId,
              tenant_id,
              body.brand_id,
              version,
              entry.kind,
              entry.term,
              actor.user_id,
            ],
          );
        }
        objectId = head;
        result = { version, version_object_id: head, effective: false };
      } else if (operation === "brand_lexicon.submit") {
        const row = (
          await client.query(
            "SELECT id,created_by,brand_id,version FROM brand_lexicon WHERE tenant_id=$1 AND id=$2",
            [tenant_id, params.id],
          )
        ).rows[0];
        if (!row || row.created_by !== actor.user_id)
          throw permission("only version author submits");
        await client.query(
          "SELECT id FROM brand WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant_id, row.brand_id],
        );
        const existingReview = await client.query(
          `SELECT q.id FROM review_queue q JOIN brand_lexicon l
           ON l.tenant_id=q.tenant_id AND l.id=q.object_id
           WHERE q.tenant_id=$1 AND q.object_type='brand_lexicon'
           AND l.brand_id=$2 AND l.version=$3 AND q.status IN ('waiting','approved')`,
          [tenant_id, row.brand_id, row.version],
        );
        if (existingReview.rowCount)
          throw new ServiceError(
            409,
            "state_conflict",
            "version already submitted or sealed",
          );
        objectId = row.id;
        result = {
          review_entry_id: await queue(
            actor,
            tenant_id,
            "brand_lexicon",
            row.id,
          ),
          object_id: row.id,
          status: "waiting",
        };
      } else if (operation === "official_fact.create") {
        await client.query(
          `INSERT INTO official_fact(id,tenant_id,brand_id,fact_category,content,source_level,status,effective_from,product_line_ref)
     VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8)`,
          [
            id,
            tenant_id,
            body.brand_id,
            body.fact_category,
            body.content,
            body.source_level,
            body.effective_from,
            body.product_line_ref ?? null,
          ],
        );
        result = {
          id,
          status: "draft",
          review_entry_id: await queue(actor, tenant_id, "official_fact", id),
        };
      } else if (
        operation === "review_queue.approve" ||
        operation === "official_fact.approve"
      ) {
        const rows =
          operation === "review_queue.approve"
            ? await client.query(
                "SELECT * FROM review_queue WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [tenant_id, params.id],
              )
            : await client.query(
                "SELECT * FROM review_queue WHERE tenant_id=$1 AND object_type='official_fact' AND object_id=$2 AND status='waiting' FOR UPDATE",
                [tenant_id, params.id],
              );
        const review = rows.rows[0];
        if (!review) {
          if (operation === "official_fact.approve")
            throw new ServiceError(
              409,
              "state_conflict",
              "waiting review required",
            );
          throw permission();
        }
        if (review.submitted_by === actor.user_id)
          throw permission("author cannot approve own version");
        if (review.status !== "waiting")
          throw new ServiceError(
            409,
            "state_conflict",
            "review already decided",
          );
        if (!["brand_lexicon", "official_fact"].includes(review.object_type))
          throw permission(
            "provisioning only handles onboarding basis objects",
          );
        await client.query(
          "UPDATE review_queue SET status='approved',decided_by=$1,decided_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND id=$3",
          [actor.user_id, tenant_id, review.id],
        );
        if (review.object_type === "official_fact") {
          await client.query(
            "UPDATE official_fact SET status='approved' WHERE tenant_id=$1 AND id=$2",
            [tenant_id, review.object_id],
          );
          await audit(
            actor,
            tenant_id,
            operation === "official_fact.approve"
              ? "review_queue.approve"
              : "official_fact.approve",
            operation === "official_fact.approve"
              ? review.id
              : review.object_id,
          );
        }
        objectId =
          operation === "official_fact.approve" ? review.object_id : review.id;
        result = { id: objectId, status: "approved" };
      }
      await audit(actor, tenant_id, operation, objectId);
      return result;
    } catch (error) {
      throw normalizeDatabaseError(error);
    }
  };
}

export async function executeProvisioningOperation({
  application,
  operation,
  context,
}) {
  if (!application)
    throw permission(
      "legacy provisioning requires authenticated runtime application",
    );
  if (
    Object.keys(context).some(
      (key) => !["actor", "tenant_id", "body", "params", "query"].includes(key),
    )
  )
    throw permission("untrusted provisioning authority declaration");
  const response = await application.call(operation, {
    actor: context.actor,
    body: context.body ?? {},
    params: { ...context.params, tid: context.tenant_id },
    query: context.query ?? {},
  });
  if (response.status >= 200 && response.status < 300) return response.data;
  throw new ServiceError(
    response.status,
    response.error.code,
    response.error.message,
    response.error.details,
  );
}
