"use client";
import {useEffect,useRef,useState} from "react";
import {VStack,HStack} from "@astryxdesign/core/Stack";
import {Step,Stepper} from "@astryxdesign/core/Stepper";
import {Heading,Text} from "@astryxdesign/core/Text";
import {Button} from "@astryxdesign/core/Button";
import {Link} from "@astryxdesign/core/Link";
import {TextArea} from "@astryxdesign/core/TextArea";
import {TextInput} from "@astryxdesign/core/TextInput";
import {Selector} from "@astryxdesign/core/Selector";
import {CheckboxInput} from "@astryxdesign/core/CheckboxInput";
import {ProgressBar} from "@astryxdesign/core/ProgressBar";
import {EmptyState} from "@astryxdesign/core/EmptyState";
import {Card} from "@astryxdesign/core/Card";
import {Collapsible} from "@astryxdesign/core/Collapsible";
import {InternationalizationProvider} from "@astryxdesign/core/i18n";
import zhCN from "@astryxdesign/core/locales/zh-CN.generated.js";
import {readResearchEvents} from "@/lib/research-events.mjs";
import {researchProgress} from "@/lib/research-progress.mjs";
import {BrandProfileForm,useProfile,categories,type Fact,type Source} from "./ProductOnboarding";
import {defaultTopic,topicCategory} from '@/lib/fact-topics.mjs';
import {ResearchFindings} from './ResearchFindings';
import type {WorkspaceSession} from "./WorkspaceShell";

