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
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data;
};
const input = {
  industry: "B2B",
  word: "公开词根1",
  word_type: "品类",
  maintainer: "李四（虚构）",
  last_reviewed_at: "2026-11-11T00:00:00Z",
};

test("T07 CRUD：默认active，修订与软停用开新版本，历史与陈旧编辑保护", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const first = ok(
      await app.call("seed_list.create", req(f.actors.strategist, input)),
    );
    assert.equal(first.status, "active");
    assert.ok(first.logical_id);
    assert.ok(first.seed_version > 0);
    const edited = ok(
      await app.call(
        "seed_list.revise",
        req(
          f.actors.strategist,
          { ...input, maintainer: "王五（虚构）" },
          first.id,
        ),
      ),
    );
    assert.equal(edited.logical_id, first.logical_id);
    assert.equal(edited.previous_id, first.id);
    assert.ok(edited.seed_version > first.seed_version);
    assert.equal(
      (
        await app.call(
          "seed_list.revise",
          req(f.actors.strategist, input, first.id),
        )
      ).status,
      409,
    );
    const retired = ok(
      await app.call(
        "seed_list.revise",
        req(f.actors.strategist, { ...input, status: "deprecated" }, edited.id),
      ),
    );
    assert.equal(retired.status, "deprecated");
    const current = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, { industry: "B2B" }),
      ),
    );
    assert.deepEqual(
      current.items
        .filter((row) => row.logical_id === first.logical_id)
        .map((row) => row.id),
      [retired.id],
    );
    const active = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          status: "active",
        }),
      ),
    );
    assert.ok(!active.items.some((row) => row.logical_id === first.logical_id));
    const history = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          logical_id: first.logical_id,
          view: "history",
          limit: 1,
        }),
      ),
    );
    assert.equal(history.items.length, 1);
    assert.ok(history.next_cursor);
    assert.equal(history.items[0].maintainer, input.maintainer);
    const next = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          logical_id: first.logical_id,
          view: "history",
          limit: 1,
          cursor: history.next_cursor,
        }),
      ),
    );
    assert.equal(next.items[0].id, edited.id);
    assert.equal(next.items[0].maintainer, "王五（虚构）");
    const historical = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          seed_version: first.seed_version,
          logical_id: first.logical_id,
        }),
      ),
    );
    assert.deepEqual(
      historical.items.map((row) => row.id),
      [first.id],
    );
    const revived = ok(
      await app.call(
        "seed_list.revise",
        req(f.actors.strategist, { ...input, status: "active" }, retired.id),
      ),
    );
    assert.equal(revived.logical_id, first.logical_id);
    assert.equal(revived.previous_id, retired.id);
    assert.equal(revived.status, "active");
    const repeated = ok(
      await app.call(
        "seed_list.create",
        req(f.actors.strategist, { ...input, seed_version: 999999 }),
      ),
    );
    assert.equal(repeated.logical_id, first.logical_id);
    assert.equal(repeated.previous_id, revived.id);
    assert.equal(repeated.seed_version, revived.seed_version + 1);
    const audits = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, {
          object_type: "seed_list",
          limit: 100,
        }),
      ),
    );
    for (const row of [first, edited, retired, revived, repeated])
      assert.ok(
        audits.items.some(
          (a) => a.object_id === row.id && a.actor_type === "human",
        ),
      );
  } finally {
    await env.close();
  }
});

test("T07 字段与枚举：维护人/复核时间/类型必填，未知状态拒绝，兼容重试不重复版本", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    for (const field of ["maintainer", "last_reviewed_at", "word_type"]) {
      const bad = { ...input };
      delete bad[field];
      assert.equal(
        (await app.call("seed_list.create", req(f.actors.strategist, bad)))
          .status,
        422,
        field,
      );
    }
    for (const patch of [
      { maintainer: "  " },
      { last_reviewed_at: "invalid" },
      { word_type: "其他" },
      { status: "draft" },
      { status: null },
    ])
      assert.equal(
        (
          await app.call(
            "seed_list.create",
            req(f.actors.strategist, { ...input, ...patch }),
          )
        ).status,
        422,
      );
    const request = req(f.actors.strategist, input);
    const first = ok(
      await app.call("seed_list.create", request, {
        idempotencyKey: "seed-create-once",
      }),
    );
    assert.deepEqual(
      ok(
        await app.call("seed_list.create", request, {
          idempotencyKey: "seed-create-once",
        }),
      ),
      first,
    );
    const history = ok(
      await app.call(
        "seed_list.read",
        req(f.actors.strategist, {}, undefined, {
          industry: "B2B",
          logical_id: first.logical_id,
          view: "history",
        }),
      ),
    );
    assert.equal(history.items.length, 1);
  } finally {
    await env.close();
  }
});

test("T07 行业共享：跨租户可见许可公共词根，角色只按allow；私有厂牌/竞品/C原句不能混入", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const a = await registry.fixture("snapshot-input"),
      b = await registry.fixture("snapshot-input");
    const created = ok(
      await app.call("seed_list.create", req(a.actors.strategist, input)),
    );
    for (const actor of [
      b.actors.strategist,
      b.actors.factcheck,
      b.actors.cs,
    ]) {
      const read = ok(
        await app.call(
          "seed_list.read",
          req(actor, {}, undefined, { industry: "B2B" }),
        ),
      );
      assert.ok(read.items.some((row) => row.id === created.id));
      assert.equal(JSON.stringify(read).includes("tenant_id"), false);
      assert.equal(JSON.stringify(read).includes("raw_payload"), false);
    }
    for (const role of [
      "owner",
      "editor",
      "viewer",
      "content",
      "evidence",
      "admin",
    ])
      assert.equal(
        (
          await app.call(
            "seed_list.read",
            req(b.actors[role], {}, undefined, { industry: "B2B" }),
          )
        ).status,
        403,
        role,
      );
    for (const role of ["factcheck", "cs", "admin"])
      assert.equal(
        (
          await app.call(
            "seed_list.revise",
            req(b.actors[role], input, created.id),
          )
        ).status,
        403,
        role,
      );
    for (const patch of [
      { word: "简造 ERP" },
      { word: "仅某客户工单原句" },
      { word_type: "竞品" },
      { word_type: "品线" },
      { industry: "某客户私有行业" },
      { maintainer: "简造 ERP 负责人" },
    ])
      assert.equal(
        (
          await app.call(
            "seed_list.create",
            req(a.actors.strategist, { ...input, ...patch }),
          )
        ).status,
        422,
      );
    const edited = ok(
      await app.call(
        "seed_list.revise",
        req(
          b.actors.strategist,
          { ...input, maintainer: "跨租户策略员（虚构）" },
          created.id,
        ),
      ),
    );
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(b.actors.admin, {}, undefined, { object_id: edited.id }),
      ),
    );
    assert.ok(audit.items.some((row) => row.action === "seed_list.revise"));
  } finally {
    await env.close();
  }
});
