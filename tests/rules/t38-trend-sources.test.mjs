import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTrendExport,
  parseSerpTrends,
  summarizeTrend,
  trendImportRows,
} from "../../src/lib/trend-source.mjs";
import { createTrendSourceClient } from "../../src/server/api/trend-source-client.mjs";
const context = { geo: "CN", collected_at: "2026-11-16T12:00:00Z" };
test("T38 Google原始CSV自动识别元信息、比较词、日期和低量标记，零值不变缺失", () => {
  const d = parseTrendExport(
    "\ufeff类别: 所有类别\n\n周,社媒 API: (中国),运营工具: (中国)\n2026-11-01 - 2026-11-07,0,<1\n2026-11-08 - 2026-11-14,80,\n",
    { ...context, format: "google_trends_csv" },
  );
  assert.equal(d.series.length, 2);
  assert.equal(d.series[0].keyword, "社媒 API");
  assert.equal(d.series[0].points[0].value, 0);
  assert.equal(d.series[1].points[0].value, null);
  assert.equal(d.series[1].points[0].censored, true);
  assert.equal(d.series[1].points[1].value, null);
  assert.equal(d.series[0].points[0].at, "2026-11-01T00:00:00.000Z");
  assert.equal(d.series[0].points[0].period_label, "2026-11-01 - 2026-11-07");
  assert.equal(d.acquisition, "upload");
  assert.deepEqual(d.comparison_keywords, ["社媒 API", "运营工具"]);
});
test("T38 百度导出支持长表和宽表，PC/移动/整体独立口径；不猜词名与地域", () => {
  const d = parseTrendExport(
    "日期,关键词,整体搜索指数,PC搜索指数,移动搜索指数\n2026-11-01,社媒 API,120,20,100\n2026-11-02,社媒 API,150,30,120",
    { ...context, format: "baidu_index_csv", metric: "all" },
  );
  assert.equal(d.series[0].points[1].value, 150);
  assert.equal(d.metric, "all");
  const mobile = parseTrendExport(
    "日期,关键词,整体搜索指数,PC搜索指数,移动搜索指数\n2026-11-01,社媒 API,120,20,100",
    { ...context, format: "baidu_index_csv", metric: "mobile" },
  );
  assert.equal(mobile.series[0].points[0].value, 100);
  const wide = parseTrendExport("日期,社媒API,运营工具\n2026-11-01,10,20", {
    ...context,
    format: "baidu_index_csv",
    metric: "pc",
  });
  assert.equal(wide.series.length, 2);
  assert.throws(() =>
    parseTrendExport("日期,移动搜索指数\n2026-11-01,20", {
      ...context,
      format: "baidu_index_csv",
      metric: "all",
      keyword: "api",
    }),
  );
  assert.throws(() =>
    parseTrendExport("Day,api: (Worldwide)\n2026-11-01,20", {
      ...context,
      format: "google_trends_csv",
    }),
  );
  assert.throws(() =>
    parseTrendExport("日期,搜索指数\n2026-11-01,20", {
      ...context,
      format: "baidu_index_csv",
      metric: "all",
    }),
  );
  assert.throws(() =>
    parseTrendExport("日期,社媒API\n2026-11-01,20", {
      format: "baidu_index_csv",
      metric: "all",
      collected_at: context.collected_at,
    }),
  );
});
test("T38 严格拒绝坏日期、负数、冲突重复、无法识别格式；相同重复点去重", () => {
  for (const csv of [
    "日期,关键词,搜索指数\n2026-02-30,api,20",
    "日期,关键词,搜索指数\n2026-11-01,api,-1",
    "日期,关键词,搜索指数\n2026-11-01,api,20\n2026-11-01,api,30",
    "anything,whatever\na,b",
  ])
    assert.throws(() =>
      parseTrendExport(csv, {
        ...context,
        format: "baidu_index_csv",
        metric: "all",
      }),
    );
  const d = parseTrendExport(
    "日期,关键词,搜索指数\n2026-11-01,api,20\n2026-11-01,api,20",
    { ...context, format: "baidu_index_csv", metric: "all" },
  );
  assert.equal(d.series[0].points.length, 1);
});
test("T38 SerpAPI只接时间序列，校验查询回显，缺失/部分值保留而不拿相关词涨幅当指数", () => {
  const query = {
    provider: "google_trends_serpapi",
    keywords: ["社媒API"],
    geo: "CN",
    start: "2026-11-01",
    end: "2026-11-15",
  };
  const p = {
    search_parameters: { q: "社媒API", geo: "CN" },
    interest_over_time: {
      timeline_data: [
        {
          timestamp: "1793491200",
          values: [{ query: "社媒API", value: "<1", extracted_value: 0 }],
        },
        {
          timestamp: "1793577600",
          values: [
            {
              query: "社媒API",
              value: "80",
              extracted_value: 80,
              isPartial: true,
            },
          ],
        },
      ],
    },
  };
  const d = parseSerpTrends(p, query, context.collected_at);
  assert.equal(d.acquisition, "api");
  assert.equal(d.series[0].points[0].value, null);
  assert.equal(d.series[0].points[1].partial, true);
  assert.throws(() =>
    parseSerpTrends(
      { related_queries: { rising: [{ query: "api", extracted_value: 900 }] } },
      query,
      context.collected_at,
    ),
  );
  assert.throws(() =>
    parseSerpTrends(
      { ...p, search_parameters: { q: "wrong", geo: "CN" } },
      query,
      context.collected_at,
    ),
  );
});
test("T38 描述统计不混合来源，缺数据不凑均值；导入每条序列一次并保留原始点", () => {
  const d = parseTrendExport(
    "日期,关键词,搜索指数\n2026-11-01,api,0\n2026-11-02,api,20\n2026-11-03,api,",
    { ...context, format: "baidu_index_csv", metric: "all" },
  );
  const s = summarizeTrend(d.series[0]);
  assert.equal(s.available_points, 2);
  assert.equal(s.missing_points, 1);
  assert.equal(s.max, 20);
  assert.equal(s.latest, 20);
  const rows = trendImportRows(d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].demand_index, 20);
  assert.equal(rows[0].trend_dir, null);
  assert.equal(rows[0].collected_at, context.collected_at);
  assert.equal(rows[0].raw_payload.trend_source.points.length, 3);
  assert.equal(rows[0].raw_payload.trend_source.acquisition, "upload");
  assert.equal(JSON.stringify(rows).includes('"search_volume"'), false);
});
test("T38 实时Google请求固定到SerpAPI，密钥不回传；未配置/错误/超时不伪造数据", async () => {
  let calls = 0;
  const client = createTrendSourceClient({
    apiKey: "fixture-secret",
    fetch: async (url) => {
      calls++;
      const u = new URL(url);
      assert.equal(u.hostname, "serpapi.com");
      assert.equal(u.searchParams.get("engine"), "google_trends");
      assert.equal(u.searchParams.get("data_type"), "TIMESERIES");
      assert.equal(u.searchParams.get("api_key"), "fixture-secret");
      return Response.json({
        interest_over_time: {
          timeline_data: [
            {
              timestamp: "1793491200",
              values: [{ query: "api", value: "10", extracted_value: 10 }],
            },
          ],
        },
      });
    },
  });
  const query = {
    provider: "google_trends_serpapi",
    keywords: ["api"],
    geo: "CN",
    start: "2026-11-01",
    end: "2026-11-15",
  };
  const d = await client(query);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(d).includes("fixture-secret"), false);
  await assert.rejects(() =>
    client({ ...query, provider: "baidu_index_5118" }),
  );
  assert.equal(calls, 1);
  await assert.rejects(() =>
    createTrendSourceClient({ fetch: async () => calls++ })(query),
  );
  assert.equal(calls, 1);
  const bad = createTrendSourceClient({
    apiKey: "fixture-secret",
    fetch: async () => new Response("fixture-secret", { status: 429 }),
  });
  await assert.rejects(
    () => bad(query),
    (e) => !e.message.includes("fixture-secret"),
  );
  let aborted = false;
  const slow = createTrendSourceClient({
    apiKey: "fixture-secret",
    timeoutMs: 10,
    fetch: async (_, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("fixture-secret"));
        }),
      ),
  });
  await assert.rejects(
    () => slow(query),
    (e) => e.message.includes("超时") && !e.message.includes("fixture-secret"),
  );
  assert.equal(aborted, true);
});
