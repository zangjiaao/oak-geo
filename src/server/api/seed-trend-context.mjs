import { validation } from "./errors.mjs";
import { conflict } from "./domain-common.mjs";
import { assertPublicRoot, privateMarkers } from "./shared-industry.mjs";
import { previewGeneration } from "./generation-service.mjs";
import { generationTemplates } from "../../lib/generation.mjs";

// Resolve the selected industry asset and generation preview again at execution.
// Browser display strings are never authoritative query terms or provenance.
export async function resolveSeedTrendContext(ctx, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw validation("种子上下文无效");
  const generated = input.generation;
  if (Boolean(generated) === Boolean(input.seed_ids))
    throw validation("请选择种子或一组扩词结果");
  const ids = generated ? [generated.source_seed_id] : input.seed_ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 5 ||
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  )
    throw validation("一次请选择1至5个种子");
  const seeds = [];
  const markers = await privateMarkers(ctx.client);
  for (const id of ids) {
    const row = (
      await ctx.client.query("SELECT * FROM seed_list WHERE id=$1", [id])
    ).rows[0];
    if (!row || row.industry !== ctx.body.industry)
      throw validation("种子不属于当前行业");
    assertPublicRoot(row, ctx.publicRootCatalog, markers);
    if (
      row.status !== "active" ||
      (
        await ctx.client.query("SELECT 1 FROM seed_list WHERE previous_id=$1", [
          id,
        ])
      ).rowCount
    )
      throw conflict("种子版本已变更，请刷新后重新选择");
    seeds.push({
      id: row.id,
      logical_id: row.logical_id,
      seed_version: Number(row.seed_version),
      word: row.word,
    });
  }
  let keywords = seeds.map((s) => s.word),
    generation;
  if (generated) {
    const selected = generated.selected_keywords;
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > 5 ||
      new Set(selected).size !== selected.length
    )
      throw validation("一次请选择1至5个扩词结果");
    const template = generationTemplates.find(
      (t) => t.id === generated.template_id,
    );
    const inputs = Object.fromEntries(
      (template?.fields ?? []).map(([key]) => [
        key,
        Array.isArray(generated.inputs?.[key])
          ? generated.inputs[key].map((value) =>
              typeof value === "string"
                ? value.normalize("NFKC").trim().replace(/\s+/gu, " ")
                : value,
            )
          : generated.inputs?.[key],
      ]),
    );
    const candidates = await previewGeneration(ctx, { ...generated, inputs });
    if (
      selected.some(
        (word) => !candidates.some((c) => c.keyword === word),
      )
    )
      throw validation("检索词必须来自当前种子的扩词预览");
    keywords = selected;
    generation = {
      template_id: generated.template_id,
      inputs,
      source_seed_id: generated.source_seed_id,
      selected_keywords: selected,
    };
  }
  return {
    keywords,
    context: {
      industry: ctx.body.industry,
      seeds,
      ...(generation ? { generation } : {}),
    },
  };
}
