import { createHash } from "node:crypto";
import { isRuntimeApplication } from "../api/application.mjs";

// Scheduler adapter only: no SQL, credential issuance, policy or grouping here.
// No cron is installed while the T10 rule proposal is awaiting human freeze.
export async function runWeeklyPool({
  application,
  actor,
  industry,
  onDeadLetter,
  onAlert,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!isRuntimeApplication(application))
    throw new Error("real application dispatcher required");
  if (typeof onDeadLetter !== "function" || typeof onAlert !== "function")
    throw new Error(
      "durable dead-letter and alert receivers must be configured",
    );
  const key =
    "weekly:" +
    createHash("sha256")
      .update(JSON.stringify([industry, actor?.trigger_source]))
      .digest("hex");
  let response;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt) await wait(1000 * 2 ** (attempt - 1));
    response = await application.call(
      "keyword_pool_snapshot.append",
      {
        actor,
        body: { industry, weekly_pipeline: true },
        params: {},
        query: {},
      },
      { idempotencyKey: key },
    );
    if (response.status < 500)
      return { response, attempts: attempt + 1, dead_lettered: false };
  }
  const envelope = {
    job_name: "weekly_pool",
    tenant_id: actor.tenant_id,
    industry,
    trigger_source: actor.trigger_source,
    attempts: 4,
    error_code: response.error?.code ?? "internal_error",
  };
  // Both deliveries must succeed; delivery failure bubbles to the scheduler.
  await onDeadLetter(envelope);
  await onAlert(envelope);
  return { response, attempts: 4, dead_lettered: true };
}
