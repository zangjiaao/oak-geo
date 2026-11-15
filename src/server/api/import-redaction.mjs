import { normalizeSourceText } from "./keyword-normalization.mjs";
import { permission, validation } from "./errors.mjs";

export async function importAuthorization(ctx, authorization_ref) {
  if (typeof authorization_ref !== "string" || !authorization_ref.trim())
    throw permission("C类数据需要书面授权");
  const record = await ctx.resolveImportAuthorization({
    tenant_id: ctx.principal.tenant_id,
    authorization_ref,
  });
  if (
    !record ||
    record.tenant_id !== ctx.principal.tenant_id ||
    record.ref !== authorization_ref ||
    record.active !== true ||
    record.revoked_at ||
    typeof record.document_ref !== "string" ||
    !record.document_ref.trim() ||
    (record.expires_at != null &&
      (!Number.isFinite(Date.parse(record.expires_at)) ||
        Date.parse(record.expires_at) <= ctx.now()))
  )
    throw permission("C类书面授权不存在、失效或不属于本租户");
  const policy = record.redaction_policy;
  if (
    !policy ||
    policy.verified !== true ||
    policy.dictionary_complete !== true ||
    typeof policy.version !== "string" ||
    !policy.version.trim() ||
    typeof policy.reviewed_by !== "string" ||
    !policy.reviewed_by.trim() ||
    !Number.isFinite(Date.parse(policy.reviewed_at)) ||
    Date.parse(policy.reviewed_at) > ctx.now() ||
    !Array.isArray(policy.names) ||
    !Array.isArray(policy.addresses) ||
    [...policy.names, ...policy.addresses].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    throw validation("缺少可核验的姓名/地址脱敏词典", {
      reason: "redaction_policy_missing",
    });
  return record;
}
export function redactImportText(value, policy) {
  let text = normalizeSourceText(value);
  const terms = new Map();
  for (const name of policy.names)
    terms.set(normalizeSourceText(name).toLowerCase(), "[姓名]");
  for (const address of policy.addresses)
    terms.set(normalizeSourceText(address).toLowerCase(), "[地址]");
  if (terms.size) {
    const pattern = [...terms.keys()]
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    text = text.replace(new RegExp(pattern, "giu"), (match) =>
      terms.get(match.toLowerCase()),
    );
  }
  return text
    .replace(
      /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/giu,
      "[邮箱]",
    )
    .replace(/(?<!\d)(?:\d{17}[\dXx]|\d{15})(?!\d)/gu, "[证件号]")
    .replace(/(?<!\d)\d(?:[ -]?\d){15,18}(?!\d)/gu, "[银行卡号]")
    .replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/gu, "[手机号]")
    .replace(/\+\d(?:[ -]?\d){6,14}(?!\d)/gu, "[电话号码]")
    .replace(/(?<!\d)0\d{2,3}[ -]?\d{7,8}(?!\d)/gu, "[电话号码]");
}
