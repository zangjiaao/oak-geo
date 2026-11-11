import { randomUUID } from "node:crypto";
import { scoreIdentity } from "../../src/server/api/domain-common.mjs";
const kinds = ["定义", "边界", "与相邻概念区别", "常见误解"];
const enabledModels = Array.from(
  { length: 4 },
  (_, i) => `fixture-enabled-${i}`,
);
const window = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };

// Test data + transport orchestration only. Every mutation is an application call.
// No SQL, authorization decisions, aggregation, expected-result substitution here.
export function createFixtureRegistry(
  application,
  { clock = { now: () => Date.parse("2026-11-10T12:00:00Z") } } = {},
) {
  let serial = 0;
  const scenarios = new Map();
  const ok = async (operation, request) => {
    const response = await application.call(operation, request);
    if (response.status < 200 || response.status >= 300)
      throw new Error(`${operation}: ${JSON.stringify(response.error)}`);
    return response.data;
  };
  const request = (actor, body = {}, params = {}, query = {}) => ({
    actor,
    body,
    params,
    query,
  });
  const invoke = (id, actor, body = {}, params = {}, query = {}) =>
    ok(id, request(actor, body, params, query));
  function human(f, role, user_id = `${f.tenant_id}-${role}`) {
    const claims = {
      user_id,
      tenant_id: f.tenant_id,
      role,
      actor_type: "human",
    };
    if (["owner", "editor", "viewer"].includes(role))
      claims.brand_id = f.brand_id;
    return { ...application.issueActor(claims), brand_id: f.brand_id };
  }
  function job(f, name, batchId) {
    return {
      ...application.issueActor({
        user_id: "job-" + name,
        tenant_id: f.tenant_id,
        role: "system",
        actor_type: "system",
        job_name: name,
        batch_id: batchId ?? null,
        trigger_source: { event_id: randomUUID() },
      }),
      brand_id: f.brand_id,
    };
  }
  function skeleton() {
    const f = {
      tenant_id: randomUUID(),
      brand_id: randomUUID(),
      serial: ++serial,
      actors: {},
    };
    f.actors.admin = human(f, "admin", "installation-operator");
    return f;
  }
  async function base() {
    const f = skeleton();
    await invoke("tenant.configure", f.actors.admin, {
      name: "简造 ERP（虚构测试租户）",
      mode: "full",
      plan: "internal-fixture",
    });
    await invoke("user_member.configure", f.actors.admin, {
      user_id: f.actors.admin.user_id,
      role: "admin",
    });
    await invoke("brand.configure", f.actors.admin, {
      id: f.brand_id,
      name: "简造 ERP",
      industry: "B2B",
      market: "CN",
    });
    for (const role of [
      "strategist",
      "content",
      "evidence",
      "factcheck",
      "cs",
      "owner",
      "editor",
      "viewer",
    ]) {
      f.actors[role] = human(f, role);
      await invoke("user_member.configure", f.actors.admin, {
        user_id: f.actors[role].user_id,
        role,
        brand_id: ["owner", "editor", "viewer"].includes(role)
          ? f.brand_id
          : null,
      });
    }
    f.actors.independentFactcheck = f.actors.factcheck;
    const lex = await invoke("brand_lexicon.create", f.actors.strategist, {
      brand_id: f.brand_id,
      entries: [
        { kind: "brand_alias", term: "简造 ERP" },
        { kind: "exclusion", term: "erp" },
        { kind: "competitor", term: "对照软件（虚构）" },
      ],
    });
    const review = await invoke(
      "brand_lexicon.submit",
      f.actors.strategist,
      {},
      { id: lex.version_object_id },
    );
    await invoke(
      "review_queue.approve",
      f.actors.factcheck,
      {},
      { id: review.review_entry_id },
    );
    const entries = await invoke(
      "brand_lexicon.read",
      f.actors.strategist,
      {},
      {},
      { version: 1 },
    );
    f.competitorId = entries.entries.find((e) => e.kind === "competitor").id;
    const fact = await invoke("official_fact.create", f.actors.strategist, {
      brand_id: f.brand_id,
      fact_category: "boundary",
      content: "这是虚构测试品牌，仅用于自动化验证，不是对外客户事实。",
      source_level: "L1",
      effective_from: "2026-01-01T00:00:00Z",
    });
    await invoke(
      "official_fact.approve",
      f.actors.factcheck,
      {},
      { id: fact.id },
    );
    f.official_fact_id = fact.id;
    f.lexicon_version = 1;
    f.seed = {
      industry: "B2B",
      word: "ai 自动排产",
      word_type: "场景",
      maintainer: "张三（虚构）",
      last_reviewed_at: new Date(clock.now()).toISOString(),
      seed_version: f.serial,
    };
    await invoke("seed_list.create", f.actors.strategist, f.seed);
    const source = await invoke("keyword_raw.import", f.actors.strategist, {
      industry: "B2B",
      keyword: "ai 自动排产",
      channel: "B",
      demand_index: 0,
      collected_at: new Date(clock.now()).toISOString(),
      raw_payload: {
        url: "https://example.com/public/monthly-observation",
        excerpt: "公开B类排产问句样本（虚构测试记录）",
        observed_count: 0,
        statistics_window: window,
        channel_scope: "公开B类样本",
      },
    });
    f.sourceId = source.id;
    const pool = await invoke(
      "keyword_pool_snapshot.append",
      job(f, "weekly_pool"),
      { industry: "B2B", seed_version: f.seed.seed_version },
    );
    f.poolVersion = pool.pool_version;
    f.config = {
      pool_version: f.poolVersion,
      question_pool_version: 1,
      model_set: enabledModels,
      temperature_set: [0, 0.7],
      rounds: 3,
      judge_version: "rule_manual_v1",
      grounding_mode: "search_on",
    };
    return f;
  }
  async function cluster(
    f,
    { version = 1, freeze = true, anchor = true, name = "测试认知簇" } = {},
  ) {
    const c = await invoke("intent_cluster.transition", job(f, "weekly_pool"), {
      brand_id: f.brand_id,
      name,
      intent_type: "认知",
      pool_version: f.poolVersion,
    });
    for (const role of ["content", "evidence"])
      await invoke("user_member.configure", f.actors.admin, {
        user_id: f.actors[role].user_id,
        role,
        assignments: [{ object_type: "intent_cluster", object_id: c.id }],
      });
    const template = {
      cluster_id: c.id,
      question: "虚构品牌适用哪些排产场景？",
      source_word_id: f.sourceId,
      intent_type: "认知",
      source_channel: "B",
      collected_at: new Date(clock.now()).toISOString(),
      maintainer: "张三（虚构）",
      question_pool_version: version,
    };
    const questions = [];
    for (let i = 0; i < 3; i++)
      questions.push(
        await invoke("question_pool.create", f.actors.strategist, {
          ...template,
          question: template.question + `（问法${i + 1}）`,
        }),
      );
    if (freeze)
      await invoke("question_pool.freeze", f.actors.strategist, {
        cluster_id: c.id,
        question_pool_version: version,
      });
    if (freeze && anchor)
      await invoke("question_pool.upgrade_anchor", f.actors.strategist, {
        cluster_id: c.id,
        question_pool_version: version,
        question_ids: questions.map((q) => q.id),
        reason: "人工确认测试问句口径",
      });
    return {
      id: c.id,
      questions,
      questionIds: questions.map((q) => q.id),
      version,
      template,
    };
  }
  async function config(
    f,
    {
      freeze = true,
      disabled = false,
      grounding = "search_on",
      questionVersion = 1,
    } = {},
  ) {
    const input = {
      ...f.config,
      question_pool_version: questionVersion,
      grounding_mode: grounding,
      temperature_set: grounding === "search_off" ? [0] : [0, 0.7],
      model_set: disabled
        ? enabledModels.map((m) => m.replace("enabled", "disabled"))
        : enabledModels,
    };
    const s = await invoke("scoring_snapshot.create", f.actors.cs, input);
    if (freeze)
      await invoke(
        "scoring_snapshot.freeze",
        f.actors.cs,
        {},
        { id: s.snapshot_id },
      );
    return { ...s, input };
  }
  const batchBody = (
    f,
    clusters,
    snapshot,
    { baseline, type = "baseline" } = {},
  ) => ({
    type,
    snapshot_id: snapshot.snapshot_id,
    scheduled_at: new Date(clock.now()).toISOString(),
    baseline_batch_id: baseline?.id,
    cluster_question_sets: clusters.map((c) => ({
      cluster_id: c.id,
      question_pool_version: c.version,
      question_ids: c.questionIds,
    })),
  });
  async function batch(
    f,
    clusters,
    snapshot,
    {
      baseline,
      type = "baseline",
      start = true,
      complete = true,
      execute = true,
      validAnswers = 72,
      modelCoverage = 4,
      allGeneric = false,
    } = {},
  ) {
    const input = batchBody(f, clusters, snapshot, { baseline, type });
    const b = await invoke("probe_batch.create", f.actors.cs, input);
    const probeJob = job(f, "probe_execute", b.id);
    if (start) await invoke("probe_batch.start", probeJob, {}, { id: b.id });
    const records = [];
    if (execute) {
      for (const c of clusters) {
        let kept = 0;
        for (const q of c.questions)
          for (const temperature of snapshot.input.temperature_set)
            for (let round = 1; round <= 3; round++)
              for (let modelIndex = 0; modelIndex < 4; modelIndex++) {
                const valid = modelIndex < modelCoverage && kept < validAnswers;
                if (valid) kept++;
                const own = !allGeneric && modelIndex % 2 === 0;
                const probe = {
                  batch_id: b.id,
                  cluster_id: c.id,
                  question_id: q.id,
                  model: snapshot.input.model_set[modelIndex],
                  temperature,
                  round,
                  attempt_no: 1,
                };
                const result = {
                  raw_answer: valid
                    ? allGeneric
                      ? "各行业因实际情况而异。"
                      : own
                        ? "简造 ERP：虚构样本支持10天测试，范围限测试环境。"
                        : "对照软件（虚构）：10天测试场景。"
                    : "拒绝回答（测试录制回执）",
                  refused: !valid,
                  cited_urls: [],
                  cited_domains: [],
                };
                const data = await invoke(
                  "probe_batch.execute",
                  probeJob,
                  { probe, result },
                  { id: b.id },
                );
                records.push({ ...data, cluster_id: c.id, valid });
                if (valid)
                  await invoke(
                    "probe_result.judge",
                    f.actors.factcheck,
                    {
                      batch_id: b.id,
                      lexicon_version: 1,
                      official_fact_ids: [f.official_fact_id],
                      blank_i: allGeneric ? 1 : 0,
                      error_i: 0,
                      generic_i: allGeneric ? 1 : 0,
                      competitor_i: allGeneric ? 0 : 0.5,
                      brand_mentioned: own,
                      competitor_mentions:
                        !allGeneric && !own ? [f.competitorId] : [],
                      note: "人工标注的虚构录制样本",
                    },
                    { id: data.id },
                  );
              }
      }
      if (complete)
        await invoke("probe_batch.complete", probeJob, {}, { id: b.id });
    }
    return { ...b, input, records, probeJob, snapshot, clusters };
  }
  async function measured(options = {}) {
    const f = await base();
    f.cluster = await cluster(f, options.clusterOptions);
    f.snapshot = await config(f, options.configOptions);
    f.batch = await batch(f, [f.cluster], f.snapshot, options.batchOptions);
    f.actors.baselineJob = job(f, "baseline_scoring", f.batch.id);
    f.scoreRequest = {
      cluster_id: f.cluster.id,
      snapshot_id: f.snapshot.snapshot_id,
    };
    f.clusterScoreId = scoreIdentity(f.cluster.id, f.snapshot.snapshot_id);
    return f;
  }
  async function appendScore(f, c = f.cluster) {
    return invoke(
      "cluster_score.append",
      job(f, "baseline_scoring", f.batch.id),
      { cluster_id: c.id, snapshot_id: f.snapshot.snapshot_id },
    );
  }
  async function metric(f, b = f.batch, c = f.cluster, controls = []) {
    return invoke("metric_snapshot.append", job(f, "metric_aggregate", b.id), {
      batch_id: b.id,
      snapshot_id: b.snapshot_id,
      cluster_id: c.id,
      committed_attempt_no: 1,
      lexicon_version: 1,
      control_cluster_ids: controls,
    });
  }
  async function claimInput() {
    const f = await base();
    f.cluster = await cluster(f);
    f.snapshot = await config(f);
    f.card = await invoke("opportunity_card.create", f.actors.strategist, {
      cluster_id: f.cluster.id,
      pool_version: f.poolVersion,
      snapshot_id: f.snapshot.snapshot_id,
      demand_tier: "S",
      demand_source: "keyword:" + f.sourceId,
    });
    f.asset = await invoke("content_asset.create", f.actors.content, {
      opportunity_card_id: f.card.id,
      type: "定义页",
      platform: "官网",
    });
    f.claim = {
      content_asset_id: f.asset.id,
      text: "简造 ERP 是虚构测试品牌，支持10天测试且仅限测试环境。",
      number: "10",
      unit: "天",
      scope: "虚构测试环境",
      source_url: "https://example.com/facts",
      source_level: "L1",
      block_kind: kinds[0],
    };
    return f;
  }
  async function claims({ pending = false, missing = false, badText } = {}) {
    const f = await claimInput();
    f.claims = [];
    for (const kind of kinds.slice(0, missing ? 3 : 4))
      f.claims.push(
        await invoke("claim_block.create", f.actors.content, {
          ...f.claim,
          block_kind: kind,
          text: badText ?? f.claim.text,
        }),
      );
    f.claimId = f.claims[0].id;
    if (pending) {
      const submitted = await invoke(
        "claim_block.submit",
        f.actors.content,
        {},
        { id: f.claimId },
      );
      f.reviewId = submitted.review_entry_id;
    }
    return f;
  }
  async function comparison(options = {}) {
    const f = await measured();
    const before = await metric(f);
    f.oldClusterId = f.cluster.id;
    f.oldAnchor = f.cluster.version;
    let snapshot = f.snapshot,
      c = f.cluster,
      type = "event";
    if (options.newClusterInNewPool) {
      const pool = await invoke(
        "keyword_pool_snapshot.append",
        job(f, "weekly_pool"),
        { industry: "B2B", seed_version: f.seed.seed_version },
      );
      f.poolVersion = pool.pool_version;
      await cluster(f, { version: 2, name: "其他新簇" });
    }
    if (options.sameTextDifferentAnchor) {
      const questions = [];
      for (const old of f.cluster.questions)
        questions.push(
          await invoke(
            "question_pool.revise",
            f.actors.strategist,
            {
              question: old.question,
              question_pool_version: 2,
              reason: "人工升级同字面口径",
            },
            { id: old.id },
          ),
        );
      await invoke("question_pool.freeze", f.actors.strategist, {
        cluster_id: c.id,
        question_pool_version: 2,
      });
      await invoke("question_pool.upgrade_anchor", f.actors.strategist, {
        cluster_id: c.id,
        question_pool_version: 2,
        question_ids: questions.map((q) => q.id),
        reason: "人工升级锚",
      });
      c = {
        ...c,
        questions,
        questionIds: questions.map((q) => q.id),
        version: 2,
      };
      snapshot = await config(f, { questionVersion: 2 });
      type = "baseline";
    }
    if (options.differentSnapshot) {
      snapshot = await config(f, { grounding: "search_off" });
      type = "baseline";
    }
    const afterBatch = await batch(f, [c], snapshot, {
      type,
      baseline: type === "event" ? f.batch : undefined,
      validAnswers: snapshot.input.grounding_mode === "search_off" ? 36 : 72,
    });
    await metric(f, afterBatch, c);
    f.compareQuery = {
      baseline_batch_id: f.batch.id,
      retest_batch_id: afterBatch.id,
      cluster_id: c.id,
    };
    f.metricBefore = before.id;
    return f;
  }
  async function evidence({ submit = true, sealed = false } = {}) {
    const f = await measured();
    const rows = f.batch.records.filter((r) => r.valid);
    f.packageBody = {
      brand_id: f.brand_id,
      items: rows.slice(0, 30).map((r) => ({
        probe_id: r.probe_id,
        source_level: "L1",
        conclusion_text: "虚构回答的人工复核结论，可追溯官方测试口径。",
      })),
    };
    f.package = await invoke(
      "evidence_package.create",
      f.actors.evidence,
      f.packageBody,
    );
    if (submit) {
      const q = await invoke("review_queue.submit", f.actors.evidence, {
        object_type: "evidence_package",
        object_id: f.package.id,
      });
      f.packageReviewId = q.id;
    }
    if (sealed)
      await invoke(
        "evidence_package.approve",
        f.actors.factcheck,
        {},
        { id: f.package.id },
      );
    return f;
  }
  async function delivery({ create = true, approve = true } = {}) {
    const f = await base();
    const clusters = [];
    for (let i = 0; i < 30; i++)
      clusters.push(await cluster(f, { name: "基线测试簇" + i }));
    f.cluster = clusters[0];
    f.snapshot = await config(f);
    f.batch = await batch(f, clusters, f.snapshot);
    for (const c of clusters) await appendScore(f, c);
    const cards = [];
    for (const c of clusters.slice(0, 3))
      cards.push(
        await invoke("opportunity_card.create", f.actors.strategist, {
          cluster_id: c.id,
          pool_version: f.poolVersion,
          snapshot_id: f.snapshot.snapshot_id,
          demand_tier: "S",
          demand_source: "keyword:" + f.sourceId,
        }),
      );
    const records = f.batch.records
      .filter(
        (r) =>
          clusters.slice(0, 3).some((c) => c.id === r.cluster_id) && r.valid,
      )
      .slice(0, 30);
    f.package = await invoke("evidence_package.create", f.actors.evidence, {
      brand_id: f.brand_id,
      items: records.map((r) => ({
        probe_id: r.probe_id,
        source_level: "L1",
        conclusion_text: "虚构样本已由FactCheck人工核验。",
      })),
    });
    await invoke("review_queue.submit", f.actors.evidence, {
      object_type: "evidence_package",
      object_id: f.package.id,
    });
    await invoke(
      "evidence_package.approve",
      f.actors.factcheck,
      {},
      { id: f.package.id },
    );
    f.reportBody = {
      opportunity_ids: cards.map((c) => c.id),
      probe_ids: records.map((r) => r.probe_id),
      evidence_package_id: f.package.id,
    };
    if (create) {
      f.report = await invoke(
        "diagnosis_report.create",
        f.actors.strategist,
        f.reportBody,
      );
      f.reportId = f.report.id;
      if (approve)
        await invoke(
          "diagnosis_report.approve",
          f.actors.factcheck,
          {},
          { id: f.reportId },
        );
    }
    return f;
  }
  const factories = {
    "editable-question": async () => {
      const f = await base();
      const c = await invoke(
        "intent_cluster.transition",
        job(f, "weekly_pool"),
        {
          brand_id: f.brand_id,
          name: "未冻结簇",
          intent_type: "认知",
          pool_version: f.poolVersion,
        },
      );
      return {
        ...f,
        question: {
          cluster_id: c.id,
          question: "虚构问句",
          source_word_id: f.sourceId,
          intent_type: "认知",
          source_channel: "B",
          collected_at: new Date(clock.now()).toISOString(),
          maintainer: "张三（虚构）",
          question_pool_version: 1,
        },
      };
    },
    "frozen-question": async () => {
      const f = await base(),
        c = await cluster(f);
      return { ...f, cluster: c, questionId: c.questionIds[0], version: 1 };
    },
    "judged-baseline": (options) =>
      measured({
        batchOptions: {
          validAnswers: options.validAnswers ?? 72,
          modelCoverage: options.modelCoverage ?? 4,
        },
      }),
    comparison: comparison,
    "seed-input": async () => {
      const f = await base();
      return {
        ...f,
        seed: { ...f.seed, seed_version: f.seed.seed_version + 10000 },
      };
    },
    "opportunity-input": async () => {
      const f = await base();
      f.cluster = await cluster(f);
      f.snapshot = await config(f);
      return {
        ...f,
        card: {
          cluster_id: f.cluster.id,
          pool_version: f.poolVersion,
          snapshot_id: f.snapshot.snapshot_id,
          demand_tier: "S",
          demand_source: "keyword:" + f.sourceId,
        },
      };
    },
    "claim-input": claimInput,
    "pending-claim": async (options) => {
      const f = await claims({ pending: true });
      if (options.sameAuthorReviewer) {
        await invoke("user_member.configure", f.actors.admin, {
          user_id: f.actors.content.user_id,
          role: "factcheck",
          replace_role: "content",
        });
        f.actors.authorAsFactcheck = human(
          f,
          "factcheck",
          f.actors.content.user_id,
        );
      }
      return f;
    },
    report: async () => {
      const f = await claimInput();
      const control = await cluster(f, { name: "无动作对照簇" });
      f.batch = await batch(f, [f.cluster, control], f.snapshot);
      f.metricId = (await metric(f, f.batch, f.cluster, [control.id])).id;
      return f;
    },
    "archive-transition": async (options) => {
      if (options.stage === "during-transition") {
        const f = scenarios.get(options.scenarioId);
        if (!f) throw new Error("unknown archive scenario");
        clock.advanceDays(options.daysSinceArchive ?? 89);
        for (const [key, actor] of Object.entries(f.actors))
          if (actor.actor_type === "human")
            f.actors[key] = human(f, actor.role, actor.user_id);
        f.retest = await batch(f, [f.cluster], f.snapshot, {
          type: "event",
          baseline: f.batch,
          allGeneric: true,
        });
        f.metricDuringTransition = (await metric(f, f.retest)).id;
        return f;
      }
      const f = await measured({ batchOptions: { allGeneric: true } });
      f.clusterId = f.cluster.id;
      f.metricBefore = (await metric(f)).id;
      if (options.percentile !== false) {
        const weekly = job(f, "weekly_pool");
        const pool = await invoke("keyword_pool_snapshot.append", weekly, {
          industry: "B2B",
          seed_version: f.seed.seed_version,
          weekly_batch_id: weekly.trigger_source.event_id,
          demand_observations: [
            { public_cluster_key: "ai 自动排产", demand_index: 0 },
            ...Array.from({ length: 4 }, (_, i) => ({
              public_cluster_key: "公开词根" + (i + 1),
              demand_index: (i + 1) * 20,
            })),
          ],
        });
        f.poolVersion = pool.pool_version;
        await invoke(
          "intent_cluster.transition",
          weekly,
          { pool_version: f.poolVersion },
          { id: f.cluster.id },
        );
      }
      f.archiveRequest = {
        prepare_evidence: true,
        reason: "机器举证后由策略人工核验",
        statistics_window: window,
        channel_scope: "公开B类样本",
      };
      f.scenarioId = randomUUID();
      scenarios.set(f.scenarioId, f);
      return f;
    },
    "public-opportunity": async () => {
      const f = await claimInput();
      return { ...f, cardId: f.card.id };
    },
    "diagnosis-conclusions": () => delivery(),
    "snapshot-input": base,
    "external-answer": async (options) => {
      const f = await claims();
      f.batch = await batch(f, [f.cluster], f.snapshot, { execute: false });
      f.actors.probeJob = f.batch.probeJob;
      f.batchId = f.batch.id;
      f.resultRequest = {
        probe: {
          batch_id: f.batch.id,
          cluster_id: f.cluster.id,
          question_id: f.cluster.questionIds[0],
          model: enabledModels[0],
          temperature: 0,
          round: 1,
          attempt_no: 1,
        },
        result: {
          raw_answer: options.rawAnswer,
          refused: false,
          cited_urls: [],
          cited_domains: [],
        },
      };
      return f;
    },
    "claim-missing-required-block": () => claims({ missing: true }),
    "claim-with-self-containment-error": (options) =>
      claims({ badText: options.text }),
    "search-track": async () => {
      const f = await base();
      f.snapshot = await config(f, { disabled: true, freeze: false });
      return { ...f, snapshotId: f.snapshot.snapshot_id };
    },
  };
  async function fixture(name, options = {}) {
    if (!Object.hasOwn(factories, name))
      throw new Error("unknown fixture: " + name);
    return factories[name](options);
  }
  async function authorizedRequest(id) {
    const simple = new Set([
      "tenant.read",
      "brand.read",
      "user_member.read",
      "brand.configure",
      "user_member.configure",
      "brand_lexicon.create",
      "brand_lexicon.submit",
      "brand_lexicon.read",
      "official_fact.create",
      "official_fact.read",
      "official_fact.approve",
      "official_fact.retract",
      "seed_list.create",
      "seed_list.read",
      "keyword_raw.import",
      "keyword_raw.read",
      "keyword_raw.read_raw",
      "keyword_pool_snapshot.append",
      "keyword_pool_snapshot.read",
      "intent_cluster.transition",
      "scoring_snapshot.create",
      "scoring_snapshot.read",
      "scoring_snapshot.freeze",
      "audit_log.read",
      "api_token.create",
      "api_token.read",
      "api_token.revoke",
      "industry_score.read",
      "industry_score.revise",
    ]);
    if (id === "tenant.configure") {
      const f = skeleton();
      return request(f.actors.admin, {
        name: "简造 ERP（虚构测试租户）",
        mode: "full",
        plan: "internal-fixture",
      });
    }
    if (simple.has(id)) {
      const f = await base();
      const a = f.actors;
      if (id === "industry_score.read")
        return request(a.strategist, {}, {}, { industry: "B2B" });
      if (id === "industry_score.revise")
        return request(a.strategist, {
          industry: "B2B",
          c_delete_threshold: null,
        });
      if (
        id === "tenant.read" ||
        id === "user_member.read" ||
        id === "audit_log.read" ||
        id === "api_token.read"
      )
        return request(a.admin);
      if (id === "brand.read") return request(a.owner, {}, { id: f.brand_id });
      if (id === "brand.configure")
        return request(a.admin, {
          name: "第二虚构品牌",
          industry: "B2B",
          market: "CN",
        });
      if (id === "user_member.configure")
        return request(a.admin, {
          user_id: randomUUID(),
          role: "viewer",
          brand_id: f.brand_id,
        });
      if (id === "brand_lexicon.create")
        return request(a.strategist, {
          brand_id: f.brand_id,
          entries: [
            { kind: "brand_alias", term: "简造 ERP 新别名" },
            { kind: "exclusion", term: "erp" },
          ],
        });
      if (id === "brand_lexicon.submit") {
        const lex = await invoke("brand_lexicon.create", a.strategist, {
          brand_id: f.brand_id,
          entries: [{ kind: "brand_alias", term: "简造 ERP 新别名" }],
        });
        return request(a.strategist, {}, { id: lex.version_object_id });
      }
      if (id === "brand_lexicon.read" || id === "official_fact.read")
        return request(a.strategist);
      const factBody = {
        brand_id: f.brand_id,
        fact_category: "boundary",
        content: "仅限虚构测试环境",
        source_level: "L1",
        effective_from: "2026-01-01T00:00:00Z",
      };
      if (id === "official_fact.create") return request(a.strategist, factBody);
      if (id === "official_fact.approve") {
        const fact = await invoke(
          "official_fact.create",
          a.strategist,
          factBody,
        );
        return request(a.factcheck, {}, { id: fact.id });
      }
      if (id === "official_fact.retract")
        return request(
          a.factcheck,
          { reason: "测试撤回" },
          { id: f.official_fact_id },
        );
      if (id === "seed_list.create")
        return request(a.strategist, {
          ...f.seed,
          seed_version: f.seed.seed_version + 10000,
        });
      if (id === "seed_list.read")
        return request(a.strategist, {}, {}, { industry: "B2B" });
      if (id === "keyword_raw.import")
        return request(a.strategist, {
          industry: "B2B",
          keyword: "其他公开词",
          channel: "B",
          demand_index: 20,
          collected_at: new Date(clock.now()).toISOString(),
        });
      if (id === "keyword_raw.read") return request(a.strategist);
      if (id === "keyword_raw.read_raw")
        return request(a.strategist, {}, { id: f.sourceId });
      if (id === "keyword_pool_snapshot.append")
        return request(job(f, "weekly_pool"), {
          industry: "B2B",
          seed_version: f.seed.seed_version,
        });
      if (id === "keyword_pool_snapshot.read")
        return request(a.strategist, {}, {}, { industry: "B2B" });
      if (id === "intent_cluster.transition")
        return request(job(f, "weekly_pool"), {
          brand_id: f.brand_id,
          name: "新测试簇",
          intent_type: "认知",
          pool_version: f.poolVersion,
        });
      if (id === "scoring_snapshot.create") return request(a.cs, f.config);
      if (id === "scoring_snapshot.read" || id === "scoring_snapshot.freeze") {
        const s = await config(f, { freeze: false });
        return request(a.cs, {}, { id: s.snapshot_id });
      }
      if (id === "api_token.create")
        return request(a.admin, {
          user_id: a.strategist.user_id,
          scopes: ["brand.read"],
        });
      if (id === "api_token.revoke") {
        const token = await invoke("api_token.create", a.admin, {
          user_id: a.strategist.user_id,
          scopes: ["brand.read"],
        });
        return request(a.admin, { reason: "测试撤销" }, { id: token.id });
      }
    }
    if (id.startsWith("question_pool.") || id === "intent_cluster.read") {
      if (id === "question_pool.create") {
        const f = await fixture("editable-question");
        return request(f.actors.strategist, f.question);
      }
      const f = await base(),
        c = await cluster(f, {
          freeze: id !== "question_pool.freeze",
          anchor: false,
        });
      if (id === "question_pool.read")
        return request(f.actors.strategist, {}, { id: c.questionIds[0] });
      if (id === "question_pool.revise")
        return request(
          f.actors.strategist,
          {
            question: "新测试问句",
            question_pool_version: 2,
            reason: "人工升级",
          },
          { id: c.questionIds[0] },
        );
      if (id === "question_pool.freeze")
        return request(f.actors.strategist, {
          cluster_id: c.id,
          question_pool_version: 1,
        });
      if (id === "question_pool.upgrade_anchor")
        return request(f.actors.strategist, {
          cluster_id: c.id,
          question_pool_version: 1,
          question_ids: c.questionIds,
          reason: "人工锚定",
        });
      if (id === "intent_cluster.read")
        return request(f.actors.strategist, {}, { id: c.id });
    }
    if (id === "intent_cluster.archive") {
      const f = await fixture("archive-transition");
      const prepared = await invoke(id, f.actors.strategist, f.archiveRequest, {
        id: f.clusterId,
      });
      return request(
        f.actors.strategist,
        {
          reason: "策略人工核验证据",
          archive_evidence_id: prepared.archive_evidence.id,
          manual_confirmation: true,
        },
        { id: f.clusterId },
      );
    }
    if (id.startsWith("probe_batch.") || id.startsWith("probe_result.")) {
      const f = await base();
      f.cluster = await cluster(f);
      f.snapshot = await config(f);
      if (id === "probe_batch.create")
        return request(f.actors.cs, batchBody(f, [f.cluster], f.snapshot));
      if (id === "probe_batch.start" || id === "probe_batch.read") {
        const b = await batch(f, [f.cluster], f.snapshot, {
          start: false,
          execute: false,
        });
        return request(
          id.endsWith(".read") ? f.actors.strategist : b.probeJob,
          {},
          { id: b.id },
        );
      }
      const b = await batch(f, [f.cluster], f.snapshot, {
        execute: id === "probe_batch.complete",
        complete: false,
      });
      if (id === "probe_batch.complete")
        return request(b.probeJob, {}, { id: b.id });
      const body = {
        probe: {
          batch_id: b.id,
          cluster_id: f.cluster.id,
          question_id: f.cluster.questionIds[0],
          model: enabledModels[0],
          temperature: 0,
          round: 1,
          attempt_no: 1,
        },
        result: {
          raw_answer: "简造 ERP 的虚构测试回答",
          refused: false,
          cited_urls: [],
          cited_domains: [],
        },
      };
      if (id === "probe_batch.execute")
        return request(b.probeJob, body, { id: b.id });
      const r = await invoke("probe_batch.execute", b.probeJob, body, {
        id: b.id,
      });
      if (id === "probe_result.judge")
        return request(
          f.actors.factcheck,
          {
            batch_id: b.id,
            lexicon_version: 1,
            official_fact_ids: [f.official_fact_id],
            blank_i: 0,
            error_i: 0,
            generic_i: 0,
            competitor_i: 0,
            brand_mentioned: true,
          },
          { id: r.id },
        );
      return request(
        id === "probe_result.access" ? f.actors.admin : f.actors.strategist,
        id === "probe_result.access" ? { reason: "排查单条数据" } : {},
        { id: r.id },
      );
    }
    if (id.startsWith("cluster_score.") || id.startsWith("metric_snapshot.")) {
      if (id === "cluster_score.compare") {
        const f = await comparison();
        return request(f.actors.owner, {}, {}, f.compareQuery);
      }
      const f = await measured();
      if (id === "cluster_score.append")
        return request(f.actors.baselineJob, f.scoreRequest);
      if (id === "cluster_score.read") {
        const score = await appendScore(f);
        return request(f.actors.strategist, {}, { id: score.id });
      }
      if (id === "metric_snapshot.append")
        return request(job(f, "metric_aggregate", f.batch.id), {
          batch_id: f.batch.id,
          snapshot_id: f.snapshot.snapshot_id,
          cluster_id: f.cluster.id,
          committed_attempt_no: 1,
          lexicon_version: 1,
        });
      const m = await metric(f);
      return request(f.actors.owner, {}, { id: m.id });
    }
    if (
      id.startsWith("opportunity_card.") ||
      id.startsWith("content_asset.") ||
      id.startsWith("claim_block.")
    ) {
      if (id === "opportunity_card.create") {
        const f = await fixture("opportunity-input");
        return request(f.actors.strategist, f.card);
      }
      const f = await ([
        "claim_block.approve",
        "claim_block.reject",
        "claim_block.retract",
        "claim_block.revise",
      ].includes(id)
        ? claims({ pending: true })
        : claims());
      if (id === "opportunity_card.read")
        return request(f.actors.owner, {}, { id: f.card.id });
      if (id === "content_asset.create")
        return request(f.actors.content, {
          opportunity_card_id: f.card.id,
          type: "定义页",
          platform: "官网",
        });
      if (id === "content_asset.transition") {
        const audits = await invoke(
          "audit_log.read",
          f.actors.admin,
          {},
          {},
          { object_id: f.claimId, limit: 100 },
        );
        return request(job(f, "content_reconcile"), {
          content_asset_id: f.asset.id,
          trigger_claim_id: f.claimId,
          cause_event_id: audits.items.find(
            (r) => r.action === "claim_block.create",
          ).id,
        });
      }
      if (id === "content_asset.read")
        return request(f.actors.content, {}, { id: f.asset.id });
      if (id === "claim_block.create")
        return request(f.actors.content, f.claim);
      if (id === "claim_block.read" || id === "claim_block.submit")
        return request(f.actors.content, {}, { id: f.claimId });
      if (id === "claim_block.approve")
        return request(f.actors.factcheck, {}, { id: f.claimId });
      if (id === "claim_block.reject")
        return request(
          f.actors.factcheck,
          { reason: "补充来源" },
          { id: f.claimId },
        );
      if (id === "claim_block.revise" || id === "claim_block.retract")
        await invoke(
          "claim_block.approve",
          f.actors.factcheck,
          {},
          { id: f.claimId },
        );
      if (id === "claim_block.revise")
        return request(
          f.actors.content,
          {
            ...f.claim,
            text: "10天测试的新版本，限虚构环境。",
            reason: "修订",
          },
          { id: f.claimId },
        );
      if (id === "claim_block.retract")
        return request(
          f.actors.factcheck,
          { reason: "撤回事实" },
          { id: f.claimId },
        );
    }
    if (id.startsWith("review_queue.")) {
      if (id === "review_queue.submit") {
        const f = await evidence({ submit: false });
        return request(f.actors.evidence, {
          object_type: "evidence_package",
          object_id: f.package.id,
        });
      }
      const f = await claims({ pending: true });
      if (id === "review_queue.read") return request(f.actors.factcheck);
      return request(
        id === "review_queue.withdraw" ? f.actors.content : f.actors.factcheck,
        id === "review_queue.reject" ? { reason: "证据需补充" } : {},
        { id: f.reviewId },
      );
    }
    if (id.startsWith("evidence_package.")) {
      const f = await evidence({ submit: id === "evidence_package.approve" });
      if (id === "evidence_package.create")
        return request(f.actors.evidence, f.packageBody);
      return request(
        id === "evidence_package.approve"
          ? f.actors.factcheck
          : f.actors.strategist,
        {},
        { id: f.package.id },
      );
    }
    if (id.startsWith("backflow_ticket.")) {
      const f = await fixture("archive-transition");
      await invoke("industry_score.revise", f.actors.strategist, {
        industry: "B2B",
        c_delete_threshold: 1,
      });
      const prepared = await invoke(
        "intent_cluster.archive",
        f.actors.strategist,
        f.archiveRequest,
        { id: f.clusterId },
      );
      if (id === "backflow_ticket.create")
        return request(job(f, "backflow_scan"), {
          signal_type: "no_demand",
          cluster_id: f.clusterId,
          archive_evidence_id: prepared.archive_evidence.id,
        });
      const audits = await invoke(
        "audit_log.read",
        f.actors.admin,
        {},
        {},
        { object_type: "backflow_ticket", limit: 100 },
      );
      return request(
        f.actors.strategist,
        {},
        {
          id: audits.items.find((r) => r.action === "backflow_ticket.create")
            .object_id,
        },
      );
    }
    if (id.startsWith("diagnosis_report.")) {
      const f = await delivery({
        create: id !== "diagnosis_report.create",
        approve: id === "diagnosis_report.read",
      });
      if (id === "diagnosis_report.create")
        return request(f.actors.strategist, f.reportBody);
      return request(
        id === "diagnosis_report.approve" ? f.actors.factcheck : f.actors.owner,
        {},
        { id: f.reportId },
      );
    }
    throw new Error(
      "missing authorized fixture for registered operation " + id,
    );
  }
  return Object.freeze({
    fixture,
    prepareAuthorizedRequest: authorizedRequest,
  });
}
