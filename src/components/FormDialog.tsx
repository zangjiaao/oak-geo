"use client";
// Adapted from Astryx DialogFormDialog; preserve its header/body/footer slots.
import type { ReactNode } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";

export function FormDialog({
  isOpen,
  title,
  description,
  children,
  onClose,
  onSubmit,
  submitLabel,
  busy = false,
  disabled = false,
  error,
}: {
  isOpen: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  error?: string;
}) {
  if (!isOpen) return null;
  const change = (open: boolean) => {
    if (!open && !busy) onClose();
  };
  return (
    <Dialog
      isOpen
      onOpenChange={change}
      purpose={busy ? "required" : "form"}
      width="calc(var(--spacing-10) * 16)"
    >
      <Layout
        header={
          <DialogHeader
            title={title}
            subtitle={description}
            onOpenChange={busy ? undefined : change}
          />
        }
        content={
          <LayoutContent>
            <VStack gap={4}>
              {children}
              {error && <Text role="alert">{error}</Text>}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={3} hAlign="end">
              <Button
                label={onSubmit ? "取消" : "关闭"}
                onClick={onClose}
                isDisabled={busy}
              />
              {onSubmit && (
                <Button
                  label={submitLabel ?? "保存"}
                  variant="primary"
                  isLoading={busy}
                  isDisabled={disabled || busy}
                  onClick={onSubmit}
                />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
