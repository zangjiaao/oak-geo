// SQL fragments are composed only from internal aliases and parameter positions.
export function assignmentPredicate({
  tenant = "p.tenant_id",
  cluster = "p.intent_cluster_id",
  source = "q.source_word_id",
  user = "$4",
} = {}) {
  return `EXISTS(SELECT 1 FROM task_assignment a WHERE a.tenant_id=${tenant} AND a.user_id=${user} AND (
 (a.object_type='intent_cluster' AND a.object_id=${cluster}) OR
 (a.object_type='keyword_raw' AND a.object_id=${source}) OR
 (a.object_type='opportunity_card' AND EXISTS(SELECT 1 FROM opportunity_card o WHERE o.tenant_id=a.tenant_id AND o.id=a.object_id AND o.intent_cluster_id=${cluster}))))`;
}
export async function relationalKeys(
  client,
  tid,
  { clusterId, sourceId, cardId },
) {
  const keys = [
    clusterId && "intent_cluster:" + clusterId,
    sourceId && "keyword_raw:" + sourceId,
    cardId && "opportunity_card:" + cardId,
  ].filter(Boolean);
  // A card grants its shared cluster measurements, not sibling card/asset access.
  if (clusterId && !cardId) {
    const cards = (
      await client.query(
        "SELECT id FROM opportunity_card WHERE tenant_id=$1 AND intent_cluster_id=$2",
        [tid, clusterId],
      )
    ).rows;
    keys.push(...cards.map((c) => "opportunity_card:" + c.id));
  }
  return keys;
}

// Private support projections follow the same cluster/card/source assignments.
// Reject mixed-scope candidate rows rather than revealing unrelated member IDs.
export function weeklyPrivatePredicate(runs) {
  const allowed = (cluster, source) =>
    assignmentPredicate({
      tenant: "p.tenant_id",
      cluster,
      source,
      user: "$3",
    });
  if (runs)
    return `EXISTS(
    SELECT 1 FROM weekly_cluster_snapshot s CROSS JOIN LATERAL unnest(s.representative_word_ids) m(word_id)
    WHERE s.tenant_id=p.tenant_id AND s.industry=p.industry AND s.pool_version=p.pool_version
    AND ${allowed("s.cluster_id", "m.word_id")})`;
  const allOld = `NOT EXISTS(SELECT 1 FROM unnest(p.old_cluster_ids) c(cluster_id)
    WHERE NOT ${allowed("c.cluster_id", "NULL::text")})`;
  const allSources = `cardinality(p.source_word_ids)>0 AND NOT EXISTS(
    SELECT 1 FROM unnest(p.source_word_ids) m(word_id) WHERE NOT EXISTS(
      SELECT 1 FROM (
        SELECT NULL::text AS cluster_id
        UNION SELECT s.cluster_id FROM weekly_cluster_snapshot s WHERE s.tenant_id=p.tenant_id AND m.word_id=ANY(s.representative_word_ids)
        UNION SELECT q.cluster_id FROM question_pool q WHERE q.tenant_id=p.tenant_id AND q.source_word_id=m.word_id
      ) related WHERE ${allowed("related.cluster_id", "m.word_id")}))`;
  return `${allOld} AND (cardinality(p.old_cluster_ids)>0 OR (${allSources}))`;
}
