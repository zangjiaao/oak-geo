import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { parseTrendExport } from "../../src/lib/trend-source.mjs";
const req = (actor, body = {}, query = {}, params = {}) => ({
  actor,
  body,
  query,
  params,
});
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};
const query = {
  provider: "google_trends_serpapi",
  geo: "CN",
  start: "2026-11-01",
  end: "2026-11-15",
};

test("T38 行业种子→服务端扩词→采集持久化：版本溯源可查、幂等不重复取数、修订旧种子拒绝", async () => {
  const requests = [];
  const env = await startRuntimeEnvironment({
    publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
    fetchTrendSource: async (q) => {
      requests.push(q);
      const data = parseTrendExport(
        "日期,bio generator\n2026-11-01,30\n2026-11-02,50",
        {
          format: "google_trends_csv",
          geo: "CN",
          collected_at: "2026-11-16T00:00:00Z",
        },
      );
      return { ...data, acquisition: "api" };
    },
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const generation = {
      template_id: "feature_generator",
      inputs: { feature: ["bio"] },
      source_seed_id: f.seed.id,
      selected_keywords: ["bio generator"],
    };
    const body = {
      industry: "B2B",
      channel: "A",
      source_query: { ...query, seed_context: { generation } },
    };
    const report = ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, body), {
        idempotencyKey: "seed-run",
      }),
    );
    assert.equal(report.added, 1);
    assert.equal(
      (
        await app.call(
          "seed_list.revise",
          req(
            f.actors.strategist,
            {
              confirmed: true,
              maintainer: "张三（虚构）",
              last_reviewed_at: "2026-11-16T00:00:00Z",
              generation: { ...generation, source_channel: "A" },
            },
            {},
            { id: f.seed.id },
          ),
        )
      ).status,
      422,
      "private collection does not authorize shared seed storage",
    );
    assert.deepEqual(requests[0].keywords, ["bio generator"]);
    assert.equal(
      requests[0].seed_context,
      undefined,
      "network client only receives provider query",
    );
    ok(
      await app.call("keyword_raw.import", req(f.actors.strategist, body), {
        idempotencyKey: "seed-run",
      }),
    );
    assert.equal(requests.length, 1);
    const history = ok(
      await app.call(
        "keyword_raw.read",
        req(
          f.actors.strategist,
          {},
          { view: "trends", industry: "B2B", seed_id: f.seed.id },
        ),
      ),
    );
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].seed_context.seeds[0].id, f.seed.id);
    assert.equal(
      history.items[0].seed_context.seeds[0].seed_version,
      Number(f.seed.seed_version),
    );
    assert.equal(
      history.items[0].seed_context.generation.template_id,
      "feature_generator",
    );
    const unrelated = ok(
      await app.call(
        "keyword_raw.read",
        req(
          f.actors.strategist,
          {},
          { view: "trends", industry: "B2B", seed_id: "not-the-source" },
        ),
      ),
    );
    assert.equal(unrelated.items.length, 0);
    const revision = ok(
      await app.call(
        "seed_list.revise",
        req(
          f.actors.strategist,
          {
            maintainer: "张三（虚构）",
            last_reviewed_at: "2026-11-16T12:00:00Z",
          },
          {},
          { id: f.seed.id },
        ),
      ),
    );
    assert.notEqual(revision.id, f.seed.id);
    assert.equal(
      (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
        .status,
      409,
    );
    assert.equal(requests.length, 1);
    assert.equal(
      ok(
        await app.call(
          "keyword_raw.read",
          req(
            f.actors.strategist,
            {},
            { view: "trends", industry: "B2B", seed_id: f.seed.id },
          ),
        ),
      ).items.length,
      1,
      "historical evidence survives seed revision",
    );
  } finally {
    await env.close();
  }
});

test("T38 采集前校验行业/公共许可/生成集合，CSV必须属于所选检索词；不把词写成问句", async () => {
  let requests = 0;
  const env = await startRuntimeEnvironment({
    fetchTrendSource: async () => {
      requests++;
      throw new Error("must not fetch");
    },
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    for (const body of [
      {
        industry: "wrong-industry",
        channel: "A",
        source_query: { ...query, seed_context: { seed_ids: [f.seed.id] } },
      },
      {
        industry: "B2B",
        channel: "A",
        source_query: {
          ...query,
          keywords: ["unrelated"],
          seed_context: { seed_ids: [f.seed.id] },
        },
      },
      {
        industry: "B2B",
        channel: "A",
        source_query: {
          ...query,
          seed_context: {
            generation: {
              source_seed_id: f.seed.id,
              template_id: "feature_generator",
              inputs: { feature: ["private"] },
              selected_keywords: ["not-from-the-preview"],
            },
          },
        },
      },
    ])
      assert.equal(
        (await app.call("keyword_raw.import", req(f.actors.strategist, body)))
          .status,
        422,
      );
    assert.equal(requests, 0);
    const input = {
      format: "baidu_index_csv",
      metric: "all",
      geo: "CN",
      collected_at: "2026-11-16T00:00:00Z",
      seed_context: { seed_ids: [f.seed.id] },
    };
    assert.equal(
      (
        await app.call(
          "keyword_raw.import",
          req(f.actors.strategist, {
            industry: "B2B",
            channel: "A",
            trend_import: {
              ...input,
              csv: "日期,关键词,搜索指数\n2026-11-01,unrelated,20",
            },
          }),
        )
      ).status,
      422,
    );
    const saved = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "A",
          trend_import: {
            ...input,
            csv: "日期,关键词,搜索指数\n2026-11-01,ai 自动排产,20",
          },
        }),
      ),
    );
    assert.equal(saved.added, 1);
    const rows = ok(
      await app.call(
        "keyword_raw.read",
        req(f.actors.strategist, {}, { view: "trends", industry: "B2B" }),
      ),
    );
    assert.equal(rows.items[0].seed_context.seeds[0].word, "ai 自动排产");
    assert.equal(rows.items[0].provider, "baidu_index");
    const other = await createFixtureRegistry(app, {
      clock: env.clock,
    }).fixture("snapshot-input");
    assert.equal(
      ok(
        await app.call(
          "keyword_raw.read",
          req(
            other.actors.strategist,
            {},
            { view: "trends", seed_id: f.seed.id },
          ),
        ),
      ).items.length,
      0,
    );
  } finally {
    await env.close();
  }
});

test("T38 产品导航仅保留业务入口，取数/扩词/CSV不再各占菜单，旧来源页不再暴露", async () => {
  const { navigationFor, workspacePages } = await import(
    "../../src/lib/workspace-navigation.mjs"
  );
  const paths = navigationFor({ role: "strategist", mode: "full" }).flatMap(
    (g) => g.items.map((p) => p.path),
  );
  assert.ok(paths.includes("/library/seeds"));
  for (const p of ["/library/trends", "/library/generation", "/library/import"])
    assert.ok(!paths.includes(p), p);
  assert.equal(
    workspacePages.some((p) => p.path === "/library/trends"),
    false,
  );
});
