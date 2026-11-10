import { permission, ServiceError } from "./errors.mjs";
import { isRuntimeApplication } from "./application.mjs";
// Local fictional bootstrap through the SAME authenticated runtime dispatcher.
// No database connection (management or otherwise) is accepted by this fixture.
export async function provisionJianzao({ application, operator }) {
  if (!isRuntimeApplication(application) || !operator?.credential)
    throw permission(
      "fixture requires verified ordinary-role runtime application",
    );
  const tenantId = "fixture-jianzao",
    brandId = "fixture-jianzao-brand";
  if (operator.tenant_id !== tenantId)
    throw permission("fixture credential tenant mismatch");
  const call = async (id, actor, body = {}, params = {}) => {
    const response = await application.call(id, {
      actor,
      body,
      params,
      query: {},
    });
    if (response.status >= 200 && response.status < 300) return response.data;
    throw new ServiceError(
      response.status,
      response.error.code,
      response.error.message,
      response.error.details,
    );
  };
  const existing = await application.call("tenant.read", {
    actor: operator,
    body: {},
    params: {},
    query: {},
  });
  if (existing.status === 200) {
    if (existing.data.name !== "简造 ERP（虚构测试租户）")
      throw new ServiceError(409, "state_conflict", "fixture id occupied");
    if (existing.data.plan !== "internal-fixture:ready")
      throw new ServiceError(
        409,
        "state_conflict",
        "incomplete fixture requires explicit recovery",
      );
    return { tenant_id: tenantId, brand_id: brandId, existing: true };
  }
  await call("tenant.configure", operator, {
    name: "简造 ERP（虚构测试租户）",
    mode: "full",
    plan: "internal-fixture:preparing",
  });
  await call("user_member.configure", operator, {
    user_id: operator.user_id,
    role: "admin",
  });
  await call("brand.configure", operator, {
    id: brandId,
    name: "简造 ERP",
    industry: "B2B",
    market: "CN",
  });
  const person = (role) => ({
    ...application.issueActor({
      user_id: "fixture-" + role,
      tenant_id: tenantId,
      role,
      actor_type: "human",
      ...(["owner", "editor", "viewer"].includes(role)
        ? { brand_id: brandId }
        : {}),
    }),
    brand_id: brandId,
  });
  const strategist = person("strategist"),
    reviewer = person("factcheck");
  for (const actor of [strategist, reviewer, person("owner")])
    await call("user_member.configure", operator, {
      user_id: actor.user_id,
      role: actor.role,
      brand_id: actor.role === "owner" ? brandId : null,
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
    industry: "B2B",
    word: "ai 自动排产",
    word_type: "场景",
    maintainer: "张三（虚构）",
    last_reviewed_at: "2026-01-01T00:00:00Z",
    seed_version: 1,
  });
  await call("tenant.configure", operator, {
    name: "简造 ERP（虚构测试租户）",
    mode: "full",
    plan: "internal-fixture:ready",
  });
  return {
    tenant_id: tenantId,
    brand_id: brandId,
    lexicon_version: 1,
    official_fact_id: fact.id,
    existing: false,
  };
}
