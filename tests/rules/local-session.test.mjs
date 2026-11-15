import { test } from "node:test";
import assert from "node:assert/strict";

test("本地会话入口仅 development + 回环同源；不签发身份、不接受客户端角色", async () => {
  const { createLocalSessionTransport, localSessionAllowed } = await import("../../src/server/api/local-session.mjs");
  let calls = 0;
  const serve = createLocalSessionTransport(async () => { calls++; throw new Error("must not connect"); }, "development");
  const request = (host = "localhost:3000", origin = "http://localhost:3000", body = { credential: "web.forged.signature" }) => new Request("http://localhost:3000/api/local-session", { method: "POST", headers: { host, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(localSessionAllowed(new Headers({ host: "localhost:3000" }), "production"), false);
  assert.equal(localSessionAllowed(new Headers({ host: "localhost.attacker.example" }), "development"), false);
  assert.equal(localSessionAllowed(new Headers({ host: "[::1]:3000" }), "development"), true);
  assert.equal((await createLocalSessionTransport(() => { calls++; }, "production")(request())).status, 404);
  assert.equal((await serve(request("remote.example"))).status, 404);
  assert.equal((await serve(request("localhost:3000", "https://evil.example"))).status, 403);
  for (const body of [{ credential: "job.fake.fake" }, { credential: "pat.fake.fake" }, { credential: "web.fake.fake", role: "admin" }])
    assert.equal((await serve(request(undefined, undefined, body))).status, 403);
  assert.equal(calls, 0);
});
