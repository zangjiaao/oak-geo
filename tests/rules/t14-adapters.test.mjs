import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelRequest,
  parseModelResponse,
  planProbeManifest,
} from "../../src/server/api/model-adapters.mjs";
import {
  createModelTransport,
  ModelTransportError,
} from "../../src/server/api/model-transport.mjs";
import { runProbeAdapterBatch } from "../../src/server/jobs/probe-adapter-batch.mjs";
import {
  modelCandidates,
  productionModelCapabilities,
} from "../../src/server/api/probe-model-candidates.mjs";

const profiles = ["qwen", "doubao", "deepseek", "hunyuan"].map((provider) => ({
  provider,
  model: provider === "deepseek" ? "deepseek-v4-pro" : `fixture-${provider}`,
  model_version: "fixture-version-1",
  workspace_id: "fixture-space",
}));
const probe = (profile = profiles[0], extra = {}) => ({
  tenant_id: "tenant-1",
  batch_id: "batch-1",
  snapshot_id: "snapshot-1",
  cluster_id: "cluster-1",
  question_id: "question-1",
  question: "工具怎么选？",
  model: profile.model,
  model_version: profile.model_version,
  temperature: 0,
  round: 1,
  grounding_mode: "search_on",
  ...extra,
});
const completion = (content = "公开回答", extra = {}) => ({
  model: profiles[1].model,
  choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
  ...extra,
});
const controls = () => {
  const records = [];
  return {
    records,
    async reserve(context) {
      records.push({ phase: "reserve", ...context });
      return "ticket-1";
    },
    async settle(ticket, outcome) {
      records.push({ phase: "settle", ticket, ...outcome });
    },
  };
};
function batchManifest() {
  const snapshot = {
    snapshot_id: "snapshot-1",
    frozen: true,
    model_set: profiles.map((p) => p.model),
    model_version_manifest: Object.fromEntries(
      profiles.map((p) => [p.model, p.model_version]),
    ),
    temperature_set: [0, 0.7],
    rounds: 3,
    grounding_mode: "search_on",
  };
  const questions = ["a", "b", "c"].map((id) => ({
    id,
    question: id,
    cluster_id: "cluster-1",
    question_pool_version: 1,
  }));
  return planProbeManifest({
    tenant_id: "tenant-1",
    batch_id: "batch-1",
    snapshot,
    questions,
    cluster_question_sets: [
      {
        cluster_id: "cluster-1",
        question_pool_version: 1,
        question_ids: questions.map((q) => q.id),
      },
    ],
  });
}

