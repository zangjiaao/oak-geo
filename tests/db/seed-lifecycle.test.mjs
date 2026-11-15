import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { withPostgres } from "../support/postgres-server.mjs";
import { applyMigrations } from "../../src/server/api/migration-service.mjs";

test("T07 迁移回放：旧NULL补active与版本链，重复执行幂等，历史不可改/删", async () => {
  await withPostgres(async (client) => {
    const actor = {
      user_id: "migration-reviewer",
      role: "admin",
      actor_type: "human",
    };
    const files = readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((name) => ({
        name,
        sql: readFileSync("migrations/" + name, "utf8"),
      }));
    await applyMigrations({
      client,
      actor,
      files: files.filter((f) => f.name < "0009"),
    });
    // Administrative migration replay, through the migration service; never used
    // by runtime fixtures/call and never a bypass option on the application port.
    await applyMigrations({
      client,
      actor,
      files: [
        {
          name: "0008_seed_fixture.sql",
          sql: `
    INSERT INTO seed_list(id,industry,word,word_type,maintainer,last_reviewed_at,seed_version)
    VALUES('legacy-one','B2B','ai 自动排产','场景','张三（虚构）','2026-11-01T00:00:00Z',1),
    ('legacy-two','B2B','ai 自动排产','场景','李四（虚构）','2026-11-02T00:00:00Z',2),
    ('legacy-three','B2B','公开词根1','品类','李四（虚构）','2026-11-02T00:00:00Z',3);`,
        },
      ],
    });
    assert.ok(
      (await client.query("SELECT status FROM seed_list")).rows.every(
        (row) => row.status === null,
      ),
    );
    await applyMigrations({ client, actor, files });
    const rows = (
      await client.query(
        "SELECT id,logical_id,previous_id,status,maintainer FROM seed_list ORDER BY seed_version",
      )
    ).rows;
    assert.ok(rows.every((row) => row.status === "active"));
    assert.equal(rows[1].logical_id, rows[0].id);
    assert.equal(rows[1].previous_id, rows[0].id);
    assert.equal(rows[2].logical_id, rows[2].id);
    assert.equal(rows[2].previous_id, null);
    assert.equal(rows[0].maintainer, "张三（虚构）");
    const audits = (
      await client.query(
        "SELECT user_id,actor_type,object_id FROM audit_log WHERE action='schema.seed_lifecycle_backfill'",
      )
    ).rows;
    assert.equal(audits.length, 3);
    assert.ok(
      audits.every(
        (row) => row.actor_type === "human" && row.user_id === actor.user_id,
      ),
    );
    assert.deepEqual(
      (await applyMigrations({ client, actor, files })).applied,
      [],
    );
    for (const sql of [
      "UPDATE seed_list SET status='deprecated' WHERE id='legacy-one'",
      "DELETE FROM seed_list WHERE id='legacy-one'",
    ])
      await assert.rejects(
        () =>
          applyMigrations({
            client,
            actor,
            files: [{ name: "0010_forbidden_seed_change.sql", sql }],
          }),
        (e) => e.code === "23514",
      );
    assert.equal(
      (await client.query("SELECT count(*) AS n FROM seed_list")).rows[0].n,
      "3",
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*) AS n FROM schema_migration WHERE name='0010_forbidden_seed_change.sql'",
        )
      ).rows[0].n,
      "0",
    );
  });
});
