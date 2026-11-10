import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { policyTriples } from "../../src/server/api/application.mjs";
const request = (actor, body = {}, id, query = {}) => ({
  actor,
  body,
  params: id ? { id } : {},
  query,
});
const expectOk = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.error));
  return response.data;
};

test("T05按来源/机会卡分派可读关联测量，SQL分页不扩大任务范围", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
      "judged-baseline",
    );
    const card = expectOk(
      await app.call(
        "opportunity_card.create",
        request(f.actors.strategist, {
          cluster_id: f.cluster.id,
          pool_version: f.poolVersion,
          snapshot_id: f.snapshot.snapshot_id,
          demand_tier: "S",
          demand_source: "keyword:" + f.sourceId,
        }),
      ),
    );
    for (const [object_type, object_id] of [
      ["keyword_raw", f.sourceId],
      ["opportunity_card", card.id],
    ]) {
      const user_id = f.tenant_id + "-" + object_type;
      expectOk(
        await app.call(
          "user_member.configure",
          request(f.actors.admin, {
            user_id,
            role: "evidence",
            assignments: [{ object_type, object_id }],
          }),
        ),
      );
      const actor = {
        ...app.issueActor({
          user_id,
          tenant_id: f.tenant_id,
          role: "evidence",
          actor_type: "human",
        }),
        brand_id: f.brand_id,
      };
      const first = expectOk(
        await app.call(
          "probe_batch.read",
          request(actor, {}, f.batch.id, { limit: 1 }),
        ),
      );
      assert.equal(first.probes.length, 1);
      assert.ok(first.next_cursor);
      assert.ok(
        first.probes.every((p) => p.intent_cluster_id === f.cluster.id),
      );
      const next = expectOk(
        await app.call(
          "probe_batch.read",
          request(actor, {}, f.batch.id, {
            limit: 1,
            cursor: first.next_cursor,
          }),
        ),
      );
      assert.equal(next.probes.length, 1);
      assert.notEqual(first.probes[0].id, next.probes[0].id);
      assert.equal(JSON.stringify(first).includes("raw_answer"), false);
      expectOk(
        await app.call(
          "probe_result.read_raw",
          request(actor, {}, f.batch.records[0].id),
        ),
      );
      expectOk(
        await app.call(
          "question_pool.read",
          request(actor, {}, f.cluster.questions[0].id),
        ),
      );
      assert.equal(
        (
          await app.call(
            "probe_batch.read",
            request(actor, {}, f.batch.id, { limit: 101 }),
          )
        ).status,
        422,
      );
    }
  } finally {
    await env.close();
  }
});

test("T05服务策略与245行allow一致，六层顺序由真实调用证明", async () => {
  const rows = readFileSync("docs/api/permissions.csv", "utf8")
    .trim()
    .split("\n")
    .slice(2)
    .map((line) => line.split(",").slice(0, 3).join(","));
  assert.deepEqual([...policyTriples()].sort(), rows.sort());
  assert.ok(Object.isFrozen(policyTriples()));
  const trace = [];
  const env = await startRuntimeEnvironment({
    observe: (phase) => trace.push(phase),
  });
  try {
    const fixtures = createFixtureRegistry(env.application, {
      clock: env.clock,
    });
    const f = await fixtures.fixture("snapshot-input");
    trace.length = 0;
    expectOk(
      await env.application.call(
        "scoring_snapshot.create",
        request(f.actors.cs, f.config),
      ),
    );
    assert.deepEqual(trace.slice(0, 6), [
      "authentication",
      "tenant",
      "brand_or_assignment",
      "allow",
      "credential_and_human_mode",
      "business",
    ]);
    assert.ok(Object.isFrozen(env.application.evaluationOrder));
    assert.ok(trace.indexOf("committed") < trace.indexOf("delivered"));
  } finally {
    await env.close();
  }
});

