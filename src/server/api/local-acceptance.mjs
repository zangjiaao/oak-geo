import { provisionJianzao } from "./fixture-service.mjs";
import { ServiceError } from "./errors.mjs";
import { randomUUID } from "node:crypto";

// Fictional local acceptance inputs, never a real industry weekly run. All
// writes use the ordinary-role dispatcher and the registered actor contracts.
export async function prepareLocalAcceptance({ application, operator }) {
  const fixture = await provisionJianzao({ application, operator });
  const strategist = application.issueActor({
    tenant_id: fixture.tenant_id,
    user_id: "fixture-strategist",
    role: "strategist",
    actor_type: "human",
  });
  const call = async (id, actor, body = {}, query = {}) => {
    const r = await application.call(id, {
      actor, body, query, params: { bid: fixture.brand_id },
    });
    if (r.status !== 200)
      throw new ServiceError(r.status, r.error.code, r.error.message, r.error.details);
    return r.data;
  };
  // Check current membership before preparing inputs. Re-running does not
  // restore revoked roles, reset questions, or move any existing anchor.
  await call("brand.read", strategist, {}, {});
  for (const keyword of [
    "[演示] ERP 适合什么生产场景",
    "[演示] ERP 排产如何使用",
    "[演示] ERP 有哪些适用边界",
  ])
    await call("keyword_raw.import", strategist, {
      industry: "B2B", keyword, channel: "B",
      collected_at: "2026-01-01T00:00:00Z",
      raw_payload: {
        excerpt: "虚构验收来源，不是真实平台问句",
        url: "https://example.com/local-acceptance",
      },
    });
  const isDemoCluster = (c) => c.name === "[演示] ERP 场景问句" && c.status === "active";
  let clusters = await call("intent_cluster.read", strategist);
  let cluster = clusters.items.find(isDemoCluster);
  // Search all private pages before creating another acceptance cluster.
  while (clusters.next_cursor && !cluster) {
    clusters = await call("intent_cluster.read", strategist, {}, { cursor: clusters.next_cursor });
    cluster = clusters.items.find(isDemoCluster);
  }
  if (!cluster) {
    const pools = await call("keyword_pool_snapshot.read", strategist, {}, { industry: "B2B" });
    const job = application.issueActor({
      tenant_id: fixture.tenant_id,
      user_id: "job-weekly_pool",
      role: "system",
      actor_type: "system",
      job_name: "weekly_pool",
      trigger_source: { event_id: "local-acceptance:" + randomUUID() },
    });
    const pool = pools.items[0] ?? await call("keyword_pool_snapshot.append", job, { industry: "B2B", seed_version: 1 });
    cluster = await call("intent_cluster.transition", job, {
      brand_id: fixture.brand_id,
      name: "[演示] ERP 场景问句",
      intent_type: "认知",
      pool_version: pool.pool_version,
    });
  }
  return { tenant_id: fixture.tenant_id, brand_id: fixture.brand_id, cluster_id: cluster.id, credential: strategist.credential };
}
