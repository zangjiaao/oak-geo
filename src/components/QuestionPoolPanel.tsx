"use client";
import { useState, useRef, useEffect } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormDialog } from "./FormDialog";
import { ListToolbar, ListFooter } from "./ListPage";
import { listWindow } from "@/lib/list-view.mjs";
import type { WorkspaceSession } from "./WorkspaceShell";

type Question = Record<string, unknown> & {
  id: string;
  cluster_id: string;
  question: string;
  source_word_id: string;
  intent_type: string;
  source_channel: string;
  collected_at: string;
  maintainer: string;
  question_pool_version: number;
  frozen: boolean;
  archived_at: string | null;
};
type Cluster = {
  id: string;
  name: string;
  intent_type: string;
  status: string;
  question_pool_version: number | null;
};
type Source = {
  id: string;
  keyword: string;
  channel: string;
  collected_at: string;
};
type Version = {
  question_pool_version: number;
  question_count: number;
  cluster_count: number;
  frozen: boolean;
  locked: boolean;
  archived: boolean;
};
export type QuestionWorkbench = {
  error?: string;
  clusters?: Cluster[];
  cluster_id?: string | null;
  versions?: Version[];
  version?: number;
  next_version?: number;
  questions?: Question[];
  sources?: Source[];
};
export function QuestionPoolPanel({
  session,
  brandId,
  data,
}: {
  session: WorkspaceSession;
  brandId: string | null;
  data: QuestionWorkbench;
}) {
  const clusters = data.clusters ?? [],
    versions = data.versions ?? [],
    questions = data.questions ?? [],
    sources = data.sources ?? [];
  const cluster = clusters.find((c) => c.id === data.cluster_id),
    version = data.version ?? 1;
  const current = versions.find((v) => v.question_pool_version === version);
  const canWrite = Boolean(session?.can_write && cluster?.status === "active");
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<
    "create" | "revise" | "freeze" | "anchor" | "archive" | null
  >(null);
  const [sourceId, setSourceId] = useState(""),
    [question, setQuestion] = useState("");
  const [maintainer, setMaintainer] = useState(""),
    [reason, setReason] = useState("");
  const [revision, setRevision] = useState<Question | null>(null);
  const [target, setTarget] = useState(data.next_version ?? 1);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const source = sources.find((s) => s.id === sourceId);
  const view = listWindow(questions, {
    query,
    fields: ["question", "maintainer", "intent_type"],
    page,
  });
  const base =
    session && brandId
      ? `/api/tenants/${encodeURIComponent(session.tenant_id)}/brands/${encodeURIComponent(brandId)}/question-pools`
      : "";
  function navigate(next: { cluster?: string; version?: number }) {
    const url = new URL(window.location.href);
    if (next.cluster) url.searchParams.set("cluster", next.cluster);
    if (next.version != null)
      url.searchParams.set("version", String(next.version));
    window.location.assign(url.pathname + url.search);
  }
  function openCreate(nextVersion: number) {
    setRevision(null);
    setTarget(nextVersion);
    setSourceId(sources[0]?.id ?? "");
    setQuestion(sources[0]?.keyword ?? "");
    setMaintainer("");
    setReason("");
    setMessage("");
    setDialog("create");
  }
  function openAction(action: "freeze" | "anchor" | "archive") {
    setReason("");
    setMessage("");
    setDialog(action);
  }
  async function write(
    path: string,
    body: Record<string, unknown>,
    afterVersion = version,
  ) {
    if (!session || !brandId) return;
    setBusy(true);
    setMessage("");
    try {
      const signature = JSON.stringify([path, body]);
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": pending.current.key,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "无此操作权限"
            : (result.error?.message ?? "操作失败"),
        );
      pending.current = null;
      navigate({ version: afterVersion });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
      setBusy(false);
    }
  }
  async function submit() {
    if (dialog === "revise" && revision)
      return write(
        "/" + encodeURIComponent(revision.id) + "/revisions",
        { question, question_pool_version: target, reason },
        target,
      );
    if (dialog === "create" && source && cluster)
      return write(
        "",
        {
          cluster_id: cluster.id,
          question,
          source_word_id: source.id,
          intent_type: cluster.intent_type,
          source_channel: source.channel,
          collected_at: source.collected_at,
          maintainer,
          question_pool_version: target,
        },
        target,
      );
    if (dialog === "freeze") return write(`/versions/${version}/freeze`, {});
    if (dialog === "archive")
      return write(`/versions/${version}/archive`, { reason });
    // Always use the FULL authorized cluster/version, never the displayed page.
    if (dialog === "anchor")
      return write("/upgrade-anchor", {
        cluster_id: cluster?.id,
        question_pool_version: version,
        question_ids: questions.map((q) => q.id),
        reason,
      });
  }
  if (!session) return <EmptyState title="登录后管理问句池" />;
  if (!brandId) return <EmptyState title="请选择品牌" />;
  if (data.error) return <Text role="alert">{data.error}</Text>;
  if (!clusters.length) return <EmptyState title="暂无意图簇" />;
  if (!ready) return <Text role="status">加载中…</Text>;
  const canCreate = canWrite && !current?.locked && questions.length < 3;
  const anchorLabel =
    cluster?.question_pool_version == null ? "入测锚定" : "升级锚定";
  const titles = {
    create: `新建 v${target} 问句`,
    revise: "修订问句",
    freeze: `冻结 v${version}`,
    anchor: anchorLabel,
    archive: `归档 v${version}`,
  };
  const description =
    dialog === "freeze"
      ? `封版整个品牌版本：${current?.cluster_count} 簇、${current?.question_count} 条问句，之后只可开新版本修订。`
      : dialog === "archive"
        ? "停止新锚定；历史记录与已有锚定保留。"
        : dialog === "anchor"
          ? `将当前簇锚定到 v${version}，后续需重开基线。`
          : dialog === "revise"
            ? "修订另开版本，旧版本与当前锚定不变。"
            : target !== version
              ? `保存首条问句后创建 v${target}，当前锚定不变。`
              : undefined;
  const disabled =
    dialog === "create"
      ? !source || !question.trim() || !maintainer.trim()
      : dialog === "revise"
        ? !question.trim() ||
          !reason.trim() ||
          !revision ||
          target <= revision.question_pool_version
        : dialog === "anchor" || dialog === "archive"
          ? !reason.trim()
          : false;
  return (
    <VStack gap={4}>
      <ListToolbar>
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="搜索问句"
            isLabelHidden
            type="search"
            placeholder="搜索问句或维护人"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <Selector
            label="意图簇"
            isLabelHidden
            value={cluster?.id ?? ""}
            options={clusters.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(id) => navigate({ cluster: id })}
          />
          <Selector
            label="问句版本"
            isLabelHidden
            value={String(version)}
            options={[
              ...versions.map((v) => ({
                value: String(v.question_pool_version),
                label: `v${v.question_pool_version} · ${v.archived ? "已归档" : v.frozen ? "已冻结" : "草稿"}`,
              })),
              ...(!current
                ? [{ value: String(version), label: `v${version} · 草稿` }]
                : []),
            ]}
            onChange={(v) => navigate({ version: Number(v) })}
          />
        </HStack>
        {canWrite && (
          <HStack gap={3} wrap="wrap">
            {canCreate && (
              <Button
                label="新建问句"
                variant="primary"
                isDisabled={busy || !sources.length}
                tooltip={!sources.length ? "先导入真实采集数据" : undefined}
                onClick={() => openCreate(version)}
              />
            )}
            <Button
              label="新建版本"
              isDisabled={
                busy || version === (data.next_version ?? 1) || !sources.length
              }
              onClick={() => openCreate(data.next_version ?? version + 1)}
            />
            {current && !current.locked && (
              <Button
                label={`冻结 v${version}`}
                isDisabled={
                  busy || current.question_count !== current.cluster_count * 3
                }
                tooltip={
                  current.question_count !== current.cluster_count * 3
                    ? "每簇需配齐三条问句"
                    : undefined
                }
                onClick={() => openAction("freeze")}
              />
            )}
            {current?.frozen && !current.archived && (
              <>
                {questions.length === 3 &&
                  (cluster?.question_pool_version == null ||
                    cluster.question_pool_version < version) && (
                    <Button
                      label={anchorLabel}
                      isDisabled={busy}
                      onClick={() => openAction("anchor")}
                    />
                  )}
                <Button
                  label="归档版本"
                  isDisabled={busy}
                  onClick={() => openAction("archive")}
                />
              </>
            )}
          </HStack>
        )}
      </ListToolbar>
      <Text type="supporting">
        锚定：
        {cluster?.question_pool_version == null
          ? "未入测"
          : `v${cluster.question_pool_version}`}
      </Text>
      {view.items.length ? (
        <Table
          data={view.items}
          idKey="id"
          density="compact"
          columns={[
            { key: "question", header: "问句" },
            {
              key: "source_word_id",
              header: "来源",
              renderCell: (q) => (
                <Text type="supporting">
                  {q.source_channel} ·{" "}
                  {sources.find((s) => s.id === q.source_word_id)?.keyword ??
                    q.source_word_id}
                </Text>
              ),
            },
            { key: "intent_type", header: "意图" },
            { key: "maintainer", header: "维护人" },
            { key: "collected_at", header: "采集时间（UTC）" },
            {
              key: "state",
              header: "状态",
              renderCell: (q) => (
                <Text type="supporting">
                  {q.archived_at ? "已归档" : q.frozen ? "已冻结" : "草稿"}
                </Text>
              ),
            },
            {
              key: "action",
              header: "操作",
              renderCell: (q) =>
                canWrite && q.frozen ? (
                  <Button
                    label="修订"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => {
                      setRevision(q);
                      setQuestion(q.question);
                      setSourceId(q.source_word_id);
                      setMaintainer(q.maintainer);
                      setReason("");
                      setMessage("");
                      setTarget(
                        versions
                          .filter(
                            (v) =>
                              !v.locked &&
                              v.question_pool_version > q.question_pool_version,
                          )
                          .sort(
                            (a, b) =>
                              a.question_pool_version - b.question_pool_version,
                          )[0]?.question_pool_version ??
                          data.next_version ??
                          version + 1,
                      );
                      setDialog("revise");
                    }}
                  />
                ) : (
                  <Text type="supporting">—</Text>
                ),
            },
          ]}
        />
      ) : (
        <EmptyState
          title={questions.length ? "没有匹配的问句" : "该簇在此版本尚无问句"}
        />
      )}
      <ListFooter page={view.page} total={view.total} onChange={setPage} />
      {current?.locked && !current.frozen && (
        <Text role="alert">版本内冻结状态不一致，需核对历史记录。</Text>
      )}
      <FormDialog
        isOpen={dialog != null}
        title={dialog ? titles[dialog] : ""}
        description={description}
        busy={busy}
        error={message}
        disabled={disabled}
        onClose={() => {
          setDialog(null);
          setMessage("");
        }}
        onSubmit={submit}
        submitLabel={
          dialog === "create"
            ? "添加问句"
            : dialog === "revise"
              ? "保存新版本问句"
              : "确认"
        }
      >
        {(dialog === "create" || dialog === "revise") && (
          <>
            {dialog === "create" ? (
              <Selector
                label="真实来源"
                value={sourceId}
                options={sources.map((s) => ({
                  value: s.id,
                  label: `${s.channel} · ${s.keyword}`,
                }))}
                onChange={(id) => {
                  setSourceId(id);
                  setQuestion(sources.find((s) => s.id === id)?.keyword ?? "");
                }}
              />
            ) : (
              <NumberInput
                label="修订目标版本"
                value={target}
                min={(revision?.question_pool_version ?? 0) + 1}
                onChange={setTarget}
              />
            )}
            <TextArea
              label="问句"
              value={question}
              onChange={setQuestion}
              isRequired
            />
            {dialog === "create" && (
              <TextInput
                label="维护人"
                value={maintainer}
                onChange={setMaintainer}
                placeholder="具体人名"
                isRequired
              />
            )}
          </>
        )}
        {(dialog === "revise" ||
          dialog === "anchor" ||
          dialog === "archive") && (
          <TextInput
            label={dialog === "revise" ? "修订理由" : "操作理由"}
            value={reason}
            onChange={setReason}
            isRequired
          />
        )}
      </FormDialog>
    </VStack>
  );
}
