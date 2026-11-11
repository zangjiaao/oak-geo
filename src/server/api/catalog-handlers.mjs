import { pageQuery } from "./pagination.mjs";
import { appendMachinePercentiles } from "./industry-percentiles.mjs";
import { randomUUID } from "node:crypto";
import { provisioningOperations } from "./provisioning-service.mjs";
import {
  required,
  insertRow,
  getRow,
  change,
  conflict,
  json,
  event,
  queueObject,
} from "./domain-common.mjs";
import { opportunityStatusToApi } from "./opportunity-status.mjs";
import { permission, validation, ServiceError } from "./errors.mjs";
import { assertPublicRoot, privateMarkers } from "./shared-industry.mjs";

export function catalogHandlers() {
  const handlers = {};
  const provision = [
    "tenant.configure",
    "brand.configure",
    "user_member.configure",
    "brand_lexicon.create",
    "brand_lexicon.submit",
    "official_fact.create",
    "official_fact.approve",
  ];
  for (const operation of provision)
    handlers[operation] = async (ctx) => {
      const tid = ctx.principal.tenant_id;
      const body = {
        ...ctx.body,
        brand_id: ctx.body.brand_id ?? ctx.scope.brand_id,
      };
      if (operation === "tenant.configure") {
        required(body, ["name", "mode", "plan"]);
        const existing = (
          await ctx.client.query("SELECT id FROM tenant WHERE id=$1", [tid])
        ).rows[0];
        if (existing) {
          const row = (
            await ctx.client.query(
              "UPDATE tenant SET name=$1,mode=$2,plan=$3 WHERE id=$4 RETURNING id,name,mode,plan",
              [body.name, body.mode, body.plan, tid],
            )
          ).rows[0];
          return { data: row };
        }
      }
      if (operation === "user_member.configure") {
        if (
          !["owner", "editor", "viewer"].includes(body.role) &&
          ctx.body.brand_id == null
        )
          body.brand_id = null;
        required(body, ["user_id", "role"]);
        const current = (
          await ctx.client.query(
            "SELECT id,role,brand_id FROM user_member WHERE tenant_id=$1 AND user_id=$2",
            [tid, body.user_id],
          )
        ).rows;
        const others = current.filter((m) => m.role !== body.replace_role);
        const writing = new Set(["strategist", "content", "evidence"]);
        if (
          (body.role === "factcheck" &&
            others.some((m) => writing.has(m.role))) ||
          (writing.has(body.role) && others.some((m) => m.role === "factcheck"))
        )
          throw validation("FactCheck and writing duties cannot be combined");
        if (
          ["owner", "editor", "viewer"].includes(body.role) &&
          others.some(
            (m) =>
              m.brand_id === body.brand_id &&
              ["owner", "editor", "viewer"].includes(m.role) &&
              m.role !== body.role,
          )
        )
          throw validation("customer roles mutually exclusive within a brand");
        if (body.replace_role) {
          const old = current.filter((m) => m.role === body.replace_role);
          if (!old.length) throw validation("role to replace missing");
          for (const m of old) {
            await ctx.client.query(
              "DELETE FROM user_member WHERE tenant_id=$1 AND id=$2",
              [tid, m.id],
            );
            event(
              ctx,
              "user_member.configure_remove_role",
              "user_member",
              m.id,
            );
          }
        }
        // Reconfiguration is an explicit operation, not a writable role field API.
        const existing = (
          await ctx.client.query(
            "SELECT id FROM user_member WHERE tenant_id=$1 AND user_id=$2 AND role=$3 AND brand_id IS NOT DISTINCT FROM $4",
            [tid, body.user_id, body.role, body.brand_id ?? null],
          )
        ).rows[0];
        let member = existing;
        if (!member)
          member = await insertRow(ctx, "user_member", {
            id: body.id ?? randomUUID(),
            tenant_id: tid,
            user_id: body.user_id,
            role: body.role,
            brand_id: body.brand_id ?? null,
          });
        for (const assignment of body.assignments ?? []) {
          if (
            !["content", "evidence"].includes(body.role) ||
            !["intent_cluster", "opportunity_card", "keyword_raw"].includes(
              assignment.object_type,
            )
          )
            throw validation("only scoped task assignments allowed");
          const table = assignment.object_type;
          const found = (
            await ctx.client.query(
              `SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2`,
              [tid, assignment.object_id],
            )
          ).rows[0];
          if (!found) throw permission();
          const row = await insertRow(ctx, "task_assignment", {
            id: randomUUID(),
            tenant_id: tid,
            user_id: body.user_id,
            object_type: table,
            object_id: assignment.object_id,
            assigned_by: ctx.principal.user_id,
          });
          event(
            ctx,
            "user_member.configure_assignment",
            "task_assignment",
            row.id,
          );
        }
        return {
          data: { id: member.id, user_id: body.user_id, role: body.role },
        };
      }
      const data = await provisioningOperations(ctx.client, {
        auditSink: ctx.audit.add,
      })(operation, {
        actor: ctx.principal,
        tenant_id: tid,
        body,
        params: ctx.params,
      });
      return { data, objectId: data.version_object_id ?? data.id };
    };
  handlers["tenant.read"] = async (ctx) => {
    const row = (
      await ctx.client.query(
        "SELECT id,name,mode,plan,created_at FROM tenant WHERE id=$1",
        [ctx.principal.tenant_id],
      )
    ).rows[0];
    if (!row) throw permission();
    row.quota_usage = Object.fromEntries(
      (
        await ctx.client.query(
          "SELECT operation_type,count(*)::integer AS n FROM operation_usage WHERE tenant_id=$1 GROUP BY operation_type",
          [ctx.principal.tenant_id],
        )
      ).rows.map((r) => [r.operation_type, r.n]),
    );
    return { data: row };
  };
  handlers["brand.read"] = async (ctx) => ({
    data: await getRow(ctx, "brand", ctx.params.id ?? ctx.scope.brand_id),
  });
  handlers["user_member.read"] = async (ctx) => ({
    data: await pageQuery(ctx, {
      table: "user_member",
      columns: "id,user_id,role,brand_id",
      where: "tenant_id=$1",
      values: [ctx.principal.tenant_id],
    }),
  });
  handlers["seed_list.create"] = async (ctx) => {
    required(ctx.body, [
      "industry",
      "word",
      "word_type",
      "maintainer",
      "last_reviewed_at",
      "seed_version",
    ]);
    if (ctx.body.status != null)
      throw validation("seed status enum reserved for T07");
    assertPublicRoot(
      ctx.body,
      ctx.publicRootCatalog,
      await privateMarkers(ctx.client),
    );
    const id = randomUUID();
    await ctx.client.query(
      "INSERT INTO seed_list(id,industry,word,word_type,maintainer,last_reviewed_at,seed_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        ctx.body.industry,
        ctx.body.word,
        ctx.body.word_type,
        ctx.body.maintainer,
        ctx.body.last_reviewed_at,
        ctx.body.seed_version,
      ],
    );
    return { data: { id, seed_version: ctx.body.seed_version, status: null } };
  };
  handlers["seed_list.read"] = async (ctx) => {
    const industry = ctx.query.industry ?? "B2B";
    const words = [...ctx.publicRootCatalog]
      .filter((key) => key.startsWith(industry + "\0"))
      .map((key) => key.split("\0")[1]);
    const markers = await privateMarkers(ctx.client);
    return {
      data: await pageQuery(ctx, {
        table: "seed_list",
        columns: "id,industry,word,word_type,seed_version",
        where:
          "industry=$1 AND word=ANY($2::text[]) AND word_type=ANY($3::text[])",
        values: [industry, words, ["品类", "场景", "问题"]],
        map: (row) => {
          assertPublicRoot(row, ctx.publicRootCatalog, markers);
          return row;
        },
      }),
    };
  };
  handlers["keyword_raw.import"] = async (ctx) => {
    required(ctx.body, ["industry", "keyword", "channel", "collected_at"]);
    if (ctx.body.channel === "C")
      throw validation(
        "C ingestion requires the separately reviewed authorization/redaction ETL; no raw-C write shortcut",
      );
    const row = await insertRow(ctx, "keyword_raw", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      industry: ctx.body.industry,
      keyword: ctx.body.keyword,
      channel: ctx.body.channel,
      demand_index: ctx.body.demand_index ?? null,
      trend_dir: ctx.body.trend_dir ?? "flat",
      first_seen_at: ctx.body.collected_at,
      collected_at: ctx.body.collected_at,
      raw_payload: json(ctx.body.raw_payload ?? {}),
    });
    return { data: { id: row.id, added: 1, duplicate: 0, rejected: 0 } };
  };
  handlers["keyword_raw.read"] = async (ctx) => {
    const data = await pageQuery(ctx, {
      table: "keyword_raw",
      columns:
        "id,industry,keyword,channel,demand_index,trend_dir,collected_at",
      where: "tenant_id=$1",
      values: [ctx.principal.tenant_id],
    });
    for (const row of data.items)
      if (row.channel === "C")
        event(ctx, "keyword_raw.read", "keyword_raw", row.id);
    return { data };
  };
  handlers["keyword_raw.read_raw"] = async (ctx) => {
    const row = (
      await ctx.client.query(
        "SELECT id,channel,raw_payload FROM keyword_raw WHERE tenant_id=$1 AND id=$2",
        [ctx.principal.tenant_id, ctx.params.id],
      )
    ).rows[0];
    if (!row) throw permission();
    return { data: row, sensitive: true };
  };
  handlers["keyword_pool_snapshot.append"] = async (ctx) => {
    required(ctx.body, ["industry", "seed_version"]);
    if (
      ![...ctx.publicRootCatalog].some((key) =>
        key.startsWith(ctx.body.industry + "\0"),
      )
    )
      throw validation("unlicensed industry");
    await ctx.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      ["pool:" + ctx.body.industry],
    );
    const version = Number(
      (
        await ctx.client.query(
          "SELECT coalesce(max(pool_version),0)+1 AS v FROM keyword_pool_snapshot WHERE industry=$1",
          [ctx.body.industry],
        )
      ).rows[0].v,
    );
    const counts = (
      await ctx.client.query(
        "SELECT channel,count(*)::integer AS n FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 GROUP BY channel",
        [ctx.principal.tenant_id, ctx.body.industry],
      )
    ).rows;
    const row = (
      await ctx.client.query(
        "INSERT INTO keyword_pool_snapshot(pool_version,industry,seed_version,counts_by_channel,cluster_count) VALUES($1,$2,$3,$4,0) RETURNING pool_version,industry,seed_version,counts_by_channel,cluster_count",
        [
          version,
          ctx.body.industry,
          ctx.body.seed_version,
          json(Object.fromEntries(counts.map((r) => [r.channel, r.n]))),
        ],
      )
    ).rows[0];
    await appendMachinePercentiles(ctx, row);
    return { data: row, objectId: ctx.body.industry + ":" + version };
  };
  handlers["keyword_pool_snapshot.read"] = async (ctx) => {
    if (ctx.query.view === "percentiles")
      return {
        data: await pageQuery(ctx, {
          table: "w_pool_percentile",
          columns:
            "industry,public_cluster_key,pool_version,demand_index,percentile,producer,basis_note,computed_at",
          where: "industry=$1 AND pool_version=$2",
          values: [ctx.query.industry ?? "B2B", ctx.query.pool_version],
          order: [["public_cluster_key", "ASC"]],
        }),
      };
    return {
      data: await pageQuery(ctx, {
        table: "keyword_pool_snapshot",
        columns:
          "pool_version,industry,seed_version,counts_by_channel,cluster_count,created_at",
        where: "industry=$1",
        values: [ctx.query.industry ?? "B2B"],
        order: [["pool_version", "DESC"]],
      }),
    };
  };
  handlers["intent_cluster.transition"] = async (ctx) => {
    if (ctx.params.id) {
      const row = await getRow(ctx, "intent_cluster", ctx.params.id, {
        lock: true,
      });
      if (row.status !== "active") throw conflict();
      const updated = await change(ctx, "intent_cluster", row.id, {
        pool_version: ctx.body.pool_version,
      });
      return { data: updated };
    }
    required(ctx.body, ["brand_id", "name", "intent_type", "pool_version"]);
    const row = await insertRow(ctx, "intent_cluster", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      brand_id: ctx.body.brand_id,
      name: ctx.body.name,
      intent_type: ctx.body.intent_type,
      status: "active",
      pool_version: ctx.body.pool_version,
    });
    return { data: row };
  };
  handlers["intent_cluster.read"] = async (ctx) => ({
    data: await getRow(ctx, "intent_cluster", ctx.params.id),
  });
  handlers["question_pool.create"] = async (ctx) => {
    required(ctx.body, [
      "cluster_id",
      "question",
      "source_word_id",
      "intent_type",
      "source_channel",
      "collected_at",
      "maintainer",
      "question_pool_version",
    ]);
    const cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id);
    if (cluster.status !== "active") throw conflict();
    if (
      (
        await ctx.client.query(
          "SELECT id FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 AND frozen=true LIMIT 1",
          [ctx.principal.tenant_id, cluster.id, ctx.body.question_pool_version],
        )
      ).rowCount
    )
      throw conflict("frozen version cannot grow");
    const source = (
      await ctx.client.query(
        "SELECT id,channel FROM keyword_raw WHERE tenant_id=$1 AND id=$2",
        [ctx.principal.tenant_id, ctx.body.source_word_id],
      )
    ).rows[0];
    if (!source) throw validation("source_word_id not found");
    if (source.channel !== ctx.body.source_channel)
      throw validation("source channel disagrees with provenance");
    const row = await insertRow(ctx, "question_pool", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      cluster_id: cluster.id,
      question: ctx.body.question,
      source_word_id: ctx.body.source_word_id,
      intent_type: ctx.body.intent_type,
      source_channel: ctx.body.source_channel,
      collected_at: ctx.body.collected_at,
      maintainer: ctx.body.maintainer,
      question_pool_version: ctx.body.question_pool_version,
      frozen: false,
    });
    return { data: row };
  };
  handlers["question_pool.read"] = async (ctx) => ({
    data: await getRow(ctx, "question_pool", ctx.params.id),
  });
  handlers["question_pool.freeze"] = async (ctx) => {
    const cluster = ctx.body.cluster_id ?? ctx.scope.clusterId;
    required({ cluster }, ["cluster"]);
    const rows = (
      await ctx.client.query(
        "SELECT id,frozen FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 ORDER BY id FOR UPDATE",
        [ctx.principal.tenant_id, cluster, ctx.body.question_pool_version ?? 1],
      )
    ).rows;
    if (rows.length !== 3)
      throw validation("frozen measurement set requires three questions");
    for (const q of rows) {
      if (q.frozen) throw conflict("already frozen");
      await change(ctx, "question_pool", q.id, { frozen: true });
      event(ctx, "question_pool.freeze", "question_pool", q.id);
    }
    return {
      data: {
        cluster_id: cluster,
        question_pool_version: ctx.body.question_pool_version ?? 1,
        frozen: true,
        question_ids: rows.map((q) => q.id),
      },
      objectId: cluster,
    };
  };
  handlers["question_pool.revise"] = async (ctx) => {
    required(ctx.body, ["question", "question_pool_version", "reason"]);
    const old = await getRow(ctx, "question_pool", ctx.params.id);
    if (
      !old.frozen ||
      ctx.body.question_pool_version <= old.question_pool_version
    )
      throw conflict("revision requires newer version");
    const { id, ...fields } = old;
    const row = await insertRow(ctx, "question_pool", {
      ...fields,
      id: randomUUID(),
      question: ctx.body.question,
      question_pool_version: ctx.body.question_pool_version,
      frozen: false,
      archived_at: null,
    });
    return { data: row };
  };
  handlers["question_pool.upgrade_anchor"] = async (ctx) => {
    required(ctx.body, [
      "cluster_id",
      "question_pool_version",
      "question_ids",
      "reason",
    ]);
    const cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id, {
      lock: true,
    });
    if (
      cluster.question_pool_version != null &&
      ctx.body.question_pool_version <= cluster.question_pool_version
    )
      throw conflict("anchor must advance manually");
    const rows = (
      await ctx.client.query(
        "SELECT id,frozen FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 AND id=ANY($4::text[])",
        [
          ctx.principal.tenant_id,
          cluster.id,
          ctx.body.question_pool_version,
          ctx.body.question_ids,
        ],
      )
    ).rows;
    if (
      rows.length !== 3 ||
      new Set(ctx.body.question_ids).size !== 3 ||
      rows.some((r) => !r.frozen)
    )
      throw validation("anchor needs the same three frozen IDs");
    const row = await change(ctx, "intent_cluster", cluster.id, {
      question_pool_version: ctx.body.question_pool_version,
    });
    return { data: row };
  };
  handlers["scoring_snapshot.create"] = async (ctx) => {
    required(ctx.body, [
      "pool_version",
      "question_pool_version",
      "model_set",
      "temperature_set",
      "rounds",
      "judge_version",
      "grounding_mode",
    ]);
    if (
      !Array.isArray(ctx.body.model_set) ||
      new Set(ctx.body.model_set).size !== 4 ||
      ctx.body.model_set.some((id) => typeof id !== "string" || !id.trim()) ||
      ctx.body.model_set.length !== 4 ||
      ctx.body.rounds !== 3 ||
      JSON.stringify(ctx.body.temperature_set) !==
        JSON.stringify(
          ctx.body.grounding_mode === "search_off" ? [0] : [0, 0.7],
        )
    )
      throw validation("MVP sampling config mismatch");
    const row = await insertRow(ctx, "scoring_snapshot", {
      snapshot_id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      pool_version: ctx.body.pool_version,
      question_pool_version: ctx.body.question_pool_version,
      model_set: json(ctx.body.model_set),
      temperature_set: ctx.body.temperature_set,
      rounds: ctx.body.rounds,
      judge_version: ctx.body.judge_version,
      grounding_mode: ctx.body.grounding_mode,
      frozen: false,
    });
    return { data: row };
  };
  handlers["scoring_snapshot.read"] = async (ctx) => ({
    data: await getRow(ctx, "scoring_snapshot", ctx.params.id, {
      key: "snapshot_id",
    }),
  });
  handlers["scoring_snapshot.freeze"] = async (ctx) => {
    const row = await getRow(ctx, "scoring_snapshot", ctx.params.id, {
      lock: true,
      key: "snapshot_id",
    });
    if (row.frozen) throw conflict();
    if (!["search_on", "search_off"].includes(row.grounding_mode))
      throw validation("grounding track is reserved, not implemented");
    const manifest = {};
    for (const model of row.model_set) {
      const capability = await ctx.modelCapabilities(model, row.grounding_mode);
      if (
        !capability ||
        capability.nativeSearch !== true ||
        (row.grounding_mode === "search_on" &&
          capability.searchEnabled !== true) ||
        (row.grounding_mode === "search_off" &&
          capability.searchEnabled !== false)
      )
        throw validation("native network search is not enabled or verified");
      if (
        typeof capability.modelVersion !== "string" ||
        !capability.modelVersion.trim()
      )
        throw validation("model version required");
      manifest[model] = capability.modelVersion;
    }
    return {
      data: await change(
        ctx,
        "scoring_snapshot",
        row.snapshot_id,
        { frozen: true, model_version_manifest: json(manifest) },
        { key: "snapshot_id" },
      ),
    };
  };
  handlers["brand_lexicon.read"] = async (ctx) => {
    const rows = (
      await ctx.client.query(
        "SELECT id,brand_id,version,kind,term,created_by,created_at FROM brand_lexicon WHERE tenant_id=$1 AND brand_id=$2 AND version=$3 ORDER BY id",
        [
          ctx.principal.tenant_id,
          ctx.scope.brand_id,
          ctx.query.version ?? ctx.body.version ?? 1,
        ],
      )
    ).rows;
    return {
      data: {
        brand_id: ctx.scope.brand_id,
        version: ctx.query.version ?? 1,
        entries: rows,
      },
      objectId: ctx.scope.brand_id,
    };
  };
  handlers["official_fact.read"] = async (ctx) => ({
    data: await pageQuery(ctx, {
      table: "official_fact",
      columns:
        "id,tenant_id,brand_id,fact_category,content,source_level,status,effective_from,product_line_ref",
      where: "tenant_id=$1 AND brand_id=$2",
      values: [ctx.principal.tenant_id, ctx.scope.brand_id],
    }),
  });
  handlers["official_fact.retract"] = async (ctx) => {
    required(ctx.body, ["reason"]);
    const row = await getRow(ctx, "official_fact", ctx.params.id, {
      lock: true,
    });
    if (row.status !== "approved") throw conflict();
    return {
      data: await change(ctx, "official_fact", row.id, { status: "retracted" }),
    };
  };
  handlers["opportunity_card.create"] = async (ctx) => {
    required(ctx.body, [
      "cluster_id",
      "pool_version",
      "snapshot_id",
      "demand_tier",
      "demand_source",
    ]);
    const cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id);
    const snapshot = await getRow(
      ctx,
      "scoring_snapshot",
      ctx.body.snapshot_id,
      { key: "snapshot_id" },
    );
    if (!snapshot.frozen)
      throw validation("sampling configuration must be frozen");
    const row = await insertRow(ctx, "opportunity_card", {
      id: randomUUID(),
      tenant_id: ctx.principal.tenant_id,
      brand_id: cluster.brand_id,
      intent_cluster_id: cluster.id,
      pool_version: ctx.body.pool_version,
      seed_terms: ctx.body.seed_terms ?? [],
      demand_tier: ctx.body.demand_tier,
      demand_source: ctx.body.demand_source,
      snapshot_id: snapshot.snapshot_id,
      status: "candidate",
    });
    return { data: publicCard(row) };
  };
  handlers["opportunity_card.read"] = async (ctx) => ({
    data: publicCard(await getRow(ctx, "opportunity_card", ctx.params.id)),
  });
  return handlers;
}
export const limit = (q) => {
  const n = Number(q.limit ?? 20);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw validation("limit must be 1..100");
  return n;
};
function publicCard(row) {
  return {
    id: row.id,
    cluster_id: row.intent_cluster_id,
    pool_version: row.pool_version,
    snapshot_id: row.snapshot_id,
    demand_tier: row.demand_tier,
    demand_source: row.demand_source,
    status: opportunityStatusToApi(row.status),
  };
}