type Activity={kind:string;phase:string;call_id?:string;at?:string;query?:string;url?:string;count?:number;message?:string};
type Draft=Fact & {has_numbers:boolean|null;number_value:string;caliber:string;boundary:string};
const draft=(fact:Fact):Draft=>({...fact,topic:fact.topic??defaultTopic(fact.category),evidence:fact.evidence.slice(0,1),has_numbers:fact.has_numbers??null,number_value:fact.number_value??"",caliber:fact.caliber??"",boundary:fact.boundary??""});
function issue(fact:Draft,sources:Source[],official:string[]) {
  if(fact.is_atomic===false)return '请先把陈述拆分成一个独立产品主张。';
  if (!fact.text.trim()) return "请填写一条可以独立核验的陈述。";
  if (!fact.evidence.length) return "请选择来源并填写原文摘录。";
  for (const evidence of fact.evidence) {
    const source=sources.find(item=>item.id===evidence.source_id);
    if (!source || source.kind==='search') return "请选择已读取的页面或品牌方提供的资料，搜索摘要不能代替原文。";
    if (!evidence.quote.trim() || !source.text?.includes(evidence.quote.trim())) return "摘录未与来源原文匹配，请从下方原文中复制。";
  }
  if (!fact.evidence.some(e=>{const s=sources.find(item=>item.id===e.source_id);return s?.kind==='user_input'||s?.official||official.includes(e.source_id);}))
    return "请核实并确认官方来源，或选择品牌方提供的资料。";
  return "";
}
function FactReview({store,brandId,onBack}:{store:ReturnType<typeof useProfile>;brandId:string;onBack:()=>void}) {
  const research=store.data?.profile?.research;
  const facts=research?.facts??[],sources=research?.sources??[];
  const [edits,setEdits]=useState<Record<string,Draft>>({});
  const [selected,setSelected]=useState<string[]>([]),[active,setActive]=useState("");
  const [official,setOfficial]=useState<string[]>([]),[extra,setExtra]=useState(false),[notice,setNotice]=useState("");
  const initialized=useRef(false);
  useEffect(()=>{
    if(initialized.current||!research)return;
    initialized.current=true;
    const ids=sources.filter(source=>source.official).map(source=>source.id);
    setOfficial(ids);setActive(facts[0]?.id??"");
    setEdits(Object.fromEntries(facts.map(fact=>[fact.id,draft(fact)])));
    setSelected(facts.filter(fact=>!issue(draft(fact),sources,ids)).map(fact=>fact.id));
  },[research,facts,sources]);
  const current=edits[active],currentSource=sources.find(source=>source.id===current?.evidence[0]?.source_id);
  const currentIssue=current?issue(current,sources,official):"";
  const invalidSelected=selected.some(id=>!edits[id]||Boolean(issue(edits[id],sources,official)));
  function change(values:Partial<Draft>) {setNotice("");setEdits(old=>({...old,[active]:{...old[active],...values,...(values.text!==undefined?{is_atomic:true}:{})}}));}
  async function saveCurrent() {
    if(!current)return;
    await store.act(async()=>{await store.mutate('revise',{facts:[current]});setNotice('本条草稿已保存');});
  }
  async function confirm() {
    await store.act(async()=>{
      const chosen=selected.map(id=>edits[id]);
      await store.mutate('revise',{facts:chosen});
      await store.mutate('confirm',{official_source_ids:official,facts:chosen.map(fact=>({id:fact.id,text:fact.text,category:fact.category,evidence:fact.evidence}))});
      window.location.assign('/knowledge?brand='+encodeURIComponent(brandId));
    });
  }
  if(!facts.length)return <VStack gap={5}>{research?<ResearchFindings research={research}/>:null}<EmptyState title="还没有可编辑的事实候选" description="可以返回检索补充来源，已确认的事实仍保留在知识库。" actions={<Button label="返回检索" onClick={onBack}/>} /></VStack>;
  return <VStack gap={5}>
    <Text color="secondary">一条事实表达一个可独立核验的主张。核对出处与摘录，编辑后选择需要入库的事实。</Text>
    {research?.notices?.length?<VStack gap={2}>{research.notices.map((notice,index)=><Text key={index} type="supporting">{notice}</Text>)}</VStack>:null}
    {research?<ResearchFindings research={research}/>:null}
    <Selector label="编辑事实块" value={active} onChange={id=>{setActive(id);setNotice("");}} options={facts.map((fact,index)=>({value:fact.id,label:`${index+1}. ${(edits[fact.id]?.text||fact.text||'待编辑事实').slice(0,45)}`}))}/>
    {current?<Card padding={5}><VStack gap={4}>
      <Selector label="分类" value={current.topic??defaultTopic(current.category)} onChange={topic=>change({topic,category:topicCategory(topic)})} options={Object.entries(categories).map(([value,label])=>({value,label}))} isDisabled={store.busy}/>
      <TextArea label="陈述句" value={current.text} onChange={text=>change({text})} rows={3} maxLength={400} isDisabled={store.busy}/>
      <Selector label="事实来源" value={current.evidence[0]?.source_id??""} placeholder="选择实际取得的来源" options={sources.filter(source=>source.kind!=='search').map(source=>({value:source.id,label:source.title}))} onChange={source_id=>change({evidence:[{source_id,quote:""}]})} isDisabled={store.busy}/>
      <TextArea label="原文摘录" rows={3} maxLength={240} value={current.evidence[0]?.quote??""} onChange={quote=>change({evidence:[{source_id:current.evidence[0]?.source_id??"",quote}]})} description="复制能支持这条陈述的原文，不要改写摘录。" isDisabled={store.busy}/>
      {currentSource?<VStack gap={2}>
        {currentSource.url?<Link href={currentSource.url} target="_blank" rel="noreferrer">打开来源页面</Link>:null}
        <TextArea label="来源原文" value={currentSource.text??""} rows={6} isReadOnly/>
        <Text type="supporting">采集时间：{currentSource.collected_at}</Text>
        {currentSource.kind==='page'&&!currentSource.official?<CheckboxInput label="我已核实，这是品牌的一手官方资料" value={official.includes(currentSource.id)} isDisabled={store.busy} onChange={checked=>setOfficial(old=>checked?[...old,currentSource.id]:old.filter(id=>id!==currentSource.id))}/>:null}
      </VStack>:null}
      {currentIssue?<Text role="status" color="secondary">{currentIssue}</Text>:null}
      <HStack><Button label={extra?'收起补充信息':'数值、口径和边界（选填）'} variant="ghost" onClick={()=>setExtra(!extra)}/></HStack>
      {extra?<VStack gap={3}>
        <TextInput label="数值与单位（选填）" value={current.number_value} onChange={number_value=>change({number_value,has_numbers:number_value.trim()?true:false})} isDisabled={store.busy}/>
        <TextArea label="口径（选填）" rows={2} maxLength={500} value={current.caliber} onChange={caliber=>change({caliber})} isDisabled={store.busy}/>
        <TextArea label="适用范围与限制（选填）" rows={2} maxLength={500} value={current.boundary} onChange={boundary=>change({boundary})} isDisabled={store.busy}/>
      </VStack>:null}
      <HStack><Button label="保存本条草稿" variant="secondary" onClick={saveCurrent} isDisabled={store.busy}/></HStack>
      {notice?<Text role="status">{notice}</Text>:null}
    </VStack></Card>:null}
    <VStack gap={3}>
      <Text type="label">确认入库的事实（{selected.length}/{facts.length}）</Text>
      {facts.map((fact,index)=>{const item=edits[fact.id]??draft(fact);return <HStack key={fact.id} gap={2}>
        <CheckboxInput label={`${index+1}. ${item.text||'待编辑事实'}`} value={selected.includes(fact.id)} isDisabled={store.busy} onChange={checked=>setSelected(old=>checked?[...old,fact.id]:old.filter(id=>id!==fact.id))}/>
      </HStack>;})}
      {invalidSelected?<Text type="supporting">选中的事实还有出处或摘录待修正；也可以先取消选择，保留为草稿。</Text>:null}
    </VStack>
    <HStack gap={3} wrap="wrap">
      <Button label="确认所选事实并完成" variant="primary" onClick={confirm} isLoading={store.busy} isDisabled={!selected.length||invalidSelected||!store.canWrite}/>
      <Button label="返回检索" variant="secondary" onClick={onBack} isDisabled={store.busy}/>
    </HStack>
  </VStack>;
}
// Astryx form-wizard: one full-width panel and a horizontal progress track.
export function BrandSetupWizard({session,initialBrandId,creating,investigateOnLoad=false}:{session:WorkspaceSession;initialBrandId:string|null;creating:boolean;investigateOnLoad?:boolean}) {
  const [brandId,setBrandId]=useState(creating?null:initialBrandId),[step,setStep]=useState(0);
  const store=useProfile(session,brandId);
  const [activities,setActivities]=useState<Activity[]>([]),[running,setRunning]=useState(false),[error,setError]=useState(""),[auto,setAuto]=useState(investigateOnLoad);
  const restored=useRef(false),controller=useRef<AbortController|null>(null);
  const canWrite=store.canWrite&&(!creating||session?.role==='owner');
  const progress=researchProgress(activities,running,error||store.error);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    if(restored.current||!store.loaded||!store.data)return;
    restored.current=true;
    if(investigateOnLoad)setStep(1);
    else if(store.data.profile?.research&&!store.data.research_stale&&(store.data.profile.research.facts.length||store.data.profile.research.findings?.length))setStep(2);
    else if(store.data.profile&&!store.data.knowledge.facts.length)setStep(1);
  },[store.loaded,store.data,investigateOnLoad]);
  function saved(id:string) {
    restored.current=true;setBrandId(id);setStep(1);setError("");setAuto(true);
    window.history.replaceState(null,"",'/welcome?brand='+encodeURIComponent(id));
  }
  async function investigate() {
    if(!session||!brandId||!store.canWrite||controller.current)return;
    const abort=new AbortController();controller.current=abort;setRunning(true);setActivities([]);setError("");
    if(new URLSearchParams(window.location.search).has('investigate'))window.history.replaceState(null,"",'/welcome?brand='+encodeURIComponent(brandId));
    try{
      let hasCandidates=false;
      const response=await fetch(`/api/tenants/${encodeURIComponent(session.tenant_id)}/brands/${encodeURIComponent(brandId)}/product-profile/investigate`,{method:'POST',headers:{'content-type':'application/json',accept:'text/event-stream','idempotency-key':crypto.randomUUID()},body:'{}',signal:abort.signal});
      await readResearchEvents(response,(event:{type:string;activity?:Activity;data?:{run?:{error?:string};profile?:{research?:{facts:Fact[];findings?:unknown[]}}}})=>{
        if(event.type==='activity'&&event.activity)setActivities(old=>[...old,event.activity!].slice(-60));
        if(event.type==='result') {
          if(event.data?.run?.error)setError(event.data.run.error);
          else hasCandidates=Boolean(event.data?.profile?.research?.facts.length||event.data?.profile?.research?.findings?.length);
        }
      });
      await store.refresh();
      if(hasCandidates)setStep(2);
    }catch(cause){setError(abort.signal.aborted?'调查已停止，品牌草稿仍保留。':cause instanceof Error?cause.message:'调查未完成，请重试');}
    finally{controller.current=null;setRunning(false);}
  }
  useEffect(()=>{
    if(auto&&store.loaded&&store.data){setAuto(false);void investigate();}
  },[auto,store.loaded,store.data]);
  if(!session)return <EmptyState title="登录后建立品牌事实库" actions={<Link href="/account">登录</Link>}/>;
  if(!canWrite)return <EmptyState title="当前账号不能整理品牌事实" description="请使用可编辑品牌资料的 Owner 账号。"/>;
  const titles=['品牌资料','联网检索','编辑与确认'];
  return <InternationalizationProvider locale="zh-CN" messages={{'zh-CN':zhCN}}>
    <VStack gap={6}>
      <Stepper label="品牌事实引导" activeStep={step} orientation="horizontal" onStepClick={next=>{if(running)return;if(next===0||brandId&&next===1||brandId&&next===2&&store.data?.profile?.research&&!store.data.research_stale)setStep(next);}}>
        {titles.map((label,index)=><Step key={label} step={index} label={label}/>)}
      </Stepper>
      <Heading level={1}>{['介绍你的品牌','调查公开资料','编辑并确认事实块'][step]}</Heading>
      {error||store.error?<Text role="alert">{error||store.error}</Text>:null}
      {step===0?<BrandProfileForm key={brandId??'new'} session={session} brandId={brandId} creating={!brandId&&creating} welcome onSaved={saved}/>:null}
      {step===1?<VStack gap={5}>
        <Text color="secondary">查找官网、文档等资料，整理成事实块，下一步由你确认。</Text>
        <VStack gap={2} role="status" aria-live="polite">
          <Text type="label">{progress.title}</Text>
          {activities.length?<Text type="supporting">已完成 {progress.searches} 次搜索 · 已读取 {progress.pages} 个页面</Text>:null}
        </VStack>
        {running?<ProgressBar label="正在检索和读取资料" isIndeterminate/>:null}
        {activities.length?<Collapsible trigger="查看检索记录" defaultIsOpen={false}>
        <VStack gap={3} role="log" aria-label="联网调查过程">
          {progress.rows.map((activity,index)=><VStack key={index} gap={1}>
            <Text type="label">{activity.kind==='search'?'公开检索':activity.kind==='fetch'?'读取页面':'资料分析'} · {activity.status}{activity.count!==undefined?` · ${activity.count} 条结果`:''}</Text>
            {activity.query?<Text>{activity.query}</Text>:null}
            {activity.url?<Link href={activity.url} target="_blank" rel="noreferrer">{activity.url}</Link>:null}
            {activity.message?<Text type="supporting">{activity.message}</Text>:null}
          </VStack>)}
        </VStack>
        </Collapsible>:null}
        {!running&&store.data?.profile?.research&&!store.data.profile.research.facts.length?<Text role="status">本轮没有可确认的事实。请补充官网、资料链接或品牌描述后重新检索。{store.data.profile.research.unknowns.join('；')}</Text>:null}
        {!running&&store.loaded&&!store.data?.research_configured?<Text role="status">调查服务暂不可用。品牌草稿已保存，服务配置完成后可以继续。</Text>:null}
        <HStack gap={3} wrap="wrap">
          {!running?<Button label={activities.length||store.data?.profile?.research?'重新检索':'开始联网检索'} variant="primary" onClick={investigate} isDisabled={!store.loaded||!store.data?.research_configured}/>:<Button label="停止调查" variant="secondary" onClick={()=>controller.current?.abort()}/>}
          <Button label="返回修改资料" variant="secondary" isDisabled={running} onClick={()=>setStep(0)}/>
          {!running&&store.data?.profile?.research?.facts.length&&!store.data.research_stale?<Button label="编辑已有候选" variant="secondary" onClick={()=>setStep(2)}/>:null}
        </HStack>
      </VStack>:null}
      {step===2&&brandId?<FactReview store={store} brandId={brandId} onBack={()=>setStep(1)}/>:null}
      {brandId&&!running?<Link href={'/knowledge?brand='+encodeURIComponent(brandId)}>稍后继续，返回知识库</Link>:null}
    </VStack>
  </InternationalizationProvider>;
}
