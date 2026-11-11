import { permission, validation } from "./errors.mjs";
import { event } from "./domain-common.mjs";

// T10 machine projection seam. Only recorded public demand observations are
// substituted by tests; arithmetic and persistence run here in the real service.
export async function appendMachinePercentiles(ctx, pool) {
  const observations = ctx.body.demand_observations;
  if (observations == null) return;
  if (
    ctx.principal.actor_type !== "system" ||
    ctx.principal.job_name !== "weekly_pool"
  )
    throw permission("only weekly machine producer");
  const batchId = ctx.principal.trigger_source?.event_id;
  if (!batchId || ctx.body.weekly_batch_id !== batchId)
    throw validation("basis_note must identify the causal T10 weekly batch");
  if (!Array.isArray(observations) || observations.length === 0)
    throw validation("complete public observation population required");
  const keys = new Set();
  for (const row of observations) {
    if (
      !row ||
      Object.keys(row).some(
        (k) => !["public_cluster_key", "demand_index"].includes(k),
      ) ||
      !ctx.publicRootCatalog.has(
        pool.industry + "\0" + row.public_cluster_key,
      ) ||
      !Number.isFinite(row.demand_index) ||
      keys.has(row.public_cluster_key)
    )
      throw validation(
        "only unique licensed public keys and machine demand indices",
      );
    keys.add(row.public_cluster_key);
  }
  // Ordinary percent_rank: ties share rank; no four-source weighting invented.
  const rows = (
    await ctx.client.query(
      `
    INSERT INTO w_pool_percentile(industry,pool_version,public_cluster_key,demand_index,percentile,producer,basis_note,computed_at)
    SELECT $1,$2,o.public_cluster_key,o.demand_index,percent_rank() OVER(ORDER BY o.demand_index),
      'weekly_batch',$3,$4 FROM jsonb_to_recordset($5::jsonb) AS o(public_cluster_key text,demand_index numeric)
    RETURNING public_cluster_key,percentile`,
      [
        pool.industry,
        pool.pool_version,
        batchId,
        new Date(ctx.now()).toISOString(),
        JSON.stringify(observations),
      ],
    )
  ).rows;
  for (const row of rows)
    event(
      ctx,
      "w_pool_percentile.append",
      "w_pool_percentile",
      pool.industry + ":" + pool.pool_version + ":" + row.public_cluster_key,
    );
}

export async function readArchivePercentile(ctx, cluster, industry) {
  const roots = (
    await ctx.client.query(
      `SELECT DISTINCT k.keyword FROM question_pool q
    JOIN keyword_raw k ON k.tenant_id=q.tenant_id AND k.id=q.source_word_id
    WHERE q.tenant_id=$1 AND q.cluster_id=$2 AND q.question_pool_version=$3`,
      [ctx.principal.tenant_id, cluster.id, cluster.question_pool_version],
    )
  ).rows;
  // No guessed fusion/mapping for multiple private source terms. T10 owns the
  // public cluster mapping; an unambiguous licensed root is the present seam.
  if (
    roots.length !== 1 ||
    !ctx.publicRootCatalog.has(industry + "\0" + roots[0].keyword)
  )
    return { status: "data_pending", met: false, rows: [] };
  const rows = (
    await ctx.client.query(
      `SELECT w.public_cluster_key,w.pool_version,w.percentile,w.producer,w.basis_note
    FROM w_pool_percentile w WHERE w.industry=$1 AND w.public_cluster_key=$2
      AND w.pool_version=$3 AND w.pool_version=(SELECT max(pool_version) FROM keyword_pool_snapshot WHERE industry=$1)`,
      [industry, roots[0].keyword, cluster.pool_version],
    )
  ).rows;
  return {
    status: rows.length ? "evaluated" : "data_pending",
    met: rows.length === 1 && Number(rows[0].percentile) <= 0.2,
    rows,
  };
}
