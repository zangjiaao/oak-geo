import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";

test("T12 HTTP绑定租户/品牌/路径版本，拒绝跨站写入；幂等重放只创建一个版本", async () => {
  const { createQuestionTransport } = await import(
    "../../src/server/api/question-http.mjs"
  );
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application;
    const f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
      "frozen-question",
    );
    const serve = createQuestionTransport(async () => ({
      application: app,
      close: async () => {},
    }));
    const base = `https://geo.test/api/tenants/${f.tenant_id}/brands/${f.brand_id}/question-pools`;
    const send = (url, body, options = {}) =>
      serve(
        new Request(url, {
          method: "POST",
          headers: {
            cookie: "geo_session=" + f.actors.strategist.credential,
            origin: "https://geo.test",
            "content-type": "application/json",
            ...(options.key ? { "idempotency-key": options.key } : {}),
            ...options.headers,
          },
          body: JSON.stringify(body),
        }),
      );
    const body = {
      question: "新的来源表述",
      question_pool_version: 2,
      reason: "人工修订",
    };
    const url = base + "/" + f.questionId + "/revisions";
    const first = await send(url, body, { key: "q-revision" });
    assert.equal(first.status, 200);
    const q = (await first.json()).data;
    assert.equal(
      (await (await send(url, body, { key: "q-revision" })).json()).data.id,
      q.id,
    );
    assert.equal(
      (
        await send(
          url,
          { ...body, question: "另一个表述" },
          { key: "q-revision" },
        )
      ).status,
      409,
    );
    assert.equal(
      (await send(url, body, { headers: { origin: "https://evil.test" } }))
        .status,
      403,
    );
    assert.equal(
      (await send(url.replace(f.brand_id, "other-brand"), body)).status,
      403,
    );
    assert.equal(
      (
        await send(base + "/versions/2/freeze", {
          cluster_id: f.cluster.id,
          question_pool_version: 3,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await send(
          base.replace(f.brand_id, "other-brand") + "/versions/1/freeze",
          {},
        )
      ).status,
      403,
    );
    const noAuth = await serve(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(noAuth.status, 403);
    assert.equal((await serve(new Request(base))).status, 404); // no new public collection endpoint
    const read = await serve(
      new Request(base + "/" + f.questionId, {
        headers: { cookie: "geo_session=" + f.actors.strategist.credential },
      }),
    );
    assert.equal(read.status, 200);
    assert.equal((await read.json()).meta.snapshot_id, null);
  } finally {
    await env.close();
  }
});
