const fields = [
  {
    key: "keyword",
    required: "必填",
    description: "关键词或实际采集的问句；也识别中文列名“关键词”“词”。",
  },
  {
    key: "collected_at",
    required: "必填",
    description: "真实采集时间，UTC，例如 2026-01-01T00:00:00Z；也识别“采集时间”。",
  },
  {
    key: "demand_index",
    required: "选填",
    description: "来源提供的数值指数；没有就留空，不能用 0 代替缺失；也识别“热度指数”。",
  },
  {
    key: "trend_dir",
    required: "选填",
    description: "up（上升）、flat（持平）、down（下降），未知留空；也识别“趋势”。",
  },
  {
    key: "excerpt",
    required: "选填",
    description: "原始表述摘录；C 类会按已审核配置脱敏后保存。",
  },
  {
    key: "source_url",
    required: "选填",
    description: "观测来源的完整链接；也识别 url。C 类模板不索取链接。",
  },
];

export function keywordImportFields(channel) {
  if (!["A", "B", "C", "D"].includes(channel))
    throw new Error("请选择有效来源渠道");
  return fields.filter((field) => channel !== "C" || field.key !== "source_url");
}

export function keywordImportTemplate(channel) {
  // BOM keeps Chinese text readable in Excel; no fabricated sample observations.
  return "\uFEFF" + keywordImportFields(channel).map((field) => field.key).join(",") + "\r\n";
}
