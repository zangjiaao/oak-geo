"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormDialog } from "./FormDialog";
import { ListToolbar, ListFooter } from "./ListPage";
import { listWindow } from "@/lib/list-view.mjs";
import { generationTemplates, generateCandidates } from "@/lib/generation.mjs";
type Session = { tenant_id: string; can_write: boolean } | null;
type Seed = { id: string; industry: string; word: string; status: string };
interface Candidate extends Record<string, unknown> {
  keyword: string;
  eligible: boolean;
  reason: string | null;
}
type PreviewConfig = {
  template_id: string;
  inputs: Record<string, string[]>;
  source_seed_id: string;
};
export function GenerationPanel({
  session,
  industry = "",
}: {
  session: Session;
  industry?: string;
}) {
  const [templateId, setTemplateId] = useState("feature_generator");
  const [values, setValues] = useState<Record<string, string>>({
    mode: "unblocked,online",
  });
  const [seeds, setSeeds] = useState<Seed[]>([]),
    [source, setSource] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [previewConfig, setPreviewConfig] = useState<PreviewConfig | null>(
    null,
  );
  const [channel, setChannel] = useState("A"),
    [maintainer, setMaintainer] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [eligibility, setEligibility] = useState("all"),
    [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"generate" | "confirm" | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  const template = generationTemplates.find((item) => item.id === templateId)!;
  const base = session
    ? `/api/tenants/${encodeURIComponent(session.tenant_id)}/seed-lists`
    : "";
  const params = useMemo(
    () =>
      Object.fromEntries(
        template.fields.map(([key]) => [
          key,
          (values[key] ?? "")
            .split(/[,，\n]/)
            .map((v) => v.trim())
            .filter(Boolean),
        ]),
      ),
    [template, values],
  );
  const view = listWindow(candidates, {
    query,
    fields: ["keyword"],
    page,
    matches: (row) =>
      eligibility === "all" ||
      (eligibility === "eligible" ? row.eligible : !row.eligible),
  });
  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      const items: Seed[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({
          status: "active",
          limit: "100",
          ...(industry ? { industry } : {}),
        });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(base + "?" + query, { cache: "no-store" }),
          data = await response.json();
        if (!response.ok)
          throw new Error(data.error?.message ?? "种子读取失败");
        items.push(...data.data.items);
        cursor = data.data.next_cursor;
      } while (cursor);
      if (active) {
        setSeeds(items);
        setSource((current) =>
          items.some((item) => item.id === current)
            ? current
            : (items[0]?.id ?? ""),
        );
      }
    })().catch((error) => {
      if (active) setMessage(error.message);
    });
    return () => {
      active = false;
    };
  }, [base, session, revision, industry]);
  function open(next: "generate" | "confirm") {
    setError("");
    setDialog(next);
  }
  async function preview() {
    setBusy(true);
    setError("");
    const config = {
      template_id: templateId,
      inputs: params,
      source_seed_id: source,
    };
    try {
      let rows: Candidate[];
      if (!session)
        rows = generateCandidates(config).map((row) => ({
          ...row,
          eligible: false,
          reason: "登录后校验公共词根许可",
        }));
      else {
        if (!source) throw new Error("请先建立并选择启用的公共种子");
        const query = new URLSearchParams({
          generation: JSON.stringify(config),
        });
        const response = await fetch(base + "?" + query, { cache: "no-store" }),
          data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "预览失败");
        rows = data.data.items;
      }
      setCandidates(rows);
      setPreviewConfig(config);
      setSelected([]);
      setPage(1);
      setQuery("");
      setEligibility("all");
      setMessage("");
      setDialog(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!previewConfig) return;
    setBusy(true);
    setError("");
    try {
      // Commit the configuration that produced the visible candidates, not any
      // subsequently edited/cancelled generation form draft.
      const draft = {
        confirmed: true,
        maintainer,
        generation: {
          template_id: previewConfig.template_id,
          inputs: previewConfig.inputs,
          source_channel: channel,
          selected_keywords: selected,
        },
      };
      const signature = JSON.stringify([previewConfig.source_seed_id, draft]);
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
          base +
            "/" +
            encodeURIComponent(previewConfig.source_seed_id) +
            "/revisions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": pending.current.key,
            },
            body: pending.current.body,
          },
        ),
        data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "确认失败");
      pending.current = null;
      setDialog(null);
      setMessage(`已入库 ${data.data.items.length} 个公共词根`);
      setCandidates([]);
      setSelected([]);
      setPreviewConfig(null);
      setRevision((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "确认失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <VStack gap={4}>
      <ListToolbar>
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="搜索生成词"
            isLabelHidden
            type="search"
            placeholder="搜索生成词"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <Selector
            label="准入状态"
            isLabelHidden
            value={eligibility}
            options={[
              { value: "all", label: "全部准入状态" },
              { value: "eligible", label: "可入库" },
              { value: "blocked", label: "不可入库" },
            ]}
            onChange={(value) => {
              setEligibility(value);
              setPage(1);
            }}
          />
        </HStack>
        <HStack gap={3} wrap="wrap">
          <Button
            label={`确认入库（${selected.length}）`}
            isDisabled={!session?.can_write || !selected.length || busy}
            onClick={() => open("confirm")}
          />
          <Button
            label="生成词组"
            variant="primary"
            isDisabled={busy}
            onClick={() => open("generate")}
          />
        </HStack>
      </ListToolbar>
      {view.items.length ? (
        <Table
          data={view.items}
          idKey="keyword"
          density="compact"
          columns={[
            {
              key: "select",
              header: "选择",
              renderCell: (row) => (
                <CheckboxInput
                  label={"选择 " + row.keyword}
                  isLabelHidden
                  value={selected.includes(row.keyword)}
                  isDisabled={!row.eligible || !session?.can_write || busy}
                  onChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, row.keyword]
                        : current.filter((word) => word !== row.keyword),
                    )
                  }
                />
              ),
            },
            { key: "keyword", header: "生成词" },
            {
              key: "reason",
              header: "准入",
              renderCell: (row) => (
                <Text type="supporting">
                  {row.eligible ? "可入库" : row.reason}
                </Text>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState
          title={candidates.length ? "没有匹配的生成词" : "尚未生成词组"}
        />
      )}
      <ListFooter page={view.page} total={view.total} onChange={setPage} />
      {message && <Text role="status">{message}</Text>}
      <FormDialog
        isOpen={dialog === "generate"}
        title="生成词组"
        busy={busy}
        error={error}
        onClose={() => setDialog(null)}
        onSubmit={preview}
        submitLabel="批量预览"
      >
        <Selector
          label="模板"
          value={templateId}
          options={generationTemplates.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          onChange={setTemplateId}
        />
        {session && (
          <Selector
            label="来源种子"
            value={source}
            options={seeds.map((item) => ({
              value: item.id,
              label: item.word,
            }))}
            onChange={setSource}
            placeholder="请选择启用的公共种子"
          />
        )}
        {template.fields.map(([key, label]) => (
          <TextInput
            key={key}
            label={label}
            placeholder="多个值用逗号分隔"
            value={values[key] ?? ""}
            onChange={(value) =>
              setValues((current) => ({ ...current, [key]: value }))
            }
          />
        ))}
      </FormDialog>
      <FormDialog
        isOpen={dialog === "confirm"}
        title="确认入库"
        description={`已选 ${selected.length} 个公共词根。`}
        busy={busy}
        error={error}
        disabled={!session?.can_write || !selected.length || !maintainer.trim()}
        onClose={() => setDialog(null)}
        onSubmit={confirm}
        submitLabel="确认入库"
      >
        <TextInput
          label="维护人"
          value={maintainer}
          onChange={setMaintainer}
          isRequired
        />
        <Selector
          label="计划采集渠道"
          value={channel}
          options={[
            { value: "A", label: "A · 检索类" },
            { value: "B", label: "B · 平台内" },
          ]}
          onChange={setChannel}
        />
      </FormDialog>
    </VStack>
  );
}
