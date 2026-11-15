// Based on astryx AppShellContentOnly; preserve the template frame and spacing.
import { AppShell } from "@astryxdesign/core/AppShell";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { headers } from "next/headers";
import { readWorkbenchSession } from "@/server/api/worker-runtime.mjs";
import { GenerationPanel } from "@/components/GenerationPanel";
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await readWorkbenchSession(await headers());
  return (
    <AppShell contentPadding={6}>
      <VStack gap={4}>
        <Heading level={1}>GEO</Heading>
        <Text type="body">品牌 AI 回答测量与事实管理</Text>
        <GenerationPanel session={session} />
      </VStack>
    </AppShell>
  );
}
