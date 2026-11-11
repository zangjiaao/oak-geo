import { pageQuery } from "./pagination.mjs";
import { relationalKeys, assignmentPredicate } from "./assignment-scope.mjs";
import { randomUUID } from "node:crypto";
import {
  required,
  insertRow,
  getRow,
  change,
  conflict,
  json,
  event,
  queueObject,
  assetRequirements,
  currentBlocks,
  reconcileAsset,
} from "./domain-common.mjs";
import { permission, validation } from "./errors.mjs";
import { provisioningOperations } from "./provisioning-service.mjs";
import { hashToken } from "./identity.mjs";
import { limit } from "./catalog-handlers.mjs";
import { checkScope } from "./authorization.mjs";
export function contentHandlers() {
  const h = {};
  h["content_asset.create"] = async (ctx) => {
    required(ctx.body, ["opportunity_card_id", "type"]);
    const card = await getRow(
      ctx,
      "opportunity_card",
      ctx.body.opportunity_card_id,
    );
    const row = await insertRow(ctx, "content_asset", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      brand_id: card.brand_id,
      opportunity_card_id: card.id,
      type: ctx.body.type,
      platform: ctx.body.platform ?? null,
      author: ctx.principal.user_id,
      review_status: "draft",
      originated_by_internal: ctx.principal.role === "content",
    });
    return { data: row };
  };
  h["content_asset.transition"] = async (ctx) => {
    required(ctx.body, [
      "content_asset_id",
      "trigger_claim_id",
      "cause_event_id",
    ]);
    const claim = await getRow(ctx, "claim_block", ctx.body.trigger_claim_id);
    if (claim.content_asset_id !== ctx.body.content_asset_id)
      throw validation("cause not related to asset");
    if (
      ctx.body.retract_id &&
      (ctx.body.retract_id !== claim.id || claim.status !== "retracted")
    )
      throw validation("retract cause invalid");
    await reconcileAsset(ctx, claim.content_asset_id, {
      retractId: ctx.body.retract_id,
      cause: ctx.body.cause_event_id,
    });
    return { data: await getRow(ctx, "content_asset", claim.content_asset_id) };
  };
  h["content_asset.read"] = async (ctx) => {
    const row = await getRow(ctx, "content_asset", ctx.params.id);
    const block_versions = (
      await ctx.client.query(
        "SELECT id,logical_id,version,status FROM claim_block WHERE tenant_id=$1 AND content_asset_id=$2 ORDER BY logical_id,version",
        [ctx.principal.tenant_id, row.id],
      )
    ).rows;
    return { data: { ...row, block_versions } };
  };
  h["claim_block.create"] = async (ctx) => {
    requireClaim(ctx.body);
    const asset = await getRow(ctx, "content_asset", ctx.body.content_asset_id);
    if (asset.review_status === "retired") throw conflict();
    const id = randomUUID();
    const row = await insertRow(ctx, "claim_block", {
      id,
      tenant_id: ctx.principal.tenant_id,
      content_asset_id: asset.id,
      logical_id: id,
      version: 1,
      created_by: ctx.principal.user_id,
      ...claimFields(ctx.body),
      status: "draft",
    });
    await reconcileAsset(ctx, asset.id, { triggerClaimId: row.id });
    return { data: row, usage: "drafting" };
  };
  h["claim_block.read"] = async (ctx) => ({
    data: await getRow(ctx, "claim_block", ctx.params.id),
  });
  h["claim_block.revise"] = async (ctx) => {
    required(ctx.body, ["reason"]);
    requireClaim(ctx.body);
    const old = await getRow(ctx, "claim_block", ctx.params.id, { lock: true });
    if (
      !["approved", "retracted"].includes(old.status) ||
      old.created_by !== ctx.principal.user_id
    )
      throw conflict("revision requires author and sealed/retracted version");
    const asset = await getRow(ctx, "content_asset", old.content_asset_id, {
      lock: true,
    });
    if (asset.review_status === "retired") throw conflict();
    const next = Number(
      (
        await ctx.client.query(
          "SELECT max(version)+1 AS version FROM claim_block WHERE tenant_id=$1 AND logical_id=$2",
          [ctx.principal.tenant_id, old.logical_id],
        )
      ).rows[0].version,
    );
    const row = await insertRow(ctx, "claim_block", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      content_asset_id: old.content_asset_id,
      logical_id: old.logical_id,
      version: next,
      created_by: ctx.principal.user_id,
      ...claimFields(ctx.body),
      status: "draft",
    });
    await reconcileAsset(ctx, asset.id, { triggerClaimId: row.id });
    return { data: row, usage: "drafting" };
  };
  h["claim_block.submit"] = async (ctx) => {
    const row = await getRow(ctx, "claim_block", ctx.params.id, { lock: true });
    if (row.created_by !== ctx.principal.user_id)
      throw permission("only author submits");
    if (row.status !== "draft") throw conflict();
    requireClaim(row);
    if (row.valid_until && new Date(row.valid_until).getTime() <= ctx.now())
      throw validation("source validity ended");
    const req = await assetRequirements(ctx, row.content_asset_id),
      blocks = await currentBlocks(ctx, row.content_asset_id);
    if (req.some((kind) => !blocks.some((b) => b.block_kind === kind)))
      throw validation("required intent blocks missing", {
        required_sections: req,
      });
    // Only the two examples explicitly published in product §6; no invented regex.
    if (
      blocks.some(
        (b) => b.text.includes("如上文所述") || b.text.includes("见表"),
      )
    )
      throw validation("block is not self-contained");
    await change(ctx, "claim_block", row.id, { status: "pending_review" });
    const queue = await queueObject(ctx, "claim_block", row.id, row.created_by);
    return {
      data: { id: row.id, status: "pending_review", review_entry_id: queue.id },
    };
  };
  h["claim_block.approve"] = (ctx) =>
    decideObject(ctx, "claim_block", "approved");
  h["claim_block.reject"] = (ctx) =>
    decideObject(ctx, "claim_block", "rejected");
  h["claim_block.retract"] = async (ctx) => {
    required(ctx.body, ["reason"]);
    const row = await getRow(ctx, "claim_block", ctx.params.id, { lock: true });
    if (row.status !== "approved") throw conflict();
    const cause = randomUUID();
    await change(ctx, "claim_block", row.id, { status: "retracted" });
    await reconcileAsset(ctx, row.content_asset_id, {
      retractId: row.id,
      cause,
    });
    return {
      data: { id: row.id, status: "retracted" },
      auditMeta: { id: cause },
    };
  };
  h["review_queue.submit"] = async (ctx) => {
    required(ctx.body, ["object_type", "object_id"]);
    const type = ctx.body.object_type;
    if (type === "brand_lexicon") {
      const data = await provisioningOperations(ctx.client, {
        auditSink: ctx.audit.add,
      })("brand_lexicon.submit", {
        actor: ctx.principal,
        tenant_id: ctx.principal.tenant_id,
        body: ctx.body,
        params: { id: ctx.body.object_id },
      });
      return { data: { id: data.review_entry_id, status: "waiting" } };
    }
    const table = reviewTable(type);
    const row = await getRow(ctx, table, ctx.body.object_id);
    if (type === "official_fact") {
      const prior = (
        await ctx.client.query(
          "SELECT submitted_by FROM review_queue WHERE tenant_id=$1 AND object_type='official_fact' AND object_id=$2 ORDER BY submitted_at,id LIMIT 1",
          [ctx.principal.tenant_id, row.id],
        )
      ).rows[0];
      if (prior?.submitted_by !== ctx.principal.user_id)
        throw permission("only fact author resubmits");
      if (row.status !== "draft") throw conflict();
      return { data: await queueObject(ctx, type, row.id) };
    }
    if (row.created_by !== ctx.principal.user_id)
      throw permission("only author submits object");
    if (row.status !== "draft") throw conflict();
    const queue = await queueObject(ctx, type, row.id, row.created_by);
    return { data: queue };
  };
  h["review_queue.read"] = async (ctx) => ({
    data: await pageQuery(ctx, {
      table: "review_queue",
      columns:
        "id,object_type,object_id,submitted_by,submitted_at,status,decided_by,decided_at,reject_reason",
      where: "tenant_id=$1",
      values: [ctx.principal.tenant_id],
    }),
  });
  h["review_queue.approve"] = (ctx) => decideQueue(ctx, "approved");
  h["review_queue.reject"] = (ctx) => decideQueue(ctx, "rejected");
  h["review_queue.withdraw"] = async (ctx) => {
    const queue = await getRow(ctx, "review_queue", ctx.params.id, {
      lock: true,
    });
    if (queue.submitted_by !== ctx.principal.user_id) throw permission();
    if (queue.status !== "waiting") throw conflict();
    await change(ctx, "review_queue", queue.id, {
      status: "withdrawn",
      decided_by: ctx.principal.user_id,
      decided_at: new Date(ctx.now()).toISOString(),
    });
    if (queue.object_type === "claim_block") {
      await change(ctx, "claim_block", queue.object_id, { status: "draft" });
      event(ctx, "claim_block.withdraw", "claim_block", queue.object_id);
    }
    return { data: { id: queue.id, status: "withdrawn" } };
  };
  h["evidence_package.create"] = async (ctx) => {
    required(ctx.body, ["brand_id", "items"]);
    if (!ctx.body.items.length) throw validation("evidence items required");
    const id = randomUUID();
    const pack = await insertRow(ctx, "evidence_package", {
      id,
      tenant_id: ctx.principal.tenant_id,
      brand_id: ctx.body.brand_id,
      logical_id: id,
      version: 1,
      status: "draft",
      created_by: ctx.principal.user_id,
    });
    for (const item of ctx.body.items) {
      required(item, ["conclusion_text", "probe_id", "source_level"]);
      const probe = (
        await ctx.client.query(
          "SELECT p.id,p.intent_cluster_id,c.brand_id,q.source_word_id FROM probe p JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id JOIN intent_cluster c ON c.tenant_id=p.tenant_id AND c.id=p.intent_cluster_id WHERE p.tenant_id=$1 AND p.id=$2",
          [ctx.principal.tenant_id, item.probe_id],
        )
      ).rows[0];
      if (!probe || probe.brand_id !== pack.brand_id) throw permission();
      await checkScope({
        client: ctx.client,
        principal: ctx.principal,
        operation: ctx.operation,
        request: { actor: ctx.principal },
        scope: {
          brand_id: pack.brand_id,
          keys: await relationalKeys(ctx.client, ctx.principal.tenant_id, {
            clusterId: probe.intent_cluster_id,
            sourceId: probe.source_word_id,
          }),
        },
      });
      const row = await insertRow(ctx, "evidence_item", {
        id: randomUUID(),
        tenant_id: ctx.principal.tenant_id,
        package_id: id,
        conclusion_text: item.conclusion_text,
        probe_id: item.probe_id,
        source_level: item.source_level,
        excerpt: item.excerpt ?? null,
      });
      event(ctx, "evidence_package.create_item", "evidence_item", row.id);
    }
    return { data: pack };
  };
  h["evidence_package.read"] = async (ctx) => {
    const pack = await getRow(ctx, "evidence_package", ctx.params.id);
    if (
      ["owner", "editor", "viewer"].includes(ctx.principal.role) &&
      pack.status !== "sealed"
    )
      throw permission("draft evidence not client-visible");
    const items = (
      await ctx.client.query(
        `SELECT e.id,e.package_id,e.conclusion_text,e.probe_id,e.source_level,e.created_at FROM evidence_item e JOIN probe p ON p.tenant_id=e.tenant_id AND p.id=e.probe_id JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id WHERE e.tenant_id=$1 AND e.package_id=$2 AND ($3::boolean=false OR ${assignmentPredicate({ user: "$4" })}) ORDER BY e.id`,
        [
          ctx.principal.tenant_id,
          pack.id,
          ctx.principal.role === "evidence",
          ctx.principal.user_id,
        ],
      )
    ).rows;
    return { data: { ...pack, items } };
  };
  h["evidence_package.approve"] = (ctx) =>
    decideObject(ctx, "evidence_package", "approved");
  h["diagnosis_report.create"] = async (ctx) => {
    required(ctx.body, ["opportunity_ids", "probe_ids", "evidence_package_id"]);
    if (ctx.body.opportunity_ids.length !== 3)
      throw validation("diagnosis requires three opportunities");
    const cards = [];
    for (const id of ctx.body.opportunity_ids)
      cards.push(await getRow(ctx, "opportunity_card", id));
    if (
      new Set(cards.map((c) => c.brand_id)).size !== 1 ||
      new Set(cards.map((c) => c.intent_cluster_id)).size !== 3 ||
      new Set(cards.map((c) => c.snapshot_id)).size !== 1
    )
      throw validation(
        "three distinct same-brand comparable clusters required",
      );
    const brand = cards[0].brand_id,
      snapshot = cards[0].snapshot_id;
    const cover = (
      await ctx.client.query(
        "SELECT c.id,s.n_valid FROM intent_cluster c LEFT JOIN cluster_score s ON s.tenant_id=c.tenant_id AND s.cluster_id=c.id AND s.snapshot_id=$3 WHERE c.tenant_id=$1 AND c.brand_id=$2",
        [ctx.principal.tenant_id, brand, snapshot],
      )
    ).rows;
    if (
      cover.length !== 30 ||
      cover.filter((c) => c.n_valid >= 70).length < 25 ||
      cards.some(
        (card) =>
          !cover.some(
            (c) => c.id === card.intent_cluster_id && c.n_valid >= 70,
          ),
      )
    )
      throw validation(
        "delivery coverage/suggested-cluster sample gate failed",
      );
    const pack = await getRow(
      ctx,
      "evidence_package",
      ctx.body.evidence_package_id,
    );
    if (pack.brand_id !== brand || pack.status !== "sealed")
      throw validation("sealed evidence package required");
    const items = (
      await ctx.client.query(
        "SELECT probe_id,source_level FROM evidence_item WHERE tenant_id=$1 AND package_id=$2",
        [ctx.principal.tenant_id, pack.id],
      )
    ).rows;
    if (
      ctx.body.probe_ids.length < 30 ||
      ctx.body.probe_ids.some(
        (id) =>
          !items.some(
            (item) =>
              item.probe_id === id &&
              ["L1", "L2", "L3"].includes(item.source_level),
          ),
      )
    )
      throw validation("30 traceable conclusions required");
    const id = randomUUID();
    const row = await insertRow(ctx, "diagnosis_record", {
      id,
      tenant_id: ctx.principal.tenant_id,
      brand_id: brand,
      logical_id: id,
      version: 1,
      status: "draft",
      created_by: ctx.principal.user_id,
      probe_ids: ctx.body.probe_ids,
      package_id: pack.id,
    });
    await queueObject(ctx, "diagnosis_report", id);
    return { data: row };
  };
  h["diagnosis_report.approve"] = (ctx) =>
    decideObject(ctx, "diagnosis_report", "approved");
  h["diagnosis_report.read"] = async (ctx) => {
    const report = await getRow(ctx, "diagnosis_record", ctx.params.id);
    if (
      ["owner", "editor", "viewer"].includes(ctx.principal.role) &&
      report.status !== "sealed"
    )
      throw permission("draft report not client-visible");
    const conclusions = (
      await ctx.client.query(
        `SELECT e.conclusion_text,e.probe_id,e.source_level FROM evidence_item e JOIN probe p ON p.tenant_id=e.tenant_id AND p.id=e.probe_id JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id WHERE e.tenant_id=$1 AND e.package_id=$2 AND e.probe_id=ANY($3::text[]) AND ($4::boolean=false OR ${assignmentPredicate({ user: "$5" })}) ORDER BY e.id`,
        [
          ctx.principal.tenant_id,
          report.package_id,
          report.probe_ids,
          ctx.principal.role === "evidence",
          ctx.principal.user_id,
        ],
      )
    ).rows;
    return {
      data: {
        id: report.id,
        status: report.status,
        version: report.version,
        conclusions,
      },
    };
  };
  h["audit_log.read"] = async (ctx) => ({
    data: await pageQuery(ctx, {
      table: "audit_log",
      columns:
        "id,action,object_type,object_id,at,actor_type,agent_run_id,prompt_version,job_name,batch_id,trigger_source,viewing_session_id,viewer_user_id,reason,cause_event_id",
      where:
        "tenant_id=$1 AND ($2::text IS NULL OR object_id=$2) AND ($3::text IS NULL OR object_type=$3)",
      values: [
        ctx.principal.tenant_id,
        ctx.query.object_id ?? null,
        ctx.query.object_type ?? null,
      ],
      order: [
        ["at", "DESC"],
        ["id", "DESC"],
      ],
    }),
  });
  h["api_token.create"] = async (ctx) => {
    required(ctx.body, ["user_id", "scopes"]);
    if (
      !Array.isArray(ctx.body.scopes) ||
      ctx.body.scopes.some((scope) => !ctx.registeredOperations.includes(scope))
    )
      throw validation("unknown PAT scope");
    const members = (
      await ctx.client.query(
        "SELECT role,brand_id FROM user_member WHERE tenant_id=$1 AND user_id=$2 ORDER BY role",
        [ctx.principal.tenant_id, ctx.body.user_id],
      )
    ).rows;
    const member = members.find(
      (m) => !ctx.body.role || m.role === ctx.body.role,
    );
    if (!member) throw validation("PAT user has no membership");
    const token = ctx.identity.issue(
      {
        user_id: ctx.body.user_id,
        tenant_id: ctx.principal.tenant_id,
        role: member.role,
        ...(["owner", "editor", "viewer"].includes(member.role)
          ? { brand_id: member.brand_id }
          : {}),
        actor_type: "human",
      },
      "pat",
    );
    const row = await insertRow(ctx, "api_token", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      user_id: ctx.body.user_id,
      token_hash: hashToken(token),
      scopes: json(ctx.body.scopes),
    });
    return {
      data: {
        id: row.id,
        token,
        created_at: row.created_at,
        scopes: ctx.body.scopes,
      },
      objectId: row.id,
    };
  };
  h["api_token.read"] = async (ctx) => ({
    data: await pageQuery(ctx, {
      table: "api_token",
      columns: "id,user_id,scopes,created_at,last_used_at,revoked_at",
      where: "tenant_id=$1",
      values: [ctx.principal.tenant_id],
    }),
  });
  h["api_token.revoke"] = async (ctx) => {
    required(ctx.body, ["reason"]);
    const row = await getRow(ctx, "api_token", ctx.params.id, { lock: true });
    if (row.revoked_at) throw conflict("token already revoked");
    return { data: await tokenRevoke(ctx, row.id) };
  };
  return h;
}
async function tokenRevoke(ctx, id) {
  await change(ctx, "api_token", id, {
    revoked_at: new Date(ctx.now()).toISOString(),
  });
  return { id, revoked_at: new Date(ctx.now()).toISOString() };
}
function requireClaim(body) {
  required(body, [
    "content_asset_id",
    "text",
    "number",
    "unit",
    "scope",
    "source_url",
    "source_level",
  ]);
  if (!["L1", "L2"].includes(body.source_level))
    throw validation("L3 cannot enter claim_block");
}
function claimFields(b) {
  return {
    text: b.text,
    number: b.number,
    unit: b.unit,
    scope: b.scope,
    source_url: b.source_url,
    source_level: b.source_level,
    source_checked_at: b.source_checked_at ?? null,
    valid_until: b.valid_until ?? null,
    block_kind: b.block_kind ?? null,
  };
}
function reviewTable(type) {
  const table = {
    claim_block: "claim_block",
    evidence_package: "evidence_package",
    diagnosis_report: "diagnosis_record",
    official_fact: "official_fact",
  }[type];
  if (!table) throw validation("unsupported review object");
  return table;
}
async function decideObject(ctx, type, decision) {
  const q = (
    await ctx.client.query(
      "SELECT id FROM review_queue WHERE tenant_id=$1 AND object_type=$2 AND object_id=$3 AND status='waiting' FOR UPDATE",
      [ctx.principal.tenant_id, type, ctx.params.id],
    )
  ).rows[0];
  if (!q) throw conflict("waiting review required");
  const result = await decideQueue({ ...ctx, params: { id: q.id } }, decision);
  return {
    data: {
      id: ctx.params.id,
      status:
        type === "claim_block"
          ? decision === "approved"
            ? "approved"
            : "draft"
          : decision === "approved"
            ? "sealed"
            : "draft",
    },
    auditMeta: result.auditMeta,
  };
}
async function decideQueue(ctx, decision) {
  if (decision === "rejected") required(ctx.body, ["reason"]);
  const queue = await getRow(ctx, "review_queue", ctx.params.id, {
    lock: true,
  });
  if (queue.status !== "waiting") throw conflict("review already decided");
  if (queue.submitted_by === ctx.principal.user_id)
    throw permission("author cannot decide own version");
  if (["brand_lexicon", "official_fact"].includes(queue.object_type)) {
    if (decision === "rejected") {
      await change(ctx, "review_queue", queue.id, {
        status: "rejected",
        decided_by: ctx.principal.user_id,
        decided_at: new Date(ctx.now()).toISOString(),
        reject_reason: ctx.body.reason,
      });
      event(
        ctx,
        queue.object_type + ".reject",
        queue.object_type,
        queue.object_id,
      );
      return { data: { id: queue.id, status: "rejected" } };
    }
    const data = await provisioningOperations(ctx.client, {
      auditSink: ctx.audit.add,
    })("review_queue.approve", {
      actor: ctx.principal,
      tenant_id: ctx.principal.tenant_id,
      body: ctx.body,
      params: ctx.params,
    });
    return { data };
  }
  const table = reviewTable(queue.object_type),
    object = await getRow(ctx, table, queue.object_id, { lock: true });
  if (object.created_by === ctx.principal.user_id)
    throw permission("author cannot decide own version");
  if (
    (queue.object_type === "claim_block" &&
      object.status !== "pending_review") ||
    (queue.object_type !== "claim_block" && object.status !== "draft")
  )
    throw conflict();
  const cause = randomUUID();
  const status =
    queue.object_type === "claim_block"
      ? decision === "approved"
        ? "approved"
        : "draft"
      : decision === "approved"
        ? "sealed"
        : "draft";
  const fields = { status };
  if (status === "sealed") {
    fields.sealed_by = ctx.principal.user_id;
    fields.sealed_at = new Date(ctx.now()).toISOString();
  }
  await change(ctx, table, object.id, fields);
  await change(ctx, "review_queue", queue.id, {
    status: decision,
    decided_by: ctx.principal.user_id,
    decided_at: new Date(ctx.now()).toISOString(),
    reject_reason: decision === "rejected" ? ctx.body.reason : null,
  });
  event(
    ctx,
    `review_queue.${decision === "approved" ? "approve" : "reject"}`,
    "review_queue",
    queue.id,
  );
  event(
    ctx,
    `${queue.object_type}.${decision === "approved" ? "approve" : "reject"}`,
    queue.object_type,
    object.id,
    { id: cause },
  );
  if (queue.object_type === "claim_block")
    await reconcileAsset(ctx, object.content_asset_id, {
      cause,
      triggerClaimId: object.id,
    });
  return {
    data: { id: queue.id, status: decision },
    auditMeta: ctx.operation.startsWith("claim_block.")
      ? { id: cause }
      : undefined,
  };
}
