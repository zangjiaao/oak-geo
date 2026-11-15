import { validation } from "./errors.mjs";
export function parseCsv(text) {
  if (typeof text !== "string" || !text.length || text.includes("\0"))
    throw validation("CSV内容无效");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const finishField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (closed && c !== "," && c !== "\r" && c !== "\n")
      throw validation("CSV引号后存在无效字符");
    if (c === '"') {
      if (field) throw validation("CSV引号位置无效");
      quoted = true;
    } else if (c === ",") finishField();
    else if (c === "\r" || c === "\n") {
      finishRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (quoted) throw validation("CSV引号未闭合");
  if (field || row.length || closed) finishRow();
  return rows;
}
