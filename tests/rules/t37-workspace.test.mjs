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
const request = (actor, body = {}, params = {}) => ({ actor, body, params });
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};

test("T37工作区读当前成员/合同，品牌逐个走服务鉴权；跨租户、任务范围、撤销凭证均不可越权", async () => {
  const { readWorkspaceContext } = await import(
    "../../src/server/api/workspace-context.mjs"
  );
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
    await registerInstallationAdmin({ client: management, actor });
    await management.end();
    const client = await connectDatabaseParameters({
      ...settings,
      user: "geo_app",
    });
    try {
      const now = () => Date.parse("2026-11-15T12:00:00Z");
      const secret = randomBytes(32).toString("hex");
      const app = await createApplication({
        client,
        secret,
        now,
        publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
      });
      const registry = createFixtureRegistry(app, {
        clock: { now, advanceDays: () => {} },
      });
      const f = await registry.fixture("snapshot-input");
      const other = await registry.fixture("snapshot-input");
      ok(
        await app.call(
          "brand.configure",
          request(f.actors.admin, {
            id: "self-tool-b",
            name: "自营工具",
            industry: "开发工具",
            market: "CN",
          }),
        ),
      );
      const load = (a) =>
        readWorkspaceContext({
          client,
          application: app,
          secret,
          now,
          credential: a.credential,
        });
      const strategist = await load(f.actors.strategist);
      assert.equal(strategist.role, "strategist");
      assert.equal(strategist.can_write, true);
      assert.equal(strategist.brands.length, 2);
      assert.ok(!strategist.brands.some((b) => b.id === other.brand_id));
      assert.deepEqual(
        (await load(f.actors.viewer)).brands.map((b) => b.id),
        [f.brand_id],
      );
      assert.equal((await load(f.actors.content)).brands.length, 0);
      const jobActor = app.issueActor({
        user_id: "job-weekly_pool",
        tenant_id: f.tenant_id,
        role: "system",
        actor_type: "system",
        job_name: "weekly_pool",
        trigger_source: { event_id: "workspace-scope" },
      });
      const cluster = ok(
        await app.call(
          "intent_cluster.transition",
          request(jobActor, {
            brand_id: f.brand_id,
            name: "公开测试簇",
            intent_type: "认知",
            pool_version: f.poolVersion,
          }),
        ),
      );
      ok(
        await app.call(
          "user_member.configure",
          request(f.actors.admin, {
            user_id: f.actors.content.user_id,
            role: "content",
            assignments: [
              { object_type: "intent_cluster", object_id: cluster.id },
            ],
          }),
        ),
      );
      assert.deepEqual(
        (await load(f.actors.content)).brands.map((b) => b.id),
        [f.brand_id],
      );
      ok(
        await app.call(
          "tenant.configure",
          request(f.actors.admin, {
            name: "内部验收",
            mode: "diagnosis",
            plan: "fixture",
          }),
        ),
      );
      assert.equal((await load(f.actors.editor)).mode, "diagnosis");
      ok(
        await app.call(
          "user_member.configure",
          request(f.actors.admin, {
            user_id: f.actors.strategist.user_id,
            role: "cs",
            replace_role: "strategist",
          }),
        ),
      );
      await assert.rejects(load(f.actors.strategist));
      const token = ok(
        await app.call(
          "api_token.create",
          request(f.actors.admin, {
            user_id: f.actors.owner.user_id,
            scopes: ["brand.read"],
          }),
        ),
      );
      const pat = { credential: token.token };
      assert.equal((await load(pat)).role, "owner");
      ok(
        await app.call(
          "api_token.revoke",
          request(f.actors.admin, { reason: "撤销测试" }, { id: token.id }),
        ),
      );
      await assert.rejects(load(pat));
      const narrow = ok(
        await app.call(
          "api_token.create",
          request(f.actors.admin, {
            user_id: f.actors.owner.user_id,
            scopes: ["seed_list.read"],
          }),
        ),
      );
      await assert.rejects(load({ credential: narrow.token }));
      await assert.rejects(load({ credential: "web.forged.token" }));
      const job = app.issueActor({
        user_id: "job-weekly_pool",
        tenant_id: f.tenant_id,
        role: "system",
        actor_type: "system",
        job_name: "weekly_pool",
        trigger_source: { event_id: "no-browser" },
      });
      await assert.rejects(load(job));
    } finally {
      await client.end();
    }
  });
});
