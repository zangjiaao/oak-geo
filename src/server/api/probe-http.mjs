import { requestCredential } from "./seed-http.mjs";
import { sameOriginRequest } from "./http-origin.mjs";
import { permission, validation, ServiceError } from "./errors.mjs";

// External frozen create/read(id)/cancel only. Queue projection remains an
// internal authorized service read; there is no public batch/raw collection.
export function createProbeTransport(runtimeFactory) {
  return async (request) => {
    let runtime;
    const headers = { "cache-control": "no-store" };
    const meta = { snapshot_id: null, data_as_of: new Date().toISOString() };
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(
        /^\/api\/tenants\/([^/]+)\/probe-batches(?:\/([^/]+)(?:\/(cancel))?)?\/?$/,
      );
      const valid =
        match &&
        (request.method === "POST"
          ? !match[2] || match[3] === "cancel"
          : request.method === "GET" && match[2] && !match[3]);
      if (!valid)
        return Response.json(
          {
            error: {
              code: "validation_failed",
              message: "unsupported route",
              details: {},
            },
            meta,
          },
          { status: 404, headers },
        );
      let tenantId, batchId;
      try {
        tenantId = decodeURIComponent(match[1]);
        batchId = match[2] ? decodeURIComponent(match[2]) : undefined;
      } catch {
        throw validation("invalid route encoding");
      }
      if (
        [...url.searchParams.keys()].some(
          (key) => !["include", "cursor", "limit"].includes(key),
        )
      )
        throw validation("unsupported query projection");
      const credential = requestCredential(request.headers);
      if (
        request.method === "POST" &&
        credential.startsWith("web.") &&
        !sameOriginRequest(request)
      )
        throw permission("same-origin confirmation required");
      let body = {};
      if (request.method === "POST") {
        const text = await request.text();
        if (Buffer.byteLength(text) > 1048576)
          throw validation("request too large");
        try {
          body = JSON.parse(text);
        } catch {
          throw validation("invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw validation("object body required");
      }
      runtime = await runtimeFactory(credential);
      const operation =
        request.method === "GET"
          ? "probe_batch.read"
          : match[3]
            ? "probe_batch.cancel"
            : "probe_batch.create";
      const response = await runtime.application.call(
        operation,
        {
          actor: runtime.application.actorFromCredential(credential),
          body,
          params: {
            tid: tenantId,
            ...(batchId ? { id: batchId } : {}),
          },
          query: Object.fromEntries(url.searchParams),
        },
        { idempotencyKey: request.headers.get("idempotency-key") ?? undefined },
      );
      const { status, ...payload } = response;
      return Response.json(payload, { status, headers });
    } catch (error) {
      const known = error instanceof ServiceError;
      return Response.json(
        {
          error: {
            code: known ? error.code : "internal_error",
            message: known ? error.message : "service unavailable",
            details: known ? error.details : {},
          },
          meta,
        },
        { status: known ? error.status : 500, headers },
      );
    } finally {
      if (runtime) await runtime.close();
    }
  };
}
