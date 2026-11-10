import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { permission } from "./errors.mjs";
export const hashToken = (value) =>
  createHash("sha256").update(value).digest("hex");
export function createIdentityAuthority({ secret, now }) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("identity signing secret must have at least 32 characters");
  function issue(claims, kind = "web") {
    const payload = Buffer.from(
      JSON.stringify({
        ...claims,
        nonce: randomBytes(16).toString("hex"),
        expires_at: kind === "pat" ? null : now() + 24 * 3600_000,
      }),
    ).toString("base64url");
    const signed = `${kind}.${payload}`;
    return (
      signed +
      "." +
      createHmac("sha256", secret).update(signed).digest("base64url")
    );
  }
  function verify(token) {
    if (typeof token !== "string") throw permission("credential required");
    const [kind, payload, signature, ...rest] = token.split(".");
    if (rest.length || !["web", "pat", "job"].includes(kind) || !signature)
      throw permission("invalid credential");
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", secret)
      .update(`${kind}.${payload}`)
      .digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw permission("invalid credential");
    let claims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      throw permission("invalid credential");
    }
    if (
      !claims.user_id ||
      !claims.tenant_id ||
      (claims.expires_at != null && claims.expires_at <= now())
    )
      throw permission("expired or incomplete credential");
    return {
      ...claims,
      credential_kind: kind,
      credential_hash: hashToken(token),
    };
  }
  return Object.freeze({ issue, verify });
}
