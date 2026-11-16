import {test} from 'node:test';
import assert from 'node:assert/strict';
import {APICallError} from 'ai';
import {startRuntimeEnvironment} from '../support/runtime-environment.mjs';
import {createFixtureRegistry} from '../support/fixture-registry.mjs';
import {executeProductResearch} from '../../src/server/api/product-onboarding-http.mjs';
import {createProductResearchAgent} from '../../src/server/api/product-research-agent.mjs';
const input={name:'调查错误验收',description:'提供公开数据API。',website:'https://example.com/'};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.error));return r.data;};
const apiError=status=>new APICallError({message:'secret-do-not-echo',url:'https://api.deepseek.com/chat/completions?key=secret-do-not-echo',requestBodyValues:{prompt:'secret-do-not-echo'},statusCode:status,responseBody:'secret-do-not-echo'});

test('调查失败按HTTP状态保存可操作原因，未知错误不冒充超时，原资料和用量边界保留',async()=>{
 let failure;
 const agent={configured:true,model:'recorded-errors',prompt_version:'product_facts_v1',run:async()=>{throw failure;}};
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,registry=createFixtureRegistry(app);
  for(const [error,expected] of [[apiError(401),/身份验证失败.*HTTP 401/],[apiError(402),/余额不足.*HTTP 402/],[apiError(429),/限流.*HTTP 429/],[apiError(400),/请求参数.*HTTP 400/],[new DOMException('secret-do-not-echo','TimeoutError'),/超时/],[new Error('secret-do-not-echo'),/未识别错误/]]){
   failure=error;const f=await registry.fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
   const call=(id,body={})=>app.call(id,{actor:f.actors.owner,params,body});
   ok(await call('product_profile.save',{input}));const run=ok(await call('product_profile.investigate'));
   await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,run.id);
   const state=ok(await call('product_profile.read'));assert.match(state.run.error,expected);assert.doesNotMatch(state.run.error,/secret-do-not-echo/);
   assert.equal(state.profile.input.description,input.description);assert.equal(state.profile.research,null);assert.deepEqual(state.knowledge.facts,[]);assert.deepEqual(state.run.usage,{unknown:true});
   assert.ok(state.run.error.length<=250);
  }
 }finally{await env.close();}
});

test('真实AI SDK模型鉴权失败保留阶段与HTTP状态，不回显响应、请求或凭证',async()=>{
 const agent=createProductResearchAgent({apiKey:'secret-do-not-echo',fetch:async()=>Response.json({error:{message:'secret-do-not-echo',type:'authentication_error'}},{status:401})});
 await assert.rejects(()=>agent.run(input),error=>{
  assert.equal(error.details?.stage,'model');assert.equal(error.details?.upstream_status,401);assert.doesNotMatch(error.message,/secret-do-not-echo/);return true;
 });
});

test('公开工具失败与JSON/引用校验错误可以区分，错误正文不回流为事实',async()=>{
 const {describeResearchFailure}=await import('../../src/server/api/product-research-errors.mjs');
 const generate=async options=>{
  await options.tools.search_sources.execute({query:'测试官方文档'});
  await options.tools.read_page.execute({url:input.website});
  return {text:'invalid JSON',response:{modelId:'recorded'},totalUsage:{}};
 };
 for(const [status,expected] of [[401,/身份验证失败.*公开检索.*HTTP 401/],[402,/余额不足.*公开检索.*HTTP 402/],[429,/限流.*公开检索.*HTTP 429/]]){
  const agent=createProductResearchAgent({apiKey:'secret-do-not-echo',generate,fetch:async()=>Response.json({error:{message:'secret-do-not-echo'}},{status})});
  await assert.rejects(()=>agent.run(input),error=>{assert.match(describeResearchFailure(error),expected);assert.doesNotMatch(describeResearchFailure(error),/secret-do-not-echo/);return true;});
 }
 const fetch=async url=>url.endsWith('/search')?Response.json({results:[]}):Response.json({content:'页面正文'});
 await assert.rejects(()=>createProductResearchAgent({apiKey:'test-only',generate,fetch}).run(input),error=>{assert.match(describeResearchFailure(error),/JSON/);return true;});
 const badQuote=async options=>{
  await options.tools.search_sources.execute({query:'测试'});await options.tools.read_page.execute({url:input.website});
  return {text:JSON.stringify({summary:'测试',facts:[{category:'spec',text:'不支持的陈述',evidence:[{source_id:'source-1',quote:'不存在的摘录'}]}],conflicts:[],unknowns:[]}),response:{},totalUsage:{}};
 };
 const draft=await createProductResearchAgent({apiKey:'test-only',generate:badQuote,fetch}).run(input);
 assert.match(draft.facts[0].issues.join(' '),/来源或摘录/);
});
