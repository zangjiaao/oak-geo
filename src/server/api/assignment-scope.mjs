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
