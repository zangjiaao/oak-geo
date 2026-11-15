const fields = [
  {
    key: "keyword",
    required: "必填",
    description: "实际采集的关键词或问句。",
  },
  {
    key: "collected_at",
    required: "必填",
    description: "UTC 采集时间，例如 2026-01-01T00:00:00Z。",
  },
  {
    key: "demand_index",
    required: "选填",
    description: "来源指数；缺失留空，勿填 0。",
  },
  {
    key: "trend_dir",
    required: "选填",
    description: "up（上升）、flat（持平）、down（下降）；未知留空。",
  },
  {
    key: "excerpt",
    required: "选填",
    description: "原文摘录；C 类自动脱敏。",
  },
  {
    key: "source_id",
    required: "选填",
    description: "同平台、地区与指标口径使用固定标识。",
  },
  {
    key: "source_url",
    required: "选填",
    description: "完整来源 URL。",
  },
];

export function keywordImportFields(channel) {
  if (!["A", "B", "C", "D"].includes(channel))
    throw new Error("请选择有效来源渠道");
  return fields.filter(
    (field) =>
      channel !== "C" || !["source_url", "source_id"].includes(field.key),
  );
}

export function keywordImportTemplate(channel) {
  // BOM keeps Chinese text readable in Excel; no fabricated sample observations.
  return (
    "\uFEFF" +
    keywordImportFields(channel)
      .map((field) => field.key)
      .join(",") +
    "\r\n"
  );
}
