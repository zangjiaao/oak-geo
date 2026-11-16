import { createHash } from "node:crypto";
import {
  parseTrendExport,
  trendImportRows,
  summarizeTrend,
} from "../../lib/trend-source.mjs";
import { validation } from "./errors.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { pageQuery } from "./pagination.mjs";

export async function prepareTrendImport(ctx) {
  const b = ctx.body;
  if (
    b.channel !== "A" ||
    b.csv != null ||
    b.csv_ref != null ||
    Boolean(b.source_query) === Boolean(b.trend_import)
  )
    throw validation("来源分析仅接受A类，实时查询与原始CSV二选一");
  let dataset;
  try {
    if (b.source_query) dataset = await ctx.fetchTrendSource(b.source_query);
    else {
      const input = b.trend_import;
      dataset = parseTrendExport(input.csv, {
        format: input.format,
        keyword: input.keyword,
        geo: input.geo,
        metric: input.metric,
        collected_at: input.collected_at,
      });
    }
  } catch (e) {
    if (e?.code === "validation_failed") throw e;
    throw validation(e.message || "来源格式无效");
  }
  if (!dataset) throw validation("来源接口尚未配置");
  const sourceKey = createHash("sha256")
    .update(
      canonicalJson({
        provider: dataset.provider,
        geo: dataset.geo,
        metric: dataset.metric,
        comparison_keywords: dataset.comparison_keywords,
        request_window: dataset.request_window ?? null,
        windows: dataset.series.map((s) => s.statistics_window),
      }),
    )
    .digest("hex");
  const rows = trendImportRows(dataset).map((row) => ({
    ...row,
    source_id: "trend:" + sourceKey,
    raw_payload: { ...row.raw_payload, source_id: "trend:" + sourceKey },
  }));
  return {
    single: false,
    rows,
    summary: {
      provider: dataset.provider,
      geo: dataset.geo,
      metric: dataset.metric,
      acquisition: dataset.acquisition,
      series_count: dataset.series.length,
      items: dataset.series.slice(0, 20).map((s) => summarizeTrend(s)),
      truncated: dataset.series.length > 20,
    },
  };
}

export async function readTrendSources(ctx) {
  const tid = ctx.principal.tenant_id;
  if (ctx.query.view === "trend_points") {
    if (typeof ctx.query.id !== "string" || !ctx.query.id)
      throw validation("请选择序列");
    const row = (
      await ctx.client.query(
        `SELECT id,keyword,collected_at,raw_payload->>'url' AS source_url,raw_payload->>'source_id' AS source_id,raw_payload->'trend_source' AS source FROM keyword_raw
   WHERE tenant_id=$1 AND id=$2 AND channel='A' AND jsonb_typeof(raw_payload#>'{trend_source,points}')='array'`,
        [tid, ctx.query.id],
      )
    ).rows[0];
    if (!row) throw validation("序列不存在或不可读");
    const { provider, geo, metric, acquisition, statistics_window, summary } =
      row.source;
    const page = await pageQuery(
      { ...ctx, operation: ctx.operation + ":trend_points:" + row.id },
      {
        table:
          "keyword_raw k CROSS JOIN LATERAL jsonb_array_elements(k.raw_payload#>'{trend_source,points}') WITH ORDINALITY AS p(point,ordinality)",
        columns:
          "p.ordinality,p.point->>'at' AS at,p.point->>'period_label' AS period_label,p.point->'value' AS value,p.point->>'display' AS display,p.point->'censored' AS censored,p.point->'partial' AS partial",
        where: "k.tenant_id=$1 AND k.id=$2 AND k.channel='A'",
        values: [tid, row.id],
        order: [["p.ordinality", "ASC"]],
      },
    );
    return {
      data: {
        ...page,
        series: {
          id: row.id,
          keyword: row.keyword,
          collected_at: row.collected_at,
          source_url: row.source_url,
          source_id: row.source_id,
          provider,
          geo,
          metric,
          acquisition,
          statistics_window,
          summary,
        },
      },
    };
  }
  const values = [tid];
  let where =
    "tenant_id=$1 AND channel='A' AND jsonb_typeof(raw_payload#>'{trend_source,points}')='array'";
  if (ctx.query.industry) {
    values.push(ctx.query.industry);
    where += " AND industry=$" + values.length;
  }
  return {
    data: await pageQuery(
      {
        ...ctx,
        operation: ctx.operation + ":trends:" + (ctx.query.industry ?? ""),
      },
      {
        table: "keyword_raw",
        columns:
          "id,keyword,collected_at,raw_payload#>>'{trend_source,provider}' AS provider,raw_payload#>>'{trend_source,geo}' AS geo,raw_payload#>>'{trend_source,metric}' AS metric,raw_payload#>>'{trend_source,acquisition}' AS acquisition,raw_payload#>'{trend_source,summary}' AS summary",
        where,
        values,
        order: [
          ["collected_at", "DESC"],
          ["id", "DESC"],
        ],
      },
    ),
  };
}
