import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
const req = (actor, body = {}, id, query = {}) => ({
  actor,
  body,
  params: id ? { id } : {},
  query,
});

test("T08生成预览/确认与附渠道元数据分页均遵守20KB预算，游标无遗漏", async () => {
  const features = Array.from({ length: 60 }, (_, i) => `public${i}${"a".repeat(80)}`);
  const words = features.map((word) => word + " generator");
  const env = await startRuntimeEnvironment({
    publicRootCatalog: new Set(["B2B\0ai 自动排产", ...words.map((word) => "B2B\0" + word)]),
  });
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture("snapshot-input");
    const input = { template_id: "feature_generator", inputs: { feature: features }, source_channel: "A" };
    assert.equal((await app.call("seed_list.read", req(f.actors.strategist, {}, undefined, {
      generation: { ...input, source_seed_id: f.seed.id, inputs: { feature: ["a".repeat(20000)] } },
    }))).status, 422);
    const confirm = (selected_keywords) => app.call("seed_list.revise", req(f.actors.strategist, {
      generation: { ...input, selected_keywords }, confirmed: true,
      maintainer: "张三（虚构）", last_reviewed_at: "2026-11-15T00:00:00Z",
    }, f.seed.id));
    assert.equal((await confirm(words)).status, 422);
    assert.equal(ok(await app.call("seed_list.read", req(f.actors.strategist))).items.length, 1);
    for (let i = 0; i < words.length; i += 10) ok(await confirm(words.slice(i, i + 10)));
    let cursor, pages = 0;
    const seen = new Set(), metadata = new Set();
    do {
      const response = await app.call("seed_list.read", req(f.actors.strategist, {}, undefined, {
        industry: "B2B", include_generation_meta: true, limit: 100, cursor,
      }));
      const data = ok(response);
      assert.ok(Buffer.byteLength(JSON.stringify(response)) < 20000);
      for (const item of data.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
      for (const item of data.generation_metadata) metadata.add(item.seed_id);
      cursor = data.next_cursor;
      assert.ok(++pages < 10);
    } while (cursor);
    assert.equal(seen.size, 61);
    assert.equal(metadata.size, 60);
    assert.ok(pages > 1);
  } finally { await env.close(); }
});
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};
const generation = {
  template_id: "feature_generator",
  inputs: { feature: ["bio", "private-product"] },
  source_channel: "A",
  selected_keywords: ["bio generator"],
};
test("T08预览不写库：只人工勾选许可公共词根，原子确认入种子+私有渠道元数据", async () => {
  const env = await startRuntimeEnvironment({
    publicRootCatalog: new Set(["B2B\0ai 自动排产", "B2B\0bio generator"]),
  });
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const before = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          view: "history",
        }),
      ),
    );
    const preview = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          generation: { ...generation, source_seed_id: f.seed.id },
        }),
      ),
    );
    assert.equal(
      preview.items.find((row) => row.keyword === "bio generator")?.eligible,
      true,
    );
    assert.equal(
      preview.items.find((row) => row.keyword === "private-product generator")
        ?.eligible,
      false,
    );
    assert.deepEqual(
      ok(
        await app.call(
          "seed_list.read",
          req(f.actors.strategist, {}, undefined, {
            industry: "B2B",
            view: "history",
          }),
        ),
      ),
      before,
    );
    const body = {
      generation,
      confirmed: true,
      maintainer: "张三（虚构）",
      last_reviewed_at: "2026-11-15T00:00:00Z",
    };
    const rejected = await app.call(
      "seed_list.revise",
      req(
        f.actors.strategist,
        {
          ...body,
          generation: {
            ...generation,
            selected_keywords: ["bio generator", "private-product generator"],
          },
        },
        f.seed.id,
      ),
    );
    assert.equal(rejected.status, 422);
    assert.equal(
      (
        await app.call(
          "seed_list.revise",
          req(f.actors.strategist, { ...body, confirmed: false }, f.seed.id),
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await app.call(
          "seed_list.revise",
          req(
            f.actors.strategist,
            {
              ...body,
              generation: { ...generation, source_seed_id: "forged-source" },
            },
            f.seed.id,
          ),
        )
      ).status,
      422,
    );
    const agent = {
      ...app.issueActor({
        user_id: f.actors.strategist.user_id,
        tenant_id: f.tenant_id,
        role: "strategist",
        actor_type: "agent",
        agent_run_id: "generate-1",
        prompt_version: "v1",
      }),
      brand_id: f.brand_id,
    };
    assert.equal(
      (await app.call("seed_list.revise", req(agent, body, f.seed.id))).status,
      403,
    );
    const confirmed = ok(
      await app.call(
        "seed_list.revise",
        req(f.actors.strategist, body, f.seed.id),
        { idempotencyKey: "generation-once" },
      ),
    );
    assert.equal(confirmed.items.length, 1);
    assert.equal(confirmed.items[0].word, "bio generator");
    assert.deepEqual(
      ok(
        await app.call(
          "seed_list.revise",
          req(f.actors.strategist, body, f.seed.id),
          { idempotencyKey: "generation-once" },
        ),
      ),
      confirmed,
    );
    const read = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          include_generation_meta: true,
        }),
      ),
    );
    assert.ok(
      read.generation_metadata.some(
        (row) =>
          row.seed_id === confirmed.items[0].id &&
          row.source_channel === "A" &&
          row.planned === true,
      ),
    );
    const raw = ok(
      await app.call("keyword_raw.read", req(f.actors.strategist)),
    );
    assert.ok(!raw.items.some((row) => row.keyword === "bio generator"));
    const other = await createFixtureRegistry(app, {
      clock: env.clock,
    }).fixture("snapshot-input");
    const otherRead = ok(
      await app.call(
        "seed_list.read",
        req(other.actors.strategist, {}, undefined, {
          industry: "B2B",
          include_generation_meta: true,
        }),
      ),
    );
    assert.equal(otherRead.generation_metadata.length, 0);
  } finally {
    await env.close();
  }
});
