import { test } from "node:test";
import assert from "node:assert/strict";

test("T12同源校验按实际Host与协议判断，兼容Next规范化URL且不信任转发头", async () => {
  const { sameOriginRequest } = await import(
    "../../src/server/api/http-origin.mjs"
  );
  const req = (origin, host = "127.0.0.1:3000", extra = {}) =>
    new Request("http://localhost:3000/api", {
      headers: { ...(origin ? { origin } : {}), host, ...extra },
    });
  assert.equal(sameOriginRequest(req("http://127.0.0.1:3000")), true);
  assert.equal(sameOriginRequest(req("https://127.0.0.1:3000")), false);
  assert.equal(sameOriginRequest(req("http://attacker.test")), false);
  assert.equal(sameOriginRequest(req(null)), false);
  assert.equal(
    sameOriginRequest(
      req("http://attacker.test", "127.0.0.1:3000", {
        "x-forwarded-host": "attacker.test",
      }),
    ),
    false,
  );
  assert.equal(
    sameOriginRequest(
      new Request("https://geo.test/api", {
        headers: { origin: "https://geo.test" },
      }),
    ),
    true,
  );
});
