import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
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
async function setup(options = {}) {
  const env = await startRuntimeEnvironment(options);
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("snapshot-input");
    const job = app.issueActor({
      user_id: "job-weekly_pool",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "weekly_pool",
      trigger_source: { event_id: "t12-fixture" },
    });
    const cluster = async (name) =>
      ok(
        await app.call(
          "intent_cluster.transition",
          req(job, {
            brand_id: f.brand_id,
            name,
            intent_type: "认知",
            pool_version: f.poolVersion,
          }),
        ),
      );
    const a = await cluster("自营工具认知"),
      b = await cluster("公开场景");
    const body = (c, version = 1, n = 0) => ({
      cluster_id: c.id,
      question: `真实来源表述${n}`,
      source_word_id: f.sourceId,
      intent_type: "认知",
      source_channel: "B",
      collected_at: new Date(env.clock.now()).toISOString(),
      maintainer: "张三（虚构）",
      question_pool_version: version,
    });
    const add = async (c, v = 1) => {
      const rows = [];
      for (let i = 0; i < 3; i++)
        rows.push(
          ok(
            await app.call(
              "question_pool.create",
              req(f.actors.strategist, body(c, v, i)),
            ),
          ),
        );
      return rows;
    };
    const read = (query = {}) =>
      app.call(
        "question_pool.read",
        req(
          f.actors.strategist,
          {},
          { bid: f.brand_id },
          { view: "list", ...query },
        ),
      );
    return { env, app, f, registry, a, b, body, add, read };
  } catch (e) {
    await env.close();
    throw e;
  }
}

test("T12整个品牌版本原子冻结、分页还原；修订不动锚，显式升级不影响其他簇，归档保留历史", async () => {
  const { env, app, f, a, b, add, read } = await setup();
  try {
    const qa = await add(a),
      qb = await add(b);
    ok(
      await app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 1,
        }),
      ),
    );
    assert.equal(
      ok(
        await app.call(
          "question_pool.read",
          req(f.actors.strategist, {}, { id: qb[0].id }),
        ),
      ).frozen,
      true,
    );
    const first = ok(await read({ limit: 2 }));
    assert.equal(first.items.length, 2);
    assert.ok(first.next_cursor);
    const seen = [...first.items];
    let cursor = first.next_cursor;
    while (cursor) {
      const p = ok(await read({ limit: 2, cursor }));
      seen.push(...p.items);
      cursor = p.next_cursor;
    }
    assert.equal(new Set(seen.map((q) => q.id)).size, 6);
    assert.equal(first.next_version, 2);
    for (const [c, qs] of [
      [a, qa],
      [b, qb],
    ])
      ok(
        await app.call(
          "question_pool.upgrade_anchor",
          req(f.actors.strategist, {
            cluster_id: c.id,
            question_pool_version: 1,
            question_ids: qs.map((q) => q.id),
            reason: "首次入测",
          }),
        ),
      );
    const revised = [];
    for (const old of qa)
      revised.push(
        ok(
          await app.call(
            "question_pool.revise",
            req(
              f.actors.strategist,
              {
                question: old.question + "修订",
                question_pool_version: 2,
                reason: "人工升级",
              },
              { id: old.id },
            ),
          ),
        ),
      );
    assert.equal(
      ok(
        await app.call(
          "intent_cluster.read",
          req(f.actors.strategist, {}, { id: a.id }),
        ),
      ).question_pool_version,
      1,
    );
    ok(
      await app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 2,
        }),
      ),
    );
    const bad = await app.call(
      "question_pool.upgrade_anchor",
      req(f.actors.strategist, {
        cluster_id: a.id,
        question_pool_version: 2,
        question_ids: [revised[0].id, revised[1].id, qb[0].id],
        reason: "错误集合",
      }),
    );
    assert.equal(bad.status, 422);
    ok(
      await app.call(
        "question_pool.upgrade_anchor",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 2,
          question_ids: revised.map((q) => q.id),
          reason: "人工确认重开基线",
        }),
      ),
    );
    assert.equal(
      ok(
        await app.call(
          "intent_cluster.read",
          req(f.actors.strategist, {}, { id: b.id }),
        ),
      ).question_pool_version,
      1,
    );
    ok(
      await app.call(
        "question_pool.archive",
        req(
          f.actors.strategist,
          { question_pool_version: 1, reason: "停止新锚定" },
          { bid: f.brand_id, version: "1" },
        ),
      ),
    );
    const history = ok(
      await app.call(
        "question_pool.read",
        req(f.actors.strategist, {}, { id: qa[0].id }),
      ),
    );
    assert.ok(history.archived_at);
    assert.equal(history.question, qa[0].question);
    assert.equal(
      ok(
        await app.call(
          "intent_cluster.read",
          req(f.actors.strategist, {}, { id: b.id }),
        ),
      ).question_pool_version,
      1,
    );
    assert.equal(
      (
        await app.call(
          "question_pool.archive",
          req(
            f.actors.strategist,
            { reason: "重复归档" },
            { bid: f.brand_id, version: "1" },
          ),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await app.call(
          "question_pool.create",
          req(f.actors.strategist, { ...qa[0], cluster_id: b.id }),
        )
      ).status,
      409,
    );
  } finally {
    await env.close();
  }
});

