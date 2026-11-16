import { randomUUID } from "node:crypto";
import {
  required,
  getRow,
  insertRow,
  change,
  conflict,
  event,
} from "./domain-common.mjs";
import { validation } from "./errors.mjs";
import { pageQuery } from "./pagination.mjs";
import { assignmentPredicate } from "./assignment-scope.mjs";
import { importAuthorization, redactImportText } from "./import-redaction.mjs";

const intents = ["认知", "选型对比", "价格", "场景方案", "排障", "替代/否定"];
const fields = [
  "question",
  "source_word_id",
  "intent_type",
  "source_channel",
  "collected_at",
  "maintainer",
  "question_pool_version",
];
export function questionVersion(ctx) {
  const body = ctx.body.question_pool_version;
  const route = ctx.params.version;
  if (route != null && !/^[1-9]\d*$/.test(String(route)))
    throw validation("版本必须是正整数");
  const value = body ?? (route != null ? Number(route) : 1);
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw validation("版本必须是正整数");
  if (route != null && Number(route) !== value)
    throw validation("路径与请求版本不一致");
  return value;
}
const lockVersion = (ctx, brand, version) =>
  ctx.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `question-version:${ctx.principal.tenant_id}:${brand}:${version}`,
  ]);
async function writableVersion(ctx, brand, version, clusterId) {
  await lockVersion(ctx, brand, version);
  const sealed = await ctx.client.query(
    "SELECT 1 FROM question_pool q JOIN intent_cluster c ON c.tenant_id=q.tenant_id AND c.id=q.cluster_id WHERE q.tenant_id=$1 AND c.brand_id=$2 AND q.question_pool_version=$3 AND (q.frozen OR q.archived_at IS NOT NULL) LIMIT 1",
    [ctx.principal.tenant_id, brand, version],
  );
  if (sealed.rowCount) throw conflict("已冻结版本不能追加；请开新版本");
  const count = Number(
    (
      await ctx.client.query(
        "SELECT count(*) AS n FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3",
        [ctx.principal.tenant_id, clusterId, version],
      )
    ).rows[0].n,
  );
  if (count >= 3) throw validation("每簇每版本最多三条问句");
}
async function provenance(ctx, input, cluster) {
  required(input, fields);
  for (const key of fields.filter((k) => k !== "question_pool_version"))
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      input[key].includes("\0")
    )
      throw validation("问句与溯源字段必须为非空文本", { field: key });
  if (
    !intents.includes(input.intent_type) ||
    !["A", "B", "C", "D"].includes(input.source_channel)
  )
    throw validation("意图或来源渠道无效");
  const date = input.collected_at;
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 19) !== date.slice(0, 19)
  )
    throw validation("采集时间必须为有效UTC ISO-8601");
  const source = (
    await ctx.client.query(
      "SELECT id,channel,industry,authorization_ref,redaction_policy_version FROM keyword_raw WHERE tenant_id=$1 AND id=$2",
      [ctx.principal.tenant_id, input.source_word_id],
    )
  ).rows[0];
  if (!source) throw validation("来源记录不存在");
  if (source.channel !== input.source_channel)
    throw validation("来源渠道与记录不一致");
  const brand = await getRow(ctx, "brand", cluster.brand_id);
  if (source.industry !== brand.industry)
    throw validation("来源与品牌行业不一致");
  let question = input.question.trim(),
    reason = ctx.body.reason ?? null;
  if (reason != null && typeof reason !== "string")
    throw validation("理由必须为文本");
  if (source.channel === "C") {
    event(ctx, "keyword_raw.question_source_read", "keyword_raw", source.id, {
      cause_event_id: ctx.rootEventId,
    });
    if (!source.authorization_ref || !source.redaction_policy_version)
      throw validation("C类来源缺少可核验授权");
    const auth = await importAuthorization(ctx, source.authorization_ref);
    question = redactImportText(question, auth.redaction_policy);
    reason = JSON.stringify({
      reason:
        reason == null ? null : redactImportText(reason, auth.redaction_policy),
      authorization_ref: auth.ref,
      redaction_policy_version: auth.redaction_policy.version,
    });
  }
  return {
    fields: Object.fromEntries(
      fields.map((key) => [
        key,
        key === "question"
          ? question
          : key === "collected_at"
            ? new Date(date).toISOString()
            : input[key],
      ]),
    ),
    reason,
  };
}
async function versionRows(ctx, version) {
  const brand = ctx.scope.brand_id;
  if (!brand) throw validation("请选择品牌");
  await lockVersion(ctx, brand, version);
  const rows = (
    await ctx.client.query(
      "SELECT q.* FROM question_pool q JOIN intent_cluster c ON c.tenant_id=q.tenant_id AND c.id=q.cluster_id WHERE q.tenant_id=$1 AND c.brand_id=$2 AND q.question_pool_version=$3 ORDER BY q.id FOR UPDATE OF q",
      [ctx.principal.tenant_id, brand, version],
    )
  ).rows;
  if (!rows.length) throw validation("问句版本不存在");
  return rows;
}
function auditQuestionReads(ctx, rows) {
  const sensitive = rows.filter((q) => q.source_channel === "C");
  for (const q of sensitive)
    event(ctx, "question_pool.read", "question_pool", q.id);
  return sensitive.length > 0;
}
export async function listClusters(ctx) {
  const restricted = ["content", "evidence"].includes(ctx.principal.role);
  const values = [ctx.principal.tenant_id, ctx.scope.brand_id];
  let where = "c.tenant_id=$1 AND c.brand_id=$2";
  if (restricted) {
    values.push(ctx.principal.user_id);
    where +=
      " AND " +
      assignmentPredicate({
        tenant: "c.tenant_id",
        cluster: "c.id",
        source: "q.source_word_id",
        user: "$3",
      });
  }
  return {
    data: await pageQuery(ctx, {
      table:
        "intent_cluster c LEFT JOIN question_pool q ON q.tenant_id=c.tenant_id AND q.cluster_id=c.id",
      columns:
        "DISTINCT c.id,c.brand_id,c.name,c.intent_type,c.status,c.question_pool_version",
      where,
      values,
      order: [["c.id", "ASC"]],
    }),
  };
}
export function questionPoolHandlers() {
  return {
    "question_pool.delete": async (ctx) => {
      if (ctx.body.confirmed !== true) throw validation("请确认删除问句草稿");
      required(ctx.body, ["question_pool_version"]);
      const version = questionVersion(ctx);
      const readDraft = async (lock = false) =>
        (
          await ctx.client.query(
            "SELECT id,cluster_id,source_word_id,question_pool_version,frozen,archived_at FROM question_pool WHERE tenant_id=$1 AND id=$2" +
              (lock ? " FOR UPDATE" : ""),
            [ctx.principal.tenant_id, ctx.params.id],
          )
        ).rows[0];
      const initial = await readDraft();
      if (!initial) throw conflict("该问句草稿已删除");
      // Same lock order as anchoring: cluster first, then brand/version. Reread
      // after the lock so a concurrent freeze cannot leave a stale draft check.
      // NO KEY UPDATE still serializes anchor changes, while allowing the FK
      // KEY SHARE lock of a simultaneous draft insert to finish before we wait
      // on its brand/version lock.
      const cluster = (
        await ctx.client.query(
          "SELECT id,brand_id,question_pool_version FROM intent_cluster WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE",
          [ctx.principal.tenant_id, initial.cluster_id],
        )
      ).rows[0];
      if (!cluster) throw conflict("问句关联簇已不可用");
      await lockVersion(ctx, cluster.brand_id, initial.question_pool_version);
      const row = await readDraft(true);
      if (!row || row.question_pool_version !== version)
        throw conflict("问句版本已变更或草稿已删除");
      const sealed = await ctx.client.query(
        "SELECT 1 FROM question_pool q JOIN intent_cluster c ON c.tenant_id=q.tenant_id AND c.id=q.cluster_id WHERE q.tenant_id=$1 AND c.brand_id=$2 AND q.question_pool_version=$3 AND (q.frozen OR q.archived_at IS NOT NULL) LIMIT 1",
        [ctx.principal.tenant_id, cluster.brand_id, version],
      );
      if (row.frozen || row.archived_at || sealed.rowCount)
        throw conflict("冻结或归档版本不可删除，请修订新版本");
      const referenced = (
        await ctx.client.query(
          `SELECT EXISTS(SELECT 1 FROM probe WHERE tenant_id=$1 AND question_id=$2)
          OR EXISTS(SELECT 1 FROM question_score WHERE tenant_id=$1 AND question_id=$2)
          OR EXISTS(SELECT 1 FROM probe_batch WHERE tenant_id=$1 AND cluster_question_sets @> $3::jsonb) AS used`,
          [
            ctx.principal.tenant_id,
            row.id,
            JSON.stringify([{ question_ids: [row.id] }]),
          ],
        )
      ).rows[0].used;
      if (cluster.question_pool_version === version || referenced)
        throw conflict("已锚定或被批次/评分引用的问句不可删除");
      await ctx.client.query(
        "DELETE FROM question_pool WHERE tenant_id=$1 AND id=$2",
        [ctx.principal.tenant_id, row.id],
      );
      return {
        data: { id: row.id, deleted: true, question_pool_version: version },
        objectId: row.id,
        auditMeta: {
          reason: JSON.stringify({
            operation: "question_pool.delete",
            brand_id: cluster.brand_id,
            cluster_id: row.cluster_id,
            source_word_id: row.source_word_id,
            question_pool_version: version,
          }),
        },
      };
    },
    "question_pool.create": async (ctx) => {
      required(ctx.body, ["cluster_id", ...fields]);
      const version = questionVersion(ctx);
      const cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id);
      if (cluster.status !== "active") throw conflict("归档簇不能新增问句");
      await writableVersion(ctx, cluster.brand_id, version, cluster.id);
      const checked = await provenance(
        ctx,
        { ...ctx.body, question_pool_version: version },
        cluster,
      );
      return {
        data: await insertRow(ctx, "question_pool", {
          id: randomUUID(),
          tenant_id: ctx.principal.tenant_id,
          cluster_id: cluster.id,
          ...checked.fields,
          frozen: false,
        }),
        auditMeta: { reason: checked.reason },
      };
    },
    "question_pool.read": async (ctx) => {
      if (ctx.params.id) {
        const row = await getRow(ctx, "question_pool", ctx.params.id);
        return { data: row, sensitive: auditQuestionReads(ctx, [row]) };
      }
      if (!["list", "versions"].includes(ctx.query.view))
        throw validation("请选择问句或列表视图");
      const restricted = ["content", "evidence"].includes(ctx.principal.role);
      const values = [ctx.principal.tenant_id, ctx.scope.brand_id];
      let where = "q.tenant_id=$1 AND c.brand_id=$2";
      if (ctx.query.cluster_id) {
        values.push(ctx.query.cluster_id);
        where += ` AND q.cluster_id=$${values.length}`;
      }
      if (ctx.query.question_pool_version != null) {
        const v = Number(ctx.query.question_pool_version);
        if (!Number.isInteger(v) || v < 1) throw validation("版本必须是正整数");
        values.push(v);
        where += ` AND q.question_pool_version=$${values.length}`;
      }
      if (restricted) {
        values.push(ctx.principal.user_id);
        where +=
          " AND " +
          assignmentPredicate({
            tenant: "q.tenant_id",
            cluster: "q.cluster_id",
            source: "q.source_word_id",
            user: "$" + values.length,
          });
      }
      const from =
        "question_pool q JOIN intent_cluster c ON c.tenant_id=q.tenant_id AND c.id=q.cluster_id";
      let data, sensitive;
      if (ctx.query.view === "versions") {
        data = await pageQuery(ctx, {
          table: `(SELECT q.question_pool_version,count(*)::integer AS question_count,count(DISTINCT q.cluster_id)::integer AS cluster_count,bool_and(q.frozen) AS frozen,bool_or(q.frozen) AS locked,bool_and(q.archived_at IS NOT NULL) AS archived FROM ${from} WHERE ${where} GROUP BY q.question_pool_version) v`,
          columns: "v.*",
          where: "true",
          values,
          order: [["v.question_pool_version", "DESC"]],
        });
        const versions = data.items.map((v) => v.question_pool_version);
        const used = (
          await ctx.client.query(
            `SELECT q.id,q.source_channel FROM ${from} WHERE ${where} AND q.source_channel='C' AND q.question_pool_version=ANY($${values.length + 1}::integer[])`,
            [...values, versions],
          )
        ).rows;
        sensitive = auditQuestionReads(ctx, used);
      } else {
        data = await pageQuery(ctx, {
          table: from,
          columns: "q.*",
          where,
          values,
          order: [
            ["q.question_pool_version", "DESC"],
            ["q.id", "DESC"],
          ],
        });
        sensitive = auditQuestionReads(ctx, data.items);
      }
      const latest = restricted
        ? null
        : Number(
            (
              await ctx.client.query(
                `SELECT coalesce(max(q.question_pool_version),0) AS n FROM ${from} WHERE q.tenant_id=$1 AND c.brand_id=$2`,
                [ctx.principal.tenant_id, ctx.scope.brand_id],
              )
            ).rows[0].n,
          );
      return {
        data: { ...data, next_version: latest == null ? null : latest + 1 },
        sensitive,
      };
    },
    "question_pool.freeze": async (ctx) => {
      const version = questionVersion(ctx),
        rows = await versionRows(ctx, version);
      if (rows.some((q) => q.frozen || q.archived_at))
        throw conflict("版本已冻结或归档");
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row.cluster_id)) groups.set(row.cluster_id, []);
        groups.get(row.cluster_id).push(row);
      }
      for (const [id, qs] of groups) {
        if (qs.length !== 3) throw validation("版本内每簇必须有三条问句");
        const cluster = await getRow(ctx, "intent_cluster", id);
        if (cluster.status !== "active") throw conflict("归档簇不能冻结新问句");
        for (const q of qs) {
          const checked = await provenance(
            ctx,
            { ...q, collected_at: new Date(q.collected_at).toISOString() },
            cluster,
          );
          if (checked.fields.question !== q.question)
            throw validation("问句未按当前授权脱敏，不能冻结");
        }
      }
      for (const row of rows) {
        await change(ctx, "question_pool", row.id, { frozen: true });
        event(ctx, "question_pool.freeze", "question_pool", row.id);
      }
      return {
        data: {
          cluster_id: ctx.body.cluster_id ?? null,
          question_pool_version: version,
          frozen: true,
          question_ids: rows.slice(0, 100).map((q) => q.id),
          references_truncated: rows.length > 100,
          question_count: rows.length,
          cluster_count: groups.size,
        },
        objectId: ctx.scope.brand_id + ":" + version,
      };
    },
    "question_pool.revise": async (ctx) => {
      required(ctx.body, ["question", "question_pool_version", "reason"]);
      if (typeof ctx.body.reason !== "string")
        throw validation("修订理由必须为文本");
      const old = await getRow(ctx, "question_pool", ctx.params.id),
        version = questionVersion(ctx);
      if (!old.frozen || version <= old.question_pool_version)
        throw conflict("修订必须从冻结记录开新版本");
      const cluster = await getRow(ctx, "intent_cluster", old.cluster_id);
      if (cluster.status !== "active") throw conflict("归档簇不能修订");
      await writableVersion(ctx, cluster.brand_id, version, cluster.id);
      if (old.source_channel === "C")
        event(
          ctx,
          "question_pool.revision_source_read",
          "question_pool",
          old.id,
        );
      const checked = await provenance(
        ctx,
        {
          ...old,
          question: ctx.body.question,
          collected_at: new Date(old.collected_at).toISOString(),
          question_pool_version: version,
        },
        cluster,
      );
      return {
        data: await insertRow(ctx, "question_pool", {
          id: randomUUID(),
          tenant_id: ctx.principal.tenant_id,
          cluster_id: old.cluster_id,
          ...checked.fields,
          frozen: false,
        }),
        auditMeta: { reason: checked.reason },
      };
    },
    "question_pool.upgrade_anchor": async (ctx) => {
      required(ctx.body, [
        "cluster_id",
        "question_pool_version",
        "question_ids",
        "reason",
      ]);
      const version = questionVersion(ctx);
      if (
        !Array.isArray(ctx.body.question_ids) ||
        ctx.body.question_ids.length !== 3 ||
        new Set(ctx.body.question_ids).size !== 3 ||
        ctx.body.question_ids.some((id) => typeof id !== "string") ||
        typeof ctx.body.reason !== "string"
      )
        throw validation("需三条不同问句及升级理由");
      const cluster = await getRow(ctx, "intent_cluster", ctx.body.cluster_id, {
        lock: true,
      });
      if (
        cluster.status !== "active" ||
        (cluster.question_pool_version != null &&
          version <= cluster.question_pool_version)
      )
        throw conflict("锚定只能显式升级至新版本");
      await lockVersion(ctx, cluster.brand_id, version);
      const rows = (
        await ctx.client.query(
          "SELECT id,frozen,archived_at FROM question_pool WHERE tenant_id=$1 AND cluster_id=$2 AND question_pool_version=$3 ORDER BY id",
          [ctx.principal.tenant_id, cluster.id, version],
        )
      ).rows;
      if (
        rows.length !== 3 ||
        rows.some((q) => !q.frozen || q.archived_at) ||
        JSON.stringify(rows.map((q) => q.id).sort()) !==
          JSON.stringify([...ctx.body.question_ids].sort())
      )
        throw validation("只能锚定同簇未归档的完整冻结问句集合");
      const before = cluster.question_pool_version;
      const row = await change(ctx, "intent_cluster", cluster.id, {
        question_pool_version: version,
      });
      event(ctx, "intent_cluster.upgrade", "intent_cluster", cluster.id, {
        reason: JSON.stringify({
          reason: ctx.body.reason,
          previous_question_pool_version: before,
          question_pool_version: version,
          question_ids: ctx.body.question_ids,
        }),
        cause_event_id: ctx.rootEventId,
      });
      return {
        data: {
          ...row,
          cluster_id: row.id,
          previous_question_pool_version: before,
          baseline_required: true,
        },
      };
    },
    "question_pool.archive": async (ctx) => {
      required(ctx.body, ["reason"]);
      if (typeof ctx.body.reason !== "string")
        throw validation("归档理由必须为文本");
      const version = questionVersion(ctx),
        rows = await versionRows(ctx, version);
      if (rows.some((q) => !q.frozen || q.archived_at))
        throw conflict("仅冻结版本可归档一次");
      for (const row of rows) {
        await change(ctx, "question_pool", row.id, {
          archived_at: new Date(ctx.now()).toISOString(),
        });
        event(ctx, "question_pool.archive", "question_pool", row.id, {
          reason: ctx.body.reason,
        });
      }
      return {
        data: {
          question_pool_version: version,
          state: "archived",
          question_count: rows.length,
        },
        objectId: ctx.scope.brand_id + ":" + version,
      };
    },
  };
}
