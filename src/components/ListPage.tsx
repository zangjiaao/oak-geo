import type { ReactNode } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Pagination } from "@astryxdesign/core/Pagination";

export function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <VStack gap={2}>
      <Heading level={1}>{title}</Heading>
      <Text type="supporting">{description}</Text>
    </VStack>
  );
}
export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <HStack gap={3} wrap="wrap" hAlign="between">
      {children}
    </HStack>
  );
}
export function ListFooter({
  page,
  total,
  onChange,
  pageSize = 20,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  pageSize?: number;
}) {
  return (
    <HStack gap={3} wrap="wrap" hAlign="between">
      <Text type="supporting">共 {total} 条</Text>
      {total > pageSize && (
        <Pagination
          label="列表分页"
          page={page}
          totalItems={total}
          pageSize={pageSize}
          onChange={onChange}
          size="sm"
        />
      )}
    </HStack>
  );
}