test("T12缺溯源/非法版本或时间拒绝；整版本存在不完整簇则冻结回滚，审计失败不封版", async () => {
  let fail = false;
  const { env, app, f, a, b, body, add, read } = await setup({
    beforeAudit: (e) => {
      if (fail && e.action === "question_pool.freeze")
        throw new Error("audit unavailable");
    },
  });
  try {
    for (const change of [
      { maintainer: 123 },
      { collected_at: "2026-02-30T12:00:00Z" },
      { collected_at: "2026-11-15" },
      { question_pool_version: 1.5 },
      { source_channel: "A" },
      { source_word_id: "missing" },
    ])
      assert.equal(
        (
          await app.call(
            "question_pool.create",
            req(f.actors.strategist, { ...body(a), ...change }),
          )
        ).status,
        422,
      );
    await add(a);
    ok(
      await app.call("question_pool.create", req(f.actors.strategist, body(b))),
    );
    assert.equal(
      (
        await app.call(
          "question_pool.freeze",
          req(f.actors.strategist, {
            cluster_id: a.id,
            question_pool_version: 1,
          }),
        )
      ).status,
      422,
    );
    assert.ok(ok(await read()).items.every((q) => !q.frozen));
    for (let i = 1; i < 3; i++)
      ok(
        await app.call(
          "question_pool.create",
          req(f.actors.strategist, body(b, 1, i)),
        ),
      );
    fail = true;
    assert.equal(
      (
        await app.call(
          "question_pool.freeze",
          req(f.actors.strategist, {
            cluster_id: a.id,
            question_pool_version: 1,
          }),
        )
      ).status,
      500,
    );
    fail = false;
    assert.ok(ok(await read()).items.every((q) => !q.frozen));
  } finally {
    await env.close();
  }
});

