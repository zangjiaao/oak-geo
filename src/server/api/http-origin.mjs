// Next may normalize request.url to its listener hostname. Host remains the
// browser's actual destination authority. Never accept client forwarding headers
// as an alternative authority. Workers expose the same request Host/protocol.
export function sameOriginRequest(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    if (/[\\/?#@\s]/.test(host)) return false;
    return origin === new URL(url.protocol + "//" + host).origin;
  } catch {
    return false;
  }
}
