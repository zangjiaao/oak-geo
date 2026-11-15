// Product §13.1 / §13.2 and approved T02 customer-mode boundaries.
// Presentation only: API authorization remains authoritative.
export const roleLabels = Object.freeze({
  owner: "客户 Owner",
  editor: "客户 Editor",
  viewer: "客户 Viewer",
  strategist: "策略",
  content: "内容",
  evidence: "证据",
  factcheck: "审核",
  cs: "客户成功",
  admin: "管理员",
});
const internal = [
  "strategist",
  "content",
  "evidence",
  "factcheck",
  "cs",
  "admin",
];
export const workspacePages = Object.freeze([
  {
    path: "/",
    group: "总览",
    label: "工作台",
    task: "工作台页面后续交付",
    description: "品牌健康度、审核待办与复测进度集中展示。",
  },
  {
    path: "/diagnosis",
    group: "诊断",
    label: "诊断交付台",
    task: "T20",
    description: "诊断结论、建议簇与证据回溯。",
  },
  {
    path: "/opportunities",
    group: "机会",
    label: "机会看板",
    task: "T18–T19",
    description: "按行业、意图与热度筛选机会簇。",
  },
  {
    path: "/library/seeds",
    group: "词库",
    label: "种子表管理",
    task: "种子表网页后续交付",
    description: "维护公共词根、维护人与版本历史。服务层已完成。",
  },
  {
    path: "/library/generation",
    group: "词库",
    label: "生成语法",
    task: "T08",
    ready: true,
  },
  {
    path: "/library/import",
    group: "词库",
    label: "CSV 导入",
    task: "T09",
    ready: true,
  },
  {
    path: "/library/snapshots",
    group: "词库",
    label: "词池快照",
    task: "词池快照网页后续交付",
    description: "周批词池版本、意图与需求档位。",
  },
  {
    path: "/content/workbench",
    group: "内容",
    label: "内容工作台",
    task: "T21–T22",
    description: "事实块编辑、来源与提交前校验。",
  },
  {
    path: "/content/reviews",
    group: "内容",
    label: "审核队列",
    task: "T23",
    description: "独立审核、版本差异与放行记录。",
  },
  {
    path: "/content/templates",
    group: "内容",
    label: "模板库",
    task: "T24",
    description: "按意图选择模板与证据包。",
  },
  {
    path: "/content/publications",
    group: "内容",
    label: "发布登记",
    task: "T25",
    description: "登记发布 URL 与时间，联动事件复测。",
  },
  {
    path: "/verification/retests",
    group: "验证",
    label: "复测台",
    task: "T26",
    description: "同口径观察 T0 与各复测时点的判定结果。",
  },
  {
    path: "/verification/reports",
    group: "验证",
    label: "报告页",
    task: "T29",
    description: "月度趋势、对照组与可比差值。",
  },
  {
    path: "/evidence",
    group: "证据",
    label: "证据包 / 异议复核",
    task: "T24",
    description: "封版证据包与受控的单条异议调阅。",
  },
  {
    path: "/settings/members",
    group: "设置",
    label: "开通清单与成员",
    task: "设置页面后续交付",
    description: "租户、角色、品牌、词表与官方口径的开通清单。",
  },
  {
    path: "/settings/audit",
    group: "设置",
    label: "审计日志",
    task: "审计页面后续交付",
    description: "按对象回溯操作记录。",
  },
  {
    path: "/settings/models",
    group: "设置",
    label: "模型与配额",
    task: "T14 / 设置页面后续交付",
    description: "模型接入状态与分操作配额。",
  },
]);

export function pageVisible(page, session) {
  if (!session) return true; // Explicit, data-free layout preview.
  if (!Object.hasOwn(roleLabels, session.role)) return false;
  const staff = internal.includes(session.role);
  if (page.group === "设置") return session.role === "admin";
  if (page.group === "词库") return staff;
  if (page.path === "/content/reviews") return session.role === "factcheck";
  if (
    !staff &&
    session.mode !== "full" &&
    ["/opportunities", "/content/workbench", "/content/publications"].includes(
      page.path,
    )
  )
    return false;
  return true;
}
export function navigationFor(session) {
  /** @type {{label: string, items: (typeof workspacePages)[number][]}[]} */
  const groups = [];
  for (const page of workspacePages.filter((p) => pageVisible(p, session))) {
    let group = groups.find((g) => g.label === page.group);
    if (!group) groups.push((group = { label: page.group, items: [] }));
    group.items.push(page);
  }
  return groups;
}
export function selectWorkspace(session, query) {
  const brands = session?.brands ?? [];
  const brand = query.brand
    ? brands.find((b) => b.id === query.brand)
    : brands[0];
  if (
    session &&
    ((query.brand && !brand) ||
      (query.industry && query.industry !== brand?.industry))
  )
    return { valid: false, brand: null, industry: "" };
  return { valid: true, brand: brand ?? null, industry: brand?.industry ?? "" };
}
export function workspaceHref(path, selection) {
  if (
    !workspacePages.some((page) => page.path === path) &&
    !["/notifications", "/account"].includes(path)
  )
    throw new Error("Unknown workspace route");
  const params = new URLSearchParams();
  if (selection.brand?.id) params.set("brand", selection.brand.id);
  if (selection.industry) params.set("industry", selection.industry);
  return path + (params.size ? "?" + params : "");
}
