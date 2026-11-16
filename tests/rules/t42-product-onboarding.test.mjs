import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProductInput,
  validateResearchOutput,
} from "../../src/server/api/product-profile.mjs";
import { createProductResearchAgent } from "../../src/server/api/product-research-agent.mjs";

const input = {
  name: "okdata",
  website: "https://okdata.online/",
  description: "社媒数据 API",
  audience: "开发者",
  official_urls: ["https://okdata.online/docs"],
  notes: "",
};

test("T42 产品资料与研究结果只能引用实际取得的来源，外部描述不能冒充官方事实", () => {
  assert.equal(validateProductInput(input).name, "okdata");
  for (const url of [
    "http://127.0.0.1",
    "https://localhost",
    "file:///tmp/key",
    "https://user:pass@example.com",
    "https://example.com/?api_key=secret",
  ])
    assert.throws(() => validateProductInput({ ...input, website: url }));
  const sources = [
    {
      id: "s1",
      url: "https://okdata.online/docs",
      text: "失败的请求不扣费",
      collected_at: "2026-11-16T00:00:00Z",
      official: true,
    },
  ];
  const result = {
    facts: [
      {
        category: "service_promise",
        text: "失败的请求不扣费",
        evidence: [{ source_id: "s1", quote: "失败的请求不扣费" }],
      },
    ],
    conflicts: [],
    unknowns: ["需确认超时的边界"],
    summary: "提供数据接口",
  };
  assert.equal(validateResearchOutput(result, sources).facts.length, 1);
  assert.throws(() =>
    validateResearchOutput(
      {
        ...result,
        facts: [
          {
            ...result.facts[0],
            evidence: [{ source_id: "invented", quote: "免费" }],
          },
        ],
      },
      sources,
    ),
  );
  assert.throws(() =>
    validateResearchOutput(
      {
        ...result,
        facts: [
          {
            ...result.facts[0],
            evidence: [{ source_id: "s1", quote: "永久免费" }],
          },
        ],
      },
      sources,
    ),
  );
});

test("T42 Agent 使用 AI SDK 工具调查，缺凭证不假装完成，不允许伪造来源或无限工具调用", async () => {
  await assert.rejects(
    () => createProductResearchAgent({}).run(input),
    /DEEPSEEK_API_KEY/,
  );
  let called = 0;
  const fakeFetch = async (url) => {
    called++;
    assert.equal(new URL(url).origin, "https://api.deepseek.com");
    return Response.json({ title: "文档", content: "失败的请求不扣费" });
  };
  const agent = createProductResearchAgent({
    apiKey: "test-only",
    fetch: fakeFetch,
    generate: async (options) => {
      assert.match(options.system, /不可信/);
      const page = await options.tools.read_page.execute({
        url: "https://okdata.online/docs",
      });
      await options.tools.search_sources.execute({ query: "okdata 官方资料" });
      return {
        text: JSON.stringify({
          summary: "社媒 API",
          facts: [
            {
              category: "service_promise",
              text: "失败的请求不扣费",
              evidence: [{ source_id: page.id, quote: "失败的请求不扣费" }],
            },
          ],
          conflicts: [],
          unknowns: [],
        }),
        totalUsage: { inputTokens: 10, outputTokens: 20 },
        response: { modelId: "recorded-model" },
      };
    },
  });
  const result = await agent.run(input);
  assert.equal(called, 2);
  assert.equal(
    result.facts[0].evidence[0].source_id,
    result.sources.find((s) => s.kind === "page").id,
  );
  assert.ok(result.agent_run_id);
  assert.ok(result.prompt_version);
  assert.equal(result.model, "recorded-model");
});

import { startRuntimeEnvironment } from "../support/runtime-environment.mjs";
import { createFixtureRegistry } from "../support/fixture-registry.mjs";
import { createProductOnboardingTransport } from "../../src/server/api/product-onboarding-http.mjs";