test("T14 四家联网开关正确，温度0与轮次保留，记忆轨显式禁用搜索", () => {
  for (const p of profiles) {
    const on = buildModelRequest(p, probe(p)),
      off = buildModelRequest(p, probe(p, { grounding_mode: "search_off" }));
    const body = on.body.parameters ?? on.body,
      memory = off.body.parameters ?? off.body;
    assert.equal(body.temperature, 0);
    assert.equal(on.context.round, 1);
    assert.equal(on.context.snapshot_id, "snapshot-1");
    const message =
      on.body.input?.messages?.[0] ??
      on.body.input?.[0] ??
      on.body.messages?.[0];
    assert.equal(message.role, "user");
    assert.equal(message.content, "工具怎么选？");
    assert.equal(on.body.stream ?? false, false);
    if (p.provider === "qwen") {
      assert.equal(body.enable_search, true);
      assert.equal(memory.enable_search, false);
      assert.equal(body.search_options.enable_source, true);
      assert.equal(body.search_options.citation_format, "[ref_<number>]");
      assert.ok(
        on.url.endsWith("/api/v1/services/aigc/text-generation/generation"),
      );
    } else if (p.provider === "doubao") {
      assert.deepEqual(body.web_search_options, {});
      assert.equal(Object.hasOwn(memory, "web_search_options"), false);
      assert.equal(Object.hasOwn(body, "tools"), false);
    } else if (p.provider === "deepseek") {
      assert.equal(body.tools[0].type, "web_search");
      assert.deepEqual(memory.tools, []);
      assert.equal(memory.tool_choice, "none");
      assert.equal(body.reasoning.effort, "none");
    } else {
      assert.equal(body.web_search_options.enable, true);
      assert.equal(Object.hasOwn(memory, "web_search_options"), false);
      assert.match(on.url, /^https:\/\/tokenhub\.tencentmaas\.com\//);
    }
    assert.equal(JSON.stringify(on).includes("apiKey"), false);
  }
});

test("T14 不猜温度、轨道、轮次、版本或Qwen地域，不接受请求覆盖协议参数", () => {
  for (const extra of [
    { temperature: undefined },
    { temperature: 1 },
    { grounding_mode: "auto" },
    { round: 0 },
    { round: 1.5 },
    { round: 4 },
    { model_version: "changed" },
    { model: "other" },
    { grounding_mode: "search_off", temperature: 0.7 },
  ])
    assert.throws(() =>
      buildModelRequest(profiles[0], probe(profiles[0], extra)),
    );
  assert.throws(() =>
    buildModelRequest(
      { ...profiles[0], workspace_id: "evil.example/steal" },
      probe(),
    ),
  );
  const result = buildModelRequest(
    profiles[1],
    probe(profiles[1], {
      tools: ["injected"],
      system_prompt: "injected",
      endpoint: "https://evil.example",
    }),
  );
  assert.equal(Object.hasOwn(result.body, "tools"), false);
  assert.equal(result.body.messages.length, 1);
});

test("T14 72/36清单完全来自冻结快照，未知版本、未冻结、重复问句或缺问句拒绝", () => {
  const snapshot = {
    snapshot_id: "s",
    frozen: true,
    model_set: profiles.map((p) => p.model),
    model_version_manifest: Object.fromEntries(
      profiles.map((p) => [p.model, p.model_version]),
    ),
    temperature_set: [0, 0.7],
    rounds: 3,
    grounding_mode: "search_on",
  };
  const sets = [
    {
      cluster_id: "c",
      question_pool_version: 1,
      question_ids: ["q1", "q2", "q3"],
    },
  ];
  const questions = sets[0].question_ids.map((id) => ({
    id,
    cluster_id: "c",
    question_pool_version: 1,
    question: "公开问句",
  }));
  const args = {
    tenant_id: "t",
    batch_id: "b",
    snapshot,
    cluster_question_sets: sets,
    questions,
  };
  const on = planProbeManifest(args);
  assert.equal(on.length, 72);
  assert.equal(
    new Set(
      on.map((p) =>
        JSON.stringify([p.question_id, p.model, p.temperature, p.round]),
      ),
    ).size,
    72,
  );
  assert.equal(
    planProbeManifest({
      ...args,
      snapshot: {
        ...snapshot,
        grounding_mode: "search_off",
        temperature_set: [0],
      },
    }).length,
    36,
  );
  for (const invalid of [
    { ...snapshot, frozen: false },
    { ...snapshot, rounds: 2 },
    { ...snapshot, model_version_manifest: {} },
    { ...snapshot, model_set: snapshot.model_set.slice(1) },
  ])
    assert.throws(() => planProbeManifest({ ...args, snapshot: invalid }));
  assert.throws(() =>
    planProbeManifest({ ...args, questions: questions.slice(1) }),
  );
  assert.throws(() =>
    planProbeManifest({
      ...args,
      cluster_question_sets: [{ ...sets[0], question_ids: ["q1", "q1", "q3"] }],
    }),
  );
  assert.throws(() =>
    planProbeManifest({
      ...args,
      questions: questions.map((q) => ({ ...q, question_pool_version: 2 })),
    }),
  );
});

test("T14 引用只取已引用元数据与正文链接，不把检索候选、图标或域名弱命中当引用", () => {
  const qwen = {
    request_id: "r",
    output: {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "事实[ref_1]。见 https://docs.example/p?q=1#part 。",
          },
        },
      ],
      search_info: {
        search_results: [
          { index: 1, url: "https://brand.example/a?keep=1#x" },
          { index: 2, url: "https://uncited.example/b" },
        ],
      },
    },
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
  };
  const r = parseModelResponse(profiles[0], probe(), qwen);
  assert.deepEqual(r.cited_urls, [
    "https://brand.example/a?keep=1#x",
    "https://docs.example/p?q=1#part",
  ]);
  assert.deepEqual(r.cited_domains, ["brand.example", "docs.example"]);
  assert.equal(r.raw_answer, qwen.output.choices[0].message.content);
  assert.equal(r.search_results.length, 2);
  assert.equal(r.search_enabled, true);
  assert.equal(r.search_call_count, null);
  assert.equal(r.refused, false);
  assert.equal(r.refusal_review_required, true);
  const h = parseModelResponse(
    profiles[3],
    probe(profiles[3]),
    completion("事实[1]", {
      model: profiles[3].model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "事实[1]",
            search_results: [
              { index: 1, url: "https://brand.example/a" },
              { index: 2, url: "https://uncited.example" },
            ],
          },
        },
      ],
      usage: { tool_usage: { web_search_call: 0 } },
    }),
  );
  assert.deepEqual(h.cited_urls, ["https://brand.example/a"]);
  assert.equal(h.search_call_count, 0);
  const d = parseModelResponse(profiles[2], probe(profiles[2]), {
    status: "completed",
    model: profiles[2].model,
    output: [
      {
        type: "web_search_call",
        status: "completed",
        action: { sources: [{ url: "https://unused.example" }] },
      },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "明确引用",
            annotations: [
              { type: "url_citation", url: "https://brand.example/a" },
            ],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      server_tool_use: { tool_search: 1, tool_fetch: 0 },
    },
  });
  assert.deepEqual(d.cited_urls, ["https://brand.example/a"]);
  assert.equal(d.search_call_count, 1);
});

