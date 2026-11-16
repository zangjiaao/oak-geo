import { headers } from "next/headers";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Icon } from "@astryxdesign/core/Icon";
import { BrandProfileForm } from "@/components/ProductOnboarding";
import { readWorkbenchSession } from "@/server/api/worker-runtime.mjs";
import { selectWorkspace } from "@/lib/workspace-navigation.mjs";
export const dynamic = "force-dynamic";
// Adapted from Astryx contact-form: centered, full-width form with a bounded reading width.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await readWorkbenchSession(await headers()),
    query = await searchParams,
    selection = selectWorkspace(session, query),
    creating = query.new === "1";
  return (
    <VStack
      as="main"
      hAlign="center"
      vAlign="center"
      minHeight="100svh"
      width="100%"
      padding={6}
      paddingBlock={10}
      style={{ fontFamily: "var(--font-family-body)" }}
    >
      <VStack width="100%" maxWidth="44rem" gap={6}>
        <HStack hAlign="between" vAlign="center">
          <HStack gap={2} vAlign="center">
            <Icon icon="search" color="primary" />
            <Text type="label" size="xl">GEO</Text>
          </HStack>
          <Text type="supporting" color="secondary">
            {creating ? "新增品牌" : "首次设置 · 品牌资料"}
          </Text>
        </HStack>
        <Card width="100%" padding={8}>
          <BrandProfileForm
            key={creating ? "new-brand" : selection.brand?.id}
            session={session}
            brandId={creating ? null : selection.valid ? (selection.brand?.id ?? null) : null}
            creating={creating}
            welcome
          />
        </Card>
        {creating && session ? (
          <Link href="/settings/brand">返回品牌设置</Link>
        ) : null}
        <Text type="supporting" color="secondary" justify="center">
          资料会同步到品牌设置和知识库，之后随时可以修改。
        </Text>
      </VStack>
    </VStack>
  );
}
