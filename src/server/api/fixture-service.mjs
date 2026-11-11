import { provisioningOperations } from "./provisioning-service.mjs";
import { permission, ServiceError } from "./errors.mjs";

// Fictional development fixture orchestrator, not a public product endpoint.
// Every write below uses an explicit authorized service operation, atomically.
export async function provisionJianzao({ client, operator }) {
  if (operator?.role !== "admin" || operator.actor_type !== "human")
    throw permission();
  const tenantId = "fixture-jianzao",
    brandId = "fixture-jianzao-brand";
  const strategist = {
    user_id: "fixture-strategist",
    role: "strategist",
    actor_type: "human",
  };
  const reviewer = {
    user_id: "fixture-factcheck",
    role: "factcheck",
    actor_type: "human",
  };
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(187451, 41)");
    const existing = (
      await client.query("SELECT name FROM tenant WHERE id=$1", [tenantId])
    ).rows[0];
    if (existing) {
      if (existing.name !== "简造 ERP（虚构测试租户）")
        throw new ServiceError(409, "state_conflict", "fixture id occupied");
      await client.query("COMMIT");
      return { tenant_id: tenantId, brand_id: brandId, existing: true };
    }
    const execute = provisioningOperations(client, {
      publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
    });
    const call = (operation, actor, body = {}, params = {}) =>
      execute(operation, { actor, tenant_id: tenantId, body, params });
    await call("tenant.configure", operator, {
      name: "简造 ERP（虚构测试租户）",
      mode: "self",
      plan: "internal-fixture",
    });
    await call("brand.configure", operator, {
      id: brandId,
      name: "简造 ERP",
      industry: "B2B",
      market: "CN",
    });
    for (const person of [
      strategist,
      reviewer,
      { user_id: "fixture-owner", role: "owner" },
    ])
      await call("user_member.configure", operator, {
        user_id: person.user_id,
        role: person.role,
        brand_id: person.role === "owner" ? brandId : null,
      });
    const lexicon = await call("brand_lexicon.create", strategist, {
      brand_id: brandId,
      entries: [
        { kind: "brand_alias", term: "简造 ERP" },
        { kind: "exclusion", term: "erp" },
      ],
    });
    const review = await call(
      "brand_lexicon.submit",
      strategist,
      {},
      { id: lexicon.version_object_id },
    );
    await call(
      "review_queue.approve",
      reviewer,
      {},
      { id: review.review_entry_id },
    );
    const fact = await call("official_fact.create", strategist, {
      brand_id: brandId,
      fact_category: "boundary",
      content: "这是虚构测试品牌，仅用于自动化验证，不是对外客户事实。",
      source_level: "L1",
      effective_from: "2026-01-01T00:00:00Z",
    });
    await call("official_fact.approve", reviewer, {}, { id: fact.id });
    await call("seed_list.create", strategist, {
      id: "fixture-public-scheduling-root",
      industry: "B2B",
      word: "ai 自动排产",
      word_type: "场景",
      maintainer: "内部测试维护人",
      last_reviewed_at: "2026-01-01T00:00:00Z",
      seed_version: 1,
    });
    await client.query("COMMIT");
    return {
      tenant_id: tenantId,
      brand_id: brandId,
      lexicon_version: lexicon.version,
      official_fact_id: fact.id,
      existing: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
