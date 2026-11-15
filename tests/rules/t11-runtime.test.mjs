import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import {
  weeklyRulesDraft,
  weeklyRuleDigest,
} from "../../src/server/api/weekly-rules.mjs";

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
const policy = () => ({
  rules: structuredClone(weeklyRulesDraft),
  approval: {
    status: "frozen",
    approved_by: "fixture-human-reviewer",
    approved_at: "2026-01-01T00:00:00Z",
    rules_digest: weeklyRuleDigest(weeklyRulesDraft),
  },
});
function receipt({ industry, window }) {
  return {
    industry,
    window_start: window.start,
    window_end: window.end,
    source_ref: "public-fixture",
    complete: true,
    rows: ["ai 自动排产", "公开词根1"].map((root, i) => ({
      root,
      intent_type: "价格",
      channels: {
        A: { source: "public-A", demand_index: 10 + i * 10 },
        B: { source: "public-B", demand_index: 10 + i * 10 },
      },
    })),
  };
}
async function setup(options = {}) {
  const env = await startRuntimeEnvironment({
    loadWeeklyPolicy: async () => policy(),
    loadIndustryPopulation: async (input) => receipt(input),
    ...options,
  });
  try {
    env.clock.advanceDays(6);
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
      "snapshot-input",
    );
    ok(
      await app.call(
        "seed_list.create",
        req(f.actors.strategist, {
          industry: "B2B",
          word: "公开词根1",
          word_type: "问题",
          maintainer: "张三（虚构）",
          last_reviewed_at: "2026-11-16T00:00:00Z",
        }),
      ),
    );
    const actor = app.issueActor({
      user_id: "job-weekly_pool",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "weekly_pool",
      trigger_source: { event_id: "weekly-surge-fixture" },
    });
    return {
      env,
      app,
      f,
      run: () =>
        app.call(
          "keyword_pool_snapshot.append",
          req(actor, { industry: "B2B", weekly_pipeline: true }),
        ),
    };
  } catch (error) {
    await env.close();
    throw error;
  }
}
const read = (app, actor, view, extra = {}) =>
  app.call(
    "keyword_pool_snapshot.read",
    req(actor, {}, undefined, { view, industry: "B2B", ...extra }),
  );

test("T11周批内原子通知策略与候选预筛；审计故障回滚、重放不重复、跨租户与个人收件箱隔离", async () => {
  let fail = false;
  const { env, app, f, run } = await setup({
    beforeAudit: (event) => {
      if (fail && event.action === "keyword_surge_notification.create")
        throw new Error("fixture notification audit failure");
    },
  });
  try {
    const secondUser = "another-strategist-" + f.tenant_id;
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, { user_id: secondUser, role: "strategist" }),
      ),
    );
    const imported = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "B",
          source_id: "manual-platform:global:weekly:v1",
          csv: "keyword,collected_at,demand_index,trend_dir\nai 自动排产价格,2026-11-04T00:00:00Z,10,up\nAI 自动排产价格,2026-11-11T00:00:00Z,20,up\n",
        }),
      ),
    );
    fail = true;
    assert.equal((await run()).status, 500);
    fail = false;
    assert.equal(
      ok(await read(app, f.actors.strategist, "surge_alerts")).items.length,
      0,
    );
    const first = ok(await run());
    assert.equal(first.surge.created_count, 1);
    assert.equal(first.surge.notification_count, 2);
    assert.equal(first.surge.prefilter_count, 1);
    const alerts = ok(await read(app, f.actors.strategist, "surge_alerts"));
    assert.equal(alerts.items.length, 1);
    assert.equal(alerts.items[0].evidence.previous.trend_dir, "up");
    assert.equal(alerts.items[0].evidence.current.trend_dir, "up");
    assert.equal(
      ok(await read(app, f.actors.strategist, "surge_notifications")).items
        .length,
      1,
    );
    const secondActor = app.issueActor({
      user_id: secondUser,
      tenant_id: f.tenant_id,
      role: "strategist",
      actor_type: "human",
    });
    assert.equal(
      ok(await read(app, secondActor, "surge_notifications")).items.length,
      1,
    );
    assert.equal(
      (await read(app, f.actors.cs, "surge_notifications")).status,
      403,
    );
    const laterUser = "later-strategist-" + f.tenant_id;
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, { user_id: laterUser, role: "strategist" }),
      ),
    );
    const laterActor = app.issueActor({
      user_id: laterUser,
      tenant_id: f.tenant_id,
      role: "strategist",
      actor_type: "human",
    });
    assert.equal(
      ok(
        await read(app, laterActor, "surge_notifications", {
          recipient_user_id: f.actors.strategist.user_id,
        }),
      ).items.length,
      0,
    );
    assert.equal(ok(await run()).replayed, true);
    assert.equal(
      ok(await read(app, f.actors.strategist, "surge_alerts")).items.length,
      1,
    );
    const prefilter = ok(
      await read(app, f.actors.strategist, "weekly_candidates"),
    );
    assert.ok(prefilter.items.some((row) => row.reason === "surge"));
    const log = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, {
          object_type: "keyword_surge_notification",
        }),
      ),
    );
    assert.equal(log.items.length, 2);
    assert.ok(
      log.items.every(
        (row) =>
          row.actor_type === "system" &&
          row.job_name === "weekly_pool" &&
          row.cause_event_id,
      ),
    );
    const other = await createFixtureRegistry(app, {
      clock: env.clock,
    }).fixture("snapshot-input");
    assert.equal(
      ok(await read(app, other.actors.strategist, "surge_alerts")).items.length,
      0,
    );
    assert.equal(
      ok(await read(app, other.actors.strategist, "surge_notifications")).items
        .length,
      0,
    );
    ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "B",
          source_id: "manual-platform:global:weekly:v1",
          keyword: "ai 自动排产价格",
          collected_at: "2026-11-05T00:00:00Z",
          trend_dir: "down",
          demand_index: 5,
        }),
      ),
    );
    assert.equal((await run()).status, 409);
    assert.equal(
      ok(await read(app, f.actors.strategist, "surge_alerts")).items.length,
      1,
    );
    const raw = ok(
      await app.call(
        "keyword_raw.read_raw",
        req(f.actors.strategist, {}, imported.record_results[1].id),
      ),
    );
    assert.equal(raw.raw_payload.source_id, "manual-platform:global:weekly:v1");
  } finally {
    await env.close();
  }
});

