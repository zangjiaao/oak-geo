import { test } from "node:test";
import assert from "node:assert/strict";

test("T08五类模板按产品§2精确生成词，不生成测量问句", async () => {
  const { generationTemplates, generateCandidates } = await import(
    "../../src/lib/generation.mjs"
  );
  assert.equal(generationTemplates.length, 5);
  const cases = [
    [
      "feature_generator",
      { feature: ["bio", "prompt"] },
      ["bio generator", "prompt generator"],
    ],
    [
      "format_conversion",
      { from: ["webp", "pdf"], to: ["png", "docx"] },
      ["webp to png", "webp to docx", "pdf to png", "pdf to docx"],
    ],
    [
      "industry_calculator",
      { industry: ["cagr", "macro"] },
      ["cagr calculator", "macro calculator"],
    ],
    [
      "brand_alternative",
      { brand: ["notion", "canva"] },
      ["notion alternative", "canva alternative"],
    ],
    [
      "game_access",
      { game: ["某游戏"], mode: ["unblocked", "online"] },
      ["某游戏 unblocked", "某游戏 online"],
    ],
  ];
  for (const [template_id, inputs, expected] of cases)
    assert.deepEqual(
      generateCandidates({ template_id, inputs }).map((row) => row.keyword),
      expected,
    );
});

test("T08预览确定性、去重与输入保护：不接受缺参或未知模板/模式", async () => {
  const { generateCandidates } = await import("../../src/lib/generation.mjs");
  const input = {
    template_id: "format_conversion",
    inputs: { from: [" PDF ", "pdf"], to: ["docx", " docx "] },
  };
  assert.deepEqual(
    generateCandidates(input).map((row) => row.keyword),
    ["PDF to docx"],
  );
  assert.deepEqual(generateCandidates(input), generateCandidates(input));
  for (const body of [
    { template_id: "unknown", inputs: {} },
    { template_id: "feature_generator", inputs: { feature: [] } },
    {
      template_id: "game_access",
      inputs: { game: ["game"], mode: ["auto-post"] },
    },
  ])
    assert.throws(() => generateCandidates(body));
});
