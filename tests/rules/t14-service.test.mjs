import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { parseModelResponse } from "../../src/server/api/model-adapters.mjs";
import { modelCandidates } from "../../src/server/api/probe-model-candidates.mjs";
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

test("T14 候选模型不能冻结生产快照；真实服务仍按probe单独计额、鉴权、幂等并写审计", async () => {
  let quota;
  const env = await startRuntimeEnvironment({
    limits: () => (quota ? { probe: quota } : {}),
  });
  try {
    const app = env.application,
      registry = createFixtureRegistry(app, { clock: env.clock });
    const f = await registry.fixture("external-answer", {
      rawAnswer: "不会自动发布的模拟回答",
    });
    const candidate = ok(
      await app.call(
        "scoring_snapshot.create",
        req(f.actors.cs, {
          ...f.config,
          model_set: modelCandidates.map((c) => c.model),
        }),
      ),
    );
    const freeze = await app.call(
      "scoring_snapshot.freeze",
      req(f.actors.cs, {}, candidate.snapshot_id),
    );
    assert.equal(freeze.status, 422);
    const before = ok(
      await app.call("tenant.read", req(f.actors.admin)),
    ).quota_usage;
    const profile = {
      provider: "qwen",
      model: f.resultRequest.probe.model,
      model_version: "recorded-v1",
      workspace_id: "fixture-space",
    };
    const result = parseModelResponse(
      profile,
      {
        ...f.resultRequest.probe,
        tenant_id: f.tenant_id,
        snapshot_id: f.snapshot.snapshot_id,
        model_version: "recorded-v1",
        question: "模拟问题",
        grounding_mode: "search_on",
      },
      {
        output: {
          choices: [
            { finish_reason: "stop", message: { content: "模拟事实[ref_1]" } },
          ],
          search_info: {
            search_results: [{ index: 1, url: "https://brand.example/fact" }],
          },
        },
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
    );
    const input = req(
      f.actors.probeJob,
      { probe: f.resultRequest.probe, result },
      f.batchId,
    );
    const denied = await app.call("probe_batch.execute", {
      ...input,
      actor: f.actors.cs,
    });
    assert.equal(denied.status, 403);
    const first = ok(
      await app.call("probe_batch.execute", input, {
        idempotencyKey: "t14-transport-result",
      }),
    );
    quota = { windowMs: 86400_000, maxCalls: (before.probe ?? 0) + 1 };
    assert.deepEqual(
      ok(
        await app.call("probe_batch.execute", input, {
          idempotencyKey: "t14-transport-result",
        }),
      ),
      first,
    );
    const second = await app.call(
      "probe_batch.execute",
      req(
        f.actors.probeJob,
        { probe: { ...f.resultRequest.probe, round: 2 }, result },
        f.batchId,
      ),
    );
    assert.equal(second.status, 429);
    assert.equal(second.error.code, "quota_exceeded");
    const after = ok(
      await app.call("tenant.read", req(f.actors.admin)),
    ).quota_usage;
    assert.equal(after.probe, (before.probe ?? 0) + 1);
    assert.equal(after.judge ?? 0, before.judge ?? 0);
    assert.equal(after.drafting ?? 0, before.drafting ?? 0);
    const audit = ok(
      await app.call(
        "audit_log.read",
        req(f.actors.admin, {}, undefined, { object_id: first.id, limit: 100 }),
      ),
    );
    const writes = audit.items.filter(
      (row) => row.action === "probe_batch.execute",
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].actor_type, "system");
    assert.equal(writes[0].job_name, "probe_execute");
    assert.equal(writes[0].batch_id, f.batchId);
    assert.equal((await env.inspectSecurity()).currentUser, "geo_app");
  } finally {
    await env.close();
  }
});
