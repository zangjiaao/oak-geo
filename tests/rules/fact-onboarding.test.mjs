import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProductResearchAgent} from '../../src/server/api/product-research-agent.mjs';
import {startRuntimeEnvironment} from '../support/runtime-environment.mjs';
import {createFixtureRegistry} from '../support/fixture-registry.mjs';
import {createProductOnboardingTransport,executeProductResearch} from '../../src/server/api/product-onboarding-http.mjs';
const input={name:'测试品牌',description:'支持MCP。',website:'https://example.com/'};
const output={summary:'测试',facts:[{category:'spec',text:'测试品牌支持MCP。',evidence:[{source_id:'source-1',quote:'支持MCP。'}]},{category:'price',text:'接口价格待核实。',evidence:[{source_id:'missing',quote:'没有取得的摘录'}]}],conflicts:[],unknowns:[]};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.error));return r.data;};
const makeAgent=progress=>createProductResearchAgent({apiKey:'recorded-test',fetch:async url=>url.endsWith('/search')?Response.json({results:[]}):Response.json({title:'官方测试页面',content:'支持MCP。'}),generate:async options=>{await options.tools.read_page.execute({url:input.website});await options.tools.search_sources.execute({query:'测试品牌官方文档'});return {text:JSON.stringify(output),response:{},totalUsage:{}};}});

test('一条候选摘录错误只标记该条待修正，保留其他候选与真实来源；未确认不进入知识事实',async()=>{
 const agent=makeAgent(),events=[];
 const result=await agent.run(input,{onProgress:event=>events.push(event)});
 assert.equal(result.facts.length,2);assert.deepEqual(result.facts[0].issues,[]);assert.ok(result.facts[1].issues.length);
 assert.ok(events.some(e=>e.kind==='fetch'&&e.phase==='started'));assert.ok(events.some(e=>e.kind==='search'&&e.phase==='completed'));
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  const call=(id,body={})=>app.call(id,{actor:f.actors.owner,params,body});
  ok(await call('product_profile.save',{input}));const reserved=ok(await call('product_profile.investigate'));
  await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,reserved.id);
  const state=ok(await call('product_profile.read'));assert.equal(state.run.error,null);assert.equal(state.profile.research.facts.length,2);assert.deepEqual(state.knowledge.facts,[]);
  assert.equal(state.profile.research.sources.find(s=>s.kind==='page').text,'支持MCP。');
 }finally{await env.close();}
});

test('调查事件流在模型结束前交付真实工具进度，完成后保存结果并仅关闭自己持有的runtime',async()=>{
 let release,started;const gate=new Promise(r=>{release=r;}),emitted=new Promise(r=>{started=r;});let closed=0;
 const agent={configured:true,model:'recorded-stream',prompt_version:'product_facts_v1',run:async(raw,{runId,onProgress})=>{
  onProgress({kind:'search',phase:'started',query:'测试品牌官方文档',at:new Date().toISOString()});started();await gate;
  return {...output,facts:[],sources:[{id:'provided',kind:'user_input',url:null,text:raw.description,title:'用户提供',collected_at:new Date().toISOString()}],trace:[],model:'recorded-stream',usage:{input_tokens:1,output_tokens:1},agent_run_id:runId,prompt_version:'product_facts_v1'};
 }};
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  ok(await app.call('product_profile.save',{actor:f.actors.owner,params,body:{input}}));
  const serve=createProductOnboardingTransport(async()=>({application:app,productResearchAgent:agent,close:async()=>{closed++;}}));
  const response=await serve(new Request(`https://geo.test/api/tenants/${f.tenant_id}/brands/${f.brand_id}/product-profile/investigate`,{method:'POST',headers:{cookie:`geo_session=${f.actors.owner.credential}`,origin:'https://geo.test','content-type':'application/json',accept:'text/event-stream','idempotency-key':'stream'},body:'{}'}));
  assert.match(response.headers.get('content-type'),/text\/event-stream/);const reader=response.body.getReader();await emitted;
  let text='';while(!text.includes('测试品牌官方文档'))text+=new TextDecoder().decode((await reader.read()).value);assert.equal(closed,0);
  release();for(;;){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}assert.match(text,/"type":"result"/);assert.equal(closed,1);
  assert.doesNotMatch(text,/apiKey|recorded-test/);
 }finally{release();await env.close();}
});

