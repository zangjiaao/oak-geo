import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { readWorkbenchSession } from "@/server/api/worker-runtime.mjs";
import {
  WorkspaceShell,
  type WorkspaceSession,
} from "@/components/WorkspaceShell";
import { GenerationPanel } from "@/components/GenerationPanel";
import { CsvImportPanel } from "@/components/CsvImportPanel";
import {
  pageVisible,
  selectWorkspace,
  workspaceHref,
  workspacePages,
} from "@/lib/workspace-navigation.mjs";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace = [] } = await params;
  const path = workspace.length ? "/" + workspace.join("/") : "/";
  const page = workspacePages.find((p) => p.path === path);
  if (!page && !["/account", "/notifications"].includes(path)) notFound();
  const session: WorkspaceSession = await readWorkbenchSession(await headers());
  if (page && !pageVisible(page, session)) notFound();
  const selection = selectWorkspace(session, await searchParams);
  const href = (next: string) => workspaceHref(next, selection);
  let content;
  if (!selection.valid) {
    content = (
      <EmptyState
        title="该品牌或行业不在当前可见范围"
        description="请从顶栏选择有权限的品牌，或清除链接中的筛选条件。"
        actions={<Link href={path}>清除筛选</Link>}
        headingLevel={1}
      />
    );
  } else if (path === "/account") {
    content = (
      <VStack gap={4}>
        <Heading level={1}>账户</Heading>
        <Text type="body">
          {session
            ? `当前账号：${session.user_id}`
            : "尚未登录，当前为布局预览。"}
        </Text>
        <Text type="supporting">
          {session
            ? `合同档位：${session.mode}。页面与操作以当前成员权限为准。`
            : "登录入口尚未交付。可预览生成语法、下载 CSV 模板；入库仍需要有效的工作台会话。"}
        </Text>
        <Link href={href("/")}>返回工作台</Link>
      </VStack>
    );
  } else if (path === "/notifications") {
    content = (
      <EmptyState
        title="通知中心页面待交付"
        description="飙升信号与策略站内记录的服务层已完成，收件箱界面随 T18 接入。此处尚未读取通知，不显示虚构计数。"
        actions={<Link href={href("/")}>返回工作台</Link>}
        headingLevel={1}
      />
    );
  } else if (path === "/library/generation") {
    content = (
      <>
        <Heading level={1}>生成语法</Heading>
        <GenerationPanel
          key={selection.industry}
          session={session}
          industry={selection.industry}
        />
      </>
    );
  } else if (path === "/library/import") {
    content = (
      <>
        <Heading level={1}>CSV 导入</Heading>
        <CsvImportPanel
          key={selection.industry}
          session={session}
          industryContext={selection.industry}
        />
      </>
    );
  } else if (path === "/") {
    content = (
      <>
        <VStack gap={2}>
          <Heading level={1}>工作台</Heading>
          <Text type="body">
            {selection.brand
              ? `${selection.brand.name} · ${selection.industry}`
              : "准备你的第一轮 GEO 测量"}
          </Text>
        </VStack>
        <EmptyState
          title="先准备词库，再建立基线"
          headingLevel={2}
          description="当前尚未接入工作台指标。先确认公共词根、整理真实采集数据，后续沿需求发现 → 内容生产 → 效果验证完成闭环。"
          actions={
            !session ||
            [
              "strategist",
              "factcheck",
              "cs",
              "content",
              "evidence",
              "admin",
            ].includes(session.role) ? (
              <HStack gap={4} wrap="wrap">
                <Link href={href("/library/generation")}>预览生成语法</Link>
                <Link href={href("/library/import")}>下载模板 / 导入数据</Link>
              </HStack>
            ) : (
              <Link href={href("/diagnosis")}>查看诊断入口</Link>
            )
          }
        />
        <Text type="supporting">
          KPI、趋势与待办看板尚待接入；空状态不代表 SOV、准确率或引用率为 0。
        </Text>
      </>
    );
  } else {
    content = (
      <VStack gap={4}>
        <Heading level={1}>{page!.label}</Heading>
        <Text type="body">{page!.description}</Text>
        <EmptyState
          title="页面待交付"
          description={`${page!.task}。当前已建立导航入口，业务界面尚未实现。`}
          actions={<Link href={href("/")}>返回工作台</Link>}
        />
      </VStack>
    );
  }
  return (
    <WorkspaceShell session={session} selection={selection} path={path}>
      {content}
    </WorkspaceShell>
  );
}
