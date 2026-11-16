// Shared pure CSV parsing/analysis; no server bindings or database access.
import { parseCsv } from "../server/api/csv.mjs";
const fail = (message) => {
  throw new Error(message);
};
const DAY = 86400000;
const clean = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
function day(value) {
  const s = clean(value).replaceAll("/", "-");
  if (!/^\d{4}-\d\d-\d\d$/.test(s)) fail("日期需为 YYYY-MM-DD");
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s)
    fail("日期无效");
  return new Date(t).toISOString();
}
function period(value) {
  const s = clean(value);
  if (/^\d{4}-\d\d$/.test(s)) return day(s + "-01");
  const range = s.split(/\s+[–—-]\s+/);
  const start = day(range[0]);
  if (range.length > 1 && day(range[1]) < start) fail("日期范围无效");
  return start;
}
function index(value, max) {
  const display = clean(value);
  if (display === "<1") return { value: null, display, censored: true };
  if (["", "-", "--", "暂无数据", "无数据", "null", "N/A"].includes(display))
    return { value: null, display: display || "—", censored: false };
  if (!/^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(display))
    fail("指数必须为非负数或缺失标记");
  const valueNumber = Number(display.replaceAll(",", ""));
  if (!Number.isFinite(valueNumber) || (max != null && valueNumber > max))
    fail("指数超出来源范围");
  return { value: valueNumber, display, censored: false };
}
function base(options, provider) {
  if (!clean(options.geo)) fail("请选择数据地域");
  if (
    typeof options.collected_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(
      options.collected_at,
    ) ||
    !Number.isFinite(Date.parse(options.collected_at)) ||
    new Date(options.collected_at).toISOString().slice(0, 19) !==
      options.collected_at.slice(0, 19)
  )
    fail("采集时间需为有效UTC时间");
  return {
    provider,
    geo: clean(options.geo),
    metric: provider === "google_trends" ? "interest" : options.metric,
    collected_at: options.collected_at,
    acquisition: "upload",
    series: [],
    comparison_keywords: [],
  };
}
function finalize(dataset) {
  if (!dataset.series.length) fail("没有可识别的指数序列");
  if (dataset.series.length > 100) fail("一次最多分析100条序列，请拆分文件");
  for (const series of dataset.series) {
    if (!series.keyword || !series.points.length) fail("缺少关键词或时间点");
    const points = new Map();
    for (const p of series.points) {
      const existing = points.get(p.at);
      if (existing && JSON.stringify(existing) !== JSON.stringify(p))
        fail("同一时点存在冲突指数");
      points.set(p.at, p);
    }
    series.points = [...points.values()].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
    if (series.points.length > 2000) fail("时间序列过长，请缩小范围");
    series.statistics_window = {
      start: series.points[0].at,
      end: series.points.at(-1).at,
    };
  }
  dataset.comparison_keywords = dataset.series.map((s) => s.keyword);
  return dataset;
}
export function parseTrendExport(text, options) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 1048576
  )
    fail("CSV需小于1MiB");
  const google = options.format === "google_trends_csv";
  if (!google && options.format !== "baidu_index_csv") fail("不支持该来源格式");
  const dataset = base(options, google ? "google_trends" : "baidu_index");
  if (!google && !["all", "pc", "mobile"].includes(options.metric))
    fail("请选择整体、PC或移动指数");
  const rows = parseCsv(text);
  const dateNames = new Set([
    "day",
    "week",
    "month",
    "date",
    "时间",
    "日期",
    "周",
    "月份",
    "天",
  ]);
  const start = rows.findIndex((row) =>
    row.some((cell) => dateNames.has(clean(cell).toLowerCase())),
  );
  if (start < 0) fail("未识别到日期列，请使用日期和指数的CSV导出");
  const headers = rows[start].map(clean),
    dateColumn = headers.findIndex((h) => dateNames.has(h.toLowerCase()));
  const keyColumn = headers.findIndex((h) =>
    ["keyword", "关键词", "搜索词", "词"].includes(h.toLowerCase()),
  );
  const metricNames = {
    all: ["搜索指数", "整体搜索指数", "整体指数", "百度指数", "百度整体指数"],
    pc: ["PC搜索指数", "PC指数", "百度PC指数"],
    mobile: ["移动搜索指数", "移动指数", "百度移动指数"],
  };
  const metricColumn = google
    ? -1
    : headers.findIndex((h) => metricNames[options.metric].includes(h));
  if (
    !google &&
    metricColumn < 0 &&
    headers.some((h) => Object.values(metricNames).flat().includes(h))
  )
    fail("未识别所选口径的指数列");
  const series = new Map();
  const add = (keyword, date, value) => {
    keyword = clean(keyword);
    if (!keyword) fail("此导出没有关键词，请填写关键词");
    let s = series.get(keyword);
    if (!s) series.set(keyword, (s = { keyword, points: [] }));
    s.points.push({
      at: period(date),
      period_label: clean(date),
      ...index(value, google ? 100 : null),
      partial: null,
    });
  };
  for (const row of rows.slice(start + 1)) {
    if (row.length !== headers.length) fail("CSV列数与表头不一致");
    if (metricColumn >= 0) {
      add(
        keyColumn >= 0 ? row[keyColumn] : options.keyword,
        row[dateColumn],
        row[metricColumn],
      );
    } else {
      if (!google && keyColumn >= 0) fail("未识别所选口径的指数列");
      for (let i = 0; i < headers.length; i++)
        if (i !== dateColumn) {
          if (google) {
            const label = headers[i].match(/:\s*\(([^)]*)\)\s*$/u)?.[1];
            const regions = {
              中国: "CN",
              China: "CN",
              全球: "WORLD",
              Worldwide: "WORLD",
              美国: "US",
              "United States": "US",
              英国: "GB",
              "United Kingdom": "GB",
              日本: "JP",
              Japan: "JP",
            };
            if (label && regions[label] && regions[label] !== dataset.geo)
              fail("导出地区与所选地域不一致");
          }
          const name = google
            ? headers[i].replace(/:\s*\([^)]*\)\s*$/u, "")
            : headers[i];
          add(name, row[dateColumn], row[i]);
        }
    }
  }
  dataset.series = [...series.values()];
  dataset.source_url = google
    ? "https://trends.google.com/trends/"
    : "https://index.baidu.com/";
  return finalize(dataset);
}
export function validateTrendQuery(input) {
  if (input?.provider !== "google_trends_serpapi")
    fail("该实时数据接口尚未配置，请使用CSV导出");
  const keywords = input.keywords;
  if (
    !Array.isArray(keywords) ||
    !keywords.length ||
    keywords.length > 5 ||
    keywords.some(
      (k) =>
        typeof k !== "string" || !k.trim() || k.length > 100 || k.includes(","),
    ) ||
    new Set(keywords.map(clean)).size !== keywords.length
  )
    fail("请输入1至5个不同关键词");
  if (
    typeof input.geo !== "string" ||
    !(input.geo === "WORLD" || /^[A-Z]{2}(?:-[A-Z0-9]{1,5})?$/.test(input.geo))
  )
    fail("数据地域无效");
  const start = day(input.start),
    end = day(input.end);
  if (start > end) fail("开始日期不能晚于结束日期");
  return {
    provider: input.provider,
    keywords: keywords.map(clean),
    geo: input.geo,
    start: start.slice(0, 10),
    end: end.slice(0, 10),
  };
}
export function parseSerpTrends(payload, input, collected_at) {
  const query = validateTrendQuery(input);
  const data = payload?.interest_over_time?.timeline_data;
  if (payload?.error || !Array.isArray(data) || !data.length)
    fail("数据服务未返回时间序列");
  if (
    payload.search_parameters?.q != null &&
    payload.search_parameters.q !== query.keywords.join(",")
  )
    fail("数据服务查询词与请求不一致");
  if (
    payload.search_parameters?.geo != null &&
    payload.search_parameters.geo !== (query.geo === "WORLD" ? "" : query.geo)
  )
    fail("数据服务地域与请求不一致");
  const dataset = {
    ...base({ ...query, collected_at }, "google_trends"),
    acquisition: "api",
    source_url:
      "https://trends.google.com/trends/explore?" +
      new URLSearchParams({
        q: query.keywords.join(","),
        geo: query.geo === "WORLD" ? "" : query.geo,
        date: query.start + " " + query.end,
      }),
    series: query.keywords.map((keyword) => ({ keyword, points: [] })),
    request_window: { start: query.start, end: query.end },
  };
  for (const item of data)
    for (const v of item.values ?? []) {
      const series = dataset.series.find((s) => s.keyword === v.query);
      if (!series) fail("数据服务返回未知关键词");
      const stamp = Number(v.timestamp ?? item.timestamp) * 1000;
      if (
        !Number.isFinite(stamp) ||
        stamp < Date.parse(query.start) ||
        stamp >= Date.parse(query.end) + DAY
      )
        fail("返回时间不在请求范围内");
      const p = index(v.value ?? v.extracted_value, 100);
      if (
        p.value != null &&
        v.extracted_value != null &&
        p.value !== v.extracted_value
      )
        fail("数据服务指数回显不一致");
      series.points.push({
        at: new Date(stamp).toISOString(),
        period_label: clean(
          v.date ?? item.date ?? new Date(stamp).toISOString().slice(0, 10),
        ),
        ...p,
        partial: v.isPartial === true || item.isPartial === true ? true : null,
      });
    }
  return finalize(dataset);
}
export function summarizeTrend(series) {
  const valid = series.points.filter(
    (p) => p.value != null && p.partial !== true,
  );
  const values = valid.map((p) => p.value);
  return {
    keyword: series.keyword,
    point_count: series.points.length,
    available_points: valid.length,
    missing_points: series.points.filter((p) => p.value == null).length,
    partial_points: series.points.filter((p) => p.partial === true).length,
    latest: values.at(-1) ?? null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    statistics_window: series.statistics_window,
  };
}
export function trendImportRows(dataset) {
  return dataset.series.map((series) => ({
    keyword: series.keyword,
    collected_at: dataset.collected_at,
    demand_index: summarizeTrend(series).latest,
    trend_dir: null,
    raw_payload: {
      url: dataset.source_url,
      trend_source: {
        provider: dataset.provider,
        geo: dataset.geo,
        metric: dataset.metric,
        acquisition: dataset.acquisition,
        comparison_keywords: dataset.comparison_keywords,
        request_window: dataset.request_window ?? null,
        ...series,
        summary: summarizeTrend(series),
      },
    },
  }));
}