test("T05有效凭证仍受角色、品牌、任务、合同档与人工身份约束", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("claim-input");
    assert.equal(
      (await app.call("claim_block.create", request(f.actors.viewer, f.claim)))
        .status,
      403,
    );
    const otherBrand = expectOk(
      await app.call(
        "brand.configure",
        request(f.actors.admin, {
          name: "另一虚构品牌",
          industry: "B2B",
          market: "CN",
        }),
      ),
    );
    assert.equal(
      (await app.call("brand.read", request(f.actors.owner, {}, otherBrand.id)))
        .status,
      403,
    );
    expectOk(
      await app.call(
        "brand.read",
        request(
          { ...f.actors.strategist, brand_id: otherBrand.id },
          {},
          otherBrand.id,
        ),
      ),
    );
    const weekly = app.issueActor({
      user_id: "job-weekly_pool",
      tenant_id: f.tenant_id,
      actor_type: "system",
      role: "system",
      job_name: "weekly_pool",
      trigger_source: { event_id: "unassigned-cluster-test" },
    });
    const unassigned = expectOk(
      await app.call(
        "intent_cluster.transition",
        request(weekly, {
          brand_id: f.brand_id,
          name: "未分派簇",
          intent_type: "认知",
          pool_version: f.poolVersion,
        }),
      ),
    );
    assert.equal(
      (
        await app.call(
          "intent_cluster.read",
          request(f.actors.content, {}, unassigned.id),
        )
      ).status,
      403,
    );
    expectOk(
      await app.call(
        "intent_cluster.read",
        request(f.actors.content, {}, f.cluster.id),
      ),
    );
    const ownClaim = expectOk(
      await app.call("claim_block.create", request(f.actors.content, f.claim)),
    );
    expectOk(
      await app.call(
        "claim_block.read",
        request(f.actors.content, {}, ownClaim.id),
      ),
    );
    const second = await registry.fixture("claim-input");
    assert.equal(
      (
        await app.call(
          "claim_block.read",
          request(second.actors.content, {}, ownClaim.id),
        )
      ).status,
      403,
    );
    const pending = await registry.fixture("pending-claim");
    const external = {
      ...app.issueActor({
        user_id: pending.actors.factcheck.user_id,
        tenant_id: pending.tenant_id,
        role: "factcheck",
        actor_type: "external_agent",
        agent_run_id: "external-review-attempt",
        prompt_version: "fixture-v1",
      }),
      brand_id: pending.brand_id,
    };
    assert.equal(
      (
        await app.call(
          "claim_block.approve",
          request(external, {}, pending.claimId),
        )
      ).status,
      403,
    );
    expectOk(
      await app.call(
        "claim_block.approve",
        request(pending.actors.factcheck, {}, pending.claimId),
      ),
    );
    expectOk(
      await app.call(
        "tenant.configure",
        request(f.actors.admin, {
          name: "简造 ERP（虚构测试租户）",
          mode: "diagnosis",
          plan: "internal-fixture",
        }),
      ),
    );
    assert.equal(
      (await app.call("claim_block.create", request(f.actors.editor, f.claim)))
        .status,
      403,
    );
    assert.equal(
      (
        await app.call(
          "opportunity_card.read",
          request(f.actors.owner, {}, f.card.id),
        )
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});

test("T05 PAT与Web同策略、限scope、实时撤销与按token限流", async () => {
  let rate;
  const env = await startRuntimeEnvironment({
    limits: () => (rate ? { perToken: rate } : {}),
  });
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("snapshot-input");
    const token = expectOk(
      await app.call(
        "api_token.create",
        request(f.actors.admin, {
          user_id: f.actors.strategist.user_id,
          scopes: ["brand.read"],
        }),
        { idempotencyKey: "once-pat" },
      ),
    );
    const replay = expectOk(
      await app.call(
        "api_token.create",
        request(f.actors.admin, {
          user_id: f.actors.strategist.user_id,
          scopes: ["brand.read"],
        }),
        { idempotencyKey: "once-pat" },
      ),
    );
    assert.equal(replay.token, token.token);
    const pat = { ...f.actors.strategist, credential: token.token };
    const web = expectOk(
      await app.call(
        "brand.read",
        request(f.actors.strategist, {}, f.brand_id),
      ),
    );
    const api = expectOk(
      await app.call("brand.read", request(pat, {}, f.brand_id)),
    );
    assert.deepEqual(api, web);
    assert.equal((await app.call("seed_list.read", request(pat))).status, 403);
    rate = { windowMs: 60_000, maxCalls: 1 };
    const limited = await app.call("brand.read", request(pat, {}, f.brand_id));
    assert.equal(limited.status, 429);
    assert.equal(limited.error.code, "quota_exceeded");
    rate = undefined;
    const visible = expectOk(
      await app.call("api_token.read", request(f.actors.admin)),
    );
    assert.equal(visible.items.length, 1);
    assert.ok(!JSON.stringify(visible).includes(token.token));
    assert.ok(!JSON.stringify(visible).includes("token_hash"));
    expectOk(
      await app.call(
        "api_token.revoke",
        request(f.actors.admin, { reason: "撤销测试" }, token.id),
      ),
    );
    assert.equal(
      (await app.call("brand.read", request(pat, {}, f.brand_id))).status,
      403,
    );
  } finally {
    await env.close();
  }
});

