import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { prepareScheduleFixture } from "../support/probe-schedule-fixture.mjs";
import { runProbeSchedule } from "../../src/server/jobs/probe-scheduler.mjs";
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

test("T13排期等待期间簇归档超过90天，启动时不得继续采样", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("archive-transition");
    const pending = ok(
      await app.call(
        "probe_batch.create",
        req(f.actors.cs, {
          type: "event",
          snapshot_id: f.snapshot.snapshot_id,
          baseline_batch_id: f.batch.id,
          scheduled_at: new Date(
            env.clock.now() + 91 * 86400_000,
          ).toISOString(),
          cluster_question_sets: f.batch.cluster_question_sets,
        }),
      ),
    );
    const proof = ok(
      await app.call(
        "intent_cluster.archive",
        req(f.actors.strategist, f.archiveRequest, { id: f.clusterId }),
      ),
    );
    ok(
      await app.call(
        "intent_cluster.archive",
        req(
          f.actors.strategist,
          {
            reason: "策略核验后归档",
            archive_evidence_id: proof.archive_evidence.id,
            manual_confirmation: true,
          },
          { id: f.clusterId },
        ),
      ),
    );
    env.clock.advanceDays(91);
    const job = app.issueActor({
      user_id: "job-probe_execute",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "probe_execute",
      batch_id: pending.id,
      trigger_source: { event_id: "archive-window-ended" },
    });
    const start = await app.call(
      "probe_batch.start",
      req(job, {}, { id: pending.id }),
    );
    assert.equal(start.status, 422);
    assert.equal(start.error.code, "validation_failed");
  } finally {
    await env.close();
  }
});

