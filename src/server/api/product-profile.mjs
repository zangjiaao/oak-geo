import { randomUUID } from "node:crypto";
import { validation } from "./errors.mjs";
import {factTopics,topicCategory,defaultTopic} from '../../lib/fact-topics.mjs';

export const factCategories = ["price", "spec", "boundary", "service_promise"];
export function publicProductUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw validation("请填写完整的 HTTPS 公开链接");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".") ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":") ||
    /(?:^|\.)(localhost|local|internal|test|invalid|onion)$/.test(
      url.hostname,
    ) ||
    /(?:token|secret|password|api.?key|authorization)=/i.test(url.search) ||
    value.length > 1500
  )
    throw validation("仅支持不含凭证的公开 HTTPS 链接");
  url.hash = "";
  return url.href;
}
const text = (value, max, label, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw validation(`${label}不能为空或过长`);
  return value.trim();
};
export function validateProductInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validation("产品资料格式错误");
  if (
    !Array.isArray(value.official_urls ?? []) ||
    (value.official_urls ?? []).length > 5
  )
    throw validation("最多补充5个官方资料链接");
  return {
    name: text(value.name, 100, "产品名称", true),
    website: value.website ? publicProductUrl(value.website) : "",
    description: text(value.description, 2000, "产品描述", true),
    audience: text(value.audience ?? "", 500, "适用用户"),
    notes: text(value.notes ?? "", 1000, "补充说明"),
    official_urls: [
      ...new Set((value.official_urls ?? []).map(publicProductUrl)),
    ],
  };
}
export function isOfficialProductUrl(url, input) {
  const candidate = new URL(url);
  return [input.website, ...input.official_urls]
    .filter(Boolean)
    .some((value) => {
      const base = new URL(value);
      return (
        candidate.origin === base.origin &&
        (base.pathname === "/" ||
          candidate.pathname === base.pathname ||
          candidate.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/"))
      );
    });
}
export function validateResearchOutput(value, sources) {
  if (!value || !Array.isArray(value.facts) || value.facts.length > 12)
    throw validation("调查结果需要有效的事实候选");
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const facts = value.facts.map((f) => {
    if (
      !factCategories.includes(f.category) ||
      !Array.isArray(f.evidence) ||
      !f.evidence.length ||
      f.evidence.length > 3
    )
      throw validation("事实必须附实际来源");
    const evidence = f.evidence.map((e) => {
      const source = sourceMap.get(e.source_id),
        quote = text(e.quote, 240, "来源摘录", true);
      if (!source || !source.text.includes(quote))
        throw validation("来源或摘录未在本次调查中取得");
      return { source_id: source.id, quote };
    });
    return {
      id: randomUUID(),
      category: f.category,
      text: text(f.text, 400, "事实", true),
      evidence,
    };
  });
  const list = (items, label) => {
    if (!Array.isArray(items) || items.length > 8)
      throw validation(`${label}格式错误`);
    return items.map((item) => text(item, 350, label, true));
  };
  return {
    facts,
    summary: text(value.summary, 1000, "产品理解"),
    conflicts: list(value.conflicts, "口径冲突"),
    unknowns: list(value.unknowns, "待核实项"),
  };
}

// Model output is a review draft. A broken citation must not discard unrelated
// candidates; strict source validation is repeated when a human confirms a fact.
export function prepareResearchDraft(value, sources) {
  if (!value || !Array.isArray(value.facts))
    throw validation("模型结果缺少事实列表", {reason:"research_result_format"});
  const notices = Array.isArray(value.notices) ? value.notices.filter(item=>typeof item==='string').slice(0,8).map(item=>item.slice(0,350)) : [];
  const notice = message => { if(!notices.includes(message))notices.push(message); };
  const list = (items,label) => {
    if(items==null)return [];
    if(!Array.isArray(items)){notice(`${label}未按列表返回，已保留事实候选供确认。`);return [];}
    if(items.length>8)notice(`${label}较多，当前显示前8项。`);
    return items.filter(item=>typeof item==='string'&&item.trim()).slice(0,8).map(item=>item.trim().slice(0,350));
  };
  const envelope = {
    summary: typeof value.summary==='string' ? value.summary.trim().slice(0,1000) : '',
    conflicts: list(value.conflicts,'口径冲突'),unknowns: list(value.unknowns,'待核实项'),
  };
  const isFinding=raw=>(raw?.kind!=null&&raw.kind!=='product_fact')||raw?.has_unresolved_conflict===true;
  const productFacts=value.facts.filter(raw=>!isFinding(raw));
  if(productFacts.length>12)notice(`本轮提取了${productFacts.length}条候选，当前保留前12条；其余可缩小资料范围后继续整理。`);
  const findings=[...(Array.isArray(value.findings)?value.findings:[]),...value.facts.filter(isFinding)].slice(0,16).map(raw=>({
    id:randomUUID(),kind:raw?.has_unresolved_conflict?'source_conflict':['source_conflict','open_question','source_note'].includes(raw?.kind)?raw.kind:'open_question',
    text:typeof raw?.text==='string'?raw.text.trim().slice(0,1200):'',
    evidence:(Array.isArray(raw?.evidence)?raw.evidence:[]).slice(0,3).map(item=>({source_id:typeof item?.source_id==='string'?item.source_id.slice(0,160):'',quote:typeof item?.quote==='string'?item.quote.slice(0,240):''})),
  })).filter(item=>item.text);
  return {
    ...envelope, notices,findings,
    facts: productFacts.slice(0,12).map((raw) => {
      const issues = [];
      const hasTopic=typeof raw?.topic==='string'&&Object.hasOwn(factTopics,raw.topic);
      const topic=hasTopic?raw.topic:defaultTopic(raw?.category);
      const category=hasTopic?topicCategory(topic):factCategories.includes(raw?.category)?raw.category:'spec';
      if (!raw?.topic&&!factCategories.includes(raw?.category)) issues.push("请选择正确的事实分类");
      if(raw?.is_atomic===false)issues.push('包含多个独立主张，请拆分后确认');
      const statement = typeof raw?.text === "string" ? raw.text.trim() : "";
      if (statement.length > 400) issues.push("陈述超过400字，请拆分为独立事实");
      const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : []).slice(0, 3).map((item) => ({
        source_id: typeof item?.source_id === "string" ? item.source_id.slice(0, 160) : "",
        quote: typeof item?.quote === "string" ? item.quote.trim().slice(0, 240) : "",
      }));
      const candidate = { category, text: statement.slice(0, 400), evidence };
      try { validateResearchOutput({ ...envelope, facts: [candidate] }, sources); }
      catch (error) { issues.push(error.code === "validation_failed" ? error.message : "该条事实需要人工修正"); }
      return {
        id: randomUUID(), ...candidate, issues,topic,kind:'product_fact',is_atomic:typeof raw?.is_atomic==='boolean'?raw.is_atomic:null,
        has_numbers: typeof raw?.has_numbers === "boolean" ? raw.has_numbers : null,
        number_value: typeof raw?.number_value === "string" ? raw.number_value.slice(0, 200) : "",
        caliber: typeof raw?.caliber === "string" ? raw.caliber.slice(0, 500) : "",
        boundary: typeof raw?.boundary === "string" ? raw.boundary.slice(0, 500) : "",
      };
    }),
  };
}
