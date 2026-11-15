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
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [question, setQuestion] = useState(sources[0]?.keyword ?? "");
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
  async function write(
    path: string,
    body: Record<string, unknown>,
    afterVersion?: number,
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
      if (afterVersion != null) navigate({ version: afterVersion });
      else window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
      setBusy(false);
    }
  }
  if (!session) return <EmptyState title="登录后管理问句池" />;
  if (!brandId) return <EmptyState title="请选择品牌" />;
  if (data.error) return <Text role="alert">{data.error}</Text>;
  if (!clusters.length) return <EmptyState title="暂无意图簇" />;
  if (!ready) return <Text role="status">加载中…</Text>;
  const count = questions.length;
  return (
    <VStack gap={4}>
      <HStack gap={4} wrap="wrap">
        <Selector
          label="意图簇"
          value={cluster?.id ?? ""}
          options={clusters.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(id) => navigate({ cluster: id })}
        />
        <Selector
          label="问句版本"
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
        <Text type="supporting">
          锚定：
          {cluster?.question_pool_version == null
            ? "未入测"
            : `v${cluster.question_pool_version}`}
        </Text>
        {canWrite && (
          <Button
            label="新建版本"
            onClick={() =>
              navigate({ version: data.next_version ?? version + 1 })
            }
            isDisabled={busy || version === (data.next_version ?? 1)}
          />
        )}
      </HStack>
      {count > 0 ? (
        <Table
          data={questions}
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
            { key: "collected_at", header: "采集时间" },
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
                    }}
                  />
                ) : (
                  <Text type="supporting">—</Text>
                ),
            },
          ]}
        />
      ) : (
        <EmptyState title="该簇在此版本尚无问句" />
      )}
      {canWrite && ((!current?.locked && count < 3) || revision) && (
        <VStack gap={4}>
          {revision ? (
            <HStack gap={4}>
              <NumberInput
                label="修订目标版本"
                value={target}
                min={revision.question_pool_version + 1}
                onChange={setTarget}
              />
              <Button
                label="取消修订"
                onClick={() => {
                  setRevision(null);
                  setReason("");
                  setQuestion(source?.keyword ?? "");
                  setMaintainer("");
                }}
              />
            </HStack>
          ) : null}
          {!revision && (
            <Selector
              label="真实来源"
              value={sourceId}
              options={sources.map((s) => ({
                value: s.id,
                label: `${s.channel} · ${s.keyword}`,
              }))}
              placeholder="先导入真实采集数据"
              onChange={(id) => {
                setSourceId(id);
                setQuestion(sources.find((s) => s.id === id)?.keyword ?? "");
              }}
            />
          )}
          <TextArea
            label="问句"
            value={question}
            onChange={setQuestion}
            isRequired
          />
          {!revision && (
            <TextInput
              label="维护人"
              value={maintainer}
              onChange={setMaintainer}
              placeholder="具体人名"
              isRequired
            />
          )}
          {revision && (
            <TextInput
              label="修订理由"
              value={reason}
              onChange={setReason}
              isRequired
            />
          )}
          <Button
            label={revision ? "保存新版本问句" : "添加问句"}
            isLoading={busy}
            isDisabled={
              !question.trim() ||
              (!revision && (!source || !maintainer.trim())) ||
              (Boolean(revision) && !reason.trim())
            }
            onClick={() => {
              if (revision)
                void write(
                  "/" + encodeURIComponent(revision.id) + "/revisions",
                  { question, question_pool_version: target, reason },
                );
              else if (source && cluster)
                void write(
                  "",
                  {
                    cluster_id: cluster.id,
                    question,
                    source_word_id: source.id,
                    intent_type: cluster.intent_type,
                    source_channel: source.channel,
                    collected_at: source.collected_at,
                    maintainer,
                    question_pool_version: version,
                  },
                  version,
                );
            }}
          />
        </VStack>
      )}
      {canWrite && current && !current.archived && !revision && (
        <VStack gap={4}>
          {!current.locked ? (
            <Button
              label={`冻结整个 v${version}（${current.cluster_count} 簇 / ${current.question_count} 问句）`}
              isDisabled={
                busy || current.question_count !== current.cluster_count * 3
              }
              tooltip={
                current.question_count !== current.cluster_count * 3
                  ? "每簇需配齐三条问句"
                  : undefined
              }
              isLoading={busy}
              onClick={() =>
                void write(`/versions/${version}/freeze`, {}, version)
              }
            />
          ) : current.frozen ? (
            <>
              <TextInput
                label="操作理由"
                value={reason}
                onChange={setReason}
                isRequired
              />
              <HStack gap={4} wrap="wrap">
                {count === 3 &&
                  (cluster?.question_pool_version == null ||
                    cluster.question_pool_version < version) && (
                    <Button
                      label={
                        cluster?.question_pool_version == null
                          ? "确认入测锚定"
                          : "升级锚定并重开基线"
                      }
                      isDisabled={busy || !reason.trim()}
                      onClick={() =>
                        void write(
                          "/upgrade-anchor",
                          {
                            cluster_id: cluster?.id,
                            question_pool_version: version,
                            question_ids: questions.map((q) => q.id),
                            reason,
                          },
                          version,
                        )
                      }
                    />
                  )}
                <Button
                  label="归档版本"
                  isDisabled={busy || !reason.trim()}
                  onClick={() =>
                    void write(
                      `/versions/${version}/archive`,
                      { reason },
                      version,
                    )
                  }
                />
              </HStack>
            </>
          ) : (
            <Text role="alert">版本内冻结状态不一致，需核对历史记录。</Text>
          )}
        </VStack>
      )}
      {message && <Text role="alert">{message}</Text>}
    </VStack>
  );
}
