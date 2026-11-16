import assert from "node:assert/strict";
export const t42EndpointIds = [
  "read",
  "save",
  "investigate",
  "claim",
  "finish",
  "confirm",
].map((name) => "product_profile." + name);
// Remove only the explicitly authorized additive T42/T43/T44 surfaces before applying
// existing T02 hashes. Every pre-existing property remains hash protected.
export function withoutProductAmendments(raw) {
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
  const creation = d.amendments.find((a) => a.id === "T43");
  assert.deepEqual([creation?.status, creation?.endpoint_ids, creation?.added_operations, creation?.added_allow_rows],
    ["pending_review", ["brand.create"], [], 1]);
  const createEndpoint = d.endpoints.filter((e) => e.id === "brand.create");
  assert.equal(createEndpoint.length, 1);
  assert.deepEqual([createEndpoint[0].amendment_id, createEndpoint[0].resource, createEndpoint[0].grants], ["T43", "brand", ["owner"]]);
  d.endpoints = d.endpoints.filter((e) => e.id !== "brand.create");
  d.amendments = d.amendments.filter((a) => a.id !== "T43");
  const t44 = d.amendments.find((a) => a.id === "T44");
  assert.deepEqual([t44?.status,t44?.endpoint_ids,t44?.added_operations,t44?.added_allow_rows],
    ["pending_review",["product_profile.revise"],[],0]);
  const revise = d.endpoints.find((e) => e.id === "product_profile.revise");
  assert.deepEqual([revise?.amendment_id,revise?.grants],["T44",["owner","strategist"]]);
  d.endpoints = d.endpoints.filter((e) => e.id !== "product_profile.revise");
  d.amendments = d.amendments.filter((a) => a.id !== "T44");
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