const recordedAgent = {
  configured: true,
  model: "recorded-deepseek",
  prompt_version: "product_facts_v1",
  run: async (raw, { runId }) => {
    const sources = [
      {
        id: "s1",
        url: raw.website || null,
        text: raw.description,
        title: "用户提供",
        kind: raw.website ? "page" : "user_input",
        official: Boolean(raw.website),
        collected_at: "2026-11-16T00:00:00Z",
      },
    ];
    return {
      ...validateResearchOutput(
        {
          facts: [
            {
              category: "spec",
              text: raw.description,
              evidence: [{ source_id: "s1", quote: raw.description }],
            },
          ],
          summary: "产品信息",
          conflicts: [],
          unknowns: [],
        },
        sources,
      ),
      sources,
      trace: [],
      usage: { input_tokens: 10, output_tokens: 20 },
      agent_run_id: runId,
      prompt_version: "product_facts_v1",
      model: "recorded-deepseek",
    };
  },
};
test("T42 当前资料保存、调查、确认与独立放行；知识持续可读且无资料版本", async () => {
  const env = await startRuntimeEnvironment({
    productResearchAgent: recordedAgent,
  });
  try {
    const f = await createFixtureRegistry(env.application).fixture(
        "seed-input",
      ),
      params = { tid: f.tenant_id, bid: f.brand_id };
    const call = (id, actor, body = {}, key) =>
      env.application.call(
        id,
        { actor, params, body },
        { idempotencyKey: key },
      );
    for (const role of ["editor", "viewer"])
      assert.equal(
        (await call("product_profile.save", f.actors[role], { input })).status,
        403,
      );
    let r = await call(
      "product_profile.save",
      f.actors.owner,
      { input },
      "save1",
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    const profileId = r.data.id;
    r = await call("product_profile.save", f.actors.owner, { input }, "save1");
    assert.equal(r.data.id, profileId);
    assert.equal("version" in r.data, false);
    const transport = createProductOnboardingTransport(async () => ({
      application: env.application,
      productResearchAgent: recordedAgent,
      close: async () => {},
    }));
    const make = () =>
      new Request(
        `https://geo.example/api/tenants/${f.tenant_id}/brands/${f.brand_id}/product-profile/investigate`,
        {
          method: "POST",
          headers: {
            cookie: "geo_session=" + f.actors.owner.credential,
            origin: "https://geo.example",
            "idempotency-key": "research1",
          },
          body: "{}",
        },
      );
    let response = await transport(make());
    r = await response.json();
    assert.equal(response.status, 200, JSON.stringify(r));
    assert.equal(r.data.run.error, null);
    const fact = r.data.profile.research.facts[0];
    r = await call(
      "product_profile.confirm",
      f.actors.owner,
      { facts: [{ id: fact.id, text: input.description }] },
      "confirm1",
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    const official = r.data.knowledge[0].official_fact_id;
    assert.equal(
      (
        await env.application.call("official_fact.approve", {
          actor: f.actors.owner,
          params: { ...params, id: official },
          body: {},
        })
      ).status,
      403,
    );
    const approved = await env.application.call("official_fact.approve", {
      actor: f.actors.factcheck,
      params: { ...params, id: official },
      body: {},
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    const saved = await call("product_profile.read", f.actors.viewer);
    assert.equal(saved.data.knowledge.facts.length, 1);
    assert.equal(saved.data.reviews[0].status, "approved");
    assert.equal("history" in saved.data, false);
    r = await call("product_profile.save", f.actors.owner, {
      input: { ...input, description: "当前新描述" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.id, profileId);
    const changed = await call("product_profile.read", f.actors.owner);
    assert.equal(changed.data.research_stale, true);
    assert.equal(changed.data.knowledge.facts[0].text, input.description);
    assert.equal(
      (
        await call("product_profile.claim", f.actors.owner, {
          run_id: profileId,
        })
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});
test("T42 未配置、跨品牌、请求重放与调查中资料变化不会产生伪事实", async () => {
  let runner,
    attempts = 0;
  const agent = {
    ...recordedAgent,
    run: async (...args) => {
      attempts++;
      return runner(...args);
    },
  };
  const env = await startRuntimeEnvironment({ productResearchAgent: agent });
  try {
    const registry = createFixtureRegistry(env.application),
      f = await registry.fixture("seed-input"),
      other = await registry.fixture("seed-input"),
      params = { tid: f.tenant_id, bid: f.brand_id };
    const call = (id, body = {}) =>
      env.application.call(id, { actor: f.actors.owner, params, body });
    assert.equal((await call("product_profile.save", { input })).status, 200);
    assert.equal(
      (
        await env.application.call("product_profile.read", {
          actor: other.actors.owner,
          params,
        })
      ).status,
      403,
    );
    runner = async (raw, options) => {
      assert.equal(
        (
          await call("product_profile.save", {
            input: { ...input, description: "调查期间更新" },
          })
        ).status,
        200,
      );
      return recordedAgent.run(raw, options);
    };
    const transport = createProductOnboardingTransport(async () => ({
      application: env.application,
      productResearchAgent: agent,
      close: async () => {},
    }));
    const make = () =>
      new Request(
        `https://geo.example/api/tenants/${f.tenant_id}/brands/${f.brand_id}/product-profile/investigate`,
        {
          method: "POST",
          headers: {
            cookie: "geo_session=" + f.actors.owner.credential,
            origin: "https://geo.example",
            "idempotency-key": "same-run",
          },
          body: "{}",
        },
      );
    let response = await transport(make()),
      payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.match(payload.data.run.error, /资料.*更新/);
    assert.equal(payload.data.profile.research, null);
    response = await transport(make());
    assert.equal(response.status, 200);
    assert.equal(attempts, 1);
    assert.equal(
      (
        await call("product_profile.confirm", {
          facts: [{ id: "invented", text: "没有证据" }],
        })
      ).status,
      422,
    );
  } finally {
    await env.close();
  }
  const env2 = await startRuntimeEnvironment({
    productResearchAgent: { configured: false },
  });
  try {
    const f = await createFixtureRegistry(env2.application).fixture(
        "seed-input",
      ),
      params = { tid: f.tenant_id, bid: f.brand_id };
    assert.equal(
      (
        await env2.application.call("product_profile.save", {
          actor: f.actors.owner,
          params,
          body: { input },
        })
      ).status,
      200,
    );
    const r = await env2.application.call("product_profile.investigate", {
      actor: f.actors.owner,
      params,
      body: {},
    });
    assert.equal(r.status, 422);
    assert.equal(r.error.details.reason, "research_not_configured");
  } finally {
    await env2.close();
  }
});
test("T42 真实AI SDK + DeepSeek适配器执行工具往返，保留模型与token用量", async () => {
  let modelCalls = 0,
    toolCalls = 0;
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/tools/fetch")) {
      toolCalls++;
      return Response.json({ title: "官方文档", content: "失败不扣费" });
    }
    if (path.endsWith("/tools/search")) {
      toolCalls++;
      return Response.json({ results: [] });
    }
    assert.equal(path, "/chat/completions");
    modelCalls++;
    const request = JSON.parse(init.body);
    assert.equal(request.model, "deepseek-v4-flash");
    const message =
      modelCalls === 1
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "read1",
                type: "function",
                function: {
                  name: "read_page",
                  arguments: JSON.stringify({ url: input.website }),
                },
              },
              {
                id: "search1",
                type: "function",
                function: {
                  name: "search_sources",
                  arguments: JSON.stringify({ query: "okdata 官方文档" }),
                },
              },
            ],
          }
        : {
            role: "assistant",
            content: JSON.stringify({
              summary: "社媒API",
              facts: [
                {
                  category: "service_promise",
                  text: "失败不扣费",
                  evidence: [{ source_id: "source-1", quote: "失败不扣费" }],
                },
              ],
              conflicts: [],
              unknowns: [],
            }),
          };
    return Response.json({
      id: "recorded-" + modelCalls,
      object: "chat.completion",
      created: 1794787200,
      model: "deepseek-v4-flash",
      choices: [
        {
          index: 0,
          message,
          finish_reason: modelCalls === 1 ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  };
  const result = await createProductResearchAgent({
    apiKey: "test-only",
    fetch: fetcher,
  }).run(input);
  assert.equal(modelCalls, 2);
  assert.equal(toolCalls, 2);
  assert.equal(result.facts.length, 1);
  assert.equal(result.usage.input_tokens, 20);
  assert.equal(result.usage.output_tokens, 40);
});

test("T42 只填品牌名称与描述即可开始；当前资料直接维护，不提供版本或历史接口", async () => {
  const minimal = validateProductInput({
    name: "okdata",
    description: "社媒数据API",
    website: "",
    audience: "",
    notes: "",
    official_urls: [],
  });
  assert.equal(minimal.website, "");
  const env = await startRuntimeEnvironment({
    productResearchAgent: { configured: false },
  });
  try {
    const f = await createFixtureRegistry(env.application).fixture(
        "seed-input",
      ),
      params = { tid: f.tenant_id, bid: f.brand_id };
    const call = (id, body = {}) =>
      env.application.call(id, { actor: f.actors.owner, params, body });
    let saved = await call("product_profile.save", { input: minimal });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    saved = await call("product_profile.save", {
      input: { ...minimal, description: "更新后的品牌描述" },
    });
    assert.equal(saved.status, 200);
    const read = await call("product_profile.read");
    assert.equal(read.data.profile.input.description, "更新后的品牌描述");
    assert.equal("version" in read.data.profile, false);
    assert.equal("history" in read.data, false);
    assert.equal(read.data.profile.input.description, "更新后的品牌描述");
  } finally {
    await env.close();
  }
});

test("T42 Agent发现的网页须Owner明确确认出处；审计失败回滚，同人换角色仍不能放行", async () => {
  let fail = false;
  const env = await startRuntimeEnvironment({
    productResearchAgent: recordedAgent,
    beforeAudit: (event) => {
      if (fail && event.action === "official_fact.create")
        throw new Error("injected audit failure");
    },
  });
  try {
    const f = await createFixtureRegistry(env.application).fixture(
        "seed-input",
      ),
      params = { tid: f.tenant_id, bid: f.brand_id };
    const invoke = (id, actor, body = {}) =>
      env.application.call(id, { actor, params, body });
    assert.equal(
      (
        await invoke("product_profile.save", f.actors.owner, {
          input: { name: "okdata", description: "社媒数据API" },
        })
      ).status,
      200,
    );
    const reserved = await invoke(
        "product_profile.investigate",
        f.actors.owner,
      ),
      runId = reserved.data.id;
    const job = env.application.issueActor({
      user_id: "job-research",
      tenant_id: f.tenant_id,
      role: "system",
      actor_type: "system",
      job_name: "product_research",
      trigger_source: { event_id: runId },
    });
    assert.equal(
      (await invoke("product_profile.claim", job, { run_id: runId })).status,
      200,
    );
    const result = {
      agent_run_id: runId,
      prompt_version: "product_facts_v1",
      model: "recorded-deepseek",
      sources: [
        {
          id: "found",
          url: "https://example.com/docs",
          text: "支持评论查询",
          title: "检索发现的文档",
          kind: "page",
          collected_at: "2026-11-16T00:00:00Z",
        },
      ],
      facts: [
        {
          category: "spec",
          text: "支持评论查询",
          evidence: [{ source_id: "found", quote: "支持评论查询" }],
        },
      ],
      summary: "产品资料",
      conflicts: [],
      unknowns: [],
      trace: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    assert.equal(
      (await invoke("product_profile.finish", job, { run_id: runId, result }))
        .status,
      200,
    );
    let read = await invoke("product_profile.read", f.actors.owner),
      fact = read.data.profile.research.facts[0];
    const body = { facts: [{ id: fact.id, text: fact.text }] };
    assert.equal(
      (await invoke("product_profile.confirm", f.actors.owner, body)).status,
      422,
    );
    body.official_source_ids = ["found"];
    fail = true;
    assert.equal(
      (await invoke("product_profile.confirm", f.actors.owner, body)).status,
      500,
    );
    read = await invoke("product_profile.read", f.actors.owner);
    assert.equal(read.data.knowledge.facts.length, 0);
    assert.equal(
      read.data.profile.research.facts[0].official_fact_id,
      undefined,
    );
    fail = false;
    const confirmed = await invoke(
      "product_profile.confirm",
      f.actors.owner,
      body,
    );
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    const officialId = confirmed.data.knowledge[0].official_fact_id;
    assert.equal(
      (
        await invoke("user_member.configure", f.actors.admin, {
          user_id: f.actors.owner.user_id,
          role: "factcheck",
        })
      ).status,
      200,
    );
    const same = env.application.issueActor({
      tenant_id: f.tenant_id,
      user_id: f.actors.owner.user_id,
      role: "factcheck",
      actor_type: "human",
    });
    assert.equal(
      (
        await env.application.call("official_fact.approve", {
          actor: same,
          params: { ...params, id: officialId },
          body: {},
        })
      ).status,
      403,
    );
  } finally {
    await env.close();
  }
});