test("T13队列投影为空时仍走真实鉴权，公开HTTP不暴露队列集合", async () => {
  const { createProbeTransport } = await import(
    "../../src/server/api/probe-http.mjs"
  );
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "frozen-question",
      );
    const empty = ok(
      await app.call(
        "probe_batch.read",
        req(f.actors.cs, {}, {}, { view: "scheduled" }),
      ),
    );
    assert.deepEqual(empty.items, []);
    const config = ok(
      await app.call("scoring_snapshot.create", req(f.actors.cs, f.config)),
    );
    ok(
      await app.call(
        "scoring_snapshot.freeze",
        req(f.actors.cs, {}, { id: config.snapshot_id }),
      ),
    );
    const legacy = ok(
      await app.call(
        "probe_batch.create",
        req(f.actors.cs, {
          type: "baseline",
          snapshot_id: config.snapshot_id,
          scheduled_at: new Date(env.clock.now()).toISOString(),
          cluster_question_sets: [
            {
              cluster_id: f.cluster.id,
              question_pool_version: f.cluster.version,
              question_ids: f.cluster.questionIds,
            },
          ],
        }),
      ),
    );
    const due = ok(
      await app.call(
        "probe_batch.read",
        req(f.actors.cs, {}, {}, { view: "scheduled" }),
      ),
    );
    assert.deepEqual(
      due.items.map((row) => row.id),
      [legacy.id],
      "原有单批创建不能被调度队列遗漏",
    );
    let closed = 0;
    const serve = createProbeTransport(async () => ({
      application: app,
      close: async () => {
        closed++;
      },
    }));
    const request = (
      path,
      method = "GET",
      body,
      actor = f.actors.cs,
      origin = "http://localhost",
    ) =>
      new Request("http://localhost" + path, {
        method,
        headers: {
          host: "localhost",
          origin,
          cookie: "geo_session=" + actor.credential,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const root = `/api/tenants/${f.tenant_id}/probe-batches`;
    assert.equal((await serve(request(root))).status, 404);
    assert.equal(
      (await serve(request("/api/tenants/%/probe-batches/x"))).status,
      422,
    );
    assert.equal(
      (await serve(request(root + "/x?view=scheduled"))).status,
      422,
    );
    assert.equal(
      (
        await serve(
          request(
            root,
            "POST",
            { type: "baseline" },
            f.actors.cs,
            "https://evil.example",
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await serve(
          request(root, "POST", { type: "baseline" }, f.actors.strategist),
        )
      ).status,
      403,
    );
    assert.equal(closed, 1);
    const job = app.issueActor({
      user_id: "job-event_schedule",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "event_schedule",
      trigger_source: { event_id: "invalid-plan" },
    });
    const rejected = await runProbeSchedule({
      application: app,
      actor: job,
      body: { schedule: { source_event_id: "invalid-plan" } },
      wait: async () => assert.fail("business errors must not retry"),
      onDeadLetter: async () => assert.fail(),
      onAlert: async () => assert.fail(),
    });
    assert.equal(rejected.response.status, 422);
    assert.equal(rejected.attempts, 1);
  } finally {
    await env.close();
  }
});

test("T13排期：UTC发布日跨月D+3/14/30；月度显式时点；拒绝漂移和非法日期", async () => {
  const { planProbeSchedule } = await import(
    "../../src/server/api/probe-scheduling.mjs"
  );
  const ids = Array.from({ length: 30 }, (_, i) => ({
    cluster_id: `c${i}`,
    question_pool_version: 1,
    question_ids: [`q${i}a`, `q${i}b`, `q${i}c`],
  }));
  const body = {
    type: "event",
    snapshot_id: "snapshot",
    baseline_batch_id: "baseline",
    scheduled_at: "2026-02-03T12:00:00Z",
    cluster_question_sets: ids.slice(0, 6),
    schedule: {
      source_event_id: "publication-1",
      published_at: "2026-01-31T12:00:00Z",
      target_cluster_ids: ["c0", "c1", "c2"],
      control_cluster_ids: ["c3", "c4", "c5"],
    },
  };
  assert.deepEqual(
    planProbeSchedule(body).occurrences.map((x) => x.at),
    [
      "2026-02-03T12:00:00.000Z",
      "2026-02-14T12:00:00.000Z",
      "2026-03-02T12:00:00.000Z",
    ],
  );
  assert.throws(() =>
    planProbeSchedule({ ...body, scheduled_at: "2026-02-04T12:00:00Z" }),
  );
  assert.throws(() =>
    planProbeSchedule({
      ...body,
      schedule: { ...body.schedule, published_at: "2026-02-31T12:00:00Z" },
    }),
  );
  const monthly = {
    ...body,
    type: "monthly",
    cluster_question_sets: ids,
    scheduled_at: "2026-02-28T10:00:00Z",
    schedule: { source_event_id: "monthly-2026-02", month: "2026-02" },
  };
  assert.equal(
    planProbeSchedule(monthly).occurrences[0].at,
    "2026-02-28T10:00:00.000Z",
  );
  assert.throws(() =>
    planProbeSchedule({
      ...monthly,
      schedule: { ...monthly.schedule, month: "2026-03" },
    }),
  );
});

test(
  "T13真实服务：三套排期、持久去重、到期加急、显式取消、权限与事务审计",
  { timeout: 300000 },
  async (t) => {
    let failAudit = false;
    const env = await startRuntimeEnvironment({
      beforeAudit: (e) => {
        if (failAudit && e.action === "probe_batch.create")
          throw new Error("T13 audit failure");
      },
    });
    try {
      const app = env.application;
      const { f, registry, sets, snapshot } = await prepareScheduleFixture(
        app,
        env.clock,
      );
      const advance = (days) => {
        env.clock.advanceDays(days);
        // Time advances across 24h Web credential expiry; the trusted fixture
        // provider re-issues credentials, never bypassing current membership.
        for (const [role, actor] of Object.entries(f.actors)) {
          const { credential, ...claims } = actor;
          f.actors[role] = app.issueActor(claims);
        }
      };
      const job = (name, eventId, batchId) =>
        app.issueActor({
          user_id: `job-${name}`,
          tenant_id: f.tenant_id,
          role: "system",
          actor_type: "system",
          job_name: name,
          trigger_source: { event_id: eventId },
          ...(batchId ? { batch_id: batchId } : {}),
        });
      const baselineBody = {
        type: "baseline",
        snapshot_id: snapshot.snapshot_id,
        scheduled_at: new Date(env.clock.now()).toISOString(),
        cluster_question_sets: sets,
        schedule: { source_event_id: "t13-baseline" },
      };
      let baseline;
      await t.test(
        "基线30簇，角色拒绝、审计失败回滚；重复重放不复制任务",
        async () => {
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(f.actors.strategist, baselineBody),
              )
            ).status,
            403,
          );
          failAudit = true;
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, baselineBody),
              )
            ).status,
            500,
          );
          failAudit = false;
          baseline = ok(
            await app.call(
              "probe_batch.create",
              req(f.actors.cs, baselineBody),
            ),
          );
          assert.equal(baseline.items.length, 1);
          assert.equal(baseline.cluster_question_sets.length, 30);
          assert.equal(
            ok(
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, baselineBody),
              ),
            ).id,
            baseline.id,
          );
          const { createProbeTransport } = await import(
            "../../src/server/api/probe-http.mjs"
          );
          const serve = createProbeTransport(async () => ({
            application: app,
            close: async () => {},
          }));
          const response = await serve(
            new Request(
              `http://localhost/api/tenants/${f.tenant_id}/probe-batches`,
              {
                method: "POST",
                headers: {
                  host: "localhost",
                  origin: "http://localhost",
                  cookie: "geo_session=" + f.actors.cs.credential,
                  "content-type": "application/json",
                  "idempotency-key": "t13-web-create",
                },
                body: JSON.stringify(baselineBody),
              },
            ),
          );
          assert.equal(response.status, 200);
          assert.equal((await response.json()).data.id, baseline.id);
          const read = await serve(
            new Request(
              `http://localhost/api/tenants/${f.tenant_id}/probe-batches/${baseline.id}`,
              { headers: { cookie: "geo_session=" + f.actors.cs.credential } },
            ),
          );
          assert.equal(read.status, 200);
          assert.ok(!(await read.text()).includes("raw_answer"));
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, {
                  ...baselineBody,
                  scheduled_at: "2026-11-11T12:00:00Z",
                }),
              )
            ).status,
            409,
          );
          const log = ok(
            await app.call(
              "audit_log.read",
              req(f.actors.admin, {}, {}, { object_id: baseline.id }),
            ),
          );
          assert.ok(
            log.items.some(
              (e) =>
                e.action === "probe_batch.create" &&
                e.actor_type === "human" &&
                e.batch_id === baseline.id,
            ),
          );
        },
      );
      // Complete a real service batch using 2160 explicit synthetic refusals:
      // no model calls and no direct state/database writes in the fixture.
      const probeActor = job(
        "probe_execute",
        "t13-baseline-execution",
        baseline.id,
      );
      ok(
        await app.call(
          "probe_batch.start",
          req(probeActor, {}, { id: baseline.id }),
        ),
      );
      for (const set of sets)
        for (const q of set.question_ids)
          for (const model of f.config.model_set)
            for (const temperature of f.config.temperature_set)
              for (let round = 1; round <= 3; round++) {
                ok(
                  await app.call(
                    "probe_batch.execute",
                    req(
                      probeActor,
                      {
                        probe: {
                          batch_id: baseline.id,
                          cluster_id: set.cluster_id,
                          question_id: q,
                          model,
                          temperature,
                          round,
                          attempt_no: 1,
                        },
                        result: {
                          raw_answer: "隔离测试拒答样本，不是真实模型输出",
                          refused: true,
                          cited_domains: [],
                          cited_urls: [],
                        },
                      },
                      { id: baseline.id },
                    ),
                  ),
                );
              }
      ok(
        await app.call(
          "probe_batch.complete",
          req(probeActor, {}, { id: baseline.id }),
        ),
      );
      const targets = sets.slice(0, 3).map((s) => s.cluster_id),
        controls = sets.slice(3, 6).map((s) => s.cluster_id);
      const publication = (id, expedited = false) => {
        const published_at = new Date(env.clock.now()).toISOString();
        return {
          type: "event",
          snapshot_id: snapshot.snapshot_id,
          baseline_batch_id: baseline.id,
          cluster_question_sets: sets.slice(0, 6),
          scheduled_at: new Date(env.clock.now() + 3 * 86400_000).toISOString(),
          schedule: {
            source_event_id: id,
            published_at,
            target_cluster_ids: targets,
            control_cluster_ids: controls,
            expedited,
          },
        };
      };
      const readDue = (query = {}, actor = f.actors.cs) =>
        app.call(
          "probe_batch.read",
          req(actor, {}, {}, { view: "scheduled", ...query }),
        );
      let first, second, firstBody, monthly;
      await t.test(
        "发布一次原子排三时点，快照/问句清单锁定，3+3逐项审计",
        async () => {
          firstBody = publication("publication-1");
          first = ok(
            await app.call(
              "probe_batch.create",
              req(job("event_schedule", "publication-1"), firstBody),
            ),
          );
          assert.deepEqual(
            first.items.map((b) => b.schedule_meta.offset_days),
            [3, 14, 30],
          );
          for (const b of first.items) {
            assert.equal(b.snapshot_id, snapshot.snapshot_id);
            assert.equal(b.cluster_question_sets.length, 6);
            const logs = ok(
              await app.call(
                "audit_log.read",
                req(f.actors.admin, {}, {}, { object_id: b.id }),
              ),
            );
            assert.ok(
              logs.items.some(
                (e) =>
                  e.job_name === "event_schedule" &&
                  e.actor_type === "system" &&
                  e.batch_id === b.id &&
                  e.cause_event_id === "publication-1",
              ),
            );
          }
          const early = first.items[0];
          assert.equal(
            (
              await app.call(
                "probe_batch.start",
                req(
                  job("probe_execute", "early", early.id),
                  {},
                  { id: early.id },
                ),
              )
            ).status,
            409,
          );
          assert.deepEqual(ok(await readDue()).items, []);
        },
      );
      await t.test(
        "重登记另排，旧pending保留；加急不提前，已到期队列优先且游标无遗漏",
        async () => {
          advance(1);
          second = ok(
            await app.call(
              "probe_batch.create",
              req(f.actors.cs, publication("publication-2", true)),
            ),
          );
          for (const b of first.items)
            assert.equal(
              ok(
                await app.call(
                  "probe_batch.read",
                  req(f.actors.cs, {}, { id: b.id }),
                ),
              ).status,
              "pending",
            );
          advance(4);
          const due = ok(await readDue({ limit: 1 }));
          assert.equal(due.items[0].id, second.items[0].id);
          const next = ok(await readDue({ limit: 1, cursor: due.next_cursor }));
          assert.equal(next.items[0].id, first.items[0].id);
          assert.equal(next.next_cursor, null);
          assert.equal((await readDue({}, f.actors.content)).status, 403);
          assert.equal(
            (await readDue({}, job("event_schedule", "cannot-read"))).status,
            403,
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.cancel",
                req(
                  job("event_schedule", "cannot-cancel"),
                  { reason: "自动取消不可用" },
                  { id: first.items[0].id },
                ),
              )
            ).status,
            403,
          );
          ok(
            await app.call(
              "probe_batch.cancel",
              req(
                f.actors.cs,
                { reason: "CS显式撤销旧登记D+3" },
                { id: first.items[0].id },
              ),
            ),
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.cancel",
                req(
                  f.actors.cs,
                  { reason: "终态不能再取消" },
                  { id: first.items[0].id },
                ),
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.start",
                req(
                  job("probe_execute", "cancelled", first.items[0].id),
                  {},
                  { id: first.items[0].id },
                ),
              )
            ).status,
            409,
          );
          assert.equal(
            ok(
              await app.call("probe_batch.create", req(f.actors.cs, firstBody)),
            ).items[0].status,
            "cancelled",
          );
        },
      );
      await t.test(
        "月度30簇同基线；跨锚定/跨快照拒绝；24h后仍持久去重",
        async () => {
          const body = {
            ...baselineBody,
            type: "monthly",
            baseline_batch_id: baseline.id,
            scheduled_at: "2026-11-30T10:00:00Z",
            schedule: { source_event_id: "month-2026-11", month: "2026-11" },
          };
          monthly = ok(
            await app.call("probe_batch.create", req(f.actors.cs, body)),
          );
          advance(2);
          assert.equal(
            ok(await app.call("probe_batch.create", req(f.actors.cs, body))).id,
            monthly.id,
          );
          assert.equal(
            ok(
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, {
                  ...body,
                  schedule: {
                    ...body.schedule,
                    source_event_id: "another-cron-delivery-same-month",
                  },
                }),
              ),
            ).id,
            monthly.id,
          );
          assert.equal(
            ok(
              await app.call("probe_batch.create", req(f.actors.cs, firstBody)),
            ).id,
            first.id,
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, {
                  ...body,
                  cluster_question_sets: sets.slice(0, 29),
                }),
              )
            ).status,
            422,
          );
          const altered = structuredClone(firstBody);
          altered.schedule.source_event_id = "different-anchors";
          altered.cluster_question_sets[0].question_pool_version = 2;
          const conflict = await app.call(
            "probe_batch.create",
            req(f.actors.cs, altered),
          );
          assert.equal(conflict.status, 422);
          assert.equal(conflict.error.code, "incomparable");
          const changedConfig = ok(
            await app.call(
              "scoring_snapshot.create",
              req(f.actors.cs, f.config),
            ),
          );
          ok(
            await app.call(
              "scoring_snapshot.freeze",
              req(f.actors.cs, {}, { id: changedConfig.snapshot_id }),
            ),
          );
          const mismatch = await app.call(
            "probe_batch.create",
            req(f.actors.cs, {
              ...firstBody,
              snapshot_id: changedConfig.snapshot_id,
              schedule: {
                ...firstBody.schedule,
                source_event_id: "different-snapshot",
              },
            }),
          );
          assert.equal(mismatch.status, 422);
          assert.equal(mismatch.error.code, "incomparable");
          const other = await registry.fixture("snapshot-input");
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(other.actors.cs, firstBody),
              )
            ).status,
            403,
          );
          assert.equal(ok(await readDue({}, other.actors.cs)).items.length, 0);
        },
      );
      await t.test(
        "排期job整单退避3次、审计失败整单回滚、dead-letter/告警不含原文",
        async () => {
          const body = publication("rollback-publication");
          const before = ok(await readDue({ due_only: "false", limit: 100 }))
            .items.length;
          const waits = [],
            letters = [],
            alerts = [];
          failAudit = true;
          const result = await runProbeSchedule({
            application: app,
            actor: job("event_schedule", "rollback-publication"),
            body,
            wait: async (ms) => waits.push(ms),
            onDeadLetter: async (item) => letters.push(item),
            onAlert: async (item) => alerts.push(item),
          });
          failAudit = false;
          assert.equal(result.attempts, 4);
          assert.equal(result.dead_lettered, true);
          assert.deepEqual(waits, [1000, 2000, 4000]);
          assert.equal(letters.length, 1);
          assert.equal(alerts.length, 1);
          assert.ok(!JSON.stringify(letters).includes("raw_answer"));
          assert.equal(
            ok(await readDue({ due_only: "false", limit: 100 })).items.length,
            before,
          );
          const success = await runProbeSchedule({
            application: app,
            actor: job("event_schedule", "rollback-publication"),
            body,
            onDeadLetter: async () => assert.fail(),
            onAlert: async () => assert.fail(),
          });
          assert.equal(success.response.status, 200);
          assert.equal(success.response.data.items.length, 3);
        },
      );
      await t.test(
        "对照簇一旦发生内容动作，拒绝新排期并在启动前再次拦截",
        async () => {
          const card = ok(
            await app.call(
              "opportunity_card.create",
              req(f.actors.strategist, {
                cluster_id: controls[0],
                pool_version: f.poolVersion,
                snapshot_id: snapshot.snapshot_id,
                demand_tier: "S",
                demand_source: "B",
              }),
            ),
          );
          ok(
            await app.call(
              "user_member.configure",
              req(f.actors.admin, {
                user_id: f.actors.content.user_id,
                role: "content",
                assignments: [
                  { object_type: "opportunity_card", object_id: card.id },
                ],
              }),
            ),
          );
          ok(
            await app.call(
              "content_asset.create",
              req(f.actors.content, {
                opportunity_card_id: card.id,
                type: "定义页",
              }),
            ),
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.create",
                req(f.actors.cs, publication("contaminated-controls")),
              )
            ).status,
            422,
          );
          assert.equal(
            (
              await app.call(
                "probe_batch.start",
                req(
                  job("probe_execute", "contaminated", second.items[0].id),
                  {},
                  { id: second.items[0].id },
                ),
              )
            ).status,
            422,
          );
        },
      );
      await t.test(
        "创建和启动均重验判定基准，失败不迁移状态也不扣探针配额",
        async () => {
          advance(14);
          ok(
            await app.call(
              "official_fact.retract",
              req(
                f.actors.factcheck,
                { reason: "T13基准撤回验证" },
                { id: f.official_fact_id },
              ),
            ),
          );
          const start = await app.call(
            "probe_batch.start",
            req(
              job("probe_execute", "missing-basis", monthly.id),
              {},
              { id: monthly.id },
            ),
          );
          assert.equal(start.status, 422);
          assert.equal(start.error.code, "judgment_basis_missing");
          assert.equal(
            ok(
              await app.call(
                "probe_batch.read",
                req(f.actors.cs, {}, { id: monthly.id }),
              ),
            ).status,
            "pending",
          );
          const fresh = ok(
            await app.call(
              "scoring_snapshot.create",
              req(f.actors.cs, f.config),
            ),
          );
          ok(
            await app.call(
              "scoring_snapshot.freeze",
              req(f.actors.cs, {}, { id: fresh.snapshot_id }),
            ),
          );
          const create = await app.call(
            "probe_batch.create",
            req(f.actors.cs, {
              ...baselineBody,
              snapshot_id: fresh.snapshot_id,
              schedule: { source_event_id: "missing-basis" },
            }),
          );
          assert.equal(create.status, 422);
          assert.equal(create.error.code, "judgment_basis_missing");
          assert.equal(
            ok(await app.call("tenant.read", req(f.actors.admin))).quota_usage
              .probe,
            2160,
          );
        },
      );
    } finally {
      await env.close();
    }
  },
);
