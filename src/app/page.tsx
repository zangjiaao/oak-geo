// Based on astryx AppShellContentOnly; preserve the template frame and spacing.
"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

export default function Home() {
  return (
    <AppShell contentPadding={6}>
      <VStack gap={4}>
        <Heading level={1}>GEO</Heading>
        <Text type="body">品牌 AI 回答测量与事实管理</Text>
        <Text type="supporting">项目初始化完成，业务功能尚未接入。</Text>
      </VStack>
    </AppShell>
  );
}
