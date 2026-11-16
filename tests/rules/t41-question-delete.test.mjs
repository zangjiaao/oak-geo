import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { createQuestionTransport } from "../../src/server/api/question-http.mjs";
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
const input = { confirmed: true, question_pool_version: 1 };
async function setup(options = {}) {
  const env = await startRuntimeEnvironment(options);
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock }),
      f = await registry.fixture("editable-question");
    const add = async (n = 0) =>
      ok(
        await app.call(
          "question_pool.create",
          req(f.actors.strategist, {
            ...f.question,
            question: "真实来源问题" + n,
          }),
        ),
      );
    const q = await add();
    const params = { bid: f.brand_id, id: q.id };
    const read = () =>
      app.call("question_pool.read", req(f.actors.strategist, {}, params));
    const remove = (actor = f.actors.strategist, body = input, opts) =>
      app.call("question_pool.delete", req(actor, body, params), opts);
    return { env, app, registry, f, q, params, add, read, remove };
  } catch (e) {
    await env.close();
    throw e;
  }
}
test("T41 草稿删除经服务与审计原子完成，幂等重放仍校验归属；删除后可补齐新问句", async () => {
  const { env, app, f, q, params, add, read, remove } = await setup();
  try {
    assert.equal(
      (await remove(undefined, { ...input, confirmed: false })).status,
      422,
    );
    assert.equal(
      (await remove(undefined, { ...input, question_pool_version: 2 })).status,
      409,
    );
    const result = ok(
      await remove(undefined, input, { idempotencyKey: "delete-once" }),
    );
    assert.deepEqual(result, {
      id: q.id,
      deleted: true,
      question_pool_version: 1,
    });
    assert.deepEqual(
      ok(await remove(undefined, input, { idempotencyKey: "delete-once" })),
      result,
    );
    assert.equal((await read()).status, 403);
    const list = ok(
      await app.call(
        "question_pool.read",
        req(f.actors.strategist, {}, { bid: f.brand_id }, { view: "list" }),
      ),
    );
    assert.equal(list.items.length, 0);
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, {}, { object_id: q.id, limit: 100 }),
      ),
    ).items.filter((e) => e.action === "question_pool.delete");
    assert.equal(audit.length, 1);
    const trace = JSON.parse(audit[0].reason);
    assert.equal(trace.cluster_id, f.question.cluster_id);
    assert.equal(trace.source_word_id, f.question.source_word_id);
    assert.equal(JSON.stringify(trace).includes(q.question), false);
    const newQuestion = await add(1);
    assert.notEqual(newQuestion.id, q.id);
    assert.equal(
      (
        await app.call(
          "question_pool.delete",
          req(f.actors.strategist, input, { ...params, bid: "not-our-brand" }),
          { idempotencyKey: "delete-once" },
        )
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});
test("T41 冻结、已锚定/批次引用及归档版本不可删除，历史问句保持原样", async () => {
  const { env, app, f, q, add, read, remove } = await setup();
  try {
    const questions = [q, await add(1), await add(2)];
    ok(
      await app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: f.question.cluster_id,
          question_pool_version: 1,
        }),
      ),
    );
    assert.equal((await remove()).status, 409);
    ok(
      await app.call(
        "question_pool.upgrade_anchor",
        req(f.actors.strategist, {
          cluster_id: f.question.cluster_id,
          question_pool_version: 1,
          question_ids: questions.map((q) => q.id),
          reason: "确认入测",
        }),
      ),
    );
    const snapshot = ok(
      await app.call("scoring_snapshot.create", req(f.actors.cs, f.config)),
    );
    ok(
      await app.call(
        "scoring_snapshot.freeze",
        req(f.actors.cs, {}, { id: snapshot.snapshot_id }),
      ),
    );
    ok(
      await app.call(
        "probe_batch.create",
        req(f.actors.cs, {
          type: "baseline",
          snapshot_id: snapshot.snapshot_id,
          scheduled_at: new Date(env.clock.now()).toISOString(),
          cluster_question_sets: [
            {
              cluster_id: f.question.cluster_id,
              question_pool_version: 1,
              question_ids: questions.map((q) => q.id),
            },
          ],
        }),
      ),
    );
    assert.equal((await remove()).status, 409);
    ok(
      await app.call(
        "question_pool.archive",
        req(
          f.actors.strategist,
          { reason: "版本退役", question_pool_version: 1 },
          { bid: f.brand_id, version: "1" },
        ),
      ),
    );
    assert.equal((await remove()).status, 409);
    assert.equal(ok(await read()).question, q.question);
  } finally {
    await env.close();
  }
});
test("T41 删除只授予人类策略角色，PAT取交集；删后重放不绕过凭证撤销或租户/品牌", async () => {
  const { env, app, f, registry, params, remove } = await setup();
  try {
    for (const role of [
      "owner",
      "editor",
      "viewer",
      "content",
      "evidence",
      "factcheck",
      "cs",
      "admin",
    ])
      assert.equal((await remove(f.actors[role])).status, 403, role);
    const agent = app.issueActor({
      tenant_id: f.tenant_id,
      user_id: f.actors.strategist.user_id,
      role: "strategist",
      actor_type: "agent",
      agent_run_id: "t41-agent",
      prompt_version: "v1",
    });
    assert.equal((await remove(agent)).status, 403);
    const other = await registry.fixture("snapshot-input");
    assert.equal((await remove(other.actors.strategist)).status, 403);
    const narrow = ok(
      await app.call(
        "api_token.create",
        req(f.actors.admin, {
          user_id: f.actors.strategist.user_id,
          scopes: ["question_pool.read"],
        }),
      ),
    );
    assert.equal(
      (await remove(app.actorFromCredential(narrow.token))).status,
      403,
    );
    const token = ok(
      await app.call(
        "api_token.create",
        req(f.actors.admin, {
          user_id: f.actors.strategist.user_id,
          scopes: ["question_pool.delete"],
        }),
      ),
    );
    const actor = app.actorFromCredential(token.token);
    ok(await remove(actor, input, { idempotencyKey: "pat-delete" }));
    ok(await remove(actor, input, { idempotencyKey: "pat-delete" }));
    ok(
      await app.call(
        "api_token.revoke",
        req(f.actors.admin, { reason: "撤销测试" }, { id: token.id }),
      ),
    );
    assert.equal(
      (await remove(actor, input, { idempotencyKey: "pat-delete" })).status,
      403,
    );
    assert.equal(
      (
        await app.call(
          "question_pool.delete",
          req(f.actors.strategist, input, { ...params, id: "missing" }),
        )
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});
test("T41 删除审计失败整事务回滚，冻结与删除串行竞争不能破坏版本", async () => {
  let fail = true;
  const { env, app, f, q, add, read, remove } = await setup({
    beforeAudit: (e) => {
      if (fail && e.action === "question_pool.delete")
        throw new Error("audit down");
    },
  });
  try {
    assert.equal((await remove()).status, 500);
    assert.equal(ok(await read()).id, q.id);
    fail = false;
    await add(1);
    await add(2);
    const [frozen, deleted] = await Promise.all([
      app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: f.question.cluster_id,
          question_pool_version: 1,
        }),
      ),
      remove(),
    ]);
    assert.equal(frozen.status, 200);
    assert.equal(deleted.status, 409);
    assert.equal(ok(await read()).frozen, true);
  } finally {
    await env.close();
  }
});
test("T41 Web删除薄路由要求同源与显式确认，原始数据不回传，GET不能删除", async () => {
  const { env, app, f, q } = await setup();
  try {
    const serve = createQuestionTransport(async () => ({
      application: app,
      close: async () => {},
    }));
    const url = `https://geo.test/api/tenants/${f.tenant_id}/brands/${f.brand_id}/question-pools/${q.id}/delete`;
    const headers = {
      cookie: "geo_session=" + f.actors.strategist.credential,
      "content-type": "application/json",
      "idempotency-key": "http-delete",
    };
    assert.equal(
      (await serve(new Request(url, { method: "GET", headers }))).status,
      404,
    );
    assert.equal(
      (
        await serve(
          new Request(url, {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          }),
        )
      ).status,
      403,
    );
    const response = await serve(
      new Request(url, {
        method: "POST",
        headers: { ...headers, origin: "https://geo.test" },
        body: JSON.stringify(input),
      }),
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.deleted, true);
    assert.ok(!JSON.stringify(result).includes(q.question));
    const repeated = await serve(
      new Request(url, {
        method: "POST",
        headers: { ...headers, origin: "https://geo.test" },
        body: JSON.stringify(input),
      }),
    );
    assert.equal(repeated.status, 200);
  } finally {
    await env.close();
  }
});

