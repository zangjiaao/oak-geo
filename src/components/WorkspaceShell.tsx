"use client";
// Adapted from Astryx AppShellTopNavWithSideNav: keep shell slots and spacing.
import type { ReactNode } from "react";
import { AppShell, useAppShellMobile } from "@astryxdesign/core/AppShell";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import {
  navigationFor,
  roleLabels,
  workspaceHref,
} from "@/lib/workspace-navigation.mjs";
export type WorkspaceSession = {
  tenant_id: string;
  user_id: string;
  role: string;
  mode: string;
  can_write: boolean;
  brands: { id: string; name: string; industry: string }[];
} | null;
type Selection = {
  valid: boolean;
  brand: { id: string; name: string; industry: string } | null;
  industry: string;
};

function WorkspaceBody({ children }: { children: ReactNode }) {
  const { isMobile } = useAppShellMobile();
  if (!isMobile) return children;
  return (
    <VStack gap={4}>
      <Heading level={1}>移动端日报</Heading>
      <Text type="body">请在桌面端使用完整工作台。</Text>
      <Text type="supporting">今日新增错误：待接入</Text>
      <Text type="supporting">待审项：待接入</Text>
      <Text type="supporting">飙升词：待接入</Text>
    </VStack>
  );
}

export function WorkspaceShell({
  session,
  selection,
  path,
  localLogin = false,
  children,
}: {
  session: WorkspaceSession;
  selection: Selection;
  path: string;
  localLogin?: boolean;
  children: ReactNode;
}) {
  const groups = navigationFor(session);
  const brands = session?.brands ?? [];
  const industries = [...new Set(brands.map((b) => b.industry))];
  const href = (next: string) => workspaceHref(next, selection);
  function selectBrand(id: string) {
    const brand = brands.find((b) => b.id === id);
    if (brand)
      window.location.assign(
        workspaceHref(path, { brand, industry: brand.industry }),
      );
  }
  const context = (
    <HStack gap={3} wrap="wrap">
      <Selector
        label="品牌"
        isLabelHidden
        value={selection.brand?.id ?? ""}
        options={brands.map((b) => ({ value: b.id, label: b.name }))}
        placeholder={session ? "暂无可见品牌" : "登录后选择品牌"}
        isDisabled={!brands.length}
        disabledMessage={
          session ? "请先配置品牌或关联任务" : "未登录，仅预览布局"
        }
        onChange={selectBrand}
        size="sm"
        variant="secondary"
      />
      <Selector
        label="行业"
        isLabelHidden
        value={selection.industry}
        options={industries.map((industry) => ({
          value: industry,
          label: industry,
        }))}
        placeholder="尚未选择行业"
        isDisabled={!industries.length}
        size="sm"
        variant="secondary"
        onChange={(industry) => {
          const brand = brands.find((b) => b.industry === industry);
          if (brand) selectBrand(brand.id);
        }}
      />
    </HStack>
  );
  return (
    <AppShell
      contentPadding={6}
      variant="section"
      topNav={
        <TopNav
          label="GEO 顶栏"
          heading={<TopNavHeading heading="GEO" headingHref={href("/")} />}
          startContent={context}
          endContent={
            <HStack gap={4} wrap="wrap">
              <VStack gap={0}>
                <Text type="supporting">数据截至：尚未接入</Text>
                <Text type="supporting">下次刷新：未排期</Text>
              </VStack>
              <Link href={href("/notifications")}>通知</Link>
              <Button
                label="导出"
                size="sm"
                isDisabled
                tooltip="报告页交付后提供导出"
              />
              <Link href={href("/account")}>
                {session
                  ? (roleLabels[session.role as keyof typeof roleLabels] ??
                    "账户")
                  : localLogin ? "本地登录" : "未登录"}
              </Link>
            </HStack>
          }
        />
      }
      sideNav={
        <SideNav aria-label="GEO 主导航">
          {groups.map((group) => (
            <SideNavSection key={group.label} title={group.label}>
              {group.items.map((page) => (
                <SideNavItem
                  key={page.path}
                  label={page.label}
                  href={href(page.path)}
                  isSelected={page.path === path}
                />
              ))}
            </SideNavSection>
          ))}
        </SideNav>
      }
    >
      <VStack gap={6}>
        {!session && (
          <Text type="supporting" role="status">
            未登录，仅可预览和下载模板。
          </Text>
        )}
        <WorkspaceBody>{children}</WorkspaceBody>
      </VStack>
    </AppShell>
  );
}
