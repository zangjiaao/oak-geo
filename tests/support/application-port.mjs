import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

// T04+ will supply this adapter to real src/server/api operations. No database
// writes, in-memory product implementation or T02 specification helpers here.
// Adapter protocol:
//   layer === 'server/api'; fixture(name, options) prepares via service APIs;
//   call(operationId, {actor, params, body, query}) returns {status,data,error,meta};
//   registeredOperations() lists implemented service operations;
//   prepareAuthorizedRequest(id) uses real service fixtures/authentication;
//   close() releases the isolated fixture. Transport/DTO mapping only: it must
//   not implement scoring, authorization, state transitions or fill absent data.
export async function openApplication() {
 const adapter=new URL('./runtime-driver.mjs',import.meta.url);
 assert.ok(existsSync(adapter),'APPLICATION_NOT_CONNECTED: T03红灯基线；T04/T05后在tests/support/runtime-driver.mjs接入真实服务层，禁止用规格示例或假实现转绿');
 const { createDriver }=await import(adapter.href);
 assert.equal(typeof createDriver,'function');
 const app=await createDriver();assert.equal(app.layer,'server/api');
 for(const method of ['fixture','call','close'])assert.equal(typeof app[method],'function',method);
 return app;
}
