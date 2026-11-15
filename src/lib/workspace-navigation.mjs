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
  },
  {
    path: "/diagnosis",
    group: "诊断",
    label: "诊断交付台",
  },
  {
    path: "/opportunities",
    group: "机会",
    label: "机会看板",
  },
  {
    path: "/library/seeds",
    group: "词库",
    label: "种子表管理",
  },
  {
    path: "/library/generation",
    group: "词库",
    label: "生成语法",
  },
  {
    path: "/library/import",
    group: "词库",
    label: "CSV 导入",
  },
  { path: "/library/questions", group: "词库", label: "问句池" },
  {
    path: "/library/snapshots",
    group: "词库",
    label: "词池快照",
  },
  {
    path: "/content/workbench",
    group: "内容",
    label: "内容工作台",
  },
  {
    path: "/content/reviews",
    group: "内容",
    label: "审核队列",
  },
  {
    path: "/content/templates",
    group: "内容",
    label: "模板库",
  },
  {
    path: "/content/publications",
    group: "内容",
    label: "发布登记",
  },
  {
    path: "/verification/retests",
    group: "验证",
    label: "复测台",
  },
  {
    path: "/verification/reports",
    group: "验证",
    label: "报告页",
  },
  {
    path: "/evidence",
    group: "证据",
    label: "证据包 / 异议复核",
  },
  {
    path: "/settings/members",
    group: "设置",
    label: "开通清单与成员",
  },
  {
    path: "/settings/audit",
    group: "设置",
    label: "审计日志",
  },
  {
    path: "/settings/models",
    group: "设置",
    label: "模型与配额",
  },
]);

export function pageVisible(page, session) {
  if (!session) return true; // Explicit, data-free layout preview.
  if (!Object.hasOwn(roleLabels, session.role)) return false;
  const staff = internal.includes(session.role);
  if (page.path === "/library/questions")
    return ["strategist", "factcheck", "cs", "content", "evidence"].includes(
      session.role,
    );
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
