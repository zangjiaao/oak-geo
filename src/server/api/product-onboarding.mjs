import { canonicalJson } from "./canonical-json.mjs";
import { createHash, randomUUID } from "node:crypto";
import { validation, permission } from "./errors.mjs";
import { conflict, queueObject, event } from "./domain-common.mjs";
import {
  validateProductInput,
  validateResearchOutput,
  isOfficialProductUrl,
} from "./product-profile.mjs";
const timestamp = (ctx) => new Date(ctx.now()).toISOString();
const args = (ctx) => [ctx.principal.tenant_id, ctx.scope.brand_id];
const hash = (input) =>
  createHash("sha256").update(canonicalJson(input)).digest("hex");
async function current(ctx, lock = false) {
  if (lock)
    await ctx.client.query(
      "SELECT id FROM brand WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      args(ctx),
    );
  return (
    (
      await ctx.client.query(
        "SELECT * FROM product_profile WHERE tenant_id=$1 AND brand_id=$2",
        args(ctx),
      )
    ).rows[0] ?? null
  );
}
function presented(row) {
  if (!row) return null;
  const result = structuredClone(row);
  delete result.input_hash;
  if (result.research) {
    delete result.research.input_hash;
    result.research.sources = result.research.sources.map(
      ({ text, ...source }) => source,
    );
    result.research.trace = result.research.trace.map(({ tool, at, ok }) => ({
      tool,
      at,
      ok,
    }));
  }
  return result;
}
async function run(ctx, lock = false) {
  const row = (
    await ctx.client.query(
      "SELECT * FROM product_research_run WHERE tenant_id=$1 AND id=$2" +
        (lock ? " FOR UPDATE" : ""),
      [ctx.principal.tenant_id, ctx.body.run_id],
    )
  ).rows[0];
  if (
    !row ||
    row.brand_id !== ctx.scope.brand_id ||
    ctx.principal.trigger_source?.event_id !== row.id
  )
    throw permission("调查任务不在当前范围");
  return row;
}
export function productOnboardingHandlers() {
  return {
    "product_profile.read": async (ctx) => {
      if (ctx.query.version != null) throw validation("品牌资料不提供版本查询");
      const profile = await current(ctx);
      const recent =
        (
          await ctx.client.query(
            "SELECT id,model,prompt_version,started_at,claimed_at,finished_at,error,saved,usage FROM product_research_run WHERE tenant_id=$1 AND brand_id=$2 ORDER BY started_at DESC,id DESC LIMIT 1",
            args(ctx),
          )
        ).rows[0] ?? null;
      const ids = (profile?.knowledge ?? [])
        .map((f) => f.official_fact_id)
        .filter(Boolean);
      const reviews = ids.length
        ? (
            await ctx.client.query(
              "SELECT id,status,effective_from FROM official_fact WHERE tenant_id=$1 AND brand_id=$2 AND id=ANY($3::text[])",
              [...args(ctx), ids],
            )
          ).rows
        : [];
      const view = presented(profile);
      if (view) {
        delete view.knowledge;
        if (view.research)
          view.research.facts = view.research.facts.filter(
            (f) => !f.official_fact_id,
          );
      }
      return {
        data: {
          profile: view,
          knowledge: {
            user_provided: profile
              ? {
                  profile_id: profile.id,
                  source: "user_provided",
                  updated_at: profile.updated_at,
                }
              : null,
            facts: profile?.knowledge ?? [],
          },
          research_stale: Boolean(
            profile?.research &&
              profile.research.input_hash !== profile.input_hash,
          ),
          run: recent,
          reviews,
          research_configured: ctx.productResearchAgent.configured,
        },
      };
    },
    "product_profile.save": async (ctx) => {
      const input = validateProductInput(ctx.body.input),
        row = await current(ctx, true),
        digest = hash(input);
      if (Buffer.byteLength(JSON.stringify(input)) > 10000)
        throw validation("品牌资料过长，请精简描述或链接");
      if (
        row &&
        Buffer.byteLength(JSON.stringify(presented({ ...row, input }))) > 16000
      )
        throw validation("品牌资料与知识内容过多，请精简描述后保存");
      if (!row) {
        const id = randomUUID();
        await ctx.client.query(
          "INSERT INTO product_profile(id,tenant_id,brand_id,input,input_hash,onboarded_at,updated_at,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6,$7)",
          [
            id,
            ...args(ctx),
            JSON.stringify(input),
            digest,
            timestamp(ctx),
            ctx.principal.user_id,
          ],
        );
      } else if (row.input_hash !== digest) {
        await ctx.client.query(
          "UPDATE product_profile SET input=$1,input_hash=$2,updated_at=$3,updated_by=$4 WHERE tenant_id=$5 AND brand_id=$6",
          [
            JSON.stringify(input),
            digest,
            timestamp(ctx),
            ctx.principal.user_id,
            ...args(ctx),
          ],
        );
      }
      await ctx.client.query(
        "UPDATE brand SET name=$1 WHERE tenant_id=$2 AND id=$3",
        [input.name, ...args(ctx)],
      );
      event(ctx, "brand.profile_updated", "brand", ctx.scope.brand_id);
      return { data: presented(await current(ctx)) };
    },
    "product_profile.investigate": async (ctx) => {
      if (!ctx.productResearchAgent.configured)
        throw validation("请在服务端配置 DEEPSEEK_API_KEY", {
          reason: "research_not_configured",
        });
      await ctx.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["product-research:" + ctx.principal.tenant_id],
      );
      const row = await current(ctx, true);
      if (!row) throw validation("请先保存品牌名称与描述");
      const active = (
        await ctx.client.query(
          "SELECT id FROM product_research_run WHERE tenant_id=$1 AND finished_at IS NULL AND started_at>$2",
          [ctx.principal.tenant_id, new Date(ctx.now() - 120000).toISOString()],
        )
      ).rows;
      if (active.length) throw conflict("已有调查进行中，请稍后刷新结果");
      const n = Number(
        (
          await ctx.client.query(
            "SELECT count(*) AS n FROM product_research_run WHERE tenant_id=$1 AND started_at>$2",
            [
              ctx.principal.tenant_id,
              new Date(ctx.now() - 3600000).toISOString(),
            ],
          )
        ).rows[0].n,
      );
      if (n >= 10) throw validation("本小时调查次数已达上限，请稍后再试");
      const id = randomUUID();
      await ctx.client.query(
        "INSERT INTO product_research_run(id,tenant_id,brand_id,input_hash,created_by,model,prompt_version,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          ...args(ctx),
          row.input_hash,
          ctx.principal.user_id,
          ctx.productResearchAgent.model,
          ctx.productResearchAgent.prompt_version,
          timestamp(ctx),
        ],
      );
      return {
        data: { id },
        objectId: id,
        usage: "drafting",
        auditMeta: {
          agent_run_id: id,
          prompt_version: ctx.productResearchAgent.prompt_version,
        },
      };
    },
    "product_profile.claim": async (ctx) => {
      const row = await run(ctx, true);
      if (
        row.claimed_at ||
        row.finished_at ||
        ctx.now() - Date.parse(row.started_at) > 120000
      )
        return { data: { claimed: false, id: row.id } };
      await ctx.client.query(
        "UPDATE product_research_run SET claimed_at=$1 WHERE tenant_id=$2 AND id=$3",
        [timestamp(ctx), ctx.principal.tenant_id, row.id],
      );
      const profile = await current(ctx);
      return {
        data: {
          id: row.id,
          claimed: true,
          input: profile.input,
          input_changed: profile.input_hash !== row.input_hash,
        },
      };
    },
    "product_profile.finish": async (ctx) => {
      const job = await run(ctx, true);
      if (!job.claimed_at) throw conflict("调查尚未执行");
      if (job.finished_at)
        return { data: { id: job.id, saved: job.saved, error: job.error } };
      const profile = await current(ctx, true);
      let error = ctx.body.error ? String(ctx.body.error).slice(0, 250) : null,
        saved = false;
      const result = ctx.body.result;
      if (
        !error &&
        (!result ||
          result.agent_run_id !== job.id ||
          result.prompt_version !== job.prompt_version)
      )
        throw validation("调查身份不匹配");
      if (!error && profile.input_hash !== job.input_hash)
        error = "资料在调查期间已更新，请重新调查";
      if (!error) {
        if (
          !Array.isArray(result.sources) ||
          result.sources.length > 16 ||
          !Array.isArray(result.trace)
        )
          throw validation("调查证据格式错误");
        const sources = result.sources.map((s) => ({
          ...s,
          official:
            s.kind === "page" && isOfficialProductUrl(s.url, profile.input),
        }));
        const validated = validateResearchOutput(result, sources),
          stored = {
            ...result,
            ...validated,
            sources,
            input_hash: job.input_hash,
          };
        if (
          Buffer.byteLength(
            JSON.stringify(presented({ ...profile, research: stored })),
          ) > 16000
        )
          throw validation("调查内容过多，请缩小资料范围后重试");
        await ctx.client.query(
          "UPDATE product_profile SET research=$1 WHERE tenant_id=$2 AND brand_id=$3",
          [JSON.stringify(stored), ...args(ctx)],
        );
        saved = true;
      }
      await ctx.client.query(
        "UPDATE product_research_run SET finished_at=$1,error=$2,saved=$3,usage=$4,trace=$5 WHERE tenant_id=$6 AND id=$7",
        [
          timestamp(ctx),
          error,
          saved,
          JSON.stringify(result?.usage ?? { unknown: true }),
          JSON.stringify(result?.trace ?? []),
          ctx.principal.tenant_id,
          job.id,
        ],
      );
      event(ctx, "product_research.completed", "product_profile", job.id, {
        actor: {
          user_id: job.created_by,
          actor_type: "agent",
          agent_run_id: job.id,
          prompt_version: job.prompt_version,
        },
      });
      return { data: { id: job.id, saved, error } };
    },
    "product_profile.confirm": async (ctx) => {
      const profile = await current(ctx, true);
      if (
        !profile?.research ||
        profile.research.input_hash !== profile.input_hash ||
        !Array.isArray(ctx.body.facts) ||
        !ctx.body.facts.length ||
        ctx.body.facts.length > 12
      )
        throw validation("请先调查当前品牌资料并选择事实");
      const research = structuredClone(profile.research),
        knowledge = structuredClone(profile.knowledge),
        ids = new Set();
      const officialSourceIds = ctx.body.official_source_ids ?? [];
      if (!Array.isArray(officialSourceIds) || officialSourceIds.length > 16)
        throw validation("官方来源确认无效");
      for (const id of officialSourceIds) {
        const source = research.sources.find((s) => s.id === id);
        if (!source || source.kind !== "page" || !source.url)
          throw validation("只能确认实际读取的公开页面为官方来源");
        source.official = true;
      }
      for (const selected of ctx.body.facts) {
        const fact = research.facts.find((f) => f.id === selected.id);
        if (!fact || ids.has(fact.id) || fact.official_fact_id)
          throw conflict("事实不存在或已送审");
        ids.add(fact.id);
        if (
          typeof selected.text !== "string" ||
          !selected.text.trim() ||
          selected.text.length > 400
        )
          throw validation("事实不能为空或过长");
        const evidence = fact.evidence.map((e) => ({
          ...e,
          source: research.sources.find((s) => s.id === e.source_id),
        }));
        const source = evidence
          .map((e) => e.source)
          .find((s) => s?.official || s?.kind === "user_input");
        if (!source)
          throw validation(
            "第三方描述不能作为官方口径送审，请补充官方出处或品牌方声明",
          );
        fact.text = selected.text.trim();
        fact.confirmed_by = ctx.principal.user_id;
        fact.confirmed_at = timestamp(ctx);
        const id = randomUUID();
        fact.official_fact_id = id;
        await ctx.client.query(
          "INSERT INTO official_fact(id,tenant_id,brand_id,fact_category,content,source_level,status,effective_from) VALUES($1,$2,$3,$4,$5,'L1','draft',$6)",
          [
            id,
            ...args(ctx),
            fact.category,
            JSON.stringify({
              statement: fact.text,
              source_url: source.url ?? null,
              source_ref:
                source.kind === "user_input"
                  ? "product_profile:" + profile.id
                  : source.url,
              collected_at: source.collected_at,
              evidence: fact.evidence,
            }),
            timestamp(ctx),
          ],
        );
        await queueObject(ctx, "official_fact", id);
        event(ctx, "official_fact.create", "official_fact", id);
        knowledge.push({
          ...fact,
          evidence: evidence.map(({ source_id, quote, source }) => ({
            source_id,
            quote,
            url: source?.url ?? null,
            title: source?.title ?? "用户提供",
            kind: source?.kind,
            collected_at: source?.collected_at,
          })),
        });
      }
      if (
        Buffer.byteLength(
          JSON.stringify(presented({ ...profile, research, knowledge })),
        ) > 16000
      )
        throw validation("当前知识较多，请分批整理事实");
      await ctx.client.query(
        "UPDATE product_profile SET research=$1,knowledge=$2 WHERE tenant_id=$3 AND brand_id=$4",
        [JSON.stringify(research), JSON.stringify(knowledge), ...args(ctx)],
      );
      return { data: presented({ ...profile, research, knowledge }) };
    },
  };
}
