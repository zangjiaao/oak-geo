"use client";
// Uses the existing flat Table/ListToolbar frame and shared DialogForm slots.
import { useEffect, useRef, useState } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Button } from "@astryxdesign/core/Button";
import { Table, proportional } from "@astryxdesign/core/Table";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { FormDialog } from "./FormDialog";
import { ListToolbar, ListFooter } from "./ListPage";
import {
  SeedGenerationDialog,
  type Seed,
  type Collection,
} from "./SeedGenerationDialog";
import {
  SeedCollectionDialog,
  SeedTrendHistoryDialog,
} from "./SeedTrendDialogs";
import type { WorkspaceSession } from "./WorkspaceShell";
import { listWindow } from "@/lib/list-view.mjs";
const statusName = (status: string) => (status === "active" ? "启用" : "停用");

export function SeedWorkbench({
  session,
  industry,
  market,
  importHref,
}: {
  session: WorkspaceSession;
  industry: string;
  market: string;
  importHref: string;
}) {
  const [rows, setRows] = useState<Seed[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("active"),
    [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [edit, setEdit] = useState<{ seed?: Seed } | null>(null),
    [generation, setGeneration] = useState<Seed | null>(null),
    [collection, setCollection] = useState<Collection | null>(null);
  const [history, setHistory] = useState<{ seed?: Seed } | null>(null),
    [versions, setVersions] = useState<{
      seed: Seed;
      items: Seed[];
      cursor: string | null;
    } | null>(null);
  const [word, setWord] = useState(""),
    [wordType, setWordType] = useState("品类"),
    [maintainer, setMaintainer] = useState(""),
    [editStatus, setEditStatus] = useState("active");
  const pending = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  const readable =
      !!session && ["strategist", "factcheck", "cs"].includes(session.role),
    writable = !!session?.can_write;
  const base = session
    ? `/api/tenants/${encodeURIComponent(session.tenant_id)}/seed-lists`
    : "";
  const listUrl = base + "?" + new URLSearchParams({ industry, limit: "100" });
  async function dataOf(response: Response) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "操作失败");
    return body.data;
  }
  useEffect(() => {
    if (!readable || !industry) {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    fetch(listUrl, { signal: controller.signal })
      .then(dataOf)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.items);
          setCursor(data.next_cursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [listUrl, readable, industry, revision]);
  const view = listWindow(rows, {
    query,
    fields: ["word", "maintainer"],
    page,
    matches: (r: Seed) => status === "all" || r.status === status,
  });
  function openEdit(seed?: Seed) {
    setError("");
    setWord(seed?.word ?? "");
    setWordType(seed?.word_type ?? "品类");
    setMaintainer(seed?.maintainer ?? "");
    setEditStatus(seed?.status ?? "active");
    setEdit({ seed });
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const draft = {
          industry,
          word,
          word_type: wordType,
          maintainer,
          status: editStatus,
        },
        signature = JSON.stringify([edit?.seed?.id, draft]);
      if (pending.current?.signature !== signature)
        pending.current = {
          signature,
          key: crypto.randomUUID(),
          body: JSON.stringify({
            ...draft,
            last_reviewed_at: new Date().toISOString(),
          }),
        };
      await dataOf(
        await fetch(
          base +
            (edit?.seed
              ? "/" + encodeURIComponent(edit.seed.id) + "/revisions"
              : ""),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": pending.current.key,
            },
            body: pending.current.body,
          },
        ),
      );
      pending.current = null;
      setEdit(null);
      setRevision((v) => v + 1);
      setMessage("种子版本已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    setError("");
    try {
      const data = await dataOf(
        await fetch(
          listUrl + "&" + new URLSearchParams({ cursor: cursor ?? "" }),
        ),
      );
      setRows((old) => [...old, ...data.items]);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  async function readVersions(seed: Seed, next?: string | null) {
    setBusy(true);
    setError("");
    try {
      const data = await dataOf(
        await fetch(
          base +
            "?" +
            new URLSearchParams({
              industry,
              view: "history",
              logical_id: seed.logical_id,
              limit: "20",
              ...(next ? { cursor: next } : {}),
            }),
        ),
      );
      setVersions((old) => ({
        seed,
        items: next ? [...(old?.items ?? []), ...data.items] : data.items,
        cursor: data.next_cursor,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <EmptyState title="登录并选择品牌后管理行业种子" />;
  if (!readable) return <EmptyState title="当前角色无行业种子管理权限" />;
  if (!industry) return <EmptyState title="请先为品牌配置行业" />;
  return (
    <>
      <ListToolbar>
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="搜索已加载词根"
            isLabelHidden
            placeholder="搜索词根或维护人"
            type="search"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <Selector
            label="种子状态"
            isLabelHidden
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "全部状态" },
              { value: "active", label: "启用" },
              { value: "deprecated", label: "停用" },
            ]}
          />
        </HStack>
        <HStack gap={3} wrap="wrap">
          <Button
            label="采集记录"
            onClick={() => {
              setError("");
              setHistory({});
            }}
            isDisabled={busy}
          />
          <Link href={importHref}>其他来源补录</Link>
          {writable && (
            <Button
              label="添加词根"
              variant="primary"
              onClick={() => openEdit()}
              isDisabled={busy}
            />
          )}
        </HStack>
      </ListToolbar>
      {message && <Text role="status">{message}</Text>}
      {error && !edit && !versions && <Text role="alert">{error}</Text>}
      {view.items.length ? (
        <Table
          data={view.items}
          idKey="id"
          density="compact"
          columns={[
            { key: "word", header: "词根" },
            { key: "word_type", header: "类型" },
            { key: "maintainer", header: "维护人" },
            {
              key: "last_reviewed_at",
              header: "复核时间",
              renderCell: (r) => <Text>{r.last_reviewed_at.slice(0, 10)}</Text>,
            },
            {
              key: "seed_version",
              header: "版本",
              renderCell: (r) => <Text>v{r.seed_version}</Text>,
            },
            {
              key: "status",
              header: "状态",
              renderCell: (r) => <Text>{statusName(r.status)}</Text>,
            },
            {
              key: "id",
              header: "操作",
              width: proportional(2),
              renderCell: (r) => (
                <HStack gap={2} wrap="wrap">
                  {writable && (
                    <>
                      <Button
                        label="扩词"
                        onClick={() => setGeneration(r)}
                        isDisabled={r.status !== "active" || busy}
                      />
                      <Button
                        label="采集"
                        onClick={() =>
                          setCollection({
                            keywords: [r.word],
                            seed_context: { seed_ids: [r.id] },
                          })
                        }
                        isDisabled={r.status !== "active" || busy}
                      />
                    </>
                  )}
                  <DropdownMenu button={{ label: "更多", isDisabled: busy }}>
                    <DropdownMenuItem
                      label="采集记录"
                      onClick={() => setHistory({ seed: r })}
                    />
                    <DropdownMenuItem
                      label="版本历史"
                      onClick={() => readVersions(r)}
                    />
                    {writable && (
                      <DropdownMenuItem
                        label="编辑"
                        onClick={() => openEdit(r)}
                      />
                    )}
                  </DropdownMenu>
                </HStack>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState
          title={
            busy
              ? "正在加载行业种子"
              : rows.length
                ? "没有匹配的词根"
                : "该行业尚未配置公共种子"
          }
        />
      )}
      <ListFooter page={view.page} total={view.total} onChange={setPage} />
      {cursor && (
        <Button label="加载更多词根" onClick={more} isDisabled={busy} />
      )}
      <FormDialog
        isOpen={edit !== null}
        title={edit?.seed ? "编辑词根" : "添加词根"}
        onClose={() => setEdit(null)}
        onSubmit={save}
        busy={busy}
        error={error}
        disabled={!word.trim() || !maintainer.trim()}
      >
        <TextInput label="词根" value={word} onChange={setWord} isRequired />
        <Text type="supporting">
          仅限已许可的行业公共词根；品牌、品线与竞品词归品牌配置。
        </Text>
        <Selector
          label="类型"
          value={wordType}
          onChange={setWordType}
          options={["品类", "场景", "问题"].map((value) => ({
            value,
            label: value,
          }))}
        />
        <TextInput
          label="维护人"
          value={maintainer}
          onChange={setMaintainer}
          isRequired
        />
        <Selector
          label="状态"
          value={editStatus}
          onChange={setEditStatus}
          options={[
            { value: "active", label: "启用" },
            { value: "deprecated", label: "停用" },
          ]}
        />
      </FormDialog>
      {generation && (
        <SeedGenerationDialog
          seed={generation}
          tenantId={session.tenant_id}
          canWrite={writable}
          onClose={() => setGeneration(null)}
          onSaved={() => {
            setRevision((v) => v + 1);
            setMessage("公共种子已保存");
          }}
          onCollect={(next) => {
            setGeneration(null);
            setCollection(next);
          }}
        />
      )}
      {collection && writable && (
        <SeedCollectionDialog
          key={JSON.stringify(collection)}
          collection={collection}
          tenantId={session.tenant_id}
          industry={industry}
          market={market}
          onClose={() => setCollection(null)}
          onSaved={() => {
            setMessage(
              "采集完成，数据已进入词池输入；归簇分档仍待周批规则冻结。",
            );
            setHistory({});
          }}
        />
      )}
      {history && (
        <SeedTrendHistoryDialog
          key={history.seed?.id ?? "industry"}
          tenantId={session.tenant_id}
          industry={industry}
          seed={history.seed}
          onClose={() => setHistory(null)}
        />
      )}
      <FormDialog
        isOpen={versions !== null}
        title={"版本历史 · " + (versions?.seed.word ?? "")}
        onClose={() => setVersions(null)}
        busy={busy}
        error={error}
      >
        <Table
          data={versions?.items ?? []}
          idKey="id"
          columns={[
            {
              key: "seed_version",
              header: "版本",
              renderCell: (r) => <Text>v{r.seed_version}</Text>,
            },
            { key: "word", header: "词根" },
            { key: "maintainer", header: "维护人" },
            {
              key: "status",
              header: "状态",
              renderCell: (r) => <Text>{statusName(r.status)}</Text>,
            },
          ]}
        />
        {versions?.cursor && (
          <Button
            label="加载更多版本"
            onClick={() => readVersions(versions.seed, versions.cursor)}
            isDisabled={busy}
          />
        )}
      </FormDialog>
    </>
  );
}
