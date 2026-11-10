import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

test('A01 无页面/jobs/scripts直写库路径，反例必须被扫描器抓住', async()=>{
 const { scanWriteBoundaries }=await import('../support/architecture-scan.mjs');
 const files={};const read=dir=>{if(!existsSync(dir))return;for(const e of readdirSync(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())read(p);else if(/\.(?:[cm]?js|tsx?)$/.test(p))files[p]=readFileSync(p,'utf8');}};
 read('src');read('scripts');if(existsSync('tests/support/runtime-driver.mjs'))files['tests/support/runtime-driver.mjs']=readFileSync('tests/support/runtime-driver.mjs','utf8');
 assert.deepEqual(scanWriteBoundaries(files),[]);
 assert.ok(scanWriteBoundaries({'src/app/actions.ts':`import {Pool as P} from 'pg'; const db=new P(); db.query('INSERT INTO claim_block VALUES (1)');`}).length);
 assert.ok(scanWriteBoundaries({'src/server/jobs/seed.ts':`const db=require('postgres'); db.query('DELETE FROM tenant');`}).length);
 assert.ok(scanWriteBoundaries({'scripts/repair.mjs':`const pool=await import('@neondatabase/serverless');`}).length);
 assert.ok(scanWriteBoundaries({'src/app/actions.ts':`import {write} from '@/server/storage'; write();`,'src/server/storage.ts':`import pg from 'pg';`}).length);
 assert.deepEqual(scanWriteBoundaries({'src/server/api/store.ts':`import pg from 'pg'; const sql='INSERT INTO claim_block VALUES (1)';`}),[]);
});
