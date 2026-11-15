"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { generationTemplates, generateCandidates } from "@/lib/generation.mjs";
type Session = { tenant_id: string; can_write: boolean } | null;
type Seed = { id: string; industry: string; word: string; status: string };
interface Candidate extends Record<string, unknown> {
  keyword: string;
  eligible: boolean;
  reason: string | null;
}
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
  const [channel, setChannel] = useState("A"),
    [maintainer, setMaintainer] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
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
  function invalidate() {
    setCandidates([]);
    setSelected([]);
    setMessage("");
    setPage(0);
  }
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
  async function preview() {
    setBusy(true);
    setMessage("");
    setSelected([]);
    setPage(0);
    try {
      if (!session) {
        setCandidates(
          generateCandidates({ template_id: templateId, inputs: params }).map(
            (row) => ({
              ...row,
              eligible: false,
              reason: "待登录校验",
            }),
          ),
        );
        return;
      }
      if (!source) throw new Error("请先建立并选择启用的公共种子");
      const query = new URLSearchParams({
        generation: JSON.stringify({
          template_id: templateId,
          inputs: params,
          source_seed_id: source,
        }),
      });
      const response = await fetch(base + "?" + query, { cache: "no-store" }),
        data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "预览失败");
      setCandidates(data.data.items);
    } catch (error) {
      setCandidates([]);
      setMessage(error instanceof Error ? error.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setMessage("");
    try {
      const draft = {
        confirmed: true,
        maintainer,
        generation: {
          template_id: templateId,
          inputs: params,
          source_channel: channel,
          selected_keywords: selected,
        },
      };
      const signature = JSON.stringify([source, draft]);
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
          base + "/" + encodeURIComponent(source) + "/revisions",
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
      setMessage(`已入库 ${data.data.items.length} 个公共词根`);
      setCandidates([]);
      setSelected([]);
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "确认失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <VStack gap={4}>
      <Text type="supporting">仅许可公共词根可入库。</Text>
      <HStack gap={4} wrap="wrap">
        <Selector
          label="模板"
          value={templateId}
          options={generationTemplates.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          onChange={(value) => {
            setTemplateId(value);
            invalidate();
          }}
        />
        {session && (
          <Selector
            label="来源种子"
            value={source}
            options={seeds.map((item) => ({
              value: item.id,
              label: item.word,
            }))}
            onChange={(value) => {
              setSource(value);
              invalidate();
            }}
            placeholder="请选择启用的公共种子"
          />
        )}
      </HStack>
      <HStack gap={4} wrap="wrap">
        {template.fields.map(([key, label]) => (
          <TextInput
            key={key}
            label={label}
            placeholder="多个值用逗号分隔"
            value={values[key] ?? ""}
            onChange={(value) => {
              setValues((current) => ({ ...current, [key]: value }));
              invalidate();
            }}
          />
        ))}
      </HStack>
      <Button label="批量预览" onClick={preview} isLoading={busy} />
      {candidates.length > 0 && (
        <>
          <Table
            data={candidates.slice(page * 20, page * 20 + 20)}
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
          <HStack gap={3}>
            <Button
              label="上一页"
              isDisabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            />
            <Text type="supporting">
              第 {page + 1} 页 · 共 {candidates.length} 条
            </Text>
            <Button
              label="下一页"
              isDisabled={(page + 1) * 20 >= candidates.length}
              onClick={() => setPage((value) => value + 1)}
            />
          </HStack>
          <HStack gap={4} wrap="wrap">
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
          </HStack>
          <Button
            label={"确认入库（" + selected.length + "）"}
            variant="primary"
            isLoading={busy}
            isDisabled={
              !session?.can_write || !selected.length || !maintainer.trim()
            }
            onClick={confirm}
          />
        </>
      )}
      {message && (
        <Text type="body" role="status">
          {message}
        </Text>
      )}
    </VStack>
  );
}
