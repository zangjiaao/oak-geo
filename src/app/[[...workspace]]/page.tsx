import { BrandProfileForm, BrandKnowledgePanel } from "@/components/ProductOnboarding";
import {
  QuestionPoolPanel,
  type QuestionWorkbench,
} from "@/components/QuestionPoolPanel";
import { readQuestionWorkbench } from "@/server/api/question-workbench.mjs";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { readWorkbenchSession } from "@/server/api/worker-runtime.mjs";
import { localSessionAllowed } from "@/server/api/local-session.mjs";
import { LocalSignInPanel } from "@/components/LocalSignInPanel";
import { PageHeading } from "@/components/ListPage";
import {
  WorkspaceShell,
  type WorkspaceSession,
} from "@/components/WorkspaceShell";
import { SeedWorkbench } from "@/components/SeedWorkbench";
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
  if (!page && !["/account", "/notifications", "/onboarding"].includes(path)) notFound();
  const requestHeaders = await headers();
  const localLogin = localSessionAllowed(requestHeaders);
  const session: WorkspaceSession = await readWorkbenchSession(requestHeaders);
  if (page && !pageVisible(page, session)) notFound();
  const selection = selectWorkspace(session, await searchParams);
  const href = (next: string) => workspaceHref(next, selection);
  if(path==='/onboarding') redirect('/welcome'+(selection.brand?'?brand='+encodeURIComponent(selection.brand.id):''));
  if(path==='/'&&session&&['owner','strategist'].includes(session.role)&&(session.role==='strategist'||session.mode!=='diagnosis')&&selection.brand&&!(selection.brand as {setup_complete?:boolean}).setup_complete) redirect('/welcome?brand='+encodeURIComponent(selection.brand.id));
  const knowledgeVisible=!session||["owner","editor","viewer","strategist","factcheck"].includes(session.role);
  const primaryHref=knowledgeVisible?href("/knowledge"):href(session?.role==="admin"?"/settings/members":"/diagnosis");
  let content;
  if (!selection.valid) {
    content = (
      <EmptyState
        title="该品牌不在当前可见范围"
        actions={<Link href={path}>清除筛选</Link>}
        headingLevel={1}
      />
    );
  } else if (path === "/knowledge") {
    content = <BrandKnowledgePanel key={selection.brand?.id} session={session} brandId={selection.brand?.id ?? null} />;
  } else if (path === "/settings/brand") {
    content = <BrandProfileForm key={selection.brand?.id} session={session} brandId={selection.brand?.id ?? null} />;
  } else if (path === "/account") {
    content = (
      <VStack gap={4}>
        <Heading level={1}>账户</Heading>
        {localLogin ? <LocalSignInPanel /> : null}
        {session ? (
          <>
            <Text type="body">账号：{session.user_id}</Text>
            <Text type="body">合同档位：{session.mode}</Text>
          </>
        ) : !localLogin ? (
          <Text type="body">登录入口尚未开放。</Text>
        ) : null}
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
        <PageHeading
          title="问句池"
          description="每簇三问句，冻结后修订另开版本。"
        />
        <QuestionPoolPanel
          session={session}
          brandId={selection.brand?.id ?? null}
          data={data}
        />
      </>
    );
  } else if (path === "/library/generation") {
    redirect(href("/library/seeds"));
  } else if (path === "/library/seeds") {
    content = (
      <>
        <PageHeading
          title="种子表管理"
          description="维护行业词根，扩展检索词并采集需求信号。"
        />
        <SeedWorkbench
          key={selection.industry}
          session={session}
          industry={selection.industry}
          market={session?.brands.find(b => b.id === selection.brand?.id)?.market ?? "CN"}
          importHref={href("/library/import")}
        />
      </>
    );
  } else if (path === "/library/import") {
    content = (
      <>
        <PageHeading
          title="CSV 导入"
          description="导入采集数据；C 类需通过授权与脱敏校验。"
        />
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
          title="先建立准确的产品事实"
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
                <Link href={primaryHref}>{knowledgeVisible?"查看品牌知识库":"查看工作入口"}</Link>
              </HStack>
            ) : (
              <Link href={primaryHref}>{knowledgeVisible?"查看品牌知识库":"查看工作入口"}</Link>
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
    <WorkspaceShell
      session={session}
      selection={selection}
      path={path}
      localLogin={localLogin}
    >
      {content}
    </WorkspaceShell>
  );
}