test('非数值事实可编辑确认，未修复摘录不能入库，知识只引用唯一事实记录并维持角色边界',async()=>{
 const agent=makeAgent(),env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  const call=(id,body={},actor=f.actors.owner)=>app.call(id,{actor,params,body});
  ok(await call('product_profile.save',{input}));const reserved=ok(await call('product_profile.investigate'));
  await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,reserved.id);
  let state=ok(await call('product_profile.read'));const [valid,invalid]=state.profile.research.facts;
  assert.equal((await call('product_profile.confirm',{facts:[{id:invalid.id,text:invalid.text}]})).status,422);
  const edit={...valid,text:'测试品牌支持 MCP。',has_numbers:false,number_value:'',caliber:'',boundary:''};
  for(const role of ['viewer','editor'])assert.equal((await call('product_profile.revise',{facts:[edit]},f.actors[role])).status,403);
  ok(await call('product_profile.revise',{facts:[edit]}));
  state=ok(await call('product_profile.read'));assert.deepEqual(state.knowledge.facts,[]);
  const confirmed=ok(await call('product_profile.confirm',{facts:[{id:valid.id,text:edit.text}]}));
  assert.equal(confirmed.knowledge.length,1);assert.equal(confirmed.knowledge[0].text,undefined,'Knowledge stores a reference, not a duplicate statement');
  state=ok(await call('product_profile.read'));assert.equal(state.knowledge.facts.length,1);
  const card=state.knowledge.facts[0];assert.equal(card.text,edit.text);assert.equal(card.has_numbers,false);assert.equal(card.fact_id,card.official_fact_id);assert.equal(card.id,card.fact_id);
  const canonical=ok(await app.call('official_fact.read',{actor:f.actors.factcheck,params})).items.find(row=>row.id===card.fact_id);
  const content=typeof canonical.content==='string'?JSON.parse(canonical.content):canonical.content;
  assert.equal(content.statement,card.text);assert.deepEqual(content.evidence,card.evidence);
  assert.equal(state.profile.research.facts.length,1,'Unconfirmed candidate remains in the wizard');
  assert.equal((await call('product_profile.revise',{facts:[edit]})).status,409);
  assert.equal((await call('product_profile.confirm',{facts:[{id:valid.id,text:edit.text}]})).status,409);
  const again=ok(await call('product_profile.investigate'));
  await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,again.id);
  state=ok(await call('product_profile.read'));
  const repeated={...state.profile.research.facts[0],text:edit.text,has_numbers:false,number_value:'',caliber:'',boundary:''};
  ok(await call('product_profile.revise',{facts:[repeated]}));
  ok(await call('product_profile.confirm',{facts:[{id:repeated.id,text:repeated.text}]}));
  state=ok(await call('product_profile.read'));assert.equal(state.knowledge.facts.length,1);assert.equal(state.knowledge.facts[0].fact_id,card.fact_id,'Identical confirmed facts reuse the canonical record');
 }finally{await env.close();}
});

test('事件流客户端跨UTF8及数据帧边界读取，连接中断不冒充完成',async()=>{
 const {readResearchEvents}=await import('../../src/lib/research-events.mjs');
 const bytes=new TextEncoder().encode('data:{"type":"activity","activity":{"query":"品牌官网"}}\n\ndata:{"type":"result","data":{}}\n\n');
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));controller.close();}}),{headers:{'content-type':'text/event-stream'}}),events=[];
 await readResearchEvents(response,event=>events.push(event));assert.equal(events[0].activity.query,'品牌官网');assert.equal(events[1].type,'result');
 await assert.rejects(()=>readResearchEvents(new Response('data:{"type":"started"}\n\n',{headers:{'content-type':'text/event-stream'}}),()=>{}),/连接中断/);
});

test('取消调查流会中止上游并保存失败记录，再关闭该请求的runtime',async()=>{
 let started,closed,aborted=false,closes=0;
 const running=new Promise(resolve=>{started=resolve;}),cleanup=new Promise(resolve=>{closed=resolve;});
 const agent={configured:true,model:'recorded-cancel',prompt_version:'product_facts_v2',run:async(raw,{signal})=>{
  started();await new Promise((resolve,reject)=>{
   const stop=()=>{aborted=true;reject(signal.reason);};
   if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
  });
 }};
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 let reader;
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  ok(await app.call('product_profile.save',{actor:f.actors.owner,params,body:{input}}));
  const serve=createProductOnboardingTransport(async()=>({application:app,productResearchAgent:agent,close:async()=>{closes++;closed();}}));
  const response=await serve(new Request(`https://geo.test/api/tenants/${f.tenant_id}/brands/${f.brand_id}/product-profile/investigate`,{method:'POST',headers:{cookie:`geo_session=${f.actors.owner.credential}`,origin:'https://geo.test','content-type':'application/json',accept:'text/event-stream','idempotency-key':'stream-cancel'},body:'{}'}));
  reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);
  const event=JSON.parse(first.slice(5));assert.equal(event.type,'started');assert.ok(event.meta.data_as_of);
  await running;await reader.cancel();await cleanup;
  assert.equal(aborted,true);assert.equal(closes,1);
  const state=ok(await app.call('product_profile.read',{actor:f.actors.owner,params}));
  assert.ok(state.run.finished_at);assert.ok(state.run.error);assert.deepEqual(state.knowledge.facts,[]);
 }finally{await reader?.cancel();await env.close();}
});
