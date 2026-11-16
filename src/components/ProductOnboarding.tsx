"use client";
import { useEffect, useRef, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Table } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import zhCN from "@astryxdesign/core/locales/zh-CN.generated.js";
import type { WorkspaceSession } from "./WorkspaceShell";
type Input = {
  name: string;
  description: string;
  website: string;
  official_urls: string[];
  audience: string;
  notes: string;
};
type Evidence = {
  source_id: string;
  quote: string;
  url?: string | null;
  title?: string;
  kind?: string;
};
type Fact = {
  id: string;
  category: string;
  text: string;
  evidence: Evidence[];
  official_fact_id?: string;
};
type Source = {
  id: string;
  url: string | null;
  title: string;
  kind: string;
  official: boolean;
  collected_at: string;
};
type Research = {
  facts: Fact[];
  sources: Source[];
  summary: string;
  conflicts: string[];
  unknowns: string[];
  model: string;
  completed_at: string;
};
type State = {
  profile: {
    id: string;
    input: Input;
    research: Research | null;
    updated_at: string;
  } | null;
  knowledge: {
    user_provided: { source: string; profile_id: string } | null;
    facts: Fact[];
  };
  research_stale: boolean;
  run: { error: string | null; finished_at: string | null } | null;
  reviews: { id: string; status: string }[];
  research_configured: boolean;
};
const empty: Input = {
  name: "",
  description: "",
  website: "",
  official_urls: [],
  audience: "",
  notes: "",
};
const categories: Record<string, string> = {
  price: "价格",
  spec: "产品能力",
  boundary: "适用边界",
  service_promise: "服务承诺",
};
function useProfile(session: WorkspaceSession, brandId: string | null) {
  const [data, setData] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const key = useRef<{ signature: string; id: string } | null>(null);
  const endpoint =
    session && brandId
      ? `/api/tenants/${encodeURIComponent(session.tenant_id)}/brands/${encodeURIComponent(brandId)}/product-profile`
      : null;
  const canWrite = Boolean(
    session &&
      ["owner", "strategist"].includes(session.role) &&
      (session.role === "strategist" || session.mode !== "diagnosis"),
  );
  async function refresh() {
    if (!endpoint) return null;
    const response = await fetch(endpoint, { cache: "no-store" }),
      payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "读取失败");
    setData(payload.data);
    return payload.data as State;
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setLoaded(false);
    setError("");
    if (!endpoint) return;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "读取失败");
        if (active) setData(payload.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  async function mutate(
    action: string, body: unknown = {}, targetEndpoint = endpoint,
  ) {
    if (!targetEndpoint) throw new Error("请先登录并选择品牌");
    const bytes = JSON.stringify(body),
      signature = targetEndpoint + "/" + action + bytes;
    if (key.current?.signature !== signature)
      key.current = { signature, id: crypto.randomUUID() };
    const response = await fetch(targetEndpoint + "/" + action, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key.current.id,
        },
        body: bytes,
      }),
      payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "操作失败");
    key.current = null;
    if (targetEndpoint === endpoint) await refresh();
    return payload.data;
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    loaded,
    busy,
    error,
    setError,
    canWrite,
    refresh,
    mutate,
    act,
  };
}
export function BrandProfileForm({
  session,
  brandId,
  welcome = false,
  creating = false,
}: {
  session: WorkspaceSession;
  brandId: string | null;
  welcome?: boolean;
  creating?: boolean;
}) {
  const store = useProfile(session, brandId),
    [input, setInput] = useState<Input>(empty),
    [links, setLinks] = useState(""),
    [extras, setExtras] = useState(!welcome),
    [notice, setNotice] = useState("");
  const createdBrand = useRef<{
    id: string; research_configured: boolean;
  } | null>(null);
  const canWrite = store.canWrite && (!creating || session?.role === "owner");
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current && store.data) {
      hydrated.current = true;
      if (store.data.profile) {
        setInput(store.data.profile.input);
        setLinks(store.data.profile.input.official_urls.join("\n"));
      }
    }
  }, [store.data]);
  const ready = creating
    ? canWrite
    : store.loaded && Boolean(store.data) && (!store.data?.profile || hydrated.current);
  if (!session)
    return (
      <EmptyState
        title="登录后建立品牌知识库"
        actions={<Link href="/account">登录</Link>}
      />
    );
  if (creating && !canWrite)
    return <EmptyState title="当前账号不能新增品牌" description="请使用可编辑品牌资料的 Owner 账号。" />;
  if (!brandId && !creating) return <EmptyState title="请管理员先为账号开通品牌" />;
  const change = (key: keyof Input, value: string) =>
    setInput((previous) => ({ ...previous, [key]: value }));
  async function save(investigate: boolean) {
    setNotice("");
    await store.act(async () => {
      const data = {
        input: {
          ...input,
          official_urls: links
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };
      const root = `/api/tenants/${encodeURIComponent(session!.tenant_id)}/brands`;
      let savedId = brandId;
      if (creating) {
        if (!createdBrand.current)
          createdBrand.current = await store.mutate("create", data, root);
        else
          await store.mutate("save", data, root + "/" + encodeURIComponent(createdBrand.current.id) + "/product-profile");
        savedId = createdBrand.current!.id;
      } else await store.mutate("save", data);
      if (
        investigate &&
        (creating ? createdBrand.current?.research_configured : store.data?.research_configured)
      )
        await store.mutate("investigate", {}, root + "/" + encodeURIComponent(savedId!) + "/product-profile");
      if (welcome || investigate)
        window.location.assign(
          "/knowledge?brand=" + encodeURIComponent(savedId!),
        );
      else setNotice("品牌资料已保存，知识库已同步");
    });
  }
  return (
    <InternationalizationProvider locale="zh-CN" messages={{ "zh-CN": zhCN }}>
      <VStack gap={welcome ? 6 : 5} width="100%">
        <VStack gap={3}>
          <Heading level={1}>{welcome ? "介绍一下你的品牌" : "品牌设置"}</Heading>
          {welcome ? (
            <Text color="secondary">
              从一段产品介绍开始，整理品牌事实与来源，供你逐条确认。
            </Text>
          ) : null}
        </VStack>
        {store.error ? <Text role="alert">{store.error}</Text> : null}
        {store.error && creating && createdBrand.current ? (
          <Link href={"/knowledge?brand=" + encodeURIComponent(createdBrand.current.id)}>
            品牌已创建，前往知识库继续
          </Link>
        ) : null}
        {notice ? <Text role="status">{notice}</Text> : null}
        {!canWrite ? (
          <Text type="supporting">当前账号只读，Owner 可修改品牌资料。</Text>
        ) : null}
        {welcome && !canWrite ? (
          <Link href={"/knowledge?brand=" + brandId}>查看品牌知识库</Link>
        ) : null}
        <TextInput
          label="品牌名称"
          placeholder={welcome ? "例如：okdata" : undefined}
          size={welcome ? "lg" : "md"}
          autoComplete="organization"
          value={input.name}
          onChange={(value) => change("name", value)}
          isRequired
          isDisabled={!canWrite || store.busy || !ready}
        />
        <TextArea
          label="品牌描述"
          rows={welcome ? 8 : 3}
          placeholder={
            welcome
              ? "可以直接粘贴已有的产品介绍。\n\n它提供什么产品或服务？适合谁使用？有哪些能力、价格或使用限制？"
              : undefined
          }
          value={input.description}
          onChange={(value) => change("description", value)}
          description={welcome ? undefined : "介绍产品能力、适用人群、价格与限制。"}
          maxLength={2000}
          isRequired
          isDisabled={!canWrite || store.busy || !ready}
        />
        {welcome ? (
          <HStack>
            <Button
              label={extras ? "收起补充资料" : "补充资料（选填）"}
              variant="ghost"
              icon={<Icon icon={extras ? "chevronDown" : "externalLink"} />}
              aria-expanded={extras}
              aria-controls="brand-additional-sources"
              onClick={() => setExtras(!extras)}
              isDisabled={store.busy}
            />
          </HStack>
        ) : null}
        {extras ? (
          <VStack gap={4} id="brand-additional-sources">
            <TextInput
              label="官网（选填）"
              value={input.website}
              onChange={(value) => change("website", value)}
              placeholder="https://example.com/"
              isDisabled={!canWrite || store.busy || !ready}
            />
            <TextArea
              label="官方资料链接（选填，每行一个）"
              value={links}
              onChange={setLinks}
              isDisabled={!canWrite || store.busy || !ready}
            />
            <TextArea
              label="重点核查或补充说明（选填）"
              value={input.notes}
              onChange={(value) => change("notes", value)}
              maxLength={1000}
              isDisabled={!canWrite || store.busy || !ready}
            />
          </VStack>
        ) : null}
        {!store.data?.research_configured && store.loaded ? (
          <Text type="supporting">
            资料调查暂不可用。你仍可保存品牌资料，稍后在知识库继续整理。
          </Text>
        ) : null}
        {store.busy ? (
          <Text role="status">正在保存并整理品牌事实，请稍候…</Text>
        ) : null}
        <HStack gap={3} width="100%">
          <Button
            label={welcome ? "建立品牌知识库" : "保存资料"}
            variant="primary"
            size={welcome ? "lg" : "md"}
            width={welcome ? "100%" : undefined}
            isLoading={store.busy}
            endContent={welcome ? <Icon icon="chevronRight" /> : undefined}
            onClick={() => save(welcome)}
            isDisabled={
              !canWrite ||
              store.busy ||
              !ready ||
              !input.name.trim() ||
              !input.description.trim()
            }
          />
          {!welcome ? (
            <Button
              label="保存并重新调查"
              variant="secondary"
              onClick={() => save(true)}
              isDisabled={
                !canWrite ||
                store.busy ||
                !ready ||
                !store.data?.research_configured
              }
            />
          ) : null}
          {!welcome ? (
            <Link href={"/knowledge?brand=" + brandId}>查看知识库</Link>
          ) : null}
        </HStack>
      </VStack>
    </InternationalizationProvider>
  );
}
export function BrandKnowledgePanel({
  session,
  brandId,
}: {
  session: WorkspaceSession;
  brandId: string | null;
}) {
  const store = useProfile(session, brandId),
    [selected, setSelected] = useState<string[]>([]),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState("");
  const [officialSources, setOfficialSources] = useState<string[]>([]);
  const data = store.data,
    research = data?.profile?.research,
    sources = research?.sources ?? [],
    known = data?.knowledge.facts ?? [];
  const facts = [
    ...known,
    ...(research?.facts ?? []).filter((f) => !known.some((k) => k.id === f.id)),
  ];
  const sourceFor = (fact: Fact) =>
    fact.evidence.map((e) => sources.find((s) => s.id === e.source_id));
  const confirmable = (fact: Fact) =>
    !store.data?.research_stale &&
    !fact.official_fact_id &&
    sourceFor(fact).some(
      (s) =>
        s?.official ||
        s?.kind === "user_input" ||
        (s?.kind === "page" && officialSources.includes(s.id)),
    );
  if (!session)
    return (
      <EmptyState
        title="登录后查看品牌知识"
        actions={<Link href="/account">登录</Link>}
      />
    );
  if (!brandId) return <EmptyState title="请先选择品牌" />;
  async function confirm() {
    await store.act(async () => {
      await store.mutate("confirm", {
        official_source_ids: officialSources,
        facts: selected.map((id) => ({
          id,
          text: edits[id] ?? facts.find((f) => f.id === id)?.text,
        })),
      });
      setSelected([]);
      setEdits({});
      setNotice("已确认并送审，独立放行后可作为官方事实使用");
    });
  }
  return (
    <VStack gap={5}>
      <HStack gap={3} justify="between" wrap="wrap">
        <Heading level={1}>知识库</Heading>
        <HStack gap={3}>
          <Link href={"/settings/brand?brand=" + brandId}>品牌设置</Link>
          <Button
            label="刷新"
            variant="secondary"
            isDisabled={store.busy}
            onClick={() =>
              store.act(async () => {
                await store.refresh();
              })
            }
          />
        </HStack>
      </HStack>
      {store.error ? <Text role="alert">{store.error}</Text> : null}
      {notice ? <Text role="status">{notice}</Text> : null}
      {!store.loaded ? <Text role="status">正在读取品牌知识…</Text> : null}
      {!data?.profile && store.loaded ? (
        <EmptyState
          title="先介绍你的品牌"
          actions={<Link href={"/welcome?brand=" + brandId}>开始引导</Link>}
        />
      ) : null}
      {data?.knowledge.user_provided ? (
        <VStack gap={2}>
          <Heading level={2}>{data.profile?.input.name}</Heading>
          <Text>{data.profile?.input.description}</Text>
          <Text type="supporting">
            来源：用户提供。独立审核前作为品牌声明与研究材料使用。
          </Text>
        </VStack>
      ) : null}
      {data?.profile ? (
        <HStack gap={3}>
          <Button
            label={store.busy ? "正在调查…" : "检索并整理事实"}
            isDisabled={
              !store.canWrite || store.busy || !data.research_configured
            }
            onClick={() =>
              store.act(async () => {
                await store.mutate("investigate");
              })
            }
          />
          {!data.research_configured ? (
            <Text type="supporting">
              调查服务未配置，请管理员设置 DEEPSEEK_API_KEY。
            </Text>
          ) : null}
        </HStack>
      ) : null}
      {data?.run?.error ? <Text role="alert">{data.run.error}</Text> : null}
      {data?.run && !data.run.finished_at ? (
        <Text role="status">
          调查尚未完成，可稍后刷新；中断任务两分钟后可重试。
        </Text>
      ) : null}
      {data?.research_stale ? (
        <Text role="status">
          品牌资料已修改，请重新调查。已送审事实仍保留。
        </Text>
      ) : null}
      {research ? (
        <>
          <Text>{research.summary}</Text>
          {research.conflicts.length ? (
            <VStack gap={2}>
              <Heading level={2}>口径冲突</Heading>
              {research.conflicts.map((s, i) => (
                <Text key={i}>{s}</Text>
              ))}
            </VStack>
          ) : null}
          {research.unknowns.length ? (
            <VStack gap={2}>
              <Heading level={2}>待核实</Heading>
              {research.unknowns.map((s, i) => (
                <Text key={i}>{s}</Text>
              ))}
            </VStack>
          ) : null}
        </>
      ) : null}
      {facts.length ? (
        <>
          <Table
            data={facts}
            idKey="id"
            density="compact"
            columns={[
              {
                key: "select",
                header: "确认",
                renderCell: (fact) => (
                  <CheckboxInput
                    label={"选择事实：" + fact.text}
                    isLabelHidden
                    value={selected.includes(fact.id)}
                    isDisabled={
                      !store.canWrite || store.busy || !confirmable(fact)
                    }
                    onChange={(value) =>
                      setSelected((old) =>
                        value
                          ? [...old, fact.id]
                          : old.filter((id) => id !== fact.id),
                      )
                    }
                  />
                ),
              },
              {
                key: "category",
                header: "类型",
                renderCell: (fact) => categories[fact.category],
              },
              {
                key: "text",
                header: "事实",
                renderCell: (fact) =>
                  store.canWrite && !fact.official_fact_id ? (
                    <TextArea
                      label="修改事实"
                      value={edits[fact.id] ?? fact.text}
                      onChange={(text) =>
                        setEdits((old) => ({ ...old, [fact.id]: text }))
                      }
                      maxLength={400}
                      isDisabled={store.busy}
                    />
                  ) : (
                    <Text>{fact.text}</Text>
                  ),
              },
              {
                key: "evidence",
                header: "出处",
                renderCell: (fact) => (
                  <VStack gap={2}>
                    {fact.evidence.map((e, i) => {
                      const source = sources.find((s) => s.id === e.source_id),
                        url = e.url ?? source?.url,
                        title = e.title ?? source?.title ?? "用户提供";
                      return (
                        <VStack key={i} gap={0}>
                          {url ? (
                            <Link href={url}>{title}</Link>
                          ) : (
                            <Text>{title}</Text>
                          )}
                          <Text>{e.quote}</Text>
                        </VStack>
                      );
                    })}
                  </VStack>
                ),
              },
              {
                key: "review",
                header: "状态",
                renderCell: (fact) => {
                  const review = data?.reviews.find(
                    (r) => r.id === fact.official_fact_id,
                  );
                  return session.role === "factcheck" &&
                    review?.status === "draft" ? (
                    <Button
                      label="放行事实"
                      isDisabled={store.busy}
                      onClick={() =>
                        store.act(async () => {
                          await store.mutate(
                            "facts/" + fact.official_fact_id + "/approve",
                          );
                          setNotice("事实已独立放行");
                        })
                      }
                    />
                  ) : (
                    <Text>
                      {review?.status === "approved"
                        ? "已放行"
                        : review?.status === "draft"
                          ? "待独立审核"
                          : fact.official_fact_id
                            ? "已送审"
                            : confirmable(fact)
                              ? "待确认"
                              : "待补官方出处"}
                    </Text>
                  );
                },
              },
            ]}
          />
          <Button
            label="确认所选事实并送审"
            isDisabled={
              !store.canWrite ||
              store.busy ||
              !selected.length ||
              data?.research_stale
            }
            onClick={confirm}
          />
        </>
      ) : research ? (
        <Text>
          暂未取得足够证据形成独立事实，可补充描述或官方资料后重新调查。
        </Text>
      ) : null}
      {sources.length ? (
        <>
          <Heading level={2}>调查来源</Heading>
          <Table
            data={sources}
            idKey="id"
            density="compact"
            columns={[
              {
                key: "title",
                header: "来源",
                renderCell: (s) =>
                  s.url ? (
                    <Link href={s.url}>{s.title}</Link>
                  ) : (
                    <Text>{s.title}</Text>
                  ),
              },
              {
                key: "kind",
                header: "依据",
                renderCell: (s) =>
                  s.kind === "user_input"
                    ? "用户提供"
                    : s.official
                      ? "官方原文"
                      : s.kind === "search"
                        ? "搜索摘要"
                        : "外部原文",
              },
              {
                key: "official",
                header: "官方来源",
                renderCell: (s) =>
                  s.kind === "page" && !s.official && store.canWrite ? (
                    <CheckboxInput
                      label={"确认官方来源：" + s.title}
                      value={officialSources.includes(s.id)}
                      isDisabled={store.busy}
                      onChange={(value) =>
                        setOfficialSources((old) =>
                          value
                            ? [...old, s.id]
                            : old.filter((id) => id !== s.id),
                        )
                      }
                    />
                  ) : (
                    <Text>
                      {s.official
                        ? "已确认"
                        : s.kind === "user_input"
                          ? "品牌方声明"
                          : "—"}
                    </Text>
                  ),
              },
              { key: "collected_at", header: "采集时间" },
            ]}
          />
        </>
      ) : null}
    </VStack>
  );
}
