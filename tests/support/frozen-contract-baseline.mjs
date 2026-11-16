import assert from "node:assert/strict";
export const t42EndpointIds = [
  "read",
  "save",
  "investigate",
  "claim",
  "finish",
  "confirm",
].map((name) => "product_profile." + name);
// Remove only the explicitly authorized additive T42 surface before applying
// existing T02 hashes. Every pre-existing property remains hash protected.
export function withoutT42(raw) {
  const d = structuredClone(raw),
    amendment = d.amendments.find((a) => a.id === "T42");
  assert.deepEqual(
    [
      amendment?.status,
      amendment?.endpoint_ids,
      amendment?.added_operations,
      amendment?.added_allow_rows,
    ],
    ["pending_review", t42EndpointIds, [], 11],
  );
  const endpoints = d.endpoints.filter((e) => e.resource === "product_profile");
  assert.deepEqual(
    endpoints.map((e) => e.id),
    t42EndpointIds,
  );
  assert.equal(
    endpoints.reduce((n, e) => n + e.grants.length, 0),
    11,
  );
  assert.ok(endpoints.every((e) => e.amendment_id === "T42"));
  assert.deepEqual(d.jobs.product_research.endpoints, [
    "product_profile.claim",
    "product_profile.finish",
  ]);
  d.endpoints = d.endpoints.filter((e) => !t42EndpointIds.includes(e.id));
  d.resources = d.resources.filter((name) => name !== "product_profile");
  d.review.core_endpoint_ids = d.review.core_endpoint_ids.filter(
    (id) => !t42EndpointIds.includes(id),
  );
  d.review.resource_layers["需求层"] = d.review.resource_layers[
    "需求层"
  ].filter((name) => name !== "product_profile");
  delete d.jobs.product_research;
  d.amendments = d.amendments.filter((a) => a.id !== "T42");
  return d;
}
