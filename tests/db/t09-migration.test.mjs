import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { withPostgres } from "../support/postgres-server.mjs";
import { openRuntimeOnDatabase } from "../support/runtime-environment.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";

test("T09旧数据迁移：归一化惰性补齐不换source_word_id，跨期保留原始观测", async () => {
  await withPostgres(async (client) => {
    const actor = {
      user_id: "migration-reviewer",
      role: "admin",
      actor_type: "human",
    };
    const files = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    await applyMigrations({
      client,
      actor,
      files: files.filter((file) => file.name < "0011"),
    });
    // Upgrade replay via the administrative migration service, not runtime fixture SQL.
    await applyMigrations({
      client,
      actor,
      files: [
        {
          name: "0010_legacy_import_fixture.sql",
          sql: `
    INSERT INTO tenant(id,name,mode,plan) VALUES('legacy-import-tenant','旧导入回放（虚构）','full','test');
    INSERT INTO keyword_raw(id,tenant_id,industry,keyword,channel,demand_index,first_seen_at,collected_at,raw_payload)
    VALUES('legacy-word','legacy-import-tenant','B2B','ＥＲＰ，系統！','B',20,'2026-02-01T00:00:00Z','2026-02-01T00:00:00Z','{}');`,
        },
      ],
    });
    await applyMigrations({ client, actor, files });
    const runtime = await openRuntimeOnDatabase(client, actor);
    try {
      const app = runtime.application;
      const admin = app.issueActor({
        ...actor,
        tenant_id: "legacy-import-tenant",
      });
      assert.equal(
        (
          await app.call("user_member.configure", {
            actor: admin,
            body: { user_id: actor.user_id, role: "admin" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await app.call("user_member.configure", {
            actor: admin,
            body: { user_id: "legacy-strategist", role: "strategist" },
          })
        ).status,
        200,
      );
      const strategy = app.issueActor({
        user_id: "legacy-strategist",
        tenant_id: "legacy-import-tenant",
        role: "strategist",
        actor_type: "human",
      });
      const input = {
        industry: "B2B",
        channel: "B",
        keyword: "erp 系统",
        collected_at: "2026-02-01T00:00:00Z",
      };
      const duplicate = await app.call("keyword_raw.import", {
        actor: strategy,
        body: input,
      });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.data.duplicate, 1);
      assert.equal(duplicate.data.id, "legacy-word");
      const next = await app.call("keyword_raw.import", {
        actor: strategy,
        body: {
          ...input,
          collected_at: "2026-03-01T00:00:00Z",
          demand_index: 30,
        },
      });
      assert.equal(next.status, 200);
      assert.equal(next.data.added, 1);
      assert.notEqual(next.data.id, "legacy-word");
      const old = (
        await client.query(
          "SELECT keyword,demand_index,normalized_hash FROM keyword_raw WHERE id='legacy-word'",
        )
      ).rows[0];
      assert.equal(old.keyword, "ＥＲＰ，系統！");
      assert.equal(Number(old.demand_index), 20);
      assert.ok(old.normalized_hash);
      const audit = await app.call("audit_log.read", {
        actor: admin,
        query: { object_id: "legacy-word", limit: 100 },
      });
      assert.equal(audit.status, 200, JSON.stringify(audit.error));
      assert.ok(
        audit.data.items.some(
          (row) => row.action === "keyword_raw.normalize_legacy",
        ),
      );
      assert.equal((await app.inspectSecurity()).sessionUser, "geo_app");
    } finally {
      await runtime.close();
    }
  });
});
