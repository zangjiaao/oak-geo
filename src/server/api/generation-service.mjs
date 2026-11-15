import { randomUUID } from "node:crypto";
import { generateCandidates } from "../../lib/generation.mjs";
import { validation, permission } from "./errors.mjs";
import { required, conflict, event } from "./domain-common.mjs";
import { assertPublicRoot, privateMarkers } from "./shared-industry.mjs";

async function source(ctx, id) {
  const row = (
    await ctx.client.query("SELECT * FROM seed_list WHERE id=$1", [id])
  ).rows[0];
  if (!row) throw permission();
  if (
    row.status !== "active" ||
    (
      await ctx.client.query("SELECT 1 FROM seed_list WHERE previous_id=$1", [
        id,
      ])
    ).rowCount
  )
    throw conflict("请选择当前启用的种子版本");
  assertPublicRoot(
    row,
    ctx.publicRootCatalog,
    await privateMarkers(ctx.client),
  );
  return row;
}
export async function previewGeneration(ctx, input) {
  const base = await source(ctx, input.source_seed_id ?? ctx.params.id);
  let candidates;
  try {
    candidates = generateCandidates(input);
  } catch (e) {
    throw validation(e.message);
  }
  const markers = await privateMarkers(ctx.client);
  const items = candidates.map((row) => {
    let eligible = true;
    try {
      assertPublicRoot(
        {
          industry: base.industry,
          word: row.keyword,
          word_type: input.word_type ?? base.word_type,
        },
        ctx.publicRootCatalog,
        markers,
      );
    } catch {
      eligible = false;
    }
    return {
      ...row,
      eligible,
      reason: eligible ? null : "不在许可公共词根目录内",
    };
  });
  assertResponseBudget(items);
  return items;
}
function assertResponseBudget(items) {
  if (Buffer.byteLength(JSON.stringify(items)) > 18000)
    throw validation("生成结果超出响应预算，请缩小预览或分批确认");
}
export async function confirmGeneration(ctx, base, write) {
  if (ctx.principal.actor_type !== "human")
    throw permission("generation needs explicit human confirmation");
  if (ctx.body.confirmed !== true) throw validation("请先预览并确认选择");
  required(ctx.body, ["maintainer", "last_reviewed_at"]);
  const input = ctx.body.generation;
  if (input.source_seed_id != null && input.source_seed_id !== base.id)
    throw validation("来源种子必须与路径一致");
  if (!["A", "B"].includes(input.source_channel))
    throw validation("请选择计划采集渠道 A/B");
  const selected = input.selected_keywords;
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    new Set(selected).size !== selected.length
  )
    throw validation("请选择不重复的预览词");
  await ctx.client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    ["seed:" + base.industry],
  );
  const candidates = await previewGeneration(ctx, {
    ...input,
    source_seed_id: base.id,
  });
  if (
    selected.some(
      (word) => !candidates.some((row) => row.keyword === word && row.eligible),
    )
  )
    throw validation("所选词必须来自本次预览且属于许可公共词根");
  const items = [];
  for (const word of selected) {
    const { data: row } = await write({
      ...ctx,
      body: {
        industry: base.industry,
        word,
        word_type: input.word_type ?? base.word_type,
        maintainer: ctx.body.maintainer,
        last_reviewed_at: ctx.body.last_reviewed_at,
      },
    });
    const metadataId = randomUUID();
    await ctx.client.query(
      `INSERT INTO seed_generation_metadata(id,tenant_id,seed_id,source_seed_id,template_id,source_channel,confirmed_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        metadataId,
        ctx.principal.tenant_id,
        row.id,
        base.id,
        input.template_id,
        input.source_channel,
        ctx.principal.user_id,
        new Date(ctx.now()).toISOString(),
      ],
    );
    event(ctx, "seed_list.create", "seed_list", row.id);
    event(
      ctx,
      "seed_generation_metadata.create",
      "seed_generation_metadata",
      metadataId,
    );
    items.push(row);
  }
  assertResponseBudget(items);
  return {
    data: { items, source_channel: input.source_channel, planned: true },
    objectId: base.id,
  };
}
