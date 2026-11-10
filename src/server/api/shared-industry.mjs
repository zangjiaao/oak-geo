import { permission, validation } from "./errors.mjs";

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
  client,
  actor,
  industry,
  publicRootCatalog,
  audience = "internal",
}) {
  if (actor?.role !== "strategist" || audience !== "internal")
    throw permission(
      "public benchmarks require a separately verified >=5-tenant sample; no public export in T04",
    );
  const markers = await privateMarkers(client);
  if (includesPrivate(industry, markers))
    throw validation("private industry label");
  const seeds = (
    await client.query(
      "SELECT id,industry,word,word_type,seed_version FROM seed_list WHERE industry=$1",
      [industry],
    )
  ).rows.filter((row) => {
    try {
      assertPublicRoot(row, publicRootCatalog, markers);
      return true;
    } catch {
      return false;
    }
  });
  // Explicit column selection: no raw keyword text, free-form notes, tenant,
  // brand/customer lists, or C payload is selected into the shared response.
  const snapshots = (
    await client.query(
      "SELECT pool_version,industry,created_at,seed_version,counts_by_channel,cluster_count FROM keyword_pool_snapshot WHERE industry=$1 ORDER BY pool_version",
      [industry],
    )
  ).rows.map((row) => ({
    ...row,
    counts_by_channel: channelCounts(row.counts_by_channel),
  }));
  const scores = (
    await client.query(
      "SELECT industry,version,demand,gap,willingness,competition,score,updated_at FROM industry_score WHERE industry=$1 ORDER BY version",
      [industry],
    )
  ).rows;
  return { industry, seeds, snapshots, scores };
}
