import { validation } from "./errors.mjs";

// Storage codes only. API values remain those in frozen t02_api_v1.
export const opportunityStatusMap = Object.freeze({
  candidate: "候选",
  scored: "评分",
  recommended: "建议",
  confirmed: "确认",
  monitoring: "在测",
  archived: "归档",
});
const apiToDatabase = new Map(
  Object.entries(opportunityStatusMap).map(([db, api]) => [api, db]),
);

export function opportunityStatusToDatabase(value) {
  if (!apiToDatabase.has(value))
    throw validation("unknown opportunity API status");
  return apiToDatabase.get(value);
}

export function opportunityStatusToApi(value) {
  if (!Object.hasOwn(opportunityStatusMap, value))
    throw validation("unknown opportunity database status");
  return opportunityStatusMap[value];
}