test("T05审计故障回滚写入，敏感读commit先于交付且不泄露失败数据", async () => {
  let faultAction;
  const trace = [];
  const env = await startRuntimeEnvironment({
    beforeAudit: (event) => {
      if (event.action === faultAction)
        throw new Error("injected audit store failure");
    },
    observe: (phase) => trace.push(phase),
  });
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("claim-input");
    const before = expectOk(
      await app.call(
        "content_asset.read",
        request(f.actors.content, {}, f.asset.id),
      ),
    );
    faultAction = "claim_block.create";
    const failed = await app.call(
      "claim_block.create",
      request(f.actors.content, f.claim),
    );
    assert.equal(failed.status, 500);
    faultAction = undefined;
    const after = expectOk(
      await app.call(
        "content_asset.read",
        request(f.actors.content, {}, f.asset.id),
      ),
    );
    assert.deepEqual(after, before);
    const raw = await registry.fixture("external-answer", {
      rawAnswer: "受限全文：只在读取审计成功后交付（虚构）",
    });
    const result = expectOk(
      await app.call(
        "probe_batch.execute",
        request(raw.actors.probeJob, raw.resultRequest, raw.batchId),
      ),
    );
    assert.equal(
      (
        await app.call(
          "probe_result.read_raw",
          request(raw.actors.admin, {}, result.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.call(
          "probe_result.access",
          request(raw.actors.admin, {}, result.id),
        )
      ).status,
      422,
    );
    trace.length = 0;
    const answer = expectOk(
      await app.call(
        "probe_result.read_raw",
        request(raw.actors.strategist, {}, result.id),
      ),
    );
    assert.ok(answer.raw_answer.includes("受限全文"));
    assert.ok(trace.indexOf("audit_written") < trace.indexOf("committed"));
    assert.ok(trace.indexOf("committed") < trace.indexOf("delivered"));
    const audits = expectOk(
      await app.call(
        "audit_log.read",
        request(raw.actors.admin, {}, undefined, {
          object_id: result.id,
          limit: 100,
        }),
      ),
    );
    const count = audits.items.length;
    faultAction = "probe_result.read_raw";
    trace.length = 0;
    const denied = await app.call(
      "probe_result.read_raw",
      request(raw.actors.strategist, {}, result.id),
    );
    assert.equal(denied.status, 500);
    assert.ok(!Object.hasOwn(denied, "data"));
    assert.ok(!JSON.stringify(denied).includes("受限全文"));
    assert.ok(!trace.includes("delivered"));
    faultAction = undefined;
    assert.equal(
      expectOk(
        await app.call(
          "audit_log.read",
          request(raw.actors.admin, {}, undefined, {
            object_id: result.id,
            limit: 100,
          }),
        ),
      ).items.length,
      count,
    );
  } finally {
    await env.close();
  }
});

test("T05幂等24h与分粒度计量：不重复草稿/业务审计、额度失败不留写入", async () => {
  let quota;
  const env = await startRuntimeEnvironment({
    limits: () => (quota ? { drafting: quota } : {}),
  });
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("claim-input");
    const input = request(f.actors.content, f.claim);
    const original = await app.call("claim_block.create", input, {
      idempotencyKey: "draft-once",
    });
    const first = expectOk(original);
    env.clock.advanceDays(1 / 24);
    const replayResponse = await app.call("claim_block.create", input, {
      idempotencyKey: "draft-once",
    });
    assert.deepEqual(replayResponse.meta, original.meta);
    assert.deepEqual(
      expectOk(
        await app.call("claim_block.create", input, {
          idempotencyKey: "draft-once",
        }),
      ),
      first,
    );
    const reordered = Object.fromEntries(Object.entries(f.claim).reverse());
    assert.deepEqual(
      expectOk(
        await app.call(
          "claim_block.create",
          request(f.actors.content, reordered),
          { idempotencyKey: "draft-once" },
        ),
      ),
      first,
    );
    assert.equal(
      (
        await app.call(
          "claim_block.create",
          request(f.actors.content, { ...f.claim, text: "载荷变更" }),
          { idempotencyKey: "draft-once" },
        )
      ).status,
      409,
    );
    const asset = expectOk(
      await app.call(
        "content_asset.read",
        request(f.actors.content, {}, f.asset.id),
      ),
    );
    assert.equal(asset.block_versions.length, 1);
    const audits = expectOk(
      await app.call(
        "audit_log.read",
        request(f.actors.admin, {}, undefined, {
          object_id: first.id,
          limit: 100,
        }),
      ),
    );
    assert.equal(
      audits.items.filter((row) => row.action === "claim_block.create").length,
      1,
    );
    const usage = expectOk(
      await app.call("tenant.read", request(f.actors.admin)),
    );
    assert.equal(usage.quota_usage.drafting, 1);
    quota = { windowMs: 86400_000, maxCalls: 1 };
    assert.deepEqual(
      expectOk(
        await app.call("claim_block.create", input, {
          idempotencyKey: "draft-once",
        }),
      ),
      first,
    );
    const limited = await app.call("claim_block.create", input);
    assert.equal(limited.status, 429);
    assert.equal(limited.error.code, "quota_exceeded");
    assert.equal(
      expectOk(
        await app.call(
          "content_asset.read",
          request(f.actors.content, {}, f.asset.id),
        ),
      ).block_versions.length,
      1,
    );
  } finally {
    await env.close();
  }
});

