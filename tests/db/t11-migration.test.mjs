import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { withPostgres } from "../support/postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";

test("T11告警/站内通知表强制租户RLS只追加，无原句或GET已读状态字段", async () => {
  await withPostgres(async (management) => {
    const files = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    const actor = {
      user_id: "migration-test",
      role: "admin",
      actor_type: "human",
    };
    await applyMigrations({ client: management, files, actor });
    const tables = ["keyword_surge_alert", "keyword_surge_notification"];
    const rows = (
      await management.query(
        `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
      has_table_privilege('geo_app',c.oid,'INSERT') AS can_insert,
      has_table_privilege('geo_app',c.oid,'UPDATE') AS can_update,
      has_table_privilege('geo_app',c.oid,'DELETE') AS can_delete
      FROM pg_class c WHERE c.relname=ANY($1::text[])`,
        [tables],
      )
    ).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true);
      assert.equal(row.relforcerowsecurity, true);
      assert.equal(row.can_insert, true);
      assert.equal(row.can_update, false);
      assert.equal(row.can_delete, false);
    }
    const columns = (
      await management.query(
        `SELECT c.relname,a.attname,col_description(c.oid,a.attnum) AS comment
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
        [tables],
      )
    ).rows;
    assert.ok(columns.every((row) => row.comment));
    for (const name of [
      "keyword",
      "raw_answer",
      "excerpt",
      "read_at",
      "viewed_at",
      "status",
    ])
      assert.ok(!columns.some((row) => row.attname === name));
    assert.equal(
      (await applyMigrations({ client: management, files, actor })).applied
        .length,
      0,
    );
  });
});
