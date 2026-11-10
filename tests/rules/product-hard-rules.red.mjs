import { test } from 'node:test';
import { openApplication } from '../support/application-port.mjs';
import { ruleCases } from './product-rule-cases.mjs';

// T03's intended red acceptance baseline. No skip/todo or fake implementation.
for(const scenario of ruleCases)test(`${scenario.id} ${scenario.title} [${scenario.tasks.join('/')}]`,async()=>{
 const app=await openApplication();try{await scenario.run(app);}finally{await app.close();}
});
