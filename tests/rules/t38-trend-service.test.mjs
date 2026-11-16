import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { createSeedTransport } from "../../src/server/api/seed-http.mjs";
import { createTrendSourceClient } from "../../src/server/api/trend-source-client.mjs";
const req = (actor, body = {}, query = {}) => ({ actor, body, query });
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};
const upload = {
  industry: "B2B",
  channel: "A",
  trend_import: {
    format: "baidu_index_csv",
    metric: "all",
    geo: "CN",
    collected_at: "2026-11-16T12:00:00Z",
    csv: "日期,关键词,整体搜索指数\n2026-11-01,社媒 API,0\n2026-11-02,社媒 API,20",
  },
};
test("T38 真实服务从来源导出入库，刷新/分页可还原，复用权限、幂等与审计", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("snapshot-input"),
      other = await registry.fixture("snapshot-input");
    const denied = await app.call(
      "keyword_raw.import",
      req(f.actors.editor, upload),
    );
    assert.equal(denied.status, 403);
    const report = ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, upload), {
        idempotencyKey: "trend-once",
      }),
    );
    assert.equal(report.added, 1);
    assert.equal(report.source_summary.items[0].latest, 20);
    assert.deepEqual(
      ok(
        await app.call("keyword_raw.import", req(f.actors.strategist, upload), {
          idempotencyKey: "trend-once",
        }),
      ),
      report,
    );
    assert.equal(
      ok(await app.call("keyword_raw.import", req(f.actors.strategist, upload)))
        .duplicate,
      1,
    );
    const query = { view: "trends", industry: "B2B" };
    const rows = ok(
      await app.call("keyword_raw.read", req(f.actors.strategist, {}, query)),
    );
    assert.equal(rows.items.length, 1);
    assert.equal(rows.items[0].provider, "baidu_index");
    const id = rows.items[0].id;
    const points = ok(
      await app.call(
        "keyword_raw.read",
        req(f.actors.strategist, {}, { view: "trend_points", id, limit: 1 }),
      ),
    );
    assert.equal(points.items[0].value, 0);
    assert.ok(points.next_cursor);
    const second = ok(
      await app.call(
        "keyword_raw.read",
        req(
          f.actors.strategist,
          {},
          { view: "trend_points", id, limit: 1, cursor: points.next_cursor },
        ),
      ),
    );
    assert.equal(second.items[0].value, 20);
    assert.equal(second.next_cursor, null);
    assert.equal(
      (
        await app.call(
          "keyword_raw.read",
          req(other.actors.strategist, {}, { view: "trend_points", id }),
        )
      ).status,
      422,
    );
    assert.equal(
      (await app.call("keyword_raw.read", req(f.actors.editor, {}, query)))
        .status,
      403,
    );
    assert.equal(
      (
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, { ...upload, channel: "B" }),
        )
      ).status,
      422,
    );
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, { object_id: id, limit: 100 }),
      ),
    );
    assert.ok(
      audit.items.some((row) => row.action === "keyword_raw.import_row"),
    );
    const serve = createSeedTransport(async () => ({
      application: app,
      close: async () => {},
    }));
    const url =
      "https://geo.test/api/tenants/" +
      f.tenant_id +
      "/keyword-imports?view=trends";
    const response = await serve(
      new Request(url, {
        headers: { cookie: "geo_session=" + f.actors.strategist.credential },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.items.length, 1);
    assert.equal((await env.inspectSecurity()).currentUser, "geo_app");
  } finally {
    await env.close();
  }
});

test("T38 实时取数接入真实服务链：权限先于网络，成功幂等重放不重复付费，刷新保留来源口径", async () => {
  let requests = 0;
  const env = await startRuntimeEnvironment({
    fetchTrendSource: createTrendSourceClient({
      apiKey: "fixture-not-real-credential",
      fetch: async () => {
        requests++;
        return Response.json({
          search_parameters: { q: "社媒API", geo: "CN" },
          interest_over_time: {
            timeline_data: [
              {
                timestamp: "1793491200",
                date: "Nov 1, 2026",
                values: [{ query: "社媒API", value: "0", extracted_value: 0 }],
              },
            ],
          },
        });
      },
    }),
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const body = {
      industry: "B2B",
      channel: "A",
      source_query: {
        provider: "google_trends_serpapi",
        keywords: ["社媒API"],
        geo: "CN",
        start: "2026-11-01",
        end: "2026-11-15",
      },
    };
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.editor, body))).status,
      403,
    );
    assert.equal(requests, 0);
    const options = { idempotencyKey: "paid-source-once" };
    const report = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, body),
        options,
      ),
    );
    assert.equal(report.added, 1);
    assert.deepEqual(
      ok(
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, body),
          options,
        ),
      ),
      report,
    );
    assert.equal(requests, 1);
    const rows = ok(
      await app.call(
        "keyword_raw.read",
        req(f.actors.strategist, {}, { view: "trends" }),
      ),
    );
    assert.equal(rows.items[0].acquisition, "api");
    assert.equal(rows.items[0].summary.latest, 0);
    const data = ok(
      await app.call(
        "keyword_raw.read",
        req(
          f.actors.strategist,
          {},
          { view: "trend_points", id: rows.items[0].id },
        ),
      ),
    );
    assert.equal(data.items[0].period_label, "Nov 1, 2026");
    assert.equal(data.series.geo, "CN");
    assert.equal(
      JSON.stringify(data).includes("fixture-not-real-credential"),
      false,
    );
  } finally {
    await env.close();
  }
});

test("T38 未配置API不伪造结果，未鉴权不触发取数，伪造趋势字段不开放读取旁路", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const failed = await app.call(
      "keyword_raw.import",
      req(f.actors.strategist, {
        industry: "B2B",
        channel: "A",
        source_query: {
          provider: "google_trends_serpapi",
          keywords: ["api"],
          geo: "CN",
          start: "2026-11-01",
          end: "2026-11-15",
        },
      }),
    );
    assert.equal(failed.status, 422);
    const forged = await app.call(
      "keyword_raw.import",
      req(f.actors.strategist, {
        industry: "B2B",
        channel: "A",
        keyword: "fake",
        collected_at: "2026-11-16T12:00:00Z",
        raw_payload: { trend_source: { points: [{ value: 999 }] } },
      }),
    );
    assert.equal(forged.status, 422);
    assert.equal(
      ok(
        await app.call(
          "keyword_raw.read",
          req(f.actors.strategist, {}, { view: "trends" }),
        ),
      ).items.length,
      0,
    );
  } finally {
    await env.close();
  }
});
