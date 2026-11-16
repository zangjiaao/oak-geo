import { ServiceError, permission, validation } from "./errors.mjs";
import { requestCredential } from "./seed-http.mjs";
import { sameOriginRequest } from "./http-origin.mjs";
import { describeResearchFailure, researchFailure } from "./product-research-errors.mjs";
import { publicProductUrl } from "./product-profile.mjs";

export async function executeProductResearch(runtime, actor, params, runId, options = {}) {
  const application = runtime.application;
  const job = application.issueActor({
    user_id: "job-product-research",
    tenant_id: actor.tenant_id,
    role: "system",
    actor_type: "system",
    job_name: "product_research",
    trigger_source: { event_id: runId },
  });
  const claim = await application.call(
    "product_profile.claim",
    { actor: job, params, body: { run_id: runId } },
    { idempotencyKey: "claim-" + runId + "-" + crypto.randomUUID() },
  );
  if (claim.status !== 200)
    throw new ServiceError(
      claim.status,
      claim.error.code,
      "调查任务未能启动，请刷新重试",
    );
  if (!claim.data.claimed) return;
  let result, error;
  try {
    if (claim.data.input_changed) throw researchFailure("input_changed", "evidence");
    result = await runtime.productResearchAgent.run(claim.data.input, {
      runId,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (cause) {
    error = describeResearchFailure(cause);
    result = cause?.researchContext;
  }
  const finished = await application.call(
    "product_profile.finish",
    {
      actor: job,
      params,
      body: { run_id: runId, ...(error ? { error } : {}), ...(result ? {result} : {}) },
    },
    { idempotencyKey: "finish-" + runId },
  );
  if (finished.status !== 200) {
    // A malformed model result must leave a durable failed run, not a fake success.
    const failure = await application.call(
      "product_profile.finish",
      {
        actor: job,
        params,
        body: {
          run_id: runId,
          error: describeResearchFailure(researchFailure(
            finished.status === 422 ? "result_rejected" : "save", "save",
          )),
        },
      },
      { idempotencyKey: "failed-" + runId },
    );
    if (failure.status !== 200)
      throw new ServiceError(
        503,
        "research_result_unavailable",
        "调查记录保存失败，请刷新查看，勿重复点击",
      );
  }
}
function researchEvents(runtime, actor, params, runId, requestSignal, meta) {
  const encoder = new TextEncoder(), abort = new AbortController();
  let closed = false;
  const cancel = () => abort.abort(new DOMException("调查已停止", "AbortError"));
  requestSignal.addEventListener("abort", cancel, { once: true });
  if (requestSignal.aborted) cancel();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode("data:" + JSON.stringify({ ...event, meta: event.meta ?? meta }) + "\n\n")); }
        catch { closed = true; cancel(); }
      };
      try {
        send({ type: "started", run_id: runId });
        await executeProductResearch(runtime, actor, params, runId, {
          signal: abort.signal,
          onProgress(event) {
            if (!['model', 'search', 'fetch'].includes(event?.kind) ||
                !['started', 'completed', 'failed'].includes(event?.phase)) return;
            const activity = { kind: event.kind, phase: event.phase, at: event.at };
            if (typeof event.call_id === 'string' && /^[\w-]{1,80}$/.test(event.call_id)) activity.call_id=event.call_id;
            if (typeof event.query === 'string') activity.query = event.query.slice(0, 128);
            if (typeof event.url === 'string') {
              try { activity.url = publicProductUrl(event.url); } catch {}
            }
            if (Number.isInteger(event.count) && event.count >= 0 && event.count <= 50) activity.count = event.count;
            if (typeof event.message === 'string') activity.message = event.message.slice(0, 250);
            send({ type: "activity", activity });
          },
        });
        const result = await runtime.application.call("product_profile.read", { actor, params });
        if (result.status !== 200) throw new Error("result_unavailable");
        send({ type: "result", data: result.data, meta: result.meta });
      } catch {
        send({ type: "error", message: "调查连接未能完成，请刷新查看已保存的进度。" });
      } finally {
        requestSignal.removeEventListener("abort", cancel);
        try { await runtime.close(); }
        finally {
          if (!closed) { closed = true; controller.close(); }
        }
      }
    },
    cancel() { closed = true; cancel(); },
  });
  return new Response(body, { headers: {
    "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  } });
}
export function createProductOnboardingTransport(runtimeFactory) {
  return async (request) => {
    let runtime;
    const meta = { snapshot_id: null, data_as_of: new Date().toISOString() };
    try {
      const url = new URL(request.url);
      const create = url.pathname.match(/^\/api\/tenants\/([^/]+)\/brands\/create$/);
      const match = create ? [create[0], create[1], undefined, "create"] : url.pathname.match(
        /^\/api\/tenants\/([^/]+)\/brands\/([^/]+)\/product-profile(?:\/(save|investigate|confirm|revise)|\/facts\/([^/]+)\/approve)?$/,
      );
      if (
        !match ||
        !["GET", "POST"].includes(request.method) ||
        (request.method === "GET" && (match[3] || match[4])) ||
        (request.method === "POST" && !match[3] && !match[4])
      )
        return Response.json(
          { error: { code: "not_found", message: "未找到操作" }, meta },
          { status: 404 },
        );
      const credential = requestCredential(request.headers);
      if (
        request.method === "POST" &&
        credential.startsWith("web.") &&
        !sameOriginRequest(request)
      )
        throw permission("请从同一站点提交");
      let body = {};
      if (request.method === "POST") {
        if (!request.headers.get("idempotency-key"))
          throw validation("提交需要幂等标识");
        const bytes = await request.text();
        if (Buffer.byteLength(bytes) > 131072) throw validation("产品资料过大");
        try {
          body = JSON.parse(bytes);
        } catch {
          throw validation("无效JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw validation("资料格式错误");
      }
      runtime = await runtimeFactory(credential);
      const actor = runtime.application.actorFromCredential(credential),
        params = {
          tid: decodeURIComponent(match[1]),
          ...(match[2] ? { bid: decodeURIComponent(match[2]) } : {}),
        };
      const operation = create ? "brand.create" : match[4]
        ? "official_fact.approve"
        : "product_profile." + (match[3] ?? "read");
      let response = await runtime.application.call(
        operation,
        {
          actor,
          params: {
            ...params,
            ...(match[4] ? { id: decodeURIComponent(match[4]) } : {}),
          },
          body,
          query: Object.fromEntries(url.searchParams),
        },
        { idempotencyKey: request.headers.get("idempotency-key") ?? undefined },
      );
      if (
        operation === "product_profile.investigate" &&
        response.status === 200
      ) {
        if (request.headers.get("accept")?.includes("text/event-stream")) {
          const owner = runtime;
          runtime = null;
          return researchEvents(owner, actor, params, response.data.id, request.signal, response.meta);
        }
        await executeProductResearch(runtime, actor, params, response.data.id);
        response = await runtime.application.call("product_profile.read", {
          actor,
          params,
        });
      }
      const { status, ...payload } = response;
      return Response.json(payload, {
        status,
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      const known = error instanceof ServiceError;
      return Response.json(
        {
          error: {
            code: known ? error.code : "internal_error",
            message: known ? error.message : "服务暂不可用",
            details: known ? error.details : {},
          },
          meta,
        },
        {
          status: known ? error.status : 503,
          headers: { "cache-control": "no-store" },
        },
      );
    } finally {
      await runtime?.close();
    }
  };
}
