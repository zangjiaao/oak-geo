import { test } from "node:test";
import assert from "node:assert/strict";
import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
test("T08 HTTP只接受已验证Web/PAT：租户防篡改、同源写入、薄路由调用真实服务", async () => {
  const { createSeedTransport } = await import(
    "../../src/server/api/seed-http.mjs"
  );
  const env = await startRuntimeEnvironment();
  try {
    const app = env.application,
      f = await createFixtureRegistry(app, { clock: env.clock }).fixture(
        "snapshot-input",
      );
    let released = 0;
    const serve = createSeedTransport(async () => ({
      application: app,
      close: async () => {
        released++;
      },
    }));
    const url = "https://geo.test/api/tenants/" + f.tenant_id + "/seed-lists";
    assert.equal((await serve(new Request(url))).status, 403);
    const cookie = "geo_session=" + f.actors.strategist.credential;
    const read = await serve(new Request(url, { headers: { cookie } }));
    assert.equal(read.status, 200);
    assert.ok((await read.json()).data.items.length > 0);
    assert.equal(
      (
        await serve(
          new Request(url.replace(f.tenant_id, "other-tenant"), {
            headers: { cookie },
          }),
        )
      ).status,
      403,
    );
    const body = { ...f.seed, maintainer: "张三（虚构）" };
    for (const origin of [undefined, "https://attacker.test"]) {
      const headers = { cookie, "content-type": "application/json" };
      if (origin) headers.origin = origin;
      assert.equal(
        (
          await serve(
            new Request(url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            }),
          )
        ).status,
        403,
      );
    }
    const saved = await serve(
      new Request(url, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://geo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(saved.status, 200);
    assert.ok((await saved.json()).data.id);
    assert.ok(released >= 3);
    const issued = await app.call("api_token.create", {
      actor: f.actors.admin,
      body: {
        user_id: f.actors.strategist.user_id,
        scopes: ["seed_list.read"],
      },
    });
    assert.equal(issued.status, 200);
    const bearer = { authorization: "Bearer " + issued.data.token };
    assert.equal(
      (await serve(new Request(url, { headers: bearer }))).status,
      200,
    );
    assert.equal(
      (
        await serve(
          new Request(url, {
            method: "POST",
            headers: bearer,
            body: JSON.stringify(body),
          }),
        )
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});