test("T14 豆包引用标注与Markdown/裸链接去重，保留完整URL；危险协议与凭证URL排除", () => {
  const answer =
    "[来源](https://brand.example/a_(b)?q=1#f) https://brand.example/a_(b)?q=1#f。 <https://other.example/p> [x](javascript:alert(1)) https://user:pass@private.example/";
  const r = parseModelResponse(
    profiles[1],
    probe(profiles[1]),
    completion(answer, {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: answer,
            annotations: [
              {
                type: "url_citation",
                url_citation: { url: "https://brand.example/a_(b)?q=1#f" },
              },
              {
                type: "url_citation",
                url_citation: { url: "file:///etc/passwd" },
              },
            ],
          },
        },
      ],
      usage: { tool_usage: { web_search: 2 } },
    }),
  );
  assert.deepEqual(r.cited_urls, [
    "https://brand.example/a_(b)?q=1#f",
    "https://other.example/p",
  ]);
  assert.equal(r.search_call_count, 2);
});

test("T14 原生安全拦截可识别；语义拒答留T16；截断/空答/工具调用/版本漂移不能冒充完整回答", () => {
  const p = profiles[1],
    request = probe(p);
  const blocked = parseModelResponse(
    p,
    request,
    completion(null, {
      choices: [
        { finish_reason: "content_filter", message: { content: null } },
      ],
    }),
  );
  assert.equal(blocked.refused, true);
  assert.equal(blocked.refusal_review_required, false);
  assert.equal(blocked.raw_answer, "");
  const uncertain = parseModelResponse(
    p,
    request,
    completion("抱歉，我不知道。"),
  );
  assert.equal(uncertain.refused, false);
  assert.equal(uncertain.refusal_review_required, true);
  for (const finish_reason of ["length", "tool_calls", undefined])
    assert.throws(() =>
      parseModelResponse(
        p,
        request,
        completion("片段", {
          choices: [{ finish_reason, message: { content: "片段" } }],
        }),
      ),
    );
  assert.throws(() => parseModelResponse(p, request, completion("")));
  assert.throws(() =>
    parseModelResponse(
      p,
      request,
      completion("正常", { model: "unexpected-version" }),
    ),
  );
});

test("T14 未审批模型清单无法在生产取得能力或发起真实调用", () => {
  assert.equal(modelCandidates.length, 4);
  assert.equal(new Set(modelCandidates.map((c) => c.provider)).size, 4);
  for (const c of modelCandidates) {
    assert.equal(c.status, "candidate");
    assert.equal(productionModelCapabilities(c.model, "search_on"), null);
    assert.equal(productionModelCapabilities(c.model, "search_off"), null);
  }
  assert.equal(productionModelCapabilities("fixture-qwen", "search_on"), null);
});

