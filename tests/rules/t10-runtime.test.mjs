import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import {
  weeklyRulesDraft,
  weeklyRuleDigest,
  previousWeek,
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
const weekly = (app, f, event = "weekly-test") =>
  app.issueActor({
    user_id: "job-weekly_pool",
    tenant_id: f.tenant_id,
    role: "system",
    actor_type: "system",
    job_name: "weekly_pool",
    trigger_source: { event_id: event },
  });
const frozenReceipt = () => ({
  rules: structuredClone(weeklyRulesDraft),
  // External registry test double: no production approval is created or bypassed.
  approval: {
    status: "frozen",
    approved_by: "fixture-product-owner",
    approved_at: "2026-01-01T00:00:00Z",
    rules_digest: weeklyRuleDigest(weeklyRulesDraft),
  },
});
function publicReceipt(industry, window) {
  return {
    industry,
    window_start: window.start,
    window_end: window.end,
    source_ref: "public-observation-receipt:" + window.end,
    complete: true,
    rows: [1, 2, 3, 4].map((i) => ({
      root: "公开词根" + i,
      intent_type: "价格",
      channels: Object.fromEntries(
        ["A", "B", "C", "D"].map((c) => [
          c,
          {
            source: "public-" + c,
            demand_index: i * 10,
            ...(c === "C" ? { tenant_count: 5 } : {}),
          },
        ]),
      ),
    })),
  };
}
async function importWeek(app, f, date) {
  const payload = JSON.stringify({
    url: "https://example.com/public-evidence",
    excerpt: "虚构B类测试摘录",
    observed_count: 0,
    statistics_window: {
      from: "2026-10-01T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
    },
    channel_scope: "公开B类测试样本",
  }).replace(/"/g, '""');
  return ok(
    await app.call(
      "keyword_raw.import",
      req(f.actors.strategist, {
        industry: "B2B",
        channel: "B",
        csv:
          "keyword,collected_at,raw_payload\n" +
          ["公开词根1多少钱 私有标记", "公开词根2价格", "公开词根2"]
            .map((word) => `${word},${date},"${payload}"\n`)
            .join(""),
      }),
    ),
  );
}

test("T10真实周批默认关闭，客户端伪造冻结记录不能启用且无产物写入", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
      "snapshot-input",
    );
    const before = ok(
      await app.call("keyword_pool_snapshot.read", req(f.actors.strategist)),
    );
    const denied = await app.call(
      "keyword_pool_snapshot.append",
      req(weekly(app, f), {
        industry: "B2B",
        seed_version: f.seed.seed_version,
        weekly_pipeline: true,
        weekly_policy: frozenReceipt(),
      }),
    );
    assert.equal(denied.status, 422);
    assert.equal(denied.error.details.reason, "weekly_rules_not_frozen");
    assert.deepEqual(
      ok(
        await app.call("keyword_pool_snapshot.read", req(f.actors.strategist)),
      ),
      before,
    );
  } finally {
    await env.close();
  }
});

test("T10 job指数退避最多3次，失败整批回滚并投递dead-letter和告警，业务拒绝不重试", async () => {
  const { runWeeklyPool } = await import(
    "../../src/server/jobs/weekly-pool.mjs"
  );
  const env = await startRuntimeEnvironment({
    loadWeeklyPolicy: async () => frozenReceipt(),
    loadIndustryPopulation: async ({ industry, window }) =>
      publicReceipt(industry, window),
    beforeAudit: (event) => {
      if (event.action === "weekly_pool_publication.append")
        throw new Error("fixture audit failure");
    },
  });
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
      "snapshot-input",
    );
    for (let i = 1; i <= 4; i++)
      ok(
        await app.call(
          "seed_list.create",
          req(f.actors.strategist, {
            industry: "B2B",
            word: "公开词根" + i,
            word_type: "问题",
            maintainer: "张三（虚构）",
            last_reviewed_at: "2026-11-10T00:00:00Z",
          }),
        ),
      );
    const delays = [],
      letters = [],
      alerts = [];
    const common = {
      application: app,
      actor: weekly(app, f),
      industry: "B2B",
      wait: async (ms) => {
        delays.push(ms);
      },
      onDeadLetter: async (row) => {
        letters.push(row);
      },
      onAlert: async (row) => {
        alerts.push(row);
      },
    };
    const result = await runWeeklyPool(common);
    assert.equal(result.attempts, 4);
    assert.equal(result.dead_lettered, true);
    assert.deepEqual(delays, [1000, 2000, 4000]);
    assert.equal(letters.length, 1);
    assert.deepEqual(alerts, letters);
    const runs = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.strategist, {}, undefined, { view: "weekly_runs" }),
      ),
    );
    assert.equal(runs.items.length, 0);
    const rejected = await runWeeklyPool({
      ...common,
      actor: f.actors.strategist,
    });
    assert.equal(rejected.response.status, 403);
    assert.equal(rejected.attempts, 1);
    assert.equal(letters.length, 1);
  } finally {
    await env.close();
  }
});

