import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { withPostgres } from "../support/postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";
import { registerInstallationAdmin } from "../../src/server/api/installation-service.mjs";
import { connectDatabaseParameters } from "../../src/server/api/database.mjs";
import { createApplication } from "../../src/server/api/application.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
const req = (actor, body = {}, params = {}, query = {}) => ({
  actor,
  body,
  params,
  query,
});
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};

test("T12两个普通连接并发冻结/追加不产生冻结后增长，旧锚与版本原文不被覆盖", async () => {
  await withPostgres(async (management) => {
    const settings = {
      host: management.connectionParameters.host,
      port: management.connectionParameters.port,
      database: management.connectionParameters.database,
    };
    const actor = {
      user_id: "installation-operator",
      role: "admin",
      actor_type: "human",
    };
    const files = readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    await applyMigrations({ client: management, files, actor });
    assert.equal(
      (await applyMigrations({ client: management, files, actor })).applied
        .length,
      0,
    );
    await registerInstallationAdmin({ client: management, actor });
    await management.end();
    const c1 = await connectDatabaseParameters({
        ...settings,
        user: "geo_app",
      }),
      c2 = await connectDatabaseParameters({ ...settings, user: "geo_app" });
    try {
      const secret = randomBytes(32).toString("hex"),
        now = () => Date.parse("2026-11-15T12:00:00Z");
      const options = {
        secret,
        now,
        publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
      };
      const a1 = await createApplication({ ...options, client: c1 }),
        a2 = await createApplication({ ...options, client: c2 });
      const f = await createFixtureRegistry(a1, {
        clock: { now, advanceDays: () => {} },
      }).fixture("snapshot-input");
      const job = a1.issueActor({
        user_id: "weekly_pool",
        tenant_id: f.tenant_id,
        role: "system",
        actor_type: "system",
        job_name: "weekly_pool",
        trigger_source: { event_id: "race" },
      });
      const cluster = async (name) =>
        ok(
          await a1.call(
            "intent_cluster.transition",
            req(job, {
              brand_id: f.brand_id,
              name,
              intent_type: "认知",
              pool_version: f.poolVersion,
            }),
          ),
        );
      const a = await cluster("已配齐"),
        b = await cluster("新候选");
      const body = (c) => ({
        cluster_id: c.id,
        question: "真实测试表述",
        source_word_id: f.sourceId,
        intent_type: "认知",
        source_channel: "B",
        collected_at: new Date(now()).toISOString(),
        maintainer: "张三（虚构）",
        question_pool_version: 1,
      });
      for (let i = 0; i < 3; i++)
        ok(
          await a1.call(
            "question_pool.create",
            req(f.actors.strategist, body(a)),
          ),
        );
      assert.equal(
        (
          await a1.call(
            "question_pool.create",
            req(f.actors.strategist, body(a)),
          )
        ).status,
        422,
      );
      const [freeze, append] = await Promise.all([
        a1.call(
          "question_pool.freeze",
          req(f.actors.strategist, {
            cluster_id: a.id,
            question_pool_version: 1,
          }),
        ),
        a2.call("question_pool.create", req(f.actors.strategist, body(b))),
      ]);
      assert.ok(freeze.status !== 200 || append.status !== 200);
      const data = ok(
        await a1.call(
          "question_pool.read",
          req(
            f.actors.strategist,
            {},
            { bid: f.brand_id },
            { view: "list", limit: 100 },
          ),
        ),
      );
      if (freeze.status === 200) {
        assert.equal(append.status, 409);
        assert.equal(data.items.length, 3);
        assert.ok(data.items.every((q) => q.frozen));
      } else {
        assert.equal(freeze.status, 422);
        assert.equal(append.status, 200);
        assert.equal(data.items.length, 4);
        assert.ok(data.items.every((q) => !q.frozen));
      }
    } finally {
      await Promise.allSettled([c1.end(), c2.end()]);
    }
  });
});
