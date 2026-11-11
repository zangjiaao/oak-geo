import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const protectedFiles = {
  "tests/support/application-port.mjs":
    "79b35bd69fbdba8052ba77216fb3f96952d2b66281c6fc3e9ce1a1597c1b8488",
  "tests/rules/product-rule-cases.mjs":
    "3ca4a4aa7a509fd61e9c1adef5fa9cc8a8f3a8aba435352672955fabf6c91023",
  "tests/rules/product-hard-rules.red.mjs":
    "6497c2566bd08274abf88fe87c6510a8cb4b86d35dd1cc1faef7888735f849e2",
  "tests/arch/server-permissions.red.mjs":
    "ce36fda37b739f9ccc48c5509b58ad7375b0a406071aff8ed0cb161aa22d678c",
  "docs/api/contracts.json":
    "4dbcb6dd247d4e3d236f3404069d9cef19620045f5746f2ef8e033d97d5d550d",
  "docs/GEO产品文档.md":
    "4bf10e9d4f46d2851aa7c38497921c9f4ca0203af472db9f2a3424afa1f368be",
};
test("T05冻结保护：T03协议/断言、产品、完整contracts字节不变", () => {
  for (const [path, hash] of Object.entries(protectedFiles))
    assert.equal(
      createHash("sha256").update(readFileSync(path)).digest("hex"),
      hash,
      path,
    );
});
test("T05-RLS：25租户业务表启用RLS，登录与当前角色均非owner且无BYPASSRLS", async () => {
  const { startRuntimeEnvironment } = await import(
    "../support/runtime-environment.mjs"
  );
  const env = await startRuntimeEnvironment();
  try {
    const security = await env.inspectSecurity();
    assert.equal(security.tenantTables.length, 25);
    for (const table of security.tenantTables)
      assert.equal(table.rls, true, table.name);
    for (const role of security.roles) {
      assert.equal(role.superuser, false);
      assert.equal(role.bypassrls, false);
      assert.equal(role.ownsBusinessTables, false);
    }
    assert.equal(security.currentUser, "geo_app");
    assert.equal(security.sessionUser, "geo_app");
  } finally {
    await env.close();
  }
});
test("T05-fixture/call：只携普通连接，拒绝管理连接和绕过声明", async () => {
  const { startRuntimeEnvironment } = await import(
    "../support/runtime-environment.mjs"
  );
  const { createFixtureRegistry } = await import(
    "../support/fixture-registry.mjs"
  );
  const env = await startRuntimeEnvironment();
  try {
    const registry = createFixtureRegistry(env.application);
    const f = await registry.fixture("snapshot-input");
    const response = await env.application.call("scoring_snapshot.create", {
      actor: f.actors.cs,
      body: f.config,
    });
    assert.equal(response.status, 200);
    for (const key of ["bypass", "bypass_rls", "management_connection"]) {
      const denied = await env.application.call("scoring_snapshot.create", {
        actor: { ...f.actors.cs, [key]: true },
        body: f.config,
      });
      assert.equal(denied.status, 403);
    }
    await assert.rejects(
      () => env.assertManagementRejected(),
      /management connection/i,
    );
    assert.equal((await env.inspectSecurity()).sessionUser, "geo_app");
  } finally {
    await env.close();
  }
});

test("T05-R11例外仅覆盖负责人授权块，其他T03场景逐字保留", () => {
  const source = readFileSync(
    "tests/rules/product-rule-cases.mjs",
    "utf8",
  ).replace(/ rule\(11,[\s\S]*?(?= rule\(12,)/, "[[AUTHORIZED_R11]]");
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "9e5b1c306fbc6efb6828e7027e3ba7062f86a8d08818804499315823af6198fa",
  );
});

test("T05-driver与fixture注册表不持有数据库连接或绕过权", () => {
  for (const path of [
    "tests/support/runtime-driver.mjs",
    "tests/support/fixture-registry.mjs",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /(?:from\s*["']pg["']|\.query\s*\(|connectDatabase|management_connection|bypass_rls|BYPASSRLS)/,
      path,
    );
  }
});