test("T05 R11：NULL阈值只举证，配置阈值只生成建议且保持active", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("archive-transition");
    const prepared = expectOk(
      await app.call(
        "intent_cluster.archive",
        request(f.actors.strategist, f.archiveRequest, f.clusterId),
      ),
    );
    assert.equal(prepared.archive_evidence.industry_threshold, null);
    assert.equal(prepared.archive_evidence.condition3_met, null);
    assert.equal(prepared.status, "active");
    assert.equal(
      (
        await app.call(
          "intent_cluster.archive",
          request(
            f.actors.strategist,
            {
              reason: "缺人工确认",
              archive_evidence_id: prepared.archive_evidence.id,
            },
            f.clusterId,
          ),
        )
      ).status,
      422,
    );
    expectOk(
      await app.call(
        "industry_score.revise",
        request(f.actors.strategist, {
          industry: "B2B",
          c_delete_threshold: 1,
        }),
      ),
    );
    const configured = expectOk(
      await app.call(
        "intent_cluster.archive",
        request(f.actors.strategist, f.archiveRequest, f.clusterId),
      ),
    );
    assert.equal(configured.archive_evidence.condition3_met, true);
    assert.equal(
      expectOk(
        await app.call(
          "intent_cluster.read",
          request(f.actors.strategist, {}, f.clusterId),
        ),
      ).status,
      "active",
    );
    const logs = expectOk(
      await app.call(
        "audit_log.read",
        request(f.actors.admin, {}, undefined, {
          object_type: "backflow_ticket",
          limit: 100,
        }),
      ),
    );
    const created = logs.items.find(
      (row) => row.action === "backflow_ticket.create",
    );
    assert.ok(created);
    assert.equal(created.actor_type, "system");
    assert.equal(created.job_name, "backflow_scan");
    assert.equal(
      expectOk(
        await app.call(
          "backflow_ticket.read",
          request(f.actors.strategist, {}, created.object_id),
        ),
      ).status,
      "open",
    );
  } finally {
    await env.close();
  }
});