test("T12列表逐行按品牌/任务隔离，C问句先脱敏，C读取必须审计提交后交付", async () => {
  let tid,
    fail = false;
  const auth = {
    ref: "c-t12",
    document_ref: "signed-t12",
    active: true,
    redaction_policy: {
      version: "v1",
      verified: true,
      dictionary_complete: true,
      reviewed_by: "李四",
      reviewed_at: "2026-01-01T00:00:00Z",
      names: ["王敏"],
      addresses: ["示例街道8号"],
    },
  };
  const { env, app, f, a, b, body, read, registry } = await setup({
    resolveImportAuthorization: async () => ({ ...auth, tenant_id: tid }),
    beforeAudit: (e) => {
      if (fail && e.action === "question_pool.read")
        throw new Error("audit down");
    },
  });
  try {
    tid = f.tenant_id;
    const imported = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "C",
          authorization_ref: auth.ref,
          csv: "keyword,collected_at\n王敏需要排产软件,2026-11-10T00:00:00Z",
        }),
      ),
    );
    const sources = ok(
      await app.call("keyword_raw.read", req(f.actors.strategist)),
    ).items;
    const source = sources.find((s) => s.channel === "C");
    assert.ok(source);
    assert.equal(imported.added, 1);
    const q = ok(
      await app.call(
        "question_pool.create",
        req(f.actors.strategist, {
          ...body(a),
          source_word_id: source.id,
          source_channel: "C",
          collected_at: "2026-11-10T00:00:00Z",
          question: "王敏 13800138000 的排产问题",
        }),
      ),
    );
    assert.ok(!q.question.includes("王敏"));
    assert.ok(!q.question.includes("13800138000"));
    ok(
      await app.call("question_pool.create", req(f.actors.strategist, body(b))),
    );
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, {
          user_id: f.actors.content.user_id,
          role: "content",
          assignments: [{ object_type: "intent_cluster", object_id: a.id }],
        }),
      ),
    );
    const scoped = ok(
      await app.call(
        "question_pool.read",
        req(f.actors.content, {}, { bid: f.brand_id }, { view: "list" }),
      ),
    );
    assert.deepEqual(
      scoped.items.map((x) => x.id),
      [q.id],
    );
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, {
          user_id: f.actors.evidence.user_id,
          role: "evidence",
          assignments: [{ object_type: "keyword_raw", object_id: source.id }],
        }),
      ),
    );
    const sourceScoped = ok(
      await app.call(
        "question_pool.read",
        req(
          f.actors.evidence,
          {},
          { bid: f.brand_id },
          { view: "list", cluster_id: a.id },
        ),
      ),
    );
    assert.deepEqual(
      sourceScoped.items.map((x) => x.id),
      [q.id],
    );
    const other = await registry.fixture("snapshot-input");
    assert.equal(
      (
        await app.call(
          "question_pool.read",
          req(
            other.actors.strategist,
            {},
            { bid: f.brand_id },
            { view: "list" },
          ),
        )
      ).status,
      403,
    );
    fail = true;
    const denied = await read();
    assert.equal(denied.status, 500);
    assert.ok(!denied.data);
    fail = false;
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, {}, { object_id: q.id, limit: 100 }),
      ),
    ).items;
    assert.ok(audit.some((e) => e.action === "question_pool.read"));
    assert.equal(
      (
        await app.call(
          "question_pool.read",
          req(f.actors.editor, {}, { id: q.id }),
        )
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});

test("T12归档只停止新锚定，已锚定版本仍可创建基线批次且不改旧问句", async () => {
  const { env, app, f, a, b, add } = await setup();
  try {
    const qa = await add(a),
      qb = await add(b);
    ok(
      await app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 1,
        }),
      ),
    );
    ok(
      await app.call(
        "question_pool.upgrade_anchor",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 1,
          question_ids: qa.map((q) => q.id),
          reason: "首次入测",
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
        "question_pool.archive",
        req(f.actors.strategist, {
          cluster_id: a.id,
          question_pool_version: 1,
          reason: "停止后续新锚定",
        }),
      ),
    );
    assert.equal(
      (
        await app.call(
          "question_pool.upgrade_anchor",
          req(f.actors.strategist, {
            cluster_id: b.id,
            question_pool_version: 1,
            question_ids: qb.map((q) => q.id),
            reason: "新锚定",
          }),
        )
      ).status,
      422,
    );
    const batch = ok(
      await app.call(
        "probe_batch.create",
        req(f.actors.cs, {
          type: "baseline",
          snapshot_id: snapshot.snapshot_id,
          scheduled_at: new Date(env.clock.now()).toISOString(),
          cluster_question_sets: [
            {
              cluster_id: a.id,
              question_pool_version: 1,
              question_ids: qa.map((q) => q.id),
            },
          ],
        }),
      ),
    );
    assert.equal(batch.status, "pending");
    assert.equal(batch.snapshot_id, snapshot.snapshot_id);
  } finally {
    await env.close();
  }
});
