import { createHash, randomUUID } from "node:crypto";
import { keywordHash, normalizationVersion } from "./keyword-normalization.mjs";
import { event, json } from "./domain-common.mjs";
import { validation, permission } from "./errors.mjs";
import { pageQuery } from "./pagination.mjs";
import { weeklyPrivatePredicate } from "./assignment-scope.mjs";

const DAY = 86400_000;
export const surgeRuleVersion = "surge_source_trend_v1";
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function sourceIdentity(row) {
  if (row.channel === "C")
    return row.authorization_ref && row.redaction_policy_version
      ? fingerprint(["C", row.authorization_ref, row.redaction_policy_version])
      : null;
  const payload = row.raw_payload ?? {};
  if (
    payload.channel_scope != null &&
    typeof payload.channel_scope !== "string"
  )
    return null;
  if (typeof payload.source_id === "string" && payload.source_id.trim())
    return fingerprint([
      row.channel,
      payload.source_id.trim(),
      payload.channel_scope ?? null,
    ]);
  if (
    typeof payload.url === "string" &&
    typeof payload.channel_scope === "string" &&
    payload.channel_scope.trim()
  ) {
    try {
      const url = new URL(payload.url);
      if (["https:", "http:"].includes(url.protocol))
        return fingerprint([
          row.channel,
          url.origin,
          payload.channel_scope.trim(),
        ]);
    } catch {}
  }
  return null;
}
const time = (value) => new Date(value).getTime();
const number = (value) => (value == null ? null : Number(value));
function latest(records) {
  const max = records.reduce(
    (value, row) => Math.max(value, time(row.collected_at)),
    -Infinity,
  );
  const matches = records.filter((row) => time(row.collected_at) === max);
  const signatures = new Set(
    matches.map((row) =>
      JSON.stringify([row.trend_dir, number(row.demand_index)]),
    ),
  );
  return signatures.size === 1
    ? matches.sort((a, b) => a.id.localeCompare(b.id))[0]
    : null;
}

// Two successive complete weekly source trend observations, not two invented
// growth ratios from two points. Source-provided trend is retained as evidence.
export function findSurgeCandidates(records, window, now) {
  const start = time(window.start),
    end = time(window.end),
    priorStart = start - 7 * DAY;
  const skipped = {},
    groups = new Map();
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  for (const row of records) {
    let hash;
    try {
      hash = keywordHash(row.keyword);
    } catch {
      skip("invalid_keyword");
      continue;
    }
    if (
      row.normalized_hash !== hash ||
      row.normalization_version !== normalizationVersion
    ) {
      skip("unindexed_observation");
      continue;
    }
    const collected = time(row.collected_at),
      seen = time(row.first_seen_at);
    if (
      !Number.isFinite(collected) ||
      !Number.isFinite(seen) ||
      seen > collected ||
      collected < priorStart ||
      collected >= end
    ) {
      skip("invalid_or_outside_window");
      continue;
    }
    const identity = sourceIdentity(row);
    if (!identity) {
      skip("missing_source_identity");
      continue;
    }
    const key = JSON.stringify([hash, row.channel, identity]);
    if (!groups.has(key))
      groups.set(key, { hash, channel: row.channel, identity, rows: [] });
    groups.get(key).rows.push(row);
  }
  const candidates = [];
  for (const group of groups.values()) {
    const seen = group.rows.reduce(
      (value, row) => Math.min(value, time(row.first_seen_at)),
      Infinity,
    );
    if (now < seen || now - seen >= 14 * DAY) {
      skip("not_new");
      continue;
    }
    const previousRows = group.rows.filter(
      (row) => time(row.collected_at) < start,
    );
    const currentRows = group.rows.filter(
      (row) => time(row.collected_at) >= start,
    );
    if (!previousRows.length || !currentRows.length) {
      skip("missing_week");
      continue;
    }
    const previous = latest(previousRows),
      current = latest(currentRows);
    if (!previous || !current) {
      skip("conflicting_latest_observation");
      continue;
    }
    if (previous.trend_dir !== "up" || current.trend_dir !== "up") {
      skip("not_two_source_up_trends");
      continue;
    }
    const before = number(previous.demand_index),
      after = number(current.demand_index);
    if (
      (before !== null && !Number.isFinite(before)) ||
      (after !== null && !Number.isFinite(after)) ||
      (before !== null && after !== null && after <= before)
    ) {
      skip("trend_index_conflict");
      continue;
    }
    candidates.push({
      normalized_hash: group.hash,
      source_channel: group.channel,
      source_identity: group.identity,
      first_seen_at: new Date(seen).toISOString(),
      source_word_ids: [previous.id, current.id],
      evidence: {
        mode: "source_reported_trend",
        previous: {
          id: previous.id,
          collected_at: new Date(previous.collected_at).toISOString(),
          trend_dir: "up",
          demand_index: before,
        },
        current: {
          id: current.id,
          collected_at: new Date(current.collected_at).toISOString(),
          trend_dir: "up",
          demand_index: after,
        },
      },
    });
  }
  return {
    candidates,
    evaluated_count: groups.size,
    observations_count: records.length,
    skipped,
  };
}