test("T14 传输先保留probe配额/限流许可，后调用且仅一次，结算保留token细粒度与批次身份", async () => {
  const control = controls();
  let calls = 0;
  const transport = createModelTransport({
    control,
    fetch: async (url, options) => {
      calls++;
      assert.equal(control.records[0].phase, "reserve");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fixture-key");
      assert.equal(JSON.parse(options.body).temperature, 0);
      return Response.json(completion());
    },
  });
  const result = await transport.invoke(profiles[1], probe(profiles[1]), {
    apiKey: "fixture-key",
    attempt_no: 1,
  });
  assert.equal(calls, 1);
  assert.equal(result.raw_answer, "公开回答");
  assert.equal(control.records[0].operation_type, "probe");
  assert.equal(control.records[0].tenant_id, "tenant-1");
  assert.equal(control.records[0].batch_id, "batch-1");
  assert.equal(control.records[1].usage.total_tokens, 17);
  assert.equal(control.records[1].outcome, "completed");
  assert.equal(JSON.stringify(control.records).includes("fixture-key"), false);
  assert.equal(JSON.stringify(control.records).includes("公开回答"), false);
});

test("T14 配额或限流拒绝时零外部调用，缺控制器、凭证或合法批次身份时拒绝", async () => {
  let calls = 0;
  assert.throws(() => createModelTransport({ fetch: async () => calls++ }));
  const transport = createModelTransport({
    fetch: async () => calls++,
    control: {
      ...controls(),
      reserve: async () => {
        throw new Error("quota_exceeded");
      },
    },
  });
  await assert.rejects(
    () =>
      transport.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    /quota_exceeded/,
  );
  const normal = createModelTransport({
    fetch: async () => calls++,
    control: controls(),
  });
  for (const credentials of [
    { apiKey: "", attempt_no: 1 },
    { apiKey: "fixture-key", attempt_no: 0 },
  ])
    await assert.rejects(() =>
      normal.invoke(profiles[1], probe(profiles[1]), credentials),
    );
  await assert.rejects(() =>
    normal.invoke(profiles[1], probe(profiles[1], { batch_id: "" }), {
      apiKey: "fixture-key",
      attempt_no: 1,
    }),
  );
  assert.equal(calls, 0);
});

test("T14 429/5xx/超时交由整批重试，错误不泄漏供应商正文、问题或key；未知耗量为null", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const control = controls();
    let calls = 0;
    const transport = createModelTransport({
      control,
      fetch: async () => {
        calls++;
        return new Response("fixture-key 敏感回答", {
          status,
          headers: { "Retry-After": "7" },
        });
      },
    });
    await assert.rejects(
      () =>
        transport.invoke(profiles[1], probe(profiles[1]), {
          apiKey: "fixture-key",
          attempt_no: 1,
        }),
      (e) => {
        assert.ok(e instanceof ModelTransportError);
        assert.equal(e.retryable, status === 429 || status >= 500);
        assert.equal(e.retry_after_ms, 7000);
        assert.doesNotMatch(
          JSON.stringify(e),
          /fixture-key|敏感回答|工具怎么选/,
        );
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.equal(control.records[1].usage, null);
  }
  const control = controls();
  const transport = createModelTransport({
    control,
    timeoutMs: 10,
    fetch: async (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("fixture-key")),
          { once: true },
        ),
      ),
  });
  await assert.rejects(
    () =>
      transport.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    (e) => e.retryable && e.code === "provider_timeout",
  );
  assert.equal(control.records.length, 2);
});

test("T14 非JSON、超大响应、响应版本变化拒绝；记忆轨返回实际搜索证据则拒绝", async () => {
  for (const [response, maxResponseBytes] of [
    [() => new Response("not-json"), 2048],
    [() => Response.json(completion("too long")), 10],
    [() => Response.json(completion("完整", { model: "changed" })), 2048],
    [
      () =>
        Response.json(
          completion("不该联网", { usage: { tool_usage: { web_search: 1 } } }),
        ),
      2048,
    ],
  ]) {
    const control = controls();
    const transport = createModelTransport({
      control,
      maxResponseBytes,
      fetch: async () => response(),
    });
    await assert.rejects(() =>
      transport.invoke(
        profiles[1],
        probe(profiles[1], { grounding_mode: "search_off" }),
        { apiKey: "fixture-key", attempt_no: 1 },
      ),
    );
    assert.equal(control.records[1].outcome, "failed");
  }
});

