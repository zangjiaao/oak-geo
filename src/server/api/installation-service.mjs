import { randomUUID } from "node:crypto";
import { permission } from "./errors.mjs";
export async function registerInstallationAdmin({ client, actor }) {
  const identity = (await client.query("SELECT current_user AS name")).rows[0];
  if (
    identity.name === "geo_app" ||
    actor?.role !== "admin" ||
    actor.actor_type !== "human" ||
    !actor.user_id
  )
    throw permission("installation requires migration identity");
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO auth_installation_admin(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [actor.user_id],
    );
    await client.query(
      "INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,actor_type,agent_run_id,prompt_version) VALUES($1,NULL,$2,'auth.installation.configure','auth_installation_admin',$2,'human',NULL,NULL)",
      [randomUUID(), actor.user_id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
