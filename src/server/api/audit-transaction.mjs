import { randomUUID } from "node:crypto";
export function createAuditUnit({ client, principal, now, beforeAudit }) {
  const events = new Map();
  const add = (event) => {
    const item = Object.freeze({
      ...event,
      actor: event.actor ? Object.freeze({ ...event.actor }) : undefined,
    });
    events.set(`${item.action}:${item.object_type}:${item.object_id}`, item);
  };
  async function commitEvents() {
    for (const event of events.values()) {
      if (beforeAudit) await beforeAudit(event);
      const actor = event.actor ?? principal;
      await client.query(
        `INSERT INTO audit_log(id,tenant_id,user_id,action,object_type,object_id,at,actor_type,agent_run_id,prompt_version,job_name,batch_id,trigger_source,viewing_session_id,viewer_user_id,reason,cause_event_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          event.id ?? randomUUID(),
          principal.tenant_id,
          actor.actor_type === "system" ? null : actor.user_id,
          event.action,
          event.object_type,
          event.object_id,
          new Date(now()).toISOString(),
          actor.actor_type,
          actor.agent_run_id ?? null,
          actor.prompt_version ?? null,
          actor.job_name ?? null,
          actor.batch_id ?? null,
          actor.trigger_source ?? null,
          event.viewing_session_id ?? null,
          event.viewer_user_id ?? null,
          event.reason ?? null,
          event.cause_event_id ?? null,
        ],
      );
    }
  }
  return Object.freeze({ add, commitEvents });
}
