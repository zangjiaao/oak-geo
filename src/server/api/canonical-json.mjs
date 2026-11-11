// Object-key ordering is not a semantic Idempotency-Key payload change.
export function canonicalJson(value) {
  if (Array.isArray(value))
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  if (value && typeof value === "object" && !(value instanceof Date))
    return (
      "{" +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
