import { validation } from "./errors.mjs";
export function pageLimit(query) {
  const value = Number(query.limit ?? 20);
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw validation("limit must be 1..100");
  return value;
}
export function readCursor(query, expected) {
  if (query.cursor == null) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(query.cursor, "base64url").toString(),
    );
    if (parsed.operation !== expected || !Array.isArray(parsed.values))
      throw new Error();
    return parsed.values;
  } catch {
    throw validation("invalid cursor");
  }
}
export async function pageQuery(
  ctx,
  {
    table,
    columns,
    where,
    values,
    order = [["id", "ASC"]],
    map = (row) => row,
  },
) {
  const cursor = readCursor(ctx.query, ctx.operation);
  const params = [...values];
  let filter = where;
  if (cursor) {
    if (cursor.length !== order.length)
      throw validation("cursor shape mismatch");
    const slots = cursor.map((v) => {
      params.push(v);
      return "$" + params.length;
    });
    filter += ` AND (${order.map(([key]) => key).join(",")}) ${order[0][1] === "DESC" ? "<" : ">"} (${slots.join(",")})`;
  }
  params.push(pageLimit(ctx.query) + 1);
  const fetched = (
    await ctx.client.query(
      `SELECT ${columns} FROM ${table} WHERE ${filter} ORDER BY ${order.map(([key, direction]) => key + " " + direction).join(",")} LIMIT $${params.length}`,
      params,
    )
  ).rows;
  const selected = [];
  let bytes = 300,
    used = 0;
  for (const row of fetched.slice(0, pageLimit(ctx.query))) {
    const item = map(row);
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > 19000)
      throw validation("single item exceeds summary page; use a narrower view");
    if (bytes + size > 19500) break;
    bytes += size;
    selected.push(item);
    used++;
  }
  const last = fetched[used - 1];
  const next_cursor =
    fetched.length > used && last
      ? Buffer.from(
          JSON.stringify({
            operation: ctx.operation,
            values: order.map(([key]) => last[key.split(".").at(-1)]),
          }),
        ).toString("base64url")
      : null;
  return { items: selected, next_cursor };
}
