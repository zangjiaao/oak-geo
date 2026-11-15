export const generationTemplates = Object.freeze(
  [
    {
      id: "feature_generator",
      label: "[功能] + generator",
      fields: [["feature", "功能"]],
    },
    {
      id: "format_conversion",
      label: "[格式 A] to [格式 B]",
      fields: [
        ["from", "格式 A"],
        ["to", "格式 B"],
      ],
    },
    {
      id: "industry_calculator",
      label: "[行业] + calculator",
      fields: [["industry", "行业"]],
    },
    {
      id: "brand_alternative",
      label: "[大牌] + alternative",
      fields: [["brand", "品牌"]],
    },
    {
      id: "game_access",
      label: "[游戏名] + unblocked / online",
      fields: [
        ["game", "游戏名"],
        ["mode", "unblocked / online"],
      ],
    },
  ].map((item) => Object.freeze(item)),
);

export function generateCandidates({ template_id, inputs }) {
  const template = generationTemplates.find((item) => item.id === template_id);
  if (!template || !inputs || typeof inputs !== "object")
    throw new Error("请选择有效模板并填写参数");
  const values = template.fields.map(([key]) => {
    const raw = inputs[key];
    if (
      !Array.isArray(raw) ||
      !raw.length ||
      raw.some((value) => typeof value !== "string" || !value.trim())
    )
      throw new Error("模板参数不能为空");
    return [
      ...new Set(
        raw.map((value) =>
          value.normalize("NFKC").trim().replace(/\s+/gu, " "),
        ),
      ),
    ];
  });
  if (
    template_id === "game_access" &&
    values[1].some((mode) => !["unblocked", "online"].includes(mode))
  )
    throw new Error("游戏模板只支持 unblocked / online");
  const seen = new Set(),
    rows = [];
  for (const first of values[0])
    for (const second of values[1] ?? [""]) {
      const keyword =
        template_id === "feature_generator"
          ? `${first} generator`
          : template_id === "format_conversion"
            ? `${first} to ${second}`
            : template_id === "industry_calculator"
              ? `${first} calculator`
              : template_id === "brand_alternative"
                ? `${first} alternative`
                : `${first} ${second}`;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ keyword, template_id });
      if (rows.length > 100)
        throw new Error("一次最多预览100个词，请缩小参数组合");
    }
  return rows;
}
