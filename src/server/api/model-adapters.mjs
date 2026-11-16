import { validation } from "./errors.mjs";

const providers = new Set(["qwen", "doubao", "deepseek", "hunyuan"]);
const manifests = new WeakSet();
export const isProbeManifest = (value) => manifests.has(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
function validateProfile(profile, probe) {
  if (
    !providers.has(profile?.provider) ||
    !text(profile.model) ||
    !text(profile.model_version)
  )
    throw validation("verified model profile required");
  for (const key of [
    "tenant_id",
    "batch_id",
    "snapshot_id",
    "cluster_id",
    "question_id",
    "question",
  ])
    if (!text(probe?.[key])) throw validation("incomplete probe identity");
  if (
    probe.model !== profile.model ||
    probe.model_version !== profile.model_version
  )
    throw validation("model differs from frozen version");
  if (
    !["search_on", "search_off"].includes(probe.grounding_mode) ||
    ![0, 0.7].includes(probe.temperature) ||
    (probe.grounding_mode === "search_off" && probe.temperature !== 0) ||
    !Number.isInteger(probe.round) ||
    probe.round < 1 ||
    probe.round > 3
  )
    throw validation("probe outside sampling contract");
  if (profile.provider === "deepseek" && profile.model !== "deepseek-v4-pro")
    throw validation(
      "only the reviewed deepseek-v4-pro Responses protocol is supported",
    );
  if (
    profile.provider === "doubao" &&
    ["doubao-seed-2-0-pro-260215", "doubao-seed-2-0-lite-260215"].includes(
      profile.model,
    )
  )
    throw validation("this model ignores the required sampling temperature");
}

// Profiles are trusted server configuration, never spread into user requests.
// Qwen uses DashScope native HTTP: OpenAI compatibility omits source metadata.
export function buildModelRequest(profile, probe) {
  validateProfile(profile, probe);
  const search = probe.grounding_mode === "search_on";
  const message = { role: "user", content: probe.question };
  const base = {
    model: profile.model,
    temperature: probe.temperature,
    stream: false,
  };
  let url, body;
  if (profile.provider === "qwen") {
    if (!/^[a-zA-Z0-9-]+$/.test(profile.workspace_id ?? ""))
      throw validation("Beijing workspace ID required");
    url = `https://${profile.workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation`;
    body = {
      model: profile.model,
      input: { messages: [message] },
      parameters: {
        temperature: probe.temperature,
        enable_thinking: false,
        result_format: "message",
        enable_search: search,
        ...(search
          ? {
              search_options: {
                enable_source: true,
                enable_citation: true,
                citation_format: "[ref_<number>]",
              },
            }
          : {}),
      },
    };
  } else if (profile.provider === "doubao") {
    url = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    body = {
      ...base,
      messages: [message],
      thinking: { type: "disabled" },
      ...(search ? { web_search_options: {} } : {}),
    };
  } else if (profile.provider === "deepseek") {
    url = "https://api.deepseek.com/responses";
    // New deepseek_web_search ignores temperature. Only the documented standard
    // Responses web_search + no-thinking path is a candidate for our two tracks.
    body = {
      ...base,
      input: [message],
      reasoning: { effort: "none" },
      tools: search ? [{ type: "web_search" }] : [],
      tool_choice: search ? "auto" : "none",
      store: false,
    };
  } else {
    // Investigated fallback only; not a selected fourth model.
    url = "https://tokenhub.tencentmaas.com/v1/chat/completions";
    body = {
      ...base,
      messages: [message],
      ...(search
        ? { web_search_options: { enable: true, search_source: "standard" } }
        : {}),
    };
  }
  const context = Object.fromEntries(
    [
      "tenant_id",
      "batch_id",
      "snapshot_id",
      "cluster_id",
      "question_id",
      "model",
      "model_version",
      "temperature",
      "round",
      "grounding_mode",
    ].map((k) => [k, probe[k]]),
  );
  return { url, body, context };
}

export function planProbeManifest({
  tenant_id,
  batch_id,
  snapshot,
  cluster_question_sets,
  questions,
}) {
  const mode = snapshot?.grounding_mode,
    temperatures = mode === "search_on" ? [0, 0.7] : [0];
  if (
    !text(tenant_id) ||
    !text(batch_id) ||
    !snapshot?.frozen ||
    !text(snapshot.snapshot_id) ||
    !["search_on", "search_off"].includes(mode) ||
    snapshot.rounds !== 3 ||
    !Array.isArray(snapshot.model_set) ||
    snapshot.model_set.length !== 4 ||
    new Set(snapshot.model_set).size !== 4 ||
    JSON.stringify(snapshot.temperature_set?.map(Number)) !==
      JSON.stringify(temperatures) ||
    snapshot.model_set.some(
      (m) => !text(m) || !text(snapshot.model_version_manifest?.[m]),
    ) ||
    !Array.isArray(cluster_question_sets) ||
    !cluster_question_sets.length ||
    !Array.isArray(questions)
  )
    throw validation("complete frozen sampling manifest required");
  const byId = new Map(questions.map((q) => [q.id, q])),
    seen = new Set(),
    clusters = new Set(),
    result = [];
  if (byId.size !== questions.length)
    throw validation("duplicate question identity");
  for (const set of cluster_question_sets) {
    if (
      !text(set.cluster_id) ||
      clusters.has(set.cluster_id) ||
      !Number.isInteger(set.question_pool_version) ||
      !Array.isArray(set.question_ids) ||
      set.question_ids.length !== 3 ||
      new Set(set.question_ids).size !== 3
    )
      throw validation("three unique anchored questions required");
    clusters.add(set.cluster_id);
    for (const id of set.question_ids) {
      const q = byId.get(id);
      if (
        seen.has(id) ||
        !q ||
        q.cluster_id !== set.cluster_id ||
        q.question_pool_version !== set.question_pool_version ||
        !text(q.question)
      )
        throw validation("question anchor mismatch");
      seen.add(id);
      for (const model of snapshot.model_set)
        for (const temperature of temperatures)
          for (let round = 1; round <= 3; round++)
            result.push(
              Object.freeze({
                tenant_id,
                batch_id,
                snapshot_id: snapshot.snapshot_id,
                cluster_id: set.cluster_id,
                question_id: id,
                question: q.question,
                question_pool_version: set.question_pool_version,
                model,
                model_version: snapshot.model_version_manifest[model],
                temperature,
                round,
                grounding_mode: mode,
              }),
            );
    }
  }
  manifests.add(result);
  return Object.freeze(result);
}

const nonnegative = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
export function modelUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    input_tokens: nonnegative(usage.input_tokens ?? usage.prompt_tokens),
    output_tokens: nonnegative(usage.output_tokens ?? usage.completion_tokens),
    total_tokens: nonnegative(usage.total_tokens),
    search_calls: nonnegative(
      usage.tool_usage?.web_search ??
        usage.tool_usage?.web_search_call ??
        usage.server_tool_use?.tool_search,
    ),
  };
}
function safeUrl(value) {
  if (typeof value !== "string" || /[\s<>]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function bodyUrls(answer) {
  const urls = [];
  // Retain balanced parentheses inside URLs; trim only unmatched prose closers.
  for (const match of answer.matchAll(
    /https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/giu,
  )) {
    let value = match[0].replace(/[.,;:!?]+$/u, "");
    while (
      value.endsWith(")") &&
      (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
    )
      value = value.slice(0, -1);
    value = value.replace(/\]+$/u, "");
    urls.push(value);
  }
  return urls;
}
const array = (value) => (Array.isArray(value) ? value : []);

export function parseModelResponse(profile, probe, payload) {
  validateProfile(profile, probe);
  if (!payload || payload.error || payload.code)
    throw validation("provider response failed");
  if (payload.model != null && payload.model !== profile.model)
    throw validation("provider model changed");
  if (payload.temperature != null && payload.temperature !== probe.temperature)
    throw validation("provider temperature changed");
  let answer,
    refused = false,
    annotationUrls = [],
    searchResults = [];
  const usage = modelUsage(payload);
  if (profile.provider === "deepseek") {
    refused =
      payload.status === "incomplete" &&
      payload.incomplete_details?.reason === "content_filter";
    if (!refused && payload.status !== "completed")
      throw validation("incomplete provider answer");
    const messages = array(payload.output).filter(
      (o) => o.type === "message" && o.role === "assistant",
    );
    if (!refused && messages.some((m) => m.status !== "completed"))
      throw validation("incomplete provider message");
    const blocks = messages.flatMap((m) => array(m.content));
    if (
      !refused &&
      blocks.some((b) => b.type !== "output_text" || typeof b.text !== "string")
    )
      throw validation("unexpected provider content");
    answer = refused ? "" : blocks.map((b) => b.text).join("\n");
    annotationUrls = blocks
      .flatMap((b) => array(b.annotations))
      .filter((a) => a.type === "url_citation")
      .map((a) => a.url);
    searchResults = array(payload.output)
      .filter((o) => o.type === "web_search_call")
      .flatMap((o) => array(o.action?.sources));
  } else {
    const output = profile.provider === "qwen" ? payload.output : payload;
    const choices = array(output?.choices);
    if (choices.length !== 1) throw validation("one complete answer required");
    const choice = choices[0],
      message = choice.message;
    refused = choice.finish_reason === "content_filter";
    if (!refused && choice.finish_reason !== "stop")
      throw validation("incomplete provider answer");
    answer = message?.content ?? (refused ? "" : null);
    annotationUrls = array(message?.annotations)
      .filter((a) => a.type === "url_citation")
      .map((a) => a.url_citation?.url);
    searchResults =
      profile.provider === "qwen"
        ? array(output?.search_info?.search_results)
        : array(message?.search_results);
    for (const source of searchResults) {
      const index = source.index;
      if (
        Number.isSafeInteger(index) &&
        index >= 0 &&
        (answer?.includes(`[ref_${index}]`) || answer?.includes(`[${index}]`))
      )
        annotationUrls.push(source.url);
    }
  }
  if (typeof answer !== "string" || (!refused && !answer.trim()))
    throw validation("empty provider answer");
  if (
    probe.grounding_mode === "search_off" &&
    ((usage?.search_calls ?? 0) > 0 ||
      annotationUrls.length ||
      searchResults.length ||
      array(payload.output).some((o) => o.type === "web_search_call"))
  )
    throw validation("search evidence on memory track");
  const cited_urls = [
    ...new Set(
      [...annotationUrls, ...bodyUrls(answer)].map(safeUrl).filter(Boolean),
    ),
  ];
  return {
    raw_answer: answer,
    refused,
    refusal_review_required: !refused,
    cited_urls,
    cited_domains: [...new Set(cited_urls.map((u) => new URL(u).hostname))],
    usage,
    search_enabled: probe.grounding_mode === "search_on",
    search_call_count: usage?.search_calls ?? null,
    search_results: searchResults
      .map((s) => ({ url: safeUrl(s.url), index: s.index ?? null }))
      .filter((s) => s.url),
    snapshot_id: probe.snapshot_id,
    model_version: profile.model_version,
  };
}
