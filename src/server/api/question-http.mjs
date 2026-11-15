import { requestCredential } from "./seed-http.mjs";
import { sameOriginRequest } from "./http-origin.mjs";
import { ServiceError, validation, permission } from "./errors.mjs";
// Only frozen HTTP paths. Collection/versions projections are internal SSR reads.
export function createQuestionTransport(runtimeFactory) {
  return async (request) => {
    let runtime;
    const meta = { snapshot_id: null, data_as_of: new Date().toISOString() };
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(
        /^\/api\/tenants\/([^/]+)\/brands\/([^/]+)\/question-pools(?:\/(.*))?\/?$/,
      );
      if (!match)
        return Response.json(
          {
            error: {
              code: "validation_failed",
              message: "unsupported route",
              details: {},
            },
            meta,
          },
          { status: 404 },
        );
      const rest = (match[3] ?? "")
        .replace(/\/$/, "")
        .split("/")
        .filter(Boolean);
      let operation,
        params = {
          tid: decodeURIComponent(match[1]),
          bid: decodeURIComponent(match[2]),
        };
      if (
        request.method === "GET" &&
        rest.length === 1 &&
        !["versions", "upgrade-anchor"].includes(rest[0])
      ) {
        operation = "question_pool.read";
        params.id = decodeURIComponent(rest[0]);
      }
      if (request.method === "POST") {
        if (rest.length === 0) operation = "question_pool.create";
        else if (rest.length === 1 && rest[0] === "upgrade-anchor")
          operation = "question_pool.upgrade_anchor";
        else if (rest.length === 2 && rest[1] === "revisions") {
          operation = "question_pool.revise";
          params.id = decodeURIComponent(rest[0]);
        } else if (
          rest.length === 3 &&
          rest[0] === "versions" &&
          ["freeze", "archive"].includes(rest[2])
        ) {
          operation = "question_pool." + rest[2];
          params.version = rest[1];
        }
      }
      if (!operation)
        return Response.json(
          {
            error: {
              code: "validation_failed",
              message: "unsupported route",
              details: {},
            },
            meta,
          },
          { status: 404, headers: { "cache-control": "no-store" } },
        );
      const credential = requestCredential(request.headers);
      if (
        request.method === "POST" &&
        credential.startsWith("web.") &&
        !sameOriginRequest(request)
      )
        throw permission("same-origin write required");
      let body = {};
      if (request.method === "POST") {
        const input = await request.text();
        if (Buffer.byteLength(input) > 1048576)
          throw validation("request too large");
        try {
          body = JSON.parse(input);
        } catch {
          throw validation("invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw validation("object body required");
      }
      runtime = await runtimeFactory(credential);
      const actor = runtime.application.actorFromCredential(credential);
      const { status, ...response } = await runtime.application.call(
        operation,
        { actor, params, body, query: Object.fromEntries(url.searchParams) },
        { idempotencyKey: request.headers.get("idempotency-key") ?? undefined },
      );
      return Response.json(response, {
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
      if (runtime) await runtime.close();
    }
  };
}