test("T11私有C信号审计且不复制原句；多品牌仅租户级预筛，任务关联之外不可读", async () => {
  let authorization;
  const { env, app, f, run } = await setup({
    resolveImportAuthorization: async () => authorization,
  });
  try {
    authorization = {
      tenant_id: f.tenant_id,
      ref: "surge-c",
      document_ref: "written-fixture-authorization",
      active: true,
      redaction_policy: {
        version: "contacts-v1",
        verified: true,
        dictionary_complete: true,
        reviewed_by: "fixture-reviewer",
        reviewed_at: "2026-01-01T00:00:00Z",
        names: ["王五"],
        addresses: [],
      },
    };
    ok(
      await app.call(
        "brand.configure",
        req(f.actors.admin, {
          id: "second-" + f.tenant_id,
          name: "第二个虚构自营工具",
          industry: "B2B",
          market: "CN",
        }),
      ),
    );
    const imported = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "C",
          authorization_ref: "surge-c",
          source_id: "client-cannot-replace-authorization",
          csv: "keyword,collected_at,demand_index,trend_dir\nai 自动排产价格 王五13800138000,2026-11-04T00:00:00Z,10,up\nai 自动排产价格 王五13800138000,2026-11-11T00:00:00Z,20,up\n",
        }),
      ),
    );
    const result = ok(await run());
    assert.equal(result.surge.created_count, 1);
    const alerts = ok(await read(app, f.actors.strategist, "surge_alerts"));
    assert.ok(!JSON.stringify(alerts).includes("王五"));
    assert.ok(!JSON.stringify(alerts).includes("13800138000"));
    assert.deepEqual(alerts.items[0].old_cluster_ids, []);
    const readAudit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, { object_id: alerts.items[0].id }),
      ),
    );
    assert.ok(
      readAudit.items.some(
        (row) =>
          row.action === "keyword_surge_alert.read" &&
          row.actor_type === "human",
      ),
    );
    const raw = ok(
      await app.call(
        "keyword_raw.read_raw",
        req(f.actors.strategist, {}, imported.record_results[1].id),
      ),
    );
    assert.ok(
      !JSON.stringify(raw).includes("client-cannot-replace-authorization"),
    );
    const pending = ok(
      await read(app, f.actors.strategist, "weekly_candidates"),
    );
    assert.ok(
      pending.items.some(
        (row) => row.reason === "surge" && row.brand_id === null,
      ),
    );
    for (const id of imported.record_results.map((row) => row.id)) {
      const log = ok(
        await app.call(
          "audit_log.read",
          req(f.actors.admin, {}, undefined, { object_id: id }),
        ),
      );
      assert.ok(
        log.items.some(
          (row) =>
            row.action === "keyword_raw.surge_read" &&
            row.actor_type === "system",
        ),
      );
    }
    const unrelated = ok(
      await app.call(
        "intent_cluster.transition",
        req(
          app.issueActor({
            user_id: "job-weekly_pool",
            tenant_id: f.tenant_id,
            role: "system",
            actor_type: "system",
            job_name: "weekly_pool",
            trigger_source: { event_id: "fixture-assignment" },
          }),
          {
            brand_id: f.brand_id,
            name: "无关测试簇",
            intent_type: "认知",
            pool_version: result.pool_version,
          },
        ),
      ),
    );
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, {
          user_id: f.actors.content.user_id,
          role: "content",
          assignments: [
            { object_type: "intent_cluster", object_id: unrelated.id },
          ],
        }),
      ),
    );
    assert.equal(
      ok(
        await read(app, f.actors.content, "surge_alerts", {
          cluster_id: unrelated.id,
        }),
      ).items.length,
      0,
    );
  } finally {
    await env.close();
  }
});