test("T10周批原子产出与重放：冻结锚不动、稳定ID、共享数值与私有候选隔离、审计故障整批回滚", async () => {
  let failAudit = false;
  let authorization;
  const env = await startRuntimeEnvironment({
    loadWeeklyPolicy: async () => frozenReceipt(),
    loadIndustryPopulation: async ({ industry, window }) =>
      publicReceipt(industry, window),
    resolveImportAuthorization: async () => authorization,
    beforeAudit: (event) => {
      if (failAudit && event.action === "intent_cluster.transition")
        throw new Error("fixture audit unavailable");
    },
  });
  try {
    const app = env.application;
    const registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("snapshot-input");
    for (let i = 1; i <= 4; i++)
      ok(
        await app.call(
          "seed_list.create",
          req(f.actors.strategist, {
            industry: "B2B",
            word: "公开词根" + i,
            word_type: "问题",
            maintainer: "张三（虚构）",
            last_reviewed_at: "2026-11-10T00:00:00Z",
          }),
        ),
      );
    const imported = await importWeek(app, f, "2026-11-04T00:00:00Z");
    authorization = {
      tenant_id: f.tenant_id,
      ref: "weekly-c-auth",
      document_ref: "fixture-written-authorization",
      active: true,
      redaction_policy: {
        version: "weekly-contacts-v1",
        verified: true,
        dictionary_complete: true,
        reviewed_by: "fixture-reviewer",
        reviewed_at: "2026-01-01T00:00:00Z",
        names: ["王五"],
        addresses: [],
      },
    };
    const cImport = ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "C",
          authorization_ref: "weekly-c-auth",
          csv: "keyword,collected_at\n公开词根1价格 王五13800138000,2026-11-04T00:00:00Z\n",
        }),
      ),
    );
    const run = () =>
      app.call(
        "keyword_pool_snapshot.append",
        req(weekly(app, f), { industry: "B2B", weekly_pipeline: true }),
      );
    failAudit = true;
    assert.equal((await run()).status, 500);
    failAudit = false;
    assert.equal(
      ok(
        await app.call(
          "keyword_pool_snapshot.read",
          req(f.actors.strategist, {}, undefined, { view: "weekly_runs" }),
        ),
      ).items.length,
      0,
    );
    const first = ok(await run());
    assert.equal(first.created_count, 2);
    assert.equal(first.updated_count, 0);
    assert.equal(first.pending_count, 1);
    assert.equal(first.window_start, "2026-11-02T00:00:00.000Z");
    const replay = ok(await run());
    assert.equal(replay.pool_version, first.pool_version);
    assert.equal(replay.replayed, true);
    const cAudit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, {
          object_id: cImport.record_results[0].id,
        }),
      ),
    );
    assert.ok(
      cAudit.items.some(
        (row) =>
          row.action === "keyword_raw.weekly_read" &&
          row.actor_type === "system" &&
          row.job_name === "weekly_pool",
      ),
    );
    const rootAudit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, { object_id: first.id }),
      ),
    );
    const parent = rootAudit.items.find(
      (row) => row.action === "keyword_pool_snapshot.append",
    );
    const childAudit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, { object_id: first.clusters[0].id }),
      ),
    );
    assert.ok(
      childAudit.items.some(
        (row) =>
          row.action === "intent_cluster.transition" &&
          row.cause_event_id === parent.id &&
          row.job_name === "weekly_pool" &&
          row.batch_id === null,
      ),
    );
    const initial = await Promise.all(
      first.clusters.map(async (row) =>
        ok(
          await app.call(
            "intent_cluster.read",
            req(f.actors.strategist, {}, row.id),
          ),
        ),
      ),
    );
    const clusterId = initial.find((row) =>
      row.name.startsWith("公开词根1"),
    ).id;
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, {
          user_id: f.actors.content.user_id,
          role: "content",
          assignments: [
            { object_type: "intent_cluster", object_id: clusterId },
          ],
        }),
      ),
    );
    const scopedCandidates = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.content, {}, undefined, {
          view: "weekly_candidates",
          cluster_id: clusterId,
        }),
      ),
    );
    assert.equal(scopedCandidates.items.length, 0);
    const scopedRuns = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.content, {}, undefined, {
          view: "weekly_runs",
          cluster_id: clusterId,
        }),
      ),
    );
    assert.equal(scopedRuns.items.length, 1);
    ok(
      await app.call(
        "user_member.configure",
        req(f.actors.admin, {
          user_id: f.actors.evidence.user_id,
          role: "evidence",
          assignments: [
            { object_type: "intent_cluster", object_id: clusterId },
            {
              object_type: "keyword_raw",
              object_id: imported.record_results[2].id,
            },
          ],
        }),
      ),
    );
    const assignedCandidate = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.evidence, {}, undefined, {
          view: "weekly_candidates",
          cluster_id: clusterId,
        }),
      ),
    );
    assert.equal(assignedCandidate.items.length, 1);
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        ok(
          await app.call(
            "question_pool.create",
            req(f.actors.strategist, {
              cluster_id: clusterId,
              question: "虚构问句" + i,
              source_word_id: imported.record_results[0].id,
              intent_type: "价格",
              source_channel: "B",
              collected_at: "2026-11-04T00:00:00Z",
              maintainer: "张三（虚构）",
              question_pool_version: 1,
            }),
          ),
        ).id,
      );
    ok(
      await app.call(
        "question_pool.freeze",
        req(f.actors.strategist, {
          cluster_id: clusterId,
          question_pool_version: 1,
        }),
      ),
    );
    ok(
      await app.call(
        "question_pool.upgrade_anchor",
        req(f.actors.strategist, {
          cluster_id: clusterId,
          question_pool_version: 1,
          question_ids: ids,
          reason: "测试首次人工入测",
        }),
      ),
    );
    const config = ok(
      await app.call(
        "scoring_snapshot.create",
        req(f.actors.cs, {
          ...f.config,
          pool_version: first.pool_version,
          grounding_mode: "search_off",
          temperature_set: [0],
        }),
      ),
    );
    ok(
      await app.call(
        "scoring_snapshot.freeze",
        req(f.actors.cs, {}, config.snapshot_id),
      ),
    );
    const batch = ok(
      await app.call(
        "probe_batch.create",
        req(f.actors.cs, {
          type: "baseline",
          snapshot_id: config.snapshot_id,
          scheduled_at: new Date(env.clock.now()).toISOString(),
          cluster_question_sets: [
            {
              cluster_id: clusterId,
              question_pool_version: 1,
              question_ids: ids,
            },
          ],
        }),
      ),
    );
    const probeActor = app.issueActor({
      user_id: "job-probe_execute",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "probe_execute",
      batch_id: batch.id,
      trigger_source: { event_id: "fixture-recorded-transport" },
    });
    ok(await app.call("probe_batch.start", req(probeActor, {}, batch.id)));
    for (const question of ids)
      for (const model of f.config.model_set)
        for (let round = 1; round <= 3; round++)
          ok(
            await app.call(
              "probe_batch.execute",
              req(
                probeActor,
                {
                  probe: {
                    batch_id: batch.id,
                    cluster_id: clusterId,
                    question_id: question,
                    model,
                    temperature: 0,
                    round,
                    attempt_no: 1,
                  },
                  result: {
                    raw_answer: "虚构拒答回执，未调用外部模型",
                    refused: true,
                    cited_urls: [],
                    cited_domains: [],
                  },
                },
                batch.id,
              ),
            ),
          );
    ok(await app.call("probe_batch.complete", req(probeActor, {}, batch.id)));
    const archive = ok(
      await app.call(
        "intent_cluster.archive",
        req(
          f.actors.strategist,
          {
            prepare_evidence: true,
            reason: "测试T10行业分位映射",
            statistics_window: {
              from: "2026-10-01T00:00:00Z",
              to: "2026-11-01T00:00:00Z",
            },
            channel_scope: "公开B类测试样本",
          },
          clusterId,
        ),
      ),
    );
    assert.equal(archive.archive_evidence.condition1_status, "evaluated");
    assert.equal(archive.archive_evidence.condition1_met, true);
    assert.equal(archive.can_archive, true);
    assert.equal(archive.status, "active");
    const publicRead = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.strategist, {}, undefined, {
          view: "demand",
          industry: "B2B",
          pool_version: first.pool_version,
        }),
      ),
    );
    assert.equal(publicRead.items.length, 4);
    assert.ok(!JSON.stringify(publicRead).includes("私有标记"));
    assert.ok(!JSON.stringify(publicRead).includes("王五"));
    assert.ok(!JSON.stringify(publicRead).includes("13800138000"));
    ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "B",
          keyword: "公开词根1补录价格",
          collected_at: "2026-11-05T00:00:00Z",
        }),
      ),
    );
    assert.equal((await run()).status, 409);
    const other = await registry.fixture("snapshot-input");
    const privateRead = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(other.actors.strategist, {}, undefined, {
          view: "weekly_candidates",
        }),
      ),
    );
    assert.equal(privateRead.items.length, 0);
    const otherRun = ok(
      await app.call(
        "keyword_pool_snapshot.append",
        req(weekly(app, other), { industry: "B2B", weekly_pipeline: true }),
      ),
    );
    assert.equal(otherRun.pool_version, first.pool_version);
    assert.equal(otherRun.created_count, 0);
    env.clock.advanceDays(7);
    f.actors.strategist = app.issueActor({
      user_id: f.actors.strategist.user_id,
      tenant_id: f.tenant_id,
      role: "strategist",
      actor_type: "human",
      brand_id: f.brand_id,
    });
    await importWeek(app, f, "2026-11-11T00:00:00Z");
    const renewedAdmin = app.issueActor({
      user_id: f.actors.admin.user_id,
      tenant_id: f.tenant_id,
      role: "admin",
      actor_type: "human",
    });
    ok(
      await app.call(
        "brand.configure",
        req(renewedAdmin, {
          id: "second-brand-" + f.tenant_id,
          name: "第二个虚构品牌",
          industry: "B2B",
          market: "CN",
        }),
      ),
    );
    ok(
      await app.call(
        "keyword_raw.import",
        req(f.actors.strategist, {
          industry: "B2B",
          channel: "C",
          authorization_ref: "weekly-c-auth",
          csv: "keyword,collected_at\n公开词根1价格 王五13800138000,2026-11-11T00:00:00Z\n",
        }),
      ),
    );
    const next = ok(await run());
    assert.equal(next.created_count, 2);
    assert.equal(next.updated_count, 2);
    // Each brand also sees the base fixture's unlabelled word collected in this week.
    assert.equal(next.pending_count, 5);
    const pending = ok(
      await app.call(
        "keyword_pool_snapshot.read",
        req(f.actors.strategist, {}, undefined, { view: "weekly_candidates" }),
      ),
    );
    assert.ok(
      pending.items.some(
        (row) => row.reason === "c_brand_unassigned" && row.brand_id === null,
      ),
    );
    assert.ok(next.clusters.some((c) => c.id === clusterId));
    const cluster = ok(
      await app.call(
        "intent_cluster.read",
        req(f.actors.strategist, {}, clusterId),
      ),
    );
    assert.equal(cluster.question_pool_version, 1);
    assert.equal(cluster.pool_version, next.pool_version);
    assert.ok(cluster.demand.demand_tier);
    assert.equal(cluster.demand.channel_counts.C, 0);
    const forbidden = await app.call(
      "intent_cluster.transition",
      req(
        weekly(app, f),
        {
          pool_version: next.pool_version,
          status: "archived",
          question_pool_version: 99,
        },
        clusterId,
      ),
    );
    assert.equal(forbidden.status, 422);
  } finally {
    await env.close();
  }
});
