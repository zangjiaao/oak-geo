import {
  parseSerpTrends,
  validateTrendQuery,
} from "../../lib/trend-source.mjs";
import { validation } from "./errors.mjs";
export function createTrendSourceClient({
  apiKey,
  fetch: fetcher = globalThis.fetch,
  now = Date.now,
  timeoutMs = 30000,
} = {}) {
  return async (input) => {
    let query;
    try {
      query = validateTrendQuery(input);
    } catch (e) {
      throw validation(e.message);
    }
    if (typeof apiKey !== "string" || !apiKey.trim())
      throw validation("请在服务端配置 SERPAPI_API_KEY", {
        reason: "source_not_configured",
      });
    const url = new URL("https://serpapi.com/search.json");
    for (const [k, v] of Object.entries({
      engine: "google_trends",
      data_type: "TIMESERIES",
      q: query.keywords.join(","),
      geo: query.geo === "WORLD" ? "" : query.geo,
      date: query.start + " " + query.end,
      tz: "0",
      api_key: apiKey,
    }))
      url.searchParams.set(k, v);
    const controller = new AbortController();
    let timer;
    try {
      const work = (async () => {
        const response = await fetcher(url.href, {
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("upstream");
        }
        if (Number(response.headers.get("content-length")) > 2 * 1048576) {
          await response.body?.cancel();
          throw new Error("size");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("empty");
        const chunks = [];
        let length = 0;
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            length += r.value.length;
            if (length > 2 * 1048576) {
              await reader.cancel();
              throw new Error("size");
            }
            chunks.push(r.value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        return parseSerpTrends(payload, query, new Date(now()).toISOString());
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
      });
      return await Promise.race([work, timeout]);
    } catch {
      throw validation(
        controller.signal.aborted
          ? "来源请求超时，请重试"
          : "来源请求失败或数据格式不匹配，请核对账号与查询条件",
        { reason: "source_unavailable" },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
