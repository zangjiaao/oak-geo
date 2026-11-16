import { sameOriginRequest } from "./http-origin.mjs";

// Development credential handoff only. Identity is issued by the operator CLI,
// never by this route. Production auth-provider integration remains separate.
export function localSessionAllowed(headers, mode = process.env.NODE_ENV) {
  return (
    mode === "development" &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
      headers.get("host") ?? "",
    )
  );
}
export function createLocalSessionTransport(
  runtimeFactory,
  mode = process.env.NODE_ENV,
) {
  return async (request) => {
    const headers = {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    };
    const fail = (status, message) =>
      Response.json(
        {
          error: {
            code: status === 403 ? "permission_denied" : "validation_failed",
            message,
            details: {},
          },
        },
        { status, headers },
      );
    if (
      !localSessionAllowed(request.headers, mode) ||
      request.method !== "POST"
    )
      return fail(404, "not found");
    if (!sameOriginRequest(request)) return fail(403, "需要本地同源请求");
    let runtime;
    try {
      const text = await request.text();
      if (text.length > 8192) return fail(403, "无效登录链接");
      const body = JSON.parse(text);
      if (
        !body ||
        Object.keys(body).length !== 1 ||
        !/^web\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.credential ?? "")
      )
        return fail(403, "无效登录链接");
      runtime = await runtimeFactory(body.credential);
      const actor = runtime.application.actorFromCredential(body.credential);
      const session = await runtime.readWorkspace();
      if (
        actor.actor_type !== "human" ||
        session.tenant_id !== "fixture-jianzao" ||
        session.user_id !== "fixture-" + session.role ||
        !["strategist", "owner", "factcheck"].includes(session.role) ||
        !session.brands.some((b) => b.id === "fixture-jianzao-brand")
      )
        return fail(403, "仅供本地演示账号使用");
      return Response.json(
        {
          data: {
            next:
              session.role === "factcheck"
                ? "/knowledge?brand=fixture-jianzao-brand"
                : "/?brand=fixture-jianzao-brand",
          },
          meta: { snapshot_id: null, data_as_of: new Date().toISOString() },
        },
        {
          headers: {
            ...headers,
            "set-cookie": `geo_session=${body.credential}; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
          },
        },
      );
    } catch {
      return fail(
        403,
        "登录链接无效或已过期，请重新运行 npm run dev:login；确认数据库连接与会话密钥配置一致。",
      );
    } finally {
      if (runtime) await runtime.close();
    }
  };
}
