/**
 * Presentation only: never pass the filtered page to a business transition.
 * @template T
 * @param {T[]} items
 * @param {{query?: string, fields: (keyof T)[], matches?: (row: T) => boolean, page?: number, pageSize?: number}} options
 */
export function listWindow(
  items,
  { query = "", fields, matches = () => true, page = 1, pageSize = 20 },
) {
  const normalize = (text) =>
    String(text ?? "")
      .normalize("NFKC")
      .toLowerCase();
  const needle = normalize(query.trim());
  const filtered = items.filter(
    (row) =>
      matches(row) &&
      (!needle || fields.some((key) => normalize(row[key]).includes(needle))),
  );
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 20;
  const current = Math.max(
    1,
    Math.min(
      Number.isSafeInteger(page) ? page : 1,
      Math.ceil(filtered.length / size),
    ),
  );
  return {
    items: filtered.slice((current - 1) * size, current * size),
    total: filtered.length,
    page: current,
  };
}