export async function loadSurgeEvidence(ctx, industry, window) {
  const rows = (
    await ctx.client.query(
      `SELECT id,keyword,channel,collected_at,first_seen_at,demand_index,trend_dir,normalized_hash,normalization_version,
     authorization_ref,redaction_policy_version,raw_payload->'source_id' AS source_id,
     raw_payload->'channel_scope' AS channel_scope,raw_payload->'url' AS source_url
     FROM keyword_raw WHERE tenant_id=$1 AND industry=$2 AND collected_at>=$3 AND collected_at<$4
     AND (channel<>'C' OR (authorization_ref IS NOT NULL AND redaction_policy_version IS NOT NULL)) ORDER BY id`,
      [
        ctx.principal.tenant_id,
        industry,
        new Date(time(window.start) - 7 * DAY).toISOString(),
        window.end,
      ],
    )
  ).rows;
  return rows.map(({ source_id, channel_scope, source_url, ...row }) => {
    if (row.channel === "C")
      event(ctx, "keyword_raw.surge_read", "keyword_raw", row.id, {
        cause_event_id: ctx.rootEventId,
      });
    return {
      ...row,
      collected_at: new Date(row.collected_at).toISOString(),
      first_seen_at: new Date(row.first_seen_at).toISOString(),
      raw_payload: { source_id, channel_scope, url: source_url },
    };
  });
}

