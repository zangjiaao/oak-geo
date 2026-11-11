import { readdirSync, readFileSync } from "node:fs";
import { connectDatabase } from "../src/server/api/database.mjs";
import { registerInstallationAdmin } from "../src/server/api/installation-service.mjs";
import { applyMigrations } from "../src/server/api/migration-service.mjs";
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set DATABASE_URL explicitly to the intended migration database",
  );
const root = new URL("../migrations/", import.meta.url);
const files = readdirSync(root)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, root), "utf8") }));
const client = await connectDatabase({ connectionString });
try {
  const result = await applyMigrations({
    client,
    files,
    actor: {
      user_id: process.env.GEO_MIGRATION_ACTOR ?? "local-migration-admin",
      role: "admin",
      actor_type: "human",
      agent_run_id: null,
      prompt_version: null,
    },
  });
  await registerInstallationAdmin({
    client,
    actor: {
      user_id: process.env.GEO_MIGRATION_ACTOR ?? "local-migration-admin",
      role: "admin",
      actor_type: "human",
    },
  });
  console.log(JSON.stringify({ applied: result.applied }));
} finally {
  await client.end();
}
