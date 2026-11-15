import { test } from "node:test";
import assert from "node:assert/strict";

const full = (role) => ({
  role,
  mode: "full",
  brands: [
    { id: "a", name: "自营工具", industry: "软件工具" },
    { id: "b", name: "工作室产品", industry: "开发工具" },
  ],
});

test("T37导航覆盖八组；客户与diagnosis菜单遵循现有边界，未知角色默认拒绝", async () => {
  const { navigationFor } = await import(
    "../../src/lib/workspace-navigation.mjs"
  );
  const paths = (session) =>
    navigationFor(session).flatMap((g) => g.items.map((p) => p.path));
  assert.deepEqual(
    navigationFor(null).map((g) => g.label),
    ["总览", "诊断", "机会", "词库", "内容", "验证", "证据", "设置"],
  );
  for (const role of ["owner", "editor", "viewer"]) {
    assert.ok(paths(full(role)).includes("/opportunities"));
    assert.ok(!paths(full(role)).includes("/library/generation"));
    assert.ok(!paths(full(role)).includes("/settings/members"));
    const diagnosis = paths({ ...full(role), mode: "diagnosis" });
    for (const path of [
      "/opportunities",
      "/content/workbench",
      "/content/publications",
    ])
      assert.ok(!diagnosis.includes(path));
    assert.ok(diagnosis.includes("/diagnosis"));
    assert.ok(diagnosis.includes("/evidence"));
  }
  assert.ok(paths(full("factcheck")).includes("/content/reviews"));
  assert.ok(!paths(full("content")).includes("/content/reviews"));
  assert.ok(paths(full("admin")).includes("/settings/members"));
  assert.deepEqual(navigationFor({ role: "invented", mode: "full" }), []);
});

test("T37品牌/行业上下文只接受服务端可见集合；跳页保留上下文且拒绝外部跳转", async () => {
  const { selectWorkspace, workspaceHref } = await import(
    "../../src/lib/workspace-navigation.mjs"
  );
  const s = full("strategist");
  assert.equal(selectWorkspace(s, {}).brand.id, "a");
  assert.equal(selectWorkspace(s, { brand: "b" }).industry, "开发工具");
  assert.equal(selectWorkspace(s, { brand: "other-tenant" }).valid, false);
  assert.equal(
    selectWorkspace(s, { brand: "a", industry: "开发工具" }).valid,
    false,
  );
  assert.equal(
    selectWorkspace(s, { role: "admin", tenant: "other" }).brand.id,
    "a",
  );
  const url = new URL(
    workspaceHref("/library/import", {
      brand: s.brands[1],
      industry: "开发工具",
    }),
    "https://geo.test",
  );
  assert.equal(url.searchParams.get("brand"), "b");
  assert.equal(url.searchParams.get("industry"), "开发工具");
  assert.throws(() => workspaceHref("https://evil.test", {}));
  assert.throws(() => workspaceHref("//evil.test", {}));
});