export async function appendSurgeAlerts(
  ctx,
  { industry, publication, window, evidence, brands },
) {
  const analysis = findSurgeCandidates(evidence, window, ctx.now());
  const recipients = (
    await ctx.client.query(
      "SELECT DISTINCT user_id FROM user_member WHERE tenant_id=$1 AND role='strategist' ORDER BY user_id",
      [ctx.principal.tenant_id],
    )
  ).rows;
  if (analysis.candidates.length && !recipients.length)
    throw validation("飙升通知需要至少一个本租户策略角色接收人");
  let created = 0,
    notifications = 0,
    prefilters = 0;
  for (const candidate of analysis.candidates) {
    const linked = (
      await ctx.client.query(
        `SELECT c.id,c.brand_id FROM weekly_cluster_snapshot s JOIN intent_cluster c ON c.tenant_id=s.tenant_id AND c.id=s.cluster_id
       WHERE s.tenant_id=$1 AND s.industry=$2 AND s.pool_version=$3 AND $4=ANY(s.representative_word_ids) ORDER BY c.id`,
        [
          ctx.principal.tenant_id,
          industry,
          publication.pool_version,
          candidate.source_word_ids[1],
        ],
      )
    ).rows;
    const targets = linked.length
      ? [...new Set(linked.map((row) => row.brand_id))]
      : candidate.source_channel === "C" && brands.length !== 1
        ? [null]
        : brands.length
          ? brands.map((row) => row.id)
          : [null];
    const prefilterIds = targets.map(() => randomUUID());
    const id = randomUUID();
    const inserted = (
      await ctx.client.query(
        `INSERT INTO keyword_surge_alert(id,tenant_id,industry,pool_version,window_start,window_end,normalized_hash,source_channel,source_identity,first_seen_at,source_word_ids,old_cluster_ids,prefilter_ids,evidence,rule_version,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(tenant_id,industry,window_start,window_end,normalized_hash,source_channel,source_identity) DO NOTHING RETURNING id`,
        [
          id,
          ctx.principal.tenant_id,
          industry,
          publication.pool_version,
          window.start,
          window.end,
          candidate.normalized_hash,
          candidate.source_channel,
          candidate.source_identity,
          candidate.first_seen_at,
          candidate.source_word_ids,
          linked.map((row) => row.id),
          prefilterIds,
          json(candidate.evidence),
          surgeRuleVersion,
          new Date(ctx.now()).toISOString(),
        ],
      )
    ).rows[0];
    if (!inserted) continue;
    created++;
    event(ctx, "keyword_surge_alert.create", "keyword_surge_alert", id, {
      cause_event_id: ctx.rootEventId,
    });
    for (let i = 0; i < targets.length; i++) {
      await ctx.client.query(
        `INSERT INTO weekly_pool_candidate(id,tenant_id,brand_id,industry,pool_version,reason,source_word_ids,old_cluster_ids,created_at)
         VALUES($1,$2,$3,$4,$5,'surge',$6,$7,$8)`,
        [
          prefilterIds[i],
          ctx.principal.tenant_id,
          targets[i],
          industry,
          publication.pool_version,
          candidate.source_word_ids,
          linked
            .filter((row) => row.brand_id === targets[i])
            .map((row) => row.id),
          new Date(ctx.now()).toISOString(),
        ],
      );
      prefilters++;
      event(
        ctx,
        "weekly_pool_candidate.append",
        "weekly_pool_candidate",
        prefilterIds[i],
        { cause_event_id: ctx.rootEventId },
      );
    }
    for (const recipient of recipients) {
      const notificationId = randomUUID();
      await ctx.client.query(
        "INSERT INTO keyword_surge_notification(id,tenant_id,alert_id,recipient_user_id,created_at) VALUES($1,$2,$3,$4,$5)",
        [
          notificationId,
          ctx.principal.tenant_id,
          id,
          recipient.user_id,
          new Date(ctx.now()).toISOString(),
        ],
      );
      notifications++;
      event(
        ctx,
        "keyword_surge_notification.create",
        "keyword_surge_notification",
        notificationId,
        { cause_event_id: ctx.rootEventId },
      );
    }
  }
  return {
    rule_version: surgeRuleVersion,
    detected_count: analysis.candidates.length,
    created_count: created,
    notification_count: notifications,
    prefilter_count: prefilters,
    evaluated_count: analysis.evaluated_count,
    skipped: analysis.skipped,
  };
}

export async function readSurgeAlerts(ctx) {
  const inbox = ctx.query.view === "surge_notifications";
  const values = [ctx.principal.tenant_id, ctx.query.industry ?? "B2B"];
  let where = "p.tenant_id=$1 AND p.industry=$2";
  if (inbox) {
    if (ctx.principal.role !== "strategist")
      throw permission("策略角色的个人通知入口");
    values.push(ctx.principal.user_id);
    where +=
      " AND EXISTS(SELECT 1 FROM keyword_surge_notification n WHERE n.tenant_id=p.tenant_id AND n.alert_id=p.id AND n.recipient_user_id=$3)";
  } else if (["content", "evidence"].includes(ctx.principal.role)) {
    values.push(ctx.principal.user_id);
    where += " AND " + weeklyPrivatePredicate(false);
  }
  const data = await pageQuery(ctx, {
    table: "keyword_surge_alert p",
    columns:
      "id,industry,pool_version,window_start,window_end,source_channel,source_identity,first_seen_at,source_word_ids,cardinality(old_cluster_ids) AS related_cluster_count,old_cluster_ids[1:20] AS old_cluster_ids,cardinality(prefilter_ids) AS prefilter_count,prefilter_ids[1:20] AS prefilter_ids,(cardinality(old_cluster_ids)>20 OR cardinality(prefilter_ids)>20) AS references_truncated,evidence,rule_version,created_at",
    where,
    values,
    order: [
      ["p.created_at", "DESC"],
      ["p.id", "DESC"],
    ],
  });
  const sensitive = data.items.filter((row) => row.source_channel === "C");
  for (const row of sensitive)
    event(ctx, "keyword_surge_alert.read", "keyword_surge_alert", row.id);
  return { data, sensitive: sensitive.length > 0 };
}
