import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchDraft,validateResearchOutput} from '../../src/server/api/product-profile.mjs';
import {createProductResearchAgent} from '../../src/server/api/product-research-agent.mjs';
import {startRuntimeEnvironment} from '../support/runtime-environment.mjs';
import {createFixtureRegistry} from '../support/fixture-registry.mjs';
import {executeProductResearch} from '../../src/server/api/product-onboarding-http.mjs';
const source={id:'s1',kind:'page',url:'https://example.com/',text:'支持 MCP 接入。',title:'官方文档'};
const fact={category:'spec',text:'支持 MCP 接入。',evidence:[{source_id:'s1',quote:'支持 MCP 接入。'}]};

test('可恢复的模型字段缺失、说明过长与候选超量不丢弃可编辑事实，保留明确整理提示',()=>{
 const result=prepareResearchDraft({summary:null,unknowns:null,conflicts:Array.from({length:10},(_,i)=>'冲突'+i),facts:Array.from({length:13},()=>fact)},[source]);
 assert.equal(result.facts.length,12);assert.equal(result.summary,'');assert.deepEqual(result.unknowns,[]);
 assert.equal(result.conflicts.length,8);assert.ok(result.notices.some(note=>note.includes('13')));
 assert.deepEqual(result.facts[0].issues,[]);
 assert.deepEqual(prepareResearchDraft(result,[source]).notices,result.notices,'finish再次处理草稿时保留整理提示');
 const bad=prepareResearchDraft({summary:'说明'.repeat(600),facts:[{...fact,evidence:[{source_id:'missing',quote:'不存在'}]}]},[source]);
 assert.equal(bad.summary.length,1000);assert.ok(bad.facts[0].issues.length);
 assert.throws(()=>validateResearchOutput({summary:'',conflicts:[],unknowns:[],facts:bad.facts},[source]),/来源或摘录/);
});

test('不可用的事实列表标记为结果格式问题，保留工具记录与用量，不误报来源校验或回显模型原文',async()=>{
 const events=[];
 const agent=createProductResearchAgent({apiKey:'not-a-real-key',fetch:async url=>url.endsWith('/search')?Response.json({results:[]}):Response.json({content:'支持 MCP 接入。'}),generate:async options=>{
  await options.tools.search_sources.execute({query:'品牌官网'});await options.tools.read_page.execute({url:source.url});
  return {text:JSON.stringify({facts:{secret:'do-not-echo'},summary:'原文'}),response:{modelId:'recorded-model'},totalUsage:{inputTokens:31,outputTokens:21}};
 }});
 await assert.rejects(()=>agent.run({name:'测试品牌',description:'产品介绍。'},{onProgress:event=>events.push(event)}),error=>{
  assert.equal(error.details.category,'result_format');assert.equal(error.details.stage,'result');
  assert.doesNotMatch(error.message,/来源校验|do-not-echo|原文/);
  assert.equal(error.researchContext.trace.length,2);assert.equal(error.researchContext.usage.input_tokens,31);
  return true;
 });
 assert.ok(events.some(event=>event.kind==='model'&&event.phase==='failed'));
 for(const kind of ['search','fetch']){
  const steps=events.filter(event=>event.kind===kind);assert.ok(steps[0].call_id);assert.equal(steps[0].call_id,steps.at(-1).call_id);
 }
});

test('简明进度只累计已完成采集，同一调用只显示一行，结束后不保留进行中状态',async()=>{
 const {researchProgress}=await import('../../src/lib/research-progress.mjs');
 const events=[{kind:'model',phase:'started'},{kind:'search',phase:'started',call_id:'s1',query:'品牌官网'},{kind:'fetch',phase:'started',call_id:'p1',url:source.url},{kind:'search',phase:'completed',call_id:'s1',query:'品牌官网',count:5},{kind:'fetch',phase:'completed',call_id:'p1',url:source.url}];
 const active=researchProgress(events,true,'');assert.equal(active.searches,1);assert.equal(active.pages,1);assert.equal(active.rows.length,3);
 const failed=researchProgress(events,false,'模型结果格式异常');assert.equal(failed.title,'资料已查到，事实整理未完成');assert.ok(failed.rows.every(row=>row.status!=='进行中'));
 assert.equal(researchProgress([],false,'未授权').title,'调查未完成');
});

test('模型结果格式失败仍保留实际调用用量和工具记录，不入库事实或覆盖旧草稿',async()=>{
 let malformed=false;
 const agent=createProductResearchAgent({apiKey:'not-a-real-key',fetch:async url=>url.endsWith('/search')?Response.json({results:[]}):Response.json({content:source.text}),generate:async options=>{
  await options.tools.search_sources.execute({query:'品牌官网'});const page=await options.tools.read_page.execute({url:source.url});
  return {text:JSON.stringify(malformed?{facts:null,summary:'do-not-echo'}:{facts:[{...fact,evidence:[{source_id:page.id,quote:source.text}]}]}),response:{},totalUsage:{inputTokens:31,outputTokens:21}};
 }});
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  const call=(id,body={})=>app.call(id,{actor:f.actors.owner,params,body});
  assert.equal((await call('product_profile.save',{input:{name:'失败用量测试',description:'品牌资料。'}})).status,200);
  const first=await call('product_profile.investigate');assert.equal(first.status,200);
  await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,first.data.id);
  const previous=(await call('product_profile.read')).data.profile.research;assert.equal(previous.facts.length,1);
  malformed=true;
  const reserve=await call('product_profile.investigate');assert.equal(reserve.status,200);
  await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,reserve.data.id);
  const state=(await call('product_profile.read')).data;
  assert.match(state.run.error,/事实列表.*结果解析/);assert.doesNotMatch(state.run.error,/来源校验|do-not-echo/);
  assert.deepEqual(state.run.usage,{input_tokens:31,output_tokens:21});assert.deepEqual(state.profile.research,previous);assert.deepEqual(state.knowledge.facts,[]);
 }finally{await env.close();}
});