test(
  "T41 不同运行连接同时新增与删除草稿，外键读锁不与版本锁形成死锁",
  { timeout: 20000 },
  async () => {
    const { withPostgres } = await import("../support/postgres-server.mjs");
    const { applyMigrations } = await import(
      "../../src/server/api/migration-service.mjs"
    );
    const { registerInstallationAdmin } = await import(
      "../../src/server/api/installation-service.mjs"
    );
    const { connectDatabaseParameters } = await import(
      "../../src/server/api/database.mjs"
    );
    const { createApplication } = await import(
      "../../src/server/api/application.mjs"
    );
    const { readdirSync, readFileSync } = await import("node:fs");
    await withPostgres(async (management) => {
      const settings = {
        host: management.connectionParameters.host,
        port: management.connectionParameters.port,
        database: management.connectionParameters.database,
      };
      const operator = {
        user_id: "installation-operator",
        role: "admin",
        actor_type: "human",
      };
      await applyMigrations({
        client: management,
        actor: operator,
        files: readdirSync("migrations")
          .filter((n) => n.endsWith(".sql"))
          .map((name) => ({
            name,
            sql: readFileSync("migrations/" + name, "utf8"),
          })),
      });
      await registerInstallationAdmin({ client: management, actor: operator });
      await management.end();
      const a = await connectDatabaseParameters({
          ...settings,
          user: "geo_app",
        }),
        b = await connectDatabaseParameters({ ...settings, user: "geo_app" });
      const originalA = a.query.bind(a),
        originalB = b.query.bind(b);
      let release;
      const gate = new Promise((r) => (release = r));
      try {
        const settings = {
          secret: "t41-isolated-concurrency-secret-32-chars",
          publicRootCatalog: new Set(["B2B\0ai 自动排产"]),
        };
        const appA = await createApplication({ client: a, ...settings }),
          appB = await createApplication({ client: b, ...settings });
        const f = await createFixtureRegistry(appA, {
          clock: { now: Date.now },
        }).fixture("editable-question");
        const add = (n) =>
          appB.call(
            "question_pool.create",
            req(f.actors.strategist, {
              ...f.question,
              question: "并发草稿" + n,
            }),
          );
        const q = ok(await add(0));
        ok(await add(1));
        let clusterLocked, versionLocked;
        const lockedA = new Promise((r) => (clusterLocked = r)),
          lockedB = new Promise((r) => (versionLocked = r));
        const key = `question-version:${f.tenant_id}:${f.brand_id}:1`;
        a.query = async (sql, ...args) => {
          if (
            typeof sql === "string" &&
            sql.includes("pg_advisory_xact_lock") &&
            args[0]?.[0] === key
          ) {
            clusterLocked();
            await gate;
          }
          return originalA(sql, ...args);
        };
        b.query = async (sql, ...args) => {
          const result = await originalB(sql, ...args);
          if (
            typeof sql === "string" &&
            sql.includes("pg_advisory_xact_lock") &&
            args[0]?.[0] === key
          )
            versionLocked();
          return result;
        };
        const deletion = appA.call(
          "question_pool.delete",
          req(f.actors.strategist, input, { id: q.id, bid: f.brand_id }),
        );
        await lockedA;
        const creation = add(2);
        await lockedB;
        release();
        const results = await Promise.all([deletion, creation]);
        for (const result of results) ok(result);
        const list = ok(
          await appA.call(
            "question_pool.read",
            req(f.actors.strategist, {}, { bid: f.brand_id }, { view: "list" }),
          ),
        );
        assert.equal(list.items.length, 2);
      } finally {
        release();
        a.query = originalA;
        b.query = originalB;
        await a.end();
        await b.end();
      }
    });
  },
);