test("T14 批次失败重跑全部项，丢弃前次成功片段；退避遵守Retry-After且不部分补采", async () => {
  const calls = [],
    waits = [],
    discards = [];
  let dead = 0;
  const items = batchManifest();
  const result = await runProbeAdapterBatch({
    items,
    invoke: async (item, attempt) => {
      calls.push([item.question_id, attempt]);
      if (calls.length === 2)
        throw new ModelTransportError("provider_rate_limited", true, 2000);
      return `${attempt}:${item.question_id}`;
    },
    discardAttempt: async (n) => discards.push(n),
    onDeadLetter: async () => dead++,
    onAlert: async () => dead++,
    wait: async (ms) => waits.push(ms),
  });
  assert.deepEqual(calls.slice(0, 3), [
    ["a", 1],
    ["a", 1],
    ["a", 2],
  ]);
  assert.equal(calls.length, 74);
  assert.equal(result.results.length, 72);
  assert.ok(result.results.every((r) => r.startsWith("2:")));
  assert.deepEqual(discards, [1]);
  assert.deepEqual(waits, [2000]);
  assert.equal(dead, 0);
});

test("T14 整批最多重试3次，耗尽必须dead-letter+告警；非重试错误一次失败", async () => {
  for (const retryable of [true, false]) {
    let n = 0;
    const discarded = [],
      waits = [],
      notifications = [];
    const r = await runProbeAdapterBatch({
      items: batchManifest(),
      invoke: async () => {
        n++;
        throw new ModelTransportError("provider_failed", retryable);
      },
      discardAttempt: async (attempt) => discarded.push(attempt),
      onDeadLetter: async (e) => notifications.push(e),
      onAlert: async (e) => notifications.push(e),
      wait: async (ms) => waits.push(ms),
    });
    assert.equal(n, retryable ? 4 : 1);
    assert.equal(r.results, null);
    assert.equal(discarded.length, n);
    assert.equal(notifications.length, 2);
    assert.deepEqual(waits, retryable ? [1000, 2000, 4000] : []);
    assert.equal(JSON.stringify(notifications).includes("raw_answer"), false);
    assert.equal(notifications[0].batch_id, "batch-1");
  }
  await assert.rejects(() =>
    runProbeAdapterBatch({ items: [1], invoke: async () => 1 }),
  );
});

test("T14 DeepSeek只允许保留温度的标准Responses路径，不接受flash或新联网工具的隐式替换", () => {
  const p = profiles[2];
  assert.throws(() =>
    buildModelRequest(
      { ...p, model: "deepseek-flash" },
      probe({ ...p, model: "deepseek-flash" }),
    ),
  );
  const r = buildModelRequest(
    p,
    probe(p, { temperature: 0.7, tools: [{ type: "deepseek_web_search" }] }),
  );
  assert.deepEqual(r.body.tools, [{ type: "web_search" }]);
  assert.equal(r.body.temperature, 0.7);
  assert.equal(r.body.reasoning.effort, "none");
  assert.throws(() =>
    parseModelResponse(p, probe(p), {
      model: p.model,
      status: "completed",
      temperature: 1,
      output: [],
    }),
  );
  assert.throws(() =>
    buildModelRequest(
      { provider: "dots", model: "dots3-note-prev", model_version: "invented" },
      probe({ model: "dots3-note-prev", model_version: "invented" }),
    ),
  );
});

