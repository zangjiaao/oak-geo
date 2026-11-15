import { createHash } from "node:crypto";
import { Converter } from "opencc-js/t2cn";
import { validation } from "./errors.mjs";
const convert = Converter({ from: "t", to: "cn" });
export const normalizationVersion = "nfkc_opencc_1.4.2_t_cn_v1";
export function normalizeSourceText(value) {
  if (
    typeof value !== "string" ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)
  )
    throw validation("词文本无效");
  return convert(value.normalize("NFKC"));
}
export function normalizeKeyword(value) {
  const result = normalizeSourceText(value)
    .toLowerCase()
    // Preserve meaningful operators in C++ / C# / URLs / product model names.
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/[,，。!?！？;；:：、“”‘’"'()（）\[\]【】{}<>《》]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!result) throw validation("关键词不能为空");
  return result;
}
export const keywordHash = (value) =>
  createHash("sha256").update(normalizeKeyword(value)).digest("hex");
