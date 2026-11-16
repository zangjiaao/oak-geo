import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchDraft} from '../../src/server/api/product-profile.mjs';
import {startRuntimeEnvironment} from '../support/runtime-environment.mjs';
import {createFixtureRegistry} from '../support/fixture-registry.mjs';
import {executeProductResearch} from '../../src/server/api/product-onboarding-http.mjs';
const sources=[{id:'official',kind:'page',url:'https://example.com/',title:'录制官网',text:'支持 MCP 接入。提供统一的数据接口。按次计费，无月费，余额不过期。客户甲用该服务收集评论。',collected_at:'2026-11-16T00:00:00Z'}];
const evidence=[{source_id:'official',quote:'支持 MCP 接入。'}];
const conflict='官方 llms.txt 与 README 宣称最低 $0.0001 起，与官网首页 $0.0003 起不一致。';
const counts='平台与接口数量在官方资料间不一致：官网首页23个平台、230个接口，README为17个平台、200+接口。';
const raw={summary:'录制产品资料',conflicts:[],unknowns:[],facts:[
 {kind:'product_fact',topic:'function',text:'产品支持 MCP 接入。',is_atomic:true,evidence},
 {kind:'product_fact',topic:'feature',text:'产品提供统一的数据接口。',is_atomic:true,evidence:[{source_id:'official',quote:'提供统一的数据接口'}]},
 {kind:'product_fact',topic:'pricing',text:'产品按次计费。',is_atomic:true,evidence:[{source_id:'official',quote:'按次计费'}]},
 {kind:'product_fact',topic:'case',text:'客户甲使用该服务收集评论。',is_atomic:true,evidence:[{source_id:'official',quote:'客户甲用该服务收集评论'}]},
 {kind:'source_conflict',topic:'pricing',text:conflict,evidence},
 {kind:'product_fact',has_unresolved_conflict:true,topic:'function',text:counts,evidence},
 {kind:'source_note',text:'README 未写清数据日期。',evidence},
 {kind:'product_fact',topic:'pricing',is_atomic:false,text:'产品按次计费、无月费、余额不过期。',evidence:[{source_id:'official',quote:'按次计费，无月费，余额不过期'}]},
 ]};
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.error));return result.data;};

test('产品事实与资料核查分开：冲突、来源备注不进入事实候选，多主张待拆分，产品分类不改变正式四类口径',()=>{
 const draft=prepareResearchDraft(raw,sources);
 assert.equal(draft.facts.length,5);assert.equal(draft.findings.length,3);
 assert.ok(draft.findings.some(item=>item.text===conflict));assert.ok(draft.findings.some(item=>item.text===counts));
 assert.ok(draft.facts.every(item=>item.kind==='product_fact'&&!item.has_unresolved_conflict));
 assert.equal(draft.facts.find(item=>item.topic==='case').category,'spec');
 assert.equal(draft.facts.find(item=>item.topic==='pricing').category,'price');
 assert.match(draft.facts.at(-1).issues.join(' '),/独立主张|拆分/);
 assert.deepEqual(prepareResearchDraft(draft,sources).findings.map(item=>item.text),draft.findings.map(item=>item.text));
 const featureText='产品支持识别数据不一致。';
 const semantic=prepareResearchDraft({facts:[{kind:'product_fact',topic:'function',is_atomic:true,text:featureText,evidence:[{source_id:'s',quote:featureText}]}]},[{id:'s',text:featureText}]);
 assert.equal(semantic.facts.length,1,'不能用不一致等关键词正则误删真正的产品能力');
});

test('调查结论不能伪装产品事实确认，多主张先编辑拆分；确认后保留业务分类和唯一事实ID',async()=>{
 const agent={configured:true,model:'recorded-semantics',prompt_version:'recorded-semantic-v1',run:async(input,{runId})=>({...raw,sources,trace:[],agent_run_id:runId,prompt_version:'recorded-semantic-v1',usage:{input_tokens:1,output_tokens:1}})};
 const env=await startRuntimeEnvironment({productResearchAgent:agent});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input'),params={tid:f.tenant_id,bid:f.brand_id};
  const call=(id,body={})=>app.call(id,{actor:f.actors.owner,params,body});
  ok(await call('product_profile.save',{input:{name:'产品语义验收',description:'产品介绍。',website:sources[0].url}}));
  const run=ok(await call('product_profile.investigate'));await executeProductResearch({application:app,productResearchAgent:agent},f.actors.owner,params,run.id);
  let state=ok(await call('product_profile.read'));
  const finding=state.profile.research.findings[0],compound=state.profile.research.facts.find(item=>item.is_atomic===false);
  assert.equal((await call('product_profile.confirm',{facts:[{id:finding.id,text:finding.text}]})).status,409);
  assert.equal((await call('product_profile.confirm',{facts:[{id:compound.id,text:compound.text,is_atomic:true}]})).status,422);
  assert.equal((await call('product_profile.revise',{facts:[{...compound,is_atomic:'yes'}]})).status,422);
  ok(await call('product_profile.revise',{facts:[{...compound,text:'产品无月费。',is_atomic:true,evidence:[{source_id:'official',quote:'无月费'}]}]}));
  state=ok(await call('product_profile.read'));const good=state.profile.research.facts.find(item=>item.topic==='case');
  ok(await call('product_profile.confirm',{facts:[{id:good.id,text:good.text},{id:compound.id,text:'产品无月费。'}]}));
  state=ok(await call('product_profile.read'));assert.equal(state.knowledge.facts.length,2);assert.equal(state.knowledge.facts[0].topic,'case');
  assert.ok(state.knowledge.facts.every(item=>!item.text.includes('不一致')));assert.equal(state.profile.research.findings.length,3);
 }finally{await env.close();}
});
