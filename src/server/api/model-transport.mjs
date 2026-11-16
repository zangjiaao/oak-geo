import {
  buildModelRequest,
  parseModelResponse,
  modelUsage,
} from "./model-adapters.mjs";
import { validation } from "./errors.mjs";

export class ModelTransportError extends Error {
  constructor(code, retryable = false, retry_after_ms = null) {
    super(code);
    this.name = "ModelTransportError";
    this.code = code;
    this.retryable = retryable;
    this.retry_after_ms = retry_after_ms;
  }
}
const fail = (code, retryable = false) =>
  new ModelTransportError(code, retryable);
function retryAfter(value, now) {
  if (value == null) return null;
  const number = Number(value),
    date = Date.parse(value);
  const ms =
    Number.isFinite(number) && number >= 0
      ? number * 1000
      : Number.isFinite(date)
        ? Math.max(0, date - now)
        : null;
  return Number.isSafeInteger(ms) ? ms : null;
}
async function readJson(response, maxBytes) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw fail("provider_response_too_large");
  }
  if (!response.body) throw fail("provider_invalid_response");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw fail("provider_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw fail("provider_invalid_response");
  }
}

// No global fetch fallback and no default quota. Composition must supply a
// service-owned, durable reserve/settle controller (quota + rate permit + audit).
// T15 connects that controller to execution; no public route uses this module.
export function createModelTransport({
  fetch: fetcher,
  control,
  timeoutMs = 60000,
  maxResponseBytes = 2 * 1024 * 1024,
  now = Date.now,
} = {}) {
  if (
    typeof fetcher !== "function" ||
    typeof control?.reserve !== "function" ||
    typeof control?.settle !== "function"
  )
    throw new Error("explicit fetch and durable probe control required");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0
  )
    throw new Error("positive transport limits required");
  return Object.freeze({
    async invoke(settings, input, { apiKey, attempt_no } = {}) {
      const profile = structuredClone(settings),
        probe = structuredClone(input);
      const request = buildModelRequest(profile, probe);
      if (
        typeof apiKey !== "string" ||
        !apiKey.trim() ||
        /[\r\n]/.test(apiKey) ||
        !Number.isInteger(attempt_no) ||
        attempt_no < 1 ||
        attempt_no > 4
      )
        throw validation("credentials and batch attempt required");
      // The controller decides tenant quota and distributed provider rate limits.
      // Failed/unknown billing is settled, never silently counted as zero.
      const ticket = await control.reserve({
        ...request.context,
        provider: profile.provider,
        operation_type: "probe",
        attempt_no,
      });
      if (ticket == null) throw fail("probe_permit_missing");
      const controller = new AbortController();
      let timer,
        usage = null,
        outcome = "failed",
        failure;
      try {
        const work = (async () => {
          const response = await fetcher(request.url, {
            method: "POST",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request.body),
            signal: controller.signal,
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new ModelTransportError(
              response.status === 429
                ? "provider_rate_limited"
                : "provider_http_error",
              response.status === 429 || response.status >= 500,
              retryAfter(response.headers.get("retry-after"), now()),
            );
          }
          const payload = await readJson(response, maxResponseBytes);
          usage = modelUsage(payload);
          if (payload?.error)
            throw fail(
              "provider_response_error",
              payload.error?.code === "server_error",
            );
          const result = parseModelResponse(profile, probe, payload);
          outcome = "completed";
          return result;
        })();
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(fail("provider_timeout", true));
          }, timeoutMs);
        });
        return await Promise.race([work, timeout]);
      } catch (error) {
        failure = controller.signal.aborted
          ? fail("provider_timeout", true)
          : error instanceof ModelTransportError
            ? error
            : error?.code === "validation_failed"
              ? fail("provider_contract_mismatch")
              : fail("provider_network_error", true);
        throw failure;
      } finally {
        clearTimeout(timer);
        try {
          await control.settle(ticket, {
            outcome,
            usage,
            error_code: failure?.code ?? null,
          });
        } catch {
          throw fail("probe_metering_unavailable");
        }
      }
    },
  });
}