test("T05 R11分位缺行或版本过期= data_pending；人工不得写行业分位", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const missing = await registry.fixture("archive-transition", {
      percentile: false,
    });
    const evidence = expectOk(
      await app.call(
        "intent_cluster.archive",
        request(
          missing.actors.strategist,
          missing.archiveRequest,
          missing.clusterId,
        ),
      ),
    );
    assert.equal(evidence.archive_evidence.condition1_status, "data_pending");
    assert.equal(evidence.can_archive, false);
    const denied = await app.call(
      "intent_cluster.archive",
      request(
        missing.actors.strategist,
        {
          reason: "缺分位不得删",
          manual_confirmation: true,
          archive_evidence_id: evidence.archive_evidence.id,
        },
        missing.clusterId,
      ),
    );
    assert.equal(denied.status, 422);
    assert.equal(denied.error.code, "data_pending");
    assert.equal(
      (
        await app.call(
          "keyword_pool_snapshot.append",
          request(missing.actors.strategist, {
            industry: "B2B",
            seed_version: missing.seed.seed_version,
            demand_observations: [
              { public_cluster_key: "ai 自动排产", demand_index: 0 },
            ],
          }),
        )
      ).status,
      403,
    );
    const f = await registry.fixture("archive-transition");
    const weekly = app.issueActor({
      user_id: "job-weekly_pool",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "weekly_pool",
      trigger_source: { event_id: "next-weekly-batch" },
    });
    expectOk(
      await app.call(
        "keyword_pool_snapshot.append",
        request(weekly, { industry: "B2B", seed_version: f.seed.seed_version }),
      ),
    );
    const stale = expectOk(
      await app.call(
        "intent_cluster.archive",
        request(f.actors.strategist, f.archiveRequest, f.clusterId),
      ),
    );
    assert.equal(stale.archive_evidence.condition1_status, "data_pending");
    assert.equal(stale.can_archive, false);
  } finally {
    await env.close();
  }
});

test("T05通用队列支持词表与口径驳回重提，不增对象状态", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("snapshot-input");
    const lex = expectOk(
      await app.call(
        "brand_lexicon.create",
        request(f.actors.strategist, {
          brand_id: f.brand_id,
          entries: [{ kind: "brand_alias", term: "简造 ERP 别名二" }],
        }),
      ),
    );
    const submitted = expectOk(
      await app.call(
        "review_queue.submit",
        request(f.actors.strategist, {
          object_type: "brand_lexicon",
          object_id: lex.version_object_id,
        }),
      ),
    );
    assert.equal(
      expectOk(
        await app.call(
          "review_queue.reject",
          request(f.actors.factcheck, { reason: "来源需复核" }, submitted.id),
        ),
      ).status,
      "rejected",
    );
    const next = expectOk(
      await app.call(
        "review_queue.submit",
        request(f.actors.strategist, {
          object_type: "brand_lexicon",
          object_id: lex.version_object_id,
        }),
      ),
    );
    assert.notEqual(next.id, submitted.id);
    expectOk(
      await app.call(
        "review_queue.approve",
        request(f.actors.factcheck, {}, next.id),
      ),
    );
    const fact = expectOk(
      await app.call(
        "official_fact.create",
        request(f.actors.strategist, {
          brand_id: f.brand_id,
          fact_category: "boundary",
          content: "虚构测试的第二条边界",
          source_level: "L1",
          effective_from: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    expectOk(
      await app.call(
        "review_queue.reject",
        request(
          f.actors.factcheck,
          { reason: "人工复核" },
          fact.review_entry_id,
        ),
      ),
    );
    const again = expectOk(
      await app.call(
        "review_queue.submit",
        request(f.actors.strategist, {
          object_type: "official_fact",
          object_id: fact.id,
        }),
      ),
    );
    assert.notEqual(again.id, fact.review_entry_id);
    expectOk(
      await app.call(
        "official_fact.approve",
        request(f.actors.factcheck, {}, fact.id),
      ),
    );
  } finally {
    await env.close();
  }
});
