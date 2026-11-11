import { createHash, randomUUID } from "node:crypto";
import { permission } from "./errors.mjs";

// Administrative service operation, not an HTTP/PAT endpoint or a background job.
// The CLI reads migration files; all SQL execution and ledger writes live here.
export async function applyMigrations({ client, files, actor }) {
  if (actor?.role !== "admin" || actor.actor_type !== "human" || !actor.user_id)
    throw permission("migration requires a trusted human administrator");
  const applied = [];
  await client.query("SELECT pg_advisory_lock(187451, 4)");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
   name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
   applied_by text NOT NULL
  )`);
    for (const file of [...files].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file.name))
        throw new Error("Invalid migration filename");
      const checksum = createHash("sha256").update(file.sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migration WHERE name=$1",
        [file.name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${file.name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        // Transaction-local identity for audited storage re-encoding migrations.
        await client.query("SELECT set_config('geo.migration_actor',$1,true)", [
          actor.user_id,
        ]);
        await client.query(file.sql);
        await client.query(
          "INSERT INTO schema_migration(name,checksum,applied_by) VALUES($1,$2,$3)",
          [file.name, checksum, actor.user_id],
        );
        // audit_log is created in migration 0001 before this first audit write.
        await client.query(
          `INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,actor_type,agent_run_id,prompt_version)
     VALUES($1,NULL,$2,'schema.apply','schema_migration',$3,'human',NULL,NULL)`,
          [randomUUID(), actor.user_id, file.name],
        );
        await client.query("COMMIT");
        applied.push(file.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(187451, 4)");
  }
  return { applied };
}
