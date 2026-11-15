import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { createSeedTransport } from "../../src/server/api/seed-http.mjs";
test("T09浏览器CSV导入沿用既有HTTP路径和真实服务，客户Editor无写权", async () => {
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    const serve = createSeedTransport(async () => ({
      application: app,
      close: async () => {},
    }));
    const url =
      "https://geo.test/api/tenants/" + f.tenant_id + "/keyword-imports";
    const body = JSON.stringify({
      industry: "B2B",
      channel: "A",
      csv: "keyword,collected_at\n导入测试,2026-01-01T00:00:00Z",
    });
    const request = (actor) =>
      new Request(url, {
        method: "POST",
        headers: {
          cookie: "geo_session=" + actor.credential,
          origin: "https://geo.test",
          "content-type": "application/json",
        },
        body,
      });
    assert.equal((await serve(request(f.actors.editor))).status, 403);
    const response = await serve(request(f.actors.strategist));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.added, 1);
    assert.equal(
      (
        await serve(
          new Request(url, {
            headers: {
              cookie: "geo_session=" + f.actors.strategist.credential,
            },
          }),
        )
      ).status,
      200,
    );
  } finally {
    await env.close();
  }
});
