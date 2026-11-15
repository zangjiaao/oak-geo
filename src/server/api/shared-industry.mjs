import { permission, validation, ServiceError } from "./errors.mjs";

// This is a fail-closed, internal projection boundary. The trusted public-root
// catalog is supplied by the provisioning operator, never by a client payload.
// General seed maintenance/ETL and public benchmark publication remain T07/T10+.
export async function privateMarkers(client) {
  const result =
    await client.query(`SELECT name AS term FROM tenant UNION SELECT name AS term FROM brand
  UNION SELECT term FROM brand_lexicon WHERE kind IN ('brand_alias','product_line','model','competitor')`);
  return result.rows.map((r) => r.term).filter(Boolean);
}
const canonical = (value) =>
  String(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
function includesPrivate(value, markers) {
  return markers.some((term) => canonical(value).includes(canonical(term)));
}
export function assertSharedMaintainer(value, markers) {
  if (includesPrivate(value, markers))
    throw validation(
      "customer identity cannot be stored as a shared maintainer",
    );
}
export function assertPublicRoot(
  { id, industry, word, word_type },
  catalog,
  markers,
) {
  if (
    !["品类", "场景", "问题"].includes(word_type) ||
    !catalog.has(`${industry}\0${word}`) ||
    (id && includesPrivate(id, markers)) ||
    includesPrivate(industry, markers) ||
    includesPrivate(word, markers)
  )
    throw validation(
      "unlicensed or customer-identifying root cannot enter industry shared storage",
    );
}
export function channelCounts(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([k, v]) =>
        !["A", "B", "C", "D"].includes(k) ||
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0,
    )
  )
    throw validation(
      "shared channel counts must contain only numeric aggregates",
    );
  return structuredClone(value);
}
export async function readSharedIndustry({
  application,
  actor,
  industry,
  audience = "internal",
}) {
  if (!application || actor?.role !== "strategist" || audience !== "internal")
    throw permission("no public benchmark or unmanaged shared projection");
  const call = async (id) => {
    const result = await application.call(id, {
      actor,
      body: {},
      params: {},
      query: { industry },
    });
    if (result.status !== 200)
      throw new ServiceError(
        result.status,
        result.error.code,
        result.error.message,
        result.error.details,
      );
    return result.data.items;
  };
  // Aggregate projection retains its original public-root whitelist. Management
  // metadata belongs only to the authenticated seed-list management endpoint.
  const seeds = (await call("seed_list.read")).map(
    ({ id, industry, word, word_type, seed_version }) => ({
      id,
      industry,
      word,
      word_type,
      seed_version,
    }),
  );
  const snapshots = await call("keyword_pool_snapshot.read");
  const values = await call("industry_score.read");
  const scores = values.map(
    ({
      industry,
      version,
      demand,
      gap,
      willingness,
      competition,
      score,
      updated_at,
    }) => ({
      industry,
      version,
      demand,
      gap,
      willingness,
      competition,
      score,
      updated_at,
    }),
  );
  return { industry, seeds, snapshots, scores };
}