test("T14 HTTP200内嵌错误仍失败并结算实际用量；持久结算失败禁止交付回答", async () => {
  const control = controls();
  const transport = createModelTransport({
    control,
    fetch: async () =>
      Response.json({
        error: { code: "server_error", message: "敏感内容" },
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      }),
  });
  await assert.rejects(
    () =>
      transport.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    (e) => e.code === "provider_response_error" && e.retryable,
  );
  assert.equal(control.records[1].usage.total_tokens, 13);
  const unavailable = createModelTransport({
    control: {
      ...controls(),
      settle: async () => {
        throw new Error("secret");
      },
    },
    fetch: async () => Response.json(completion()),
  });
  await assert.rejects(
    () =>
      unavailable.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    (e) => e.code === "probe_metering_unavailable" && !e.retryable,
  );
});

test("T14 Retry-After日期与正文读取超时可控；未声明用量不补0", async () => {
  const control = controls(),
    instant = Date.parse("2026-11-15T00:00:00Z");
  const limited = createModelTransport({
    control,
    now: () => instant,
    fetch: async () =>
      new Response("", {
        status: 429,
        headers: { "retry-after": "Sun, 15 Nov 2026 00:00:03 GMT" },
      }),
  });
  await assert.rejects(
    () =>
      limited.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    (e) => e.retry_after_ms === 3000,
  );
  let cancelled = false;
  const stalled = createModelTransport({
    control: controls(),
    timeoutMs: 10,
    fetch: async (_url, { signal }) => {
      const stream = new ReadableStream({
        start(c) {
          signal.addEventListener(
            "abort",
            () => {
              cancelled = true;
              c.error(new Error("aborted"));
            },
            { once: true },
          );
        },
      });
      return new Response(stream);
    },
  });
  await assert.rejects(
    () =>
      stalled.invoke(profiles[1], probe(profiles[1]), {
        apiKey: "fixture-key",
        attempt_no: 1,
      }),
    (e) => e.code === "provider_timeout",
  );
  assert.equal(cancelled, true);
  const r = parseModelResponse(
    profiles[1],
    probe(profiles[1]),
    completion("回答", { usage: { prompt_tokens: 4 } }),
  );
  assert.equal(r.usage.output_tokens, null);
  assert.equal(r.usage.total_tokens, null);
});

test("T14 未丢弃失败批次不得重跑，dead-letter失败仍尝试告警；伪造的半批清单拒绝", async () => {
  let invokes = 0,
    alerts = 0;
  const base = {
    items: batchManifest(),
    invoke: async () => {
      invokes++;
      throw new ModelTransportError("provider_failed", true);
    },
    discardAttempt: async () => {
      throw new Error("discard unavailable");
    },
    onDeadLetter: async () => {},
    onAlert: async () => {},
    wait: async () => {},
  };
  await assert.rejects(() => runProbeAdapterBatch(base), /discard unavailable/);
  assert.equal(invokes, 1);
  await assert.rejects(() =>
    runProbeAdapterBatch({ ...base, items: [...base.items].slice(1) }),
  );
  await assert.rejects(
    () =>
      runProbeAdapterBatch({
        ...base,
        invoke: async () => {
          throw new ModelTransportError("provider_failed");
        },
        discardAttempt: async () => {},
        onDeadLetter: async () => {
          throw new Error("DL unavailable");
        },
        onAlert: async () => alerts++,
      }),
    /notification failed/,
  );
  assert.equal(alerts, 1);
});

test("T14 已知忽略温度的豆包旧型号在调用前拒绝", () => {
  for (const model of [
    "doubao-seed-2-0-pro-260215",
    "doubao-seed-2-0-lite-260215",
  ]) {
    const p = { ...profiles[1], model };
    assert.throws(() => buildModelRequest(p, probe(p)));
  }
});

test("T14 等待许可期间调用方变更对象，不得改变已编译请求对应的快照版本", async () => {
  const p = { ...profiles[1] },
    input = probe(p),
    control = controls();
  const transport = createModelTransport({
    control: {
      ...control,
      reserve: async (context) => {
        p.model_version = "changed-v2";
        input.model_version = "changed-v2";
        input.snapshot_id = "changed-snapshot";
        return control.reserve(context);
      },
    },
    fetch: async () => Response.json(completion()),
  });
  const result = await transport.invoke(p, input, {
    apiKey: "fixture-key",
    attempt_no: 1,
  });
  assert.equal(result.model_version, "fixture-version-1");
  assert.equal(result.snapshot_id, "snapshot-1");
});
