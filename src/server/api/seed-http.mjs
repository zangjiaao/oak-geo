import { permission, validation, ServiceError } from "./errors.mjs";

export function requestCredential(headers) {
  const bearer = headers.get("authorization");
  if (bearer) {
    if (!bearer.startsWith("Bearer pat.")) throw permission();
    return bearer.slice(7);
  }
  const cookie = headers.get("cookie") ?? "";
  const value = cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("geo_session="))
    ?.slice(12);
  if (!value?.startsWith("web.")) throw permission();
  return value;
}
export function createSeedTransport(runtimeFactory) {
  return async function serve(request) {
    let runtime;
    const meta = { snapshot_id: null, data_as_of: new Date().toISOString() };
    try {
      const url = new URL(request.url);
      const seedMatch = url.pathname.match(
        /^\/api\/tenants\/([^/]+)\/seed-lists(?:\/([^/]+)\/revisions)?\/?$/,
      );
      const importMatch = url.pathname.match(
        /^\/api\/tenants\/([^/]+)\/keyword-imports\/?$/,
      );
      const match = seedMatch ?? importMatch;
      if (
        !match ||
        !["GET", "POST"].includes(request.method) ||
        (match[2] && request.method !== "POST")
      )
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
      const credential = requestCredential(request.headers);
      if (
        request.method === "POST" &&
        credential.startsWith("web.") &&
        request.headers.get("origin") !== url.origin
      )
        throw permission("same-origin confirmation required");
      let body = {};
      if (request.method === "POST") {
        const bytes = await request.text();
        if (Buffer.byteLength(bytes) > (importMatch ? 3 * 1048576 : 1048576))
          throw validation("request too large");
        try {
          body = JSON.parse(bytes);
        } catch {
          throw validation("invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw validation("object body required");
      }
      const query = Object.fromEntries(url.searchParams);
      if (query.generation) {
        try {
          query.generation = JSON.parse(query.generation);
        } catch {
          throw validation("invalid generation preview");
        }
      }
      runtime = await runtimeFactory(credential);
      const actor = runtime.application.actorFromCredential(credential);
      const operation = importMatch
        ? request.method === "GET"
          ? "keyword_raw.read"
          : "keyword_raw.import"
        : request.method === "GET"
          ? "seed_list.read"
          : match[2]
            ? "seed_list.revise"
            : "seed_list.create";
      const response = await runtime.application.call(
        operation,
        {
          actor,
          body,
          params: {
            tid: decodeURIComponent(match[1]),
            ...(match[2] ? { id: decodeURIComponent(match[2]) } : {}),
          },
          query,
        },
        { idempotencyKey: request.headers.get("idempotency-key") ?? undefined },
      );
      const { status, ...payload } = response;
      return Response.json(
        {
          ...payload,
          ...(payload.data?.next_cursor !== undefined
            ? { next_cursor: payload.data.next_cursor }
            : {}),
        },
        { status, headers: { "cache-control": "no-store" } },
      );
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
