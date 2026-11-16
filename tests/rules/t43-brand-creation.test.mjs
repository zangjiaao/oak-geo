import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRuntimeEnvironment } from '../support/runtime-environment.mjs';
import { createFixtureRegistry } from '../support/fixture-registry.mjs';
const input={name:'新品牌',description:'为开发者提供公开社媒数据 API。'};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.error));return r.data;};
const request=(actor,tid,body={},params={})=>({actor,params:{tid,...params},body});
const profile=(app,actor,tid,bid)=>app.call('product_profile.read',request(actor,tid,{}, {bid}));

test('T43 Owner 从空白资料创建品牌，原凭证可访问原有与新建品牌，重放不重复创建',async()=>{
 const env=await startRuntimeEnvironment();
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input');
  const create=()=>app.call('brand.create',request(f.actors.owner,f.tenant_id,{input}),{idempotencyKey:'create-once'});
  const r=await create(),brand=ok(r);assert.ok(brand.id);assert.notEqual(brand.id,f.brand_id);
  assert.equal(r.meta.snapshot_id,null);assert.ok(r.meta.data_as_of);
  assert.equal(ok(await create()).id,brand.id);
  const saved=ok(await profile(app,f.actors.owner,f.tenant_id,brand.id));
  assert.equal(saved.profile.input.name,input.name);assert.equal(saved.profile.input.description,input.description);
  assert.deepEqual(saved.knowledge.facts,[]);assert.equal(saved.profile.research,null);
  const stored=ok(await app.call('brand.read',request(f.actors.owner,f.tenant_id,{}, {bid:brand.id,id:brand.id})));
  assert.equal(stored.industry,'');assert.equal(stored.market,'');
  ok(await profile(app,f.actors.owner,f.tenant_id,f.brand_id));
  assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input:{...input,name:'不同请求'}}),{idempotencyKey:'create-once'})).status,409);
  const second=ok(await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input:{...input,name:'第二品牌'}}),{idempotencyKey:'second'}));
  assert.notEqual(second.id,brand.id);ok(await profile(app,f.actors.owner,f.tenant_id,brand.id));
 }finally{await env.close();}
});

test('T43 仅本人Owner创建并授权自身；跨租户、其他Owner、只读角色、Agent和越权字段被拒绝',async()=>{
 const env=await startRuntimeEnvironment();
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input');
  const brand=ok(await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input})));
  for(const role of ['editor','viewer','strategist','factcheck','admin']){
   assert.equal((await app.call('brand.create',request(f.actors[role],f.tenant_id,{input}))).status,403);
  }
  ok(await app.call('brand.configure',request(f.actors.admin,f.tenant_id,{id:'another-brand',name:'其他品牌',industry:'B2B',market:'CN'})));
  ok(await app.call('user_member.configure',request(f.actors.admin,f.tenant_id,{user_id:'another-owner',role:'owner',brand_id:'another-brand'})));
  const other=app.issueActor({user_id:'another-owner',tenant_id:f.tenant_id,brand_id:'another-brand',role:'owner',actor_type:'human'});
  assert.equal((await profile(app,other,f.tenant_id,brand.id)).status,403);
  assert.equal((await profile(app,f.actors.owner,f.tenant_id,'another-brand')).status,403);
  for(const role of ['editor','viewer'])assert.equal((await profile(app,f.actors[role],f.tenant_id,brand.id)).status,403);
  assert.equal((await app.call('brand.create',request(f.actors.owner,'another-tenant',{input}))).status,403);
  assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input,user_id:'another-owner'}))).status,422);
  assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input},{bid:'another-brand'}))).status,403);
  const agent=app.issueActor({user_id:f.actors.owner.user_id,tenant_id:f.tenant_id,brand_id:f.brand_id,role:'owner',actor_type:'agent',agent_run_id:'r',prompt_version:'p'});
  assert.equal((await app.call('brand.create',request(agent,f.tenant_id,{input}))).status,403);
  const validPat=ok(await app.call('api_token.create',request(f.actors.admin,f.tenant_id,{user_id:f.actors.owner.user_id,role:'owner',brand_id:f.brand_id,scopes:['brand.read']})));
  const pat=app.actorFromCredential(validPat.token);
  assert.equal((await app.call('brand.create',request(pat,f.tenant_id,{input}))).status,403);
 }finally{await env.close();}
});

test('T43 无效输入与审计失败不会留下半个品牌；缺配置仍可创建；诊断合同保持只读',async()=>{
 let fail=false,rolledBack;
 const env=await startRuntimeEnvironment({productResearchAgent:{configured:false},beforeAudit:event=>{if(fail&&event.action==='brand.create'){rolledBack=event.object_id;throw new Error('audit unavailable');}}});
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input');
  assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input:{name:'',description:''}}))).status,422);
  fail=true;assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input}),{idempotencyKey:'rollback'})).status,500);assert.ok(rolledBack);
  fail=false;assert.equal((await app.call('brand.read',request(f.actors.admin,f.tenant_id,{}, {id:rolledBack,bid:rolledBack}))).status,403);
  const brand=ok(await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input}),{idempotencyKey:'rollback'}));assert.notEqual(brand.id,rolledBack);assert.equal(brand.research_configured,false);
  ok(await app.call('tenant.configure',request(f.actors.admin,f.tenant_id,{name:'诊断租户',mode:'diagnosis',plan:'test'})));
  assert.equal((await app.call('brand.create',request(f.actors.owner,f.tenant_id,{input}))).status,403);
 }finally{await env.close();}
});

test('T43 新增品牌HTTP保持登录、同源、幂等、请求大小和单次创建约束',async()=>{
 const {createProductOnboardingTransport}=await import('../../src/server/api/product-onboarding-http.mjs');
 const env=await startRuntimeEnvironment();
 try{
  const app=env.application,f=await createFixtureRegistry(app).fixture('seed-input');
  const transport=createProductOnboardingTransport(async()=>({application:app,close:async()=>{}}));
  const url=`https://geo.test/api/tenants/${f.tenant_id}/brands/create`;
  const send=(credential=f.actors.owner.credential,extra={},body=JSON.stringify({input}),method='POST')=>transport(new Request(url,{method,headers:{cookie:`geo_session=${credential}`,origin:'https://geo.test','content-type':'application/json','idempotency-key':'http-create',...extra},...(method==='POST'?{body}:{})}));
  assert.equal((await send(undefined,{},undefined,'GET')).status,404);
  assert.equal((await send('invalid')).status,403);
  assert.equal((await send(undefined,{origin:'https://other.test'})).status,403);
  assert.equal((await send(undefined,{'idempotency-key':''})).status,422);
  assert.equal((await send(undefined,{},'{')).status,422);
  assert.equal((await send(undefined,{},'x'.repeat(33000))).status,422);
  const first=await send();assert.equal(first.status,200);const created=(await first.json()).data;
  assert.equal((await (await send()).json()).data.id,created.id);
  ok(await profile(app,f.actors.owner,f.tenant_id,created.id));
 }finally{await env.close();}
});
