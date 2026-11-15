import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { withPostgres } from "../support/postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";

test("T10辅助表：租户投影强制RLS且只追加，共享表无tenant_id，所有列有注释", async () => {
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
    const tables = [
      "weekly_pool_publication",
      "weekly_public_metric",
      "weekly_pool_run",
      "weekly_cluster_snapshot",
      "weekly_pool_candidate",
    ];
    const info = (
      await management.query(
        `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
       has_table_privilege('geo_app',c.oid,'INSERT') AS can_insert,
       has_table_privilege('geo_app',c.oid,'UPDATE') AS can_update,
       has_table_privilege('geo_app',c.oid,'DELETE') AS can_delete
       FROM pg_class c WHERE c.relname=ANY($1::text[]) ORDER BY c.relname`,
        [tables],
      )
    ).rows;
    assert.equal(info.length, 5);
    for (const row of info) {
      assert.equal(row.can_insert, true);
      assert.equal(row.can_update, false);
      assert.equal(row.can_delete, false);
      if (
        [
          "weekly_pool_run",
          "weekly_cluster_snapshot",
          "weekly_pool_candidate",
        ].includes(row.relname)
      ) {
        assert.equal(row.relrowsecurity, true);
        assert.equal(row.relforcerowsecurity, true);
      }
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
    for (const shared of ["weekly_pool_publication", "weekly_public_metric"])
      assert.ok(
        !columns.some(
          (row) => row.relname === shared && row.attname === "tenant_id",
        ),
      );
    assert.equal(
      (await applyMigrations({ client: management, files, actor })).applied
        .length,
      0,
    );
  });
});
