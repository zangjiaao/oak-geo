// Candidate review only. User approved investigation, NOT the sampled model set.
// No environment flag can turn these records into production capabilities.
export const modelCandidates = Object.freeze([
  Object.freeze({
    provider: "doubao",
    model: "doubao-seed-2-1-pro-260915",
    status: "candidate",
    native_search: "documented",
    version_evidence: "dated_model_id",
    reviewed_at: "2026-11-15",
    source: "https://docs.volcengine.com/docs/ark/web-search?lang=en",
  }),
  Object.freeze({
    provider: "qwen",
    model: "qwen-plus-2025-12-01",
    status: "candidate",
    native_search: "documented_beijing_only",
    version_evidence: "dated_model_id",
    reviewed_at: "2026-11-15",
    source: "https://help.aliyun.com/zh/model-studio/qwen-plus",
  }),
  Object.freeze({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    status: "candidate",
    native_search: "responses_web_search_only",
    version_evidence: "provider_pin_required",
    reviewed_at: "2026-11-15",
    source: "https://api-docs.deepseek.com/guides/responses_api/",
  }),
  Object.freeze({
    provider: "dots",
    model: "dots3-note-prev",
    status: "candidate",
    native_search: "unverified",
    version_evidence: "preview_not_pinned",
    reviewed_at: "2026-11-15",
    source: "https://dots.ai/platform/docs",
  }),
]);

// Snapshot freezing already rejects null. Keep the production gate closed until
// the owner approves the actual set AND evidence proves model version stability.
export function productionModelCapabilities(_model, _groundingMode) {
  return null;
}
