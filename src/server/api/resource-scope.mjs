import { relationalKeys } from "./assignment-scope.mjs";
import { permission } from "./errors.mjs";
const simple = Object.freeze({
  brand: "brand",
  intent_cluster: "intent_cluster",
  opportunity_card: "opportunity_card",
  content_asset: "content_asset",
  claim_block: "claim_block",
  evidence_package: "evidence_package",
  diagnosis_report: "diagnosis_record",
  backflow_ticket: "backflow_ticket",
  probe_batch: "probe_batch",
  metric_snapshot: "metric_snapshot",
  review_queue: "review_queue",
  official_fact: "official_fact",
});
export async function resourceScope(client, endpoint, request, principal) {
  const b = request.body ?? {},
    p = request.params ?? {},
    q = request.query ?? {};
  const tid = principal.tenant_id;
  let brand_id =
      b.brand_id ?? p.bid ?? request.actor?.brand_id ?? principal.brand_id,
    clusterId = b.cluster_id ?? b.intent_cluster_id ?? q.cluster_id,
    cardId = b.opportunity_card_id,
    assetId = b.content_asset_id,
    sourceId = b.source_word_id,
    snapshot_id;
  let id = p.id,
    resource = endpoint.resource;
  const extraKeys = [];
  const read = async (sql, params) => {
    const row = (await client.query(sql, params)).rows[0];
    if (!row) throw permission("object outside accessible scope");
    return row;
  };
  if (resource === "review_queue" && !id && b.object_type && b.object_id)
    return resourceScope(
      client,
      { resource: b.object_type },
      { actor: request.actor, params: { id: b.object_id } },
      principal,
    );
  if (resource === 'product_profile') {
    if (!brand_id) throw permission('brand required');
    await read('SELECT id FROM brand WHERE tenant_id=$1 AND id=$2', [tid,brand_id]);
  }
  if (id && simple[resource]) {
    const row = await read(
      `SELECT * FROM ${simple[resource]} WHERE tenant_id=$1 AND id=$2`,
      [tid, id],
    );
    snapshot_id = row.snapshot_id ?? snapshot_id;
    brand_id = row.brand_id ?? brand_id;
    clusterId = row.intent_cluster_id ?? row.cluster_id ?? clusterId;
    assetId = row.content_asset_id ?? assetId;
    cardId = row.opportunity_card_id ?? cardId;
    if (resource === "brand") brand_id = row.id;
    if (resource === "intent_cluster") clusterId = row.id;
    if (resource === "opportunity_card") cardId = row.id;
    if (resource === "content_asset") assetId = row.id;
    if (resource === "probe_batch") {
      for (const set of row.cluster_question_sets) {
        extraKeys.push(
          ...(await relationalKeys(client, tid, { clusterId: set.cluster_id })),
        );
        const sources = (
          await client.query(
            "SELECT source_word_id FROM question_pool WHERE tenant_id=$1 AND id=ANY($2::text[])",
            [tid, set.question_ids],
          )
        ).rows;
        extraKeys.push(
          ...sources.map((source) => "keyword_raw:" + source.source_word_id),
        );
      }
    }
    if (["evidence_package", "diagnosis_report"].includes(resource)) {
      const packageId =
        resource === "evidence_package" ? row.id : row.package_id;
      const related = (
        await client.query(
          "SELECT DISTINCT p.intent_cluster_id,q.source_word_id FROM evidence_item e JOIN probe p ON p.tenant_id=e.tenant_id AND p.id=e.probe_id JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id WHERE e.tenant_id=$1 AND e.package_id=$2",
          [tid, packageId],
        )
      ).rows;
      for (const row of related)
        extraKeys.push(
          ...(await relationalKeys(client, tid, {
            clusterId: row.intent_cluster_id,
            sourceId: row.source_word_id,
          })),
        );
    }
    if (resource === "review_queue") {
      const nested = await resourceScope(
        client,
        { resource: row.object_type },
        { params: { id: row.object_id } },
        principal,
      );
      return nested;
    }
  }
  if (resource === "evidence_package" && !id && Array.isArray(b.items)) {
    const ids = b.items.map((item) => item.probe_id);
    const related = (
      await client.query(
        "SELECT DISTINCT p.intent_cluster_id,q.source_word_id FROM probe p JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id WHERE p.tenant_id=$1 AND p.id=ANY($2::text[])",
        [tid, ids],
      )
    ).rows;
    for (const row of related)
      extraKeys.push(
        ...(await relationalKeys(client, tid, {
          clusterId: row.intent_cluster_id,
          sourceId: row.source_word_id,
        })),
      );
  }
  if (id && resource === "question_pool") {
    let row = (
      await client.query(
        "SELECT cluster_id,source_word_id FROM question_pool WHERE tenant_id=$1 AND id=$2",
        [tid, id],
      )
    ).rows[0];
    // A deleted draft still needs ordinary tenant/brand/allow/PAT checks before
    // the dispatcher may replay its encrypted idempotency result. Only the
    // deletion action may recover IDs from its immutable, server-written audit.
    if (!row && endpoint.id === "question_pool.delete") {
      const receipt = (
        await client.query(
          "SELECT reason FROM audit_log WHERE tenant_id=$1 AND object_type='question_pool' AND object_id=$2 AND action='question_pool.delete' ORDER BY at DESC LIMIT 1",
          [tid, id],
        )
      ).rows[0];
      try {
        const saved = JSON.parse(receipt?.reason ?? "null");
        if (
          saved?.operation === endpoint.id &&
          typeof saved.cluster_id === "string" &&
          typeof saved.source_word_id === "string"
        )
          row = {
            cluster_id: saved.cluster_id,
            source_word_id: saved.source_word_id,
          };
      } catch {}
    }
    if (!row) throw permission("object outside accessible scope");
    clusterId = row.cluster_id;
    sourceId = row.source_word_id;
  }
  if (id && resource === "brand_lexicon")
    brand_id = (
      await read(
        "SELECT brand_id FROM brand_lexicon WHERE tenant_id=$1 AND id=$2",
        [tid, id],
      )
    ).brand_id;
  if (id && resource === "keyword_raw") {
    await read("SELECT id FROM keyword_raw WHERE tenant_id=$1 AND id=$2", [
      tid,
      id,
    ]);
    sourceId = id;
  }
  if (id && resource === "cluster_score")
    clusterId = (
      await read(
        "SELECT cluster_id FROM cluster_score WHERE tenant_id=$1 AND id=$2",
        [tid, id],
      )
    ).cluster_id;
  if (id && resource === "scoring_snapshot") {
    await read(
      "SELECT snapshot_id FROM scoring_snapshot WHERE tenant_id=$1 AND snapshot_id=$2",
      [tid, id],
    );
    snapshot_id = id;
    const related = (
      await client.query(
        "SELECT intent_cluster_id FROM opportunity_card WHERE tenant_id=$1 AND snapshot_id=$2",
        [tid, id],
      )
    ).rows;
    extraKeys.push(
      ...related.map((r) => "intent_cluster:" + r.intent_cluster_id),
    );
    const batches = (
      await client.query(
        "SELECT cluster_question_sets FROM probe_batch WHERE tenant_id=$1 AND snapshot_id=$2",
        [tid, id],
      )
    ).rows;
    for (const b of batches)
      extraKeys.push(
        ...b.cluster_question_sets.map(
          (set) => "intent_cluster:" + set.cluster_id,
        ),
      );
  }
  if (id && resource === "probe_result") {
    const row = await read(
      "SELECT p.intent_cluster_id,q.source_word_id,b.snapshot_id FROM probe_result r JOIN probe p ON p.tenant_id=r.tenant_id AND p.id=r.probe_id JOIN question_pool q ON q.tenant_id=p.tenant_id AND q.id=p.question_id JOIN probe_batch b ON b.tenant_id=p.tenant_id AND b.id=p.batch_id WHERE r.tenant_id=$1 AND r.id=$2",
      [tid, id],
    );
    clusterId = row.intent_cluster_id;
    sourceId = row.source_word_id;
    snapshot_id = row.snapshot_id;
  }
  if (assetId) {
    const row = await read(
      "SELECT brand_id,opportunity_card_id FROM content_asset WHERE tenant_id=$1 AND id=$2",
      [tid, assetId],
    );
    brand_id = row.brand_id;
    cardId = row.opportunity_card_id;
  }
  if (cardId) {
    const row = await read(
      "SELECT brand_id,intent_cluster_id,snapshot_id FROM opportunity_card WHERE tenant_id=$1 AND id=$2",
      [tid, cardId],
    );
    brand_id = row.brand_id;
    clusterId = row.intent_cluster_id;
    snapshot_id = row.snapshot_id;
  }
  if (clusterId)
    brand_id = (
      await read(
        "SELECT brand_id FROM intent_cluster WHERE tenant_id=$1 AND id=$2",
        [tid, clusterId],
      )
    ).brand_id;
  const keys = [
    ...extraKeys,
    ...(await relationalKeys(client, tid, { clusterId, cardId, sourceId })),
  ];
  if (
    resource === "brand" &&
    id &&
    ["content", "evidence"].includes(principal.role)
  ) {
    const assignments = (
      await client.query(
        "SELECT a.object_type,a.object_id FROM task_assignment a LEFT JOIN intent_cluster c ON a.object_type='intent_cluster' AND c.tenant_id=a.tenant_id AND c.id=a.object_id LEFT JOIN opportunity_card o ON a.object_type='opportunity_card' AND o.tenant_id=a.tenant_id AND o.id=a.object_id WHERE a.tenant_id=$1 AND a.user_id=$2 AND (c.brand_id=$3 OR o.brand_id=$3)",
        [tid, principal.user_id, id],
      )
    ).rows;
    keys.push(...assignments.map((a) => `${a.object_type}:${a.object_id}`));
    brand_id = id;
  }
  if (
    !id &&
    (resource === "question_pool" ||
      (resource === "intent_cluster" && endpoint.operation === "read"))
  ) {
    if (!brand_id) throw permission("brand required for list");
    await read("SELECT id FROM brand WHERE tenant_id=$1 AND id=$2", [
      tid,
      brand_id,
    ]);
    if (["content", "evidence"].includes(principal.role)) {
      const assigned = (
        await client.query(
          `SELECT DISTINCT a.object_type,a.object_id FROM task_assignment a
        LEFT JOIN intent_cluster c ON a.object_type='intent_cluster' AND c.tenant_id=a.tenant_id AND c.id=a.object_id
        LEFT JOIN opportunity_card o ON a.object_type='opportunity_card' AND o.tenant_id=a.tenant_id AND o.id=a.object_id
        WHERE a.tenant_id=$1 AND a.user_id=$2 AND ((c.brand_id=$3 AND ($4::text IS NULL OR c.id=$4)) OR (o.brand_id=$3 AND ($4::text IS NULL OR o.intent_cluster_id=$4)) OR
        (a.object_type='keyword_raw' AND EXISTS(SELECT 1 FROM question_pool q JOIN intent_cluster k ON k.tenant_id=q.tenant_id AND k.id=q.cluster_id WHERE q.tenant_id=a.tenant_id AND q.source_word_id=a.object_id AND k.brand_id=$3 AND ($4::text IS NULL OR q.cluster_id=$4))))`,
          [tid, principal.user_id, brand_id, clusterId ?? null],
        )
      ).rows;
      keys.push(...assigned.map((a) => `${a.object_type}:${a.object_id}`));
    }
  }
  return { brand_id, clusterId, cardId, assetId, sourceId, snapshot_id, keys };
}
