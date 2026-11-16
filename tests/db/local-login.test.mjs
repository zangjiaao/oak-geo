import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { withPostgres } from "../support/postgres-server.mjs";
import { connectDatabase } from "../../src/server/api/database.mjs";
import { createApplication } from "../../src/server/api/application.mjs";
import { readWorkspaceContext } from "../../src/server/api/workspace-context.mjs";
import { createLocalSessionTransport } from "../../src/server/api/local-session.mjs";
import { createIdentityAuthority } from "../../src/server/api/identity.mjs";
const run = promisify(execFile);
const root = new URL("../../", import.meta.url).pathname;
const environment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GEO_") && !key.startsWith("PG") && !["DATABASE_URL", "NODE_OPTIONS", "NODE_PATH"].includes(key)));
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.error)); return r.data; };

test("真实本地登录命令→普通角色fixture→会话cookie→问句写入；重复不重置，撤权即失效", async () => {
  await withPostgres(async (management) => {
    const dir = mkdtempSync(join(tmpdir(), "oak-login-"));
    const host = encodeURIComponent(management.connectionParameters.host), port = management.connectionParameters.port;
    const ordinary = `postgresql://geo_app@localhost/postgres?host=${host}&port=${port}`;
    const secret = randomBytes(32).toString("hex");
    const invoke = (script, args=[]) => run(process.execPath, ["--env-file-if-exists=.dev.vars", join(root, "scripts", script), ...args], { cwd: dir, env: environment(), timeout: 30000 });
    let client;
    try {
      writeFileSync(join(dir, ".dev.vars"), `DATABASE_URL='postgresql://postgres@localhost/postgres?host=${host}&port=${port}'\nGEO_APPLICATION_DATABASE_URL='${ordinary}'\nGEO_SESSION_SECRET=${secret}\n`, { mode: 0o600 });
      await invoke("migrate.mjs");
      const login = await invoke("local-login.mjs");
      assert.ok(!login.stdout.includes(secret) && !login.stdout.includes(ordinary));
      const url = new URL(login.stdout.trim().split("\n").at(-1));
      assert.equal(url.origin, "http://localhost:3000");
      assert.equal(url.search, "");
      const credential = new URLSearchParams(url.hash.slice(1)).get("session");
      client = await connectDatabase({ connectionString: ordinary });
      const app = await createApplication({ client, secret, publicRootCatalog: new Set(["B2B\0ai 自动排产"]) });
      let closed = 0;
      const serve = createLocalSessionTransport(async (token) => ({ application: app, readWorkspace: () => readWorkspaceContext({ client, application: app, secret, credential: token }), close: async () => { closed++; } }), "development");
      const exchange = (token) => serve(new Request("http://localhost:3000/api/local-session", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" }, body: JSON.stringify({ credential: token }) }));
      const response = await exchange(credential);
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Path=/"));
      assert.ok(!(await response.text()).includes(credential));
      const actor = app.actorFromCredential(credential), params = { bid: "fixture-jianzao-brand" };
      const clusters = ok(await app.call("intent_cluster.read", { actor, params }));
      assert.equal(clusters.items.length, 1);
      const sources = ok(await app.call("keyword_raw.read", { actor, query: { industry: "B2B", provenance_ready: "true" } }));
      assert.equal(sources.items.length, 3);
      const source = sources.items[0];
      const question = ok(await app.call("question_pool.create", { actor, params, body: { brand_id: params.bid, cluster_id: clusters.items[0].id, question: "演示 ERP 的适用场景有哪些？", source_word_id: source.id, intent_type: "认知", source_channel: source.channel, collected_at: new Date(source.collected_at).toISOString(), maintainer: "验收人员（虚构）", question_pool_version: 1 } }));
      await invoke("local-login.mjs");
      const repeated = ok(await app.call("question_pool.read", { actor, params: { ...params, id: question.id } }));
      assert.equal(repeated.question, "演示 ERP 的适用场景有哪些？");
      assert.equal(ok(await app.call("intent_cluster.read", { actor, params })).items.length, 1);
      assert.equal(ok(await app.call("keyword_raw.read", { actor, query: { industry: "B2B" } })).items.length, 3);
      assert.equal((await exchange("web.forged.signature")).status, 403);
      const foreign = app.issueActor({ tenant_id: "not-the-demo", user_id: "fixture-strategist", role: "strategist", actor_type: "human" });
      const foreignAdmin = app.issueActor({ tenant_id: "not-the-demo", user_id: "local-migration-admin", role: "admin", actor_type: "human" });
      ok(await app.call("tenant.configure", { actor: foreignAdmin, body: { name: "非演示租户（安全测试）", mode: "full", plan: "test" } }));
      ok(await app.call("user_member.configure", { actor: foreignAdmin, body: { user_id: foreignAdmin.user_id, role: "admin" } }));
      ok(await app.call("brand.configure", { actor: foreignAdmin, body: { id: "foreign-brand", name: "非演示品牌", industry: "B2B", market: "CN" } }));
      ok(await app.call("user_member.configure", { actor: foreignAdmin, body: { user_id: "fixture-strategist", role: "strategist" } }));
      assert.equal((await readWorkspaceContext({ client, application: app, secret, credential: foreign.credential })).brands.length, 1);
      assert.equal((await exchange(foreign.credential)).status, 403);
      const expired = createIdentityAuthority({ secret, now: () => Date.now() - 25 * 3600_000 }).issue({ tenant_id: "fixture-jianzao", user_id: "fixture-strategist", role: "strategist", actor_type: "human" });
      assert.equal((await exchange(expired)).status, 403);
      for(const role of ['owner','factcheck']){
        const login=await invoke('local-login.mjs',['--role='+role]);
        const roleUrl=new URL(login.stdout.trim().split('\n').at(-1));
        const token=new URLSearchParams(roleUrl.hash.slice(1)).get('session');
        const response=await exchange(token);assert.equal(response.status,200);
        const result=await response.json();assert.ok(result.data.next.startsWith(role==='factcheck'?'/knowledge':'/'));
      }
      const admin = app.issueActor({ user_id: "local-migration-admin", tenant_id: "fixture-jianzao", role: "admin", actor_type: "human" });
      ok(await app.call("user_member.configure", { actor: admin, body: { user_id: actor.user_id, role: "cs", replace_role: "strategist" } }));
      const revoked = await exchange(credential);
      assert.equal(revoked.status, 403);
      assert.equal(revoked.headers.get("set-cookie"), null);
      await assert.rejects(invoke("local-login.mjs"), (e) => e.code === 1);
      assert.equal(closed, 7);
    } finally {
      if (client) await client.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("本地登录命令拒绝production、非回环地址与管理连接回退", async () => {
  const invoke = (args, extra) => run(process.execPath, [join(root, "scripts/local-login.mjs"), ...args], { cwd: tmpdir(), env: { ...environment(), ...extra }, timeout: 5000 });
  await assert.rejects(invoke([], { NODE_ENV: "production" }), (e) => /disabled in production/.test(e.stderr));
  await assert.rejects(invoke(["--origin=https://example.com"], {}), (e) => /loopback origin/.test(e.stderr));
  await assert.rejects(invoke([], { DATABASE_URL: "postgresql://owner-only.invalid" }), (e) => /Set GEO_APPLICATION_DATABASE_URL/.test(e.stderr));
});
