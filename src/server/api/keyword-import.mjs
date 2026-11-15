import { randomUUID } from "node:crypto";
import { parseCsv } from "./csv.mjs";
import { keywordHash, normalizationVersion } from "./keyword-normalization.mjs";
import { importAuthorization, redactImportText } from "./import-redaction.mjs";
import { required, event } from "./domain-common.mjs";
import { validation, permission } from "./errors.mjs";
import { canonicalJson } from "./canonical-json.mjs";

const aliases = {
  关键词: "keyword",
  词: "keyword",
  采集时间: "collected_at",
  热度指数: "demand_index",
  渠道: "channel",
  行业: "industry",
  趋势: "trend_dir",
};
function utc(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  )
    throw validation("采集时间必须是UTC ISO-8601");
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    Number(value.slice(0, 4)) < 1 ||
    new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw validation("采集时间无效");
  return new Date(time).toISOString();
}
function payload(value) {
  if (value == null || value === "") return {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw validation("原始载荷不是有效JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validation("原始载荷必须为对象");
  if (JSON.stringify(value).includes('"search_volume"'))
    throw validation("不接受绝对搜索量字段");
  if (JSON.stringify(value).includes("\\u0000"))
    throw validation("原始载荷含无效字符");
  return value;
}
async function records(ctx) {
  const b = ctx.body;
  if (b.csv != null && b.csv_ref != null)
    throw validation("CSV内容与引用只能选择一种");
  if (b.csv == null && b.csv_ref == null) {
    if (b.channel === "C") throw validation("C类仅允许授权CSV入口");
    return { single: true, rows: [b] };
  }
  let text = b.csv;
  if (b.csv_ref != null) {
    const file = await ctx.loadImportCsv({
      tenant_id: ctx.principal.tenant_id,
      csv_ref: b.csv_ref,
    });
    if (!file || file.tenant_id !== ctx.principal.tenant_id)
      throw permission("CSV引用不属于当前租户");
    text = file.content;
  }
  if (typeof text !== "string" || Buffer.byteLength(text) > 1048576)
    throw validation("CSV内容无效或超过1MiB");
  const [rawHeaders, ...cells] = parseCsv(text);
  if (!rawHeaders) throw validation("CSV不能为空");
  const headers = rawHeaders.map((value) => {
    const name = value.normalize("NFKC").trim().toLowerCase();
    return aliases[name] ?? name;
  });
  if (headers.includes("search_volume"))
    throw validation("仅接受需求指数，不接受绝对搜索量");
  if (!headers.includes("keyword") || new Set(headers).size !== headers.length)
    throw validation("CSV需唯一keyword列");
  return {
    single: false,
    rows: cells.map((row) =>
      row.length !== headers.length
        ? { invalid: true }
        : Object.fromEntries(headers.map((key, i) => [key, row[i]])),
    ),
  };
}
function prepare(ctx, row, auth) {
  const b = ctx.body;
  if (row.invalid) throw validation("CSV列数不匹配");
  if (row.channel && row.channel.trim() !== b.channel)
    throw validation("行渠道必须与批次一致");
  if (row.industry && row.industry.trim() !== b.industry)
    throw validation("行行业必须与批次一致");
  required(row, ["keyword"]);
  if (typeof row.keyword !== "string") throw validation("关键词必须为文本");
  const raw = payload(row.raw_payload);
  const policy = auth?.redaction_policy;
  let sourceId;
  if (!policy) {
    const values = [row.source_id, b.source_id, raw.source_id].filter((value) => value != null && value !== "");
    if (values.some((value) => typeof value !== "string" || !value.trim() || value.trim().length > 256))
      throw validation("来源标识无效");
    const ids = [...new Set(values.map((value) => value.trim()))];
    if (ids.length > 1) throw validation("行内来源标识与文件来源标识冲突");
    sourceId = ids[0];
  }
  const keyword = policy
    ? redactImportText(row.keyword, policy)
    : row.keyword.trim();
  const hash = keywordHash(keyword);
  const collected = row.collected_at || b.collected_at;
  const time = utc(
    typeof collected === "string" ? collected.trim() : collected,
  );
  const indexValue =
    typeof row.demand_index === "string"
      ? row.demand_index.trim()
      : row.demand_index;
  if (indexValue != null && !["number", "string"].includes(typeof indexValue))
    throw validation("需求指数无效");
  if (
    typeof indexValue === "string" &&
    indexValue !== "" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(indexValue)
  )
    throw validation("需求指数无效");
  const index =
    indexValue == null || indexValue === "" ? null : Number(indexValue);
  if (index !== null && !Number.isFinite(index))
    throw validation("需求指数无效");
  const trend = row.trend_dir || null;
  if (trend && !["up", "flat", "down"].includes(trend))
    throw validation("趋势枚举无效");
  // Never persist the entire CSV row, structured identity columns, or C URLs.
  const raw_payload = policy
    ? {
        excerpt: redactImportText(
          raw.excerpt ?? row.excerpt ?? row.keyword,
          policy,
        ),
        authorization_ref: b.authorization_ref,
        redaction_policy_version: policy.version,
      }
    : {
        ...raw,
        ...(sourceId ? { source_id: sourceId } : {}),
        ...(row.excerpt ? { excerpt: row.excerpt } : {}),
        ...(row.url || row.source_url
          ? { url: row.url || row.source_url }
          : {}),
      };
  return { keyword, hash, time, index, trend, raw_payload };
}
async function legacyIndex(ctx) {
  const b = ctx.body,
    tid = ctx.principal.tenant_id;
  if (b.channel === "C") {
    if (
      (
        await ctx.client.query(
          "SELECT id FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND channel='C' AND normalized_hash IS NULL LIMIT 1",
          [tid, b.industry],
        )
      ).rowCount
    )
      throw validation("历史C数据需先经授权脱敏迁移");
    return [];
  }
  const rows = (
    await ctx.client.query(
      "SELECT id,keyword,collected_at,first_seen_at FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND channel=$3 AND normalized_hash IS NULL",
      [tid, b.industry, b.channel],
    )
  ).rows;
  const aliases = [];
  for (const row of rows) {
    let hash;
    try {
      hash = keywordHash(row.keyword);
    } catch {
      continue;
    }
    const match = (
      await ctx.client.query(
        "SELECT id FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND channel=$3 AND normalized_hash=$4 AND collected_at=$5",
        [tid, b.industry, b.channel, hash, row.collected_at],
      )
    ).rows[0];
    if (!match) {
      await ctx.client.query(
        "UPDATE keyword_raw SET normalized_hash=$1,normalization_version=$2 WHERE tenant_id=$3 AND id=$4",
        [hash, normalizationVersion, tid, row.id],
      );
      event(ctx, "keyword_raw.normalize_legacy", "keyword_raw", row.id, {
        cause_event_id: ctx.rootEventId,
      });
    } else aliases.push({ ...row, hash });
  }
  return aliases;
}
async function append(ctx, record, legacy, auth) {
  const tid = ctx.principal.tenant_id,
    b = ctx.body;
  const existing = (
    await ctx.client.query(
      "SELECT id,first_seen_at,demand_index,trend_dir,raw_payload FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND channel=$3 AND normalized_hash=$4 AND collected_at=$5",
      [tid, b.industry, b.channel, record.hash, record.time],
    )
  ).rows[0];
  if (existing) {
    if (b.channel === "C")
      event(ctx, "keyword_raw.import_lookup", "keyword_raw", existing.id, {
        cause_event_id: ctx.rootEventId,
      });
    const conflict =
      record.index !== null &&
      existing.demand_index !== null &&
      record.index !== Number(existing.demand_index);
    if (conflict) throw validation("同一观测的需求指数冲突");
    if (
      Object.keys(record.raw_payload).length &&
      Object.keys(existing.raw_payload ?? {}).length &&
      canonicalJson(record.raw_payload) !== canonicalJson(existing.raw_payload)
    )
      throw validation("同一观测的出处冲突");
  }
  const earliest = (
    await ctx.client.query(
      "SELECT min(first_seen_at) AS at FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND channel=$3 AND normalized_hash=$4",
      [tid, b.industry, b.channel, record.hash],
    )
  ).rows[0].at;
  const aliasRows = legacy.filter((row) => row.hash === record.hash);
  const first = new Date(
    Math.min(
      Date.parse(record.time),
      ...(earliest ? [new Date(earliest).getTime()] : []),
      ...aliasRows.map((row) => new Date(row.first_seen_at).getTime()),
    ),
  ).toISOString();
  const changed = (
    await ctx.client.query(
      "UPDATE keyword_raw SET first_seen_at=$1 WHERE tenant_id=$2 AND industry=$3 AND channel=$4 AND (normalized_hash=$5 OR id=ANY($6::text[])) AND first_seen_at>$1 RETURNING id",
      [
        first,
        tid,
        b.industry,
        b.channel,
        record.hash,
        aliasRows.map((row) => row.id),
      ],
    )
  ).rows;
  for (const row of changed)
    event(ctx, "keyword_raw.first_seen_corrected", "keyword_raw", row.id, {
      cause_event_id: ctx.rootEventId,
    });
  if (existing) {
    event(ctx, "keyword_raw.import_duplicate", "keyword_raw", existing.id, {
      cause_event_id: ctx.rootEventId,
    });
    return { id: existing.id, outcome: "duplicate" };
  }
  const id = randomUUID();
  await ctx.client.query(
    `INSERT INTO keyword_raw(id,tenant_id,industry,keyword,channel,demand_index,trend_dir,first_seen_at,collected_at,raw_payload,normalized_hash,normalization_version,authorization_ref,redaction_policy_version)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      tid,
      b.industry,
      record.keyword,
      b.channel,
      record.index,
      record.trend,
      first,
      record.time,
      JSON.stringify(record.raw_payload),
      record.hash,
      normalizationVersion,
      auth ? b.authorization_ref : null,
      auth?.redaction_policy.version ?? null,
    ],
  );
  event(ctx, "keyword_raw.import_row", "keyword_raw", id, {
    cause_event_id: ctx.rootEventId,
  });
  return { id, outcome: "added" };
}
export function keywordImportHandlers() {
  return {
    "keyword_raw.import": async (inputCtx) => {
      const ctx = {
        ...inputCtx,
        body: {
          ...inputCtx.body,
          industry:
            typeof inputCtx.body.industry === "string"
              ? inputCtx.body.industry.trim()
              : inputCtx.body.industry,
        },
      };
      const b = ctx.body;
      required(b, ["industry", "channel"]);
      if (
        typeof b.industry !== "string" ||
        !["A", "B", "C", "D"].includes(b.channel)
      )
        throw validation("行业或渠道无效");
      if (
        ctx.principal.actor_type === "system" &&
        ctx.principal.job_name === "c_import" &&
        b.channel !== "C"
      )
        throw permission("c_import只允许C类授权批次");
      const auth =
        b.channel === "C"
          ? await importAuthorization(ctx, b.authorization_ref)
          : null;
      const source = await records(ctx),
        prepared = [];
      for (let i = 0; i < source.rows.length; i++) {
        try {
          prepared.push({
            number: i + 2,
            record: prepare(ctx, source.rows[i], auth),
          });
        } catch (error) {
          if (source.single) throw error;
          prepared.push({ number: i + 2, error: true });
        }
      }
      await ctx.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        ["keyword-import:" + ctx.principal.tenant_id],
      );
      const legacy = await legacyIndex(ctx);
      const counts = { added: 0, duplicate: 0, rejected: 0 },
        record_results = [];
      for (const row of prepared) {
        let result;
        if (row.error)
          result = { outcome: "rejected", code: "validation_failed" };
        else
          try {
            result = await append(ctx, row.record, legacy, auth);
          } catch (error) {
            if (source.single || error.code !== "validation_failed")
              throw error;
            result = { outcome: "rejected", code: "observation_conflict" };
          }
        counts[result.outcome]++;
        if (record_results.length < 20)
          record_results.push({ record_number: row.number, ...result });
      }
      const id = randomUUID();
      await ctx.client.query(
        "INSERT INTO keyword_import_batch(id,tenant_id,industry,channel,added,duplicate,rejected,normalization_version,authorization_ref,redaction_policy_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id,
          ctx.principal.tenant_id,
          b.industry,
          b.channel,
          counts.added,
          counts.duplicate,
          counts.rejected,
          normalizationVersion,
          auth ? b.authorization_ref : null,
          auth?.redaction_policy.version ?? null,
          new Date(ctx.now()).toISOString(),
        ],
      );
      event(ctx, "keyword_import_batch.create", "keyword_import_batch", id, {
        cause_event_id: ctx.rootEventId,
      });
      const data = {
        id: source.single ? record_results[0].id : id,
        import_id: id,
        ...counts,
        total: prepared.length,
        record_results,
        truncated: prepared.length > 20,
        normalization_version: normalizationVersion,
      };
      return {
        data,
        objectId: data.id,
        auditMeta: {
          object_type: source.single ? "keyword_raw" : "keyword_import_batch",
          reason: null,
        },
      };
    },
  };
}
