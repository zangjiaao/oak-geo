import { createHash } from "node:crypto";
import { canonicalJson } from "../api/canonical-json.mjs";
import { isRuntimeApplication } from "../api/application.mjs";

// T13 schedules only. T14/T15 supply model execution; no cron is installed here.
export async function runProbeSchedule({
  application,
  actor,
  body,
  onDeadLetter,
  onAlert,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!isRuntimeApplication(application))
    throw new Error("real application dispatcher required");
  if (actor?.actor_type !== "system" || actor?.job_name !== "event_schedule")
    throw new Error("event_schedule job identity required");
  if (!body?.schedule) throw new Error("explicit scheduling metadata required");
  if (typeof onDeadLetter !== "function" || typeof onAlert !== "function")
    throw new Error("durable dead-letter and alert receivers required");
  const key =
    "probe-schedule:" +
    createHash("sha256")
      .update(
        canonicalJson([
          actor.tenant_id,
          body?.type,
          body?.schedule?.source_event_id,
        ]),
      )
      .digest("hex");
  let response;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt) await wait(1000 * 2 ** (attempt - 1));
    response = await application.call(
      "probe_batch.create",
      { actor, body, params: {}, query: {} },
      { idempotencyKey: key },
    );
    if (response.status < 500)
      return { response, attempts: attempt + 1, dead_lettered: false };
  }
  const envelope = {
    job_name: "event_schedule",
    tenant_id: actor.tenant_id,
    source_event_id: body?.schedule?.source_event_id,
    attempts: 4,
    error_code: response.error?.code ?? "internal_error",
  };
  await onDeadLetter(envelope);
  await onAlert(envelope);
  return { response, attempts: 4, dead_lettered: true };
}
