import {
  QuestionPoolPanel,
  type QuestionWorkbench,
} from "@/components/QuestionPoolPanel";
import { readQuestionWorkbench } from "@/server/api/question-workbench.mjs";
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
        actions={<Link href={path}>清除筛选</Link>}
        headingLevel={1}
      />
    );
  } else if (path === "/account") {
    content = (
      <VStack gap={4}>
        <Heading level={1}>账户</Heading>
        {session ? (
          <>
            <Text type="body">账号：{session.user_id}</Text>
            <Text type="body">合同档位：{session.mode}</Text>
          </>
        ) : (
          <Text type="body">登录入口尚未开放。</Text>
        )}
      </VStack>
    );
  } else if (path === "/notifications") {
    content = <EmptyState title="通知中心尚未开放" headingLevel={1} />;
  } else if (path === "/library/questions") {
    const query = await searchParams;
    const data: QuestionWorkbench =
      session && selection.brand
        ? await readQuestionWorkbench(await headers(), {
            brand: selection.brand,
            cluster_id: query.cluster,
            version: query.version,
          })
        : {};
    content = (
      <>
        <Heading level={1}>问句池</Heading>
        <QuestionPoolPanel
          session={session}
          brandId={selection.brand?.id ?? null}
          data={data}
        />
      </>
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
        <Heading level={1}>工作台</Heading>
        <EmptyState
          title="先准备词库，再建立基线"
          headingLevel={2}
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
                <Link href={href("/library/generation")}>生成语法</Link>
                <Link href={href("/library/import")}>CSV 导入</Link>
              </HStack>
            ) : (
              <Link href={href("/diagnosis")}>查看诊断</Link>
            )
          }
        />
      </>
    );
  } else {
    content = (
      <VStack gap={4}>
        <Heading level={1}>{page!.label}</Heading>
        <EmptyState title="页面待交付" />
      </VStack>
    );
  }
  return (
    <WorkspaceShell session={session} selection={selection} path={path}>
      {content}
    </WorkspaceShell>
  );
}
