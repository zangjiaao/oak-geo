import { ModelTransportError } from "../api/model-transport.mjs";
import { isProbeManifest } from "../api/model-adapters.mjs";

// Transport orchestration only. T15 owns persisted batch start/fail/compensate.
// Every invoke receives the whole-attempt number; no failed-question resume list.
export async function runProbeAdapterBatch({
  items,
  invoke,
  discardAttempt,
  onDeadLetter,
  onAlert,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (
    !isProbeManifest(items) ||
    [invoke, discardAttempt, onDeadLetter, onAlert, wait].some(
      (fn) => typeof fn !== "function",
    )
  )
    throw new Error(
      "complete manifest and durable attempt/dead-letter/alert callbacks required",
    );
  const manifest = structuredClone(items);
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const results = [];
    try {
      for (const item of manifest)
        results.push(await invoke(structuredClone(item), attempt));
      return { results, attempts: attempt, dead_lettered: false };
    } catch (error) {
      last =
        error instanceof ModelTransportError
          ? error
          : new ModelTransportError("probe_attempt_failed");
      // Must discard the entire attempt before any retry; failure to discard
      // aborts immediately. Never expose the partial result buffer.
      await discardAttempt(attempt);
      if (!last.retryable || attempt === 4) {
        const { tenant_id, batch_id, snapshot_id } = manifest[0];
        const envelope = {
          job_name: "probe_execute",
          tenant_id,
          batch_id,
          snapshot_id,
          error_code: last.code,
          attempts: attempt,
        };
        const delivered = await Promise.allSettled([
          onDeadLetter(envelope),
          onAlert(envelope),
        ]);
        if (delivered.some((r) => r.status === "rejected"))
          throw new Error("durable failure notification failed");
        return {
          results: null,
          attempts: attempt,
          dead_lettered: true,
          error_code: last.code,
        };
      }
      await wait(Math.max(1000 * 2 ** (attempt - 1), last.retry_after_ms ?? 0));
    }
  }
}
