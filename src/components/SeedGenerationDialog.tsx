"use client";
import { useRef, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { HStack } from "@astryxdesign/core/Stack";
import { FormDialog } from "./FormDialog";
import { generationTemplates } from "@/lib/generation.mjs";

export type Seed = Record<string, unknown> & {
  id: string;
  logical_id: string;
  industry: string;
  word: string;
  word_type: string;
  maintainer: string;
  last_reviewed_at: string;
  seed_version: number;
  status: string;
};
export type SeedContext =
  | { seed_ids: string[] }
  | {
      generation: {
        source_seed_id: string;
        template_id: string;
        inputs: Record<string, string[]>;
        selected_keywords: string[];
      };
    };
export type Collection = { keywords: string[]; seed_context: SeedContext };
type Candidate = Record<string, unknown> & {
  keyword: string;
  eligible: boolean;
  reason: string | null;
};

// Mounted for one source/version; cancelling does not mutate the source seed.
export function SeedGenerationDialog({
  seed,
  tenantId,
  canWrite,
  onClose,
  onCollect,
  onSaved,
}: {
  seed: Seed;
  tenantId: string;
  canWrite: boolean;
  onClose: () => void;
  onCollect: (collection: Collection) => void;
  onSaved: () => void;
}) {
  const [templateId, setTemplateId] = useState("feature_generator");
  const [values, setValues] = useState<Record<string, string>>({
    feature: seed.word,
    from: seed.word,
    industry: seed.word,
    brand: seed.word,
    game: seed.word,
    mode: "unblocked,online",
  });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState<{
    template_id: string;
    inputs: Record<string, string[]>;
    source_seed_id: string;
  } | null>(null);
  const [maintainer, setMaintainer] = useState(seed.maintainer),
    [save, setSave] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  const template = generationTemplates.find((t) => t.id === templateId)!;
  const sharedSelection =
    selected.length > 0 &&
    selected.every((word) =>
      candidates?.some((c) => c.keyword === word && c.eligible),
    );
  const base = `/api/tenants/${encodeURIComponent(tenantId)}/seed-lists`;
  async function preview() {
    setBusy(true);
    setError("");
    try {
      const input = {
        source_seed_id: seed.id,
        template_id: templateId,
        inputs: Object.fromEntries(
          template.fields.map(([key]) => [
            key,
            (values[key] ?? "")
              .split(/[,，\n]/)
              .map((v) => v.trim())
              .filter(Boolean),
          ]),
        ),
      };
      const response = await fetch(
        base + "?" + new URLSearchParams({ generation: JSON.stringify(input) }),
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "扩词预览失败");
      setConfig(input);
      setCandidates(data.data.items);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      const draft = {
        confirmed: true,
        maintainer,
        generation: {
          ...config,
          selected_keywords: selected,
          source_channel: "A",
        },
      };
      const signature = JSON.stringify(draft);
      if (pending.current?.signature !== signature)
        pending.current = {
          signature,
          key: crypto.randomUUID(),
          body: JSON.stringify({
            ...draft,
            last_reviewed_at: new Date().toISOString(),
          }),
        };
      const response = await fetch(
        base + "/" + encodeURIComponent(seed.id) + "/revisions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": pending.current.key,
          },
          body: pending.current.body,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "入库失败");
      pending.current = null;
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "入库失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      isOpen
      title={"扩词 · " + seed.word}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save ? confirm : !candidates ? preview : undefined}
      submitLabel={save ? "确认入库" : "预览检索词"}
      disabled={!canWrite || (save && (!maintainer.trim() || !sharedSelection))}
    >
      {!candidates ? (
        <>
          <Selector
            label="生成模板"
            value={templateId}
            options={generationTemplates.map((t) => ({
              value: t.id,
              label: t.label,
            }))}
            onChange={setTemplateId}
          />
          {template.fields.map(([key, label]) => (
            <TextInput
              key={key}
              label={label}
              placeholder="多个值用逗号分隔"
              value={values[key] ?? ""}
              onChange={(value) =>
                setValues((old) => ({ ...old, [key]: value }))
              }
            />
          ))}
        </>
      ) : (
        <>
          <Table
            data={candidates}
            idKey="keyword"
            density="compact"
            columns={[
              {
                key: "select",
                header: "选择",
                renderCell: (r) => (
                  <CheckboxInput
                    label={"选择 " + r.keyword}
                    isLabelHidden
                    value={selected.includes(r.keyword)}
                    isDisabled={busy || save}
                    onChange={(checked) =>
                      setSelected((old) =>
                        checked
                          ? [...old, r.keyword]
                          : old.filter((word) => word !== r.keyword),
                      )
                    }
                  />
                ),
              },
              { key: "keyword", header: "检索词" },
              {
                key: "eligible",
                header: "存储范围",
                renderCell: (r) => (
                  <Text>{r.eligible ? "可存共享种子" : "仅本租户采集"}</Text>
                ),
              },
            ]}
          />
          {save ? (
            <TextInput
              label="维护人"
              value={maintainer}
              onChange={setMaintainer}
              isRequired
            />
          ) : (
            <HStack gap={3} wrap="wrap">
              <Button
                label={`采集所选词（${selected.length}）`}
                variant="primary"
                isDisabled={
                  !canWrite || !selected.length || selected.length > 5 || busy
                }
                onClick={() =>
                  config &&
                  onCollect({
                    keywords: selected,
                    seed_context: {
                      generation: { ...config, selected_keywords: selected },
                    },
                  })
                }
              />
              <Button
                label="保存为公共种子"
                isDisabled={!canWrite || !sharedSelection || busy}
                onClick={() => setSave(true)}
              />
              <Button
                label="调整模板"
                isDisabled={busy}
                onClick={() => {
                  setCandidates(null);
                  setConfig(null);
                  setSelected([]);
                  setError("");
                }}
              />
            </HStack>
          )}
          {selected.length > 5 && (
            <Text role="status">
              一次最多采集5词，请分批选择；不同查询的相对热度分别保留。
            </Text>
          )}
        </>
      )}
    </FormDialog>
  );
}
