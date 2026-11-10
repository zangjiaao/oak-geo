import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openApplication } from '../support/application-port.mjs';
const contracts=JSON.parse(readFileSync('docs/api/contracts.json','utf8'));

test('A02 实际已注册服务操作须逐个通过服务端鉴权（非空且禁止新增未声明操作）',async()=>{
 const app=await openApplication();
 try{
  const registered=await app.registeredOperations();assert.ok(registered.length>0,'空路由表不算权限全覆盖');
  for(const id of registered){
   assert.ok(contracts.endpoints.some(e=>e.id===id),`未声明服务操作${id}`);
   const request=await app.prepareAuthorizedRequest(id);
   const valid=await app.call(id,request);assert.ok(valid.status>=200&&valid.status<300,`${id}的合法请求必须成功，不能全局403冒充鉴权`);
   for(const actor of [null,{...request.actor,role:'viewer',tenant_id:'other-tenant'},{...request.actor,role:'unknown_role'}]){
    const result=await app.call(id,{...request,actor});assert.equal(result.status,403,id);assert.equal(result.error.code,'permission_denied');
   }
  }
 }finally{await app.close();}
});
