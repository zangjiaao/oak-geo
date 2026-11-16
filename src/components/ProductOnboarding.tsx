"use client";
import { useEffect, useRef, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Link } from "@astryxdesign/core/Link";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import {factTopics,defaultTopic} from '@/lib/fact-topics.mjs';
import {ResearchFindings} from './ResearchFindings';
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import zhCN from "@astryxdesign/core/locales/zh-CN.generated.js";
import type { WorkspaceSession } from "./WorkspaceShell";
export type Input = {
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
  collected_at?: string;
};
export type Fact = {
  id: string;
  category: string;
  text: string;
  evidence: Evidence[];
  official_fact_id?: string;
  fact_id?: string;
  issues?: string[];
  has_numbers?: boolean | null;
  number_value?: string;
  caliber?: string;
  boundary?: string;
  topic?: string;
  kind?: string;
  is_atomic?: boolean|null;
};
export type Finding={id:string;kind:string;text:string;evidence:Evidence[]};
export type Source = {
  id: string;
  url: string | null;
  title: string;
  kind: string;
  official: boolean;
  text?: string;
  collected_at: string;
};
export type Research = {
  findings?: Finding[];
  notices?: string[];
  facts: Fact[];
  sources: Source[];
  summary: string;
  conflicts: string[];
  unknowns: string[];
  model: string;
  completed_at: string;
};
export type State = {
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
export const empty: Input = {
  name: "",
  description: "",
  website: "",
  official_urls: [],
  audience: "",
  notes: "",
};
export const categories: Record<string, string> = factTopics;
export function useProfile(session: WorkspaceSession, brandId: string | null) {
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
  onSaved,
}: {
  session: WorkspaceSession;
  brandId: string | null;
  welcome?: boolean;
  creating?: boolean;
  onSaved?: (brandId: string) => void;
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
      if (onSaved) { onSaved(savedId!); return; }
      if (welcome || investigate)
        window.location.assign(
          "/welcome?brand=" + encodeURIComponent(savedId!) + (investigate ? "&investigate=1" : ""),
        );
      else setNotice("品牌资料已保存");
    });
  }
  return (
    <InternationalizationProvider locale="zh-CN" messages={{ "zh-CN": zhCN }}>
      <VStack gap={welcome ? 6 : 5} width="100%">
        {!onSaved ? <VStack gap={3}>
          <Heading level={1}>{welcome ? "介绍一下你的品牌" : "品牌设置"}</Heading>
          {welcome ? (
            <Text color="secondary">
              从一段产品介绍开始，整理品牌事实与来源，供你逐条确认。
            </Text>
          ) : null}
        </VStack> : null}
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
        {!onSaved && !store.data?.research_configured && store.loaded ? (
          <Text type="supporting">
            资料调查暂不可用。你仍可保存品牌资料，稍后在知识库继续整理。
          </Text>
        ) : null}
        {store.busy ? (
          <Text role="status">正在保存并整理品牌事实，请稍候…</Text>
        ) : null}
        <HStack gap={3} width="100%">
          <Button
            label={onSaved ? "下一步：检索资料" : welcome ? "建立品牌知识库" : "保存资料"}
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
export function BrandKnowledgePanel({ session, brandId }: {
  session: WorkspaceSession; brandId: string | null;
}) {
  const store = useProfile(session, brandId);
  const [category, setCategory] = useState("all");
  if (!session) return <EmptyState title="登录后查看品牌知识" actions={<Link href="/account">登录</Link>} />;
  if (!brandId) return <EmptyState title="请先选择品牌" />;
  const facts = store.data?.knowledge.facts ?? [];
  const shown = facts.filter((fact) => category === "all" || (fact.topic??defaultTopic(fact.category)) === category);
  const href = "/welcome?brand=" + encodeURIComponent(brandId);
  return (
    <InternationalizationProvider locale="zh-CN" messages={{ "zh-CN": zhCN }}>
      <VStack gap={6}>
        <HStack gap={3} hAlign="between" wrap="wrap">
          <Heading level={1}>知识库</Heading>
          <HStack gap={3} wrap="wrap">
            <Link href={"/settings/brand?brand=" + encodeURIComponent(brandId)}>品牌设置</Link>
            {store.canWrite ? <Button label="整理事实块" href={href} variant="primary" /> : null}
            <Button label="刷新" variant="secondary" isDisabled={store.busy} onClick={() => store.act(async () => { await store.refresh(); })} />
          </HStack>
        </HStack>
        {store.error ? <Text role="alert">{store.error}</Text> : null}
        {!store.loaded ? <Text role="status">正在读取事实块…</Text> : null}
        {store.loaded && !facts.length ? (
          <EmptyState title="还没有已确认的事实块" description="完成资料填写、联网检索和事实确认后，事实块会显示在这里。"
            actions={store.canWrite ? <Button label="继续品牌引导" href={href} variant="primary" /> : undefined} />
        ) : null}
        {facts.length ? (
          <Selector label="事实分类" value={category} onChange={setCategory} options={[
            {value:"all",label:"全部"}, ...Object.entries(categories).map(([value,label])=>({value,label})),
          ]} />
        ) : null}
        {shown.length ? (
          <Grid columns={{minWidth:280,max:3}} gap={4}>
            {shown.map((fact) => {
              const review = store.data?.reviews.find((row) => row.id === fact.official_fact_id);
              return (
                <Card key={fact.official_fact_id} padding={5}>
                  <VStack gap={4}>
                    <HStack hAlign="between" gap={3} wrap="wrap">
                      <Text type="label">{categories[fact.topic??defaultTopic(fact.category)]}</Text>
                      <Text type="supporting">{review?.status === "approved" ? "已放行" : review?.status === "retracted" ? "已撤回" : "用户已确认"}</Text>
                    </HStack>
                    <Text type="large">{fact.text}</Text>
                    {fact.number_value ? <Text type="supporting">数值：{fact.number_value}</Text> : null}
                    {fact.caliber ? <Text type="supporting">口径：{fact.caliber}</Text> : null}
                    {fact.boundary ? <Text type="supporting">适用范围与限制：{fact.boundary}</Text> : null}
                    <VStack gap={3}>
                      {fact.evidence.map((evidence,index) => (
                        <VStack key={index} gap={1}>
                          {evidence.url ? <Link href={evidence.url} target="_blank" rel="noreferrer">{evidence.title || evidence.url}</Link> : <Text type="supporting">品牌方提供的资料</Text>}
                          <Text type="supporting">{evidence.quote}</Text>
                          {evidence.collected_at ? <Text type="supporting">采集时间：{evidence.collected_at}</Text> : null}
                        </VStack>
                      ))}
                    </VStack>
                    {session.role === "factcheck" && review?.status === "draft" ? (
                      <Button label="放行事实" isDisabled={store.busy} onClick={() => store.act(async () => {
                        await store.mutate("facts/" + encodeURIComponent(fact.official_fact_id!) + "/approve");
                      })} />
                    ) : null}
                  </VStack>
                </Card>
              );
            })}
          </Grid>
        ) : null}
        {store.data?.profile?.research?<ResearchFindings research={store.data.profile.research}/>:null}
      </VStack>
    </InternationalizationProvider>
  );
}
