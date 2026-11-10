// Executable specification examples only: input eligibility/version resolution.
// No matching algorithm, error scoring, database writes or model API calls.
export function resolveJudgeInputs({context, lexicons, reviews, facts, fact_ids}) {
 const reject=message=>({status:422,error:{code:'validation_failed',message,details:{}},error_i:null});
 const owned=row=>row.tenant_id===context.tenant_id&&row.brand_id===context.brand_id;
 if(!Number.isInteger(context.lexicon_version))return reject('lexicon_version required');
 const lexicon=lexicons.filter(row=>owned(row)&&row.version===context.lexicon_version);
 if(!lexicon.length)return reject('recorded lexicon version unavailable; no latest fallback');
 // A queue entry identifies the first immutable row of the complete brand/version set.
 if(!reviews.some(r=>r.object_type==='brand_lexicon'&&r.object_id===lexicon[0].id&&r.status==='approved'))return reject('lexicon version not approved');
 if(!fact_ids?.length)return reject('no official comparison baseline');
 const approvedFacts=fact_ids.map(id=>facts.find(f=>f.id===id&&owned(f)));
 if(!Number.isFinite(Date.parse(context.at)))return reject('invalid judgement time');
 if(approvedFacts.some(f=>!f||!Number.isFinite(Date.parse(f.effective_from))||f.status!=='approved'||f.source_level!=='L1'||Date.parse(f.effective_from)>Date.parse(context.at)))return reject('official fact unavailable/retracted/not effective');
 return {status:200,lexicon_version:context.lexicon_version,lexicon:structuredClone(lexicon),official_facts:structuredClone(approvedFacts)};
}

// Executable C1 contract, not a deployed server handler. Both create and start
// recheck persisted brand inputs; a disabled UI button is never authorization.
export function checkBatchJudgmentBasis({operation, context, lexicons, reviews, facts}) {
 if(!['probe_batch.create','probe_batch.start'].includes(operation))return {status:403,error:{code:'permission_denied',message:'unsupported gate operation',details:{}}};
 const owned=row=>row.tenant_id===context.tenant_id&&row.brand_id===context.brand_id;
 const now=Date.parse(context.at);
 const rows=lexicons.filter(owned);
 const versions=[...new Set(rows.map(r=>r.version))].filter(version=>{
  const first=rows.find(r=>r.version===version);
  return (context.lexicon_version==null||version===context.lexicon_version)&&reviews.some(r=>r.object_type==='brand_lexicon'&&r.object_id===first.id&&r.status==='approved');
 });
 const approvedFacts=facts.filter(f=>owned(f)&&f.source_level==='L1'&&f.status==='approved'&&Number.isFinite(Date.parse(f.effective_from))&&Date.parse(f.effective_from)<=now);
 if(!versions.length||!approvedFacts.length||!Number.isFinite(now))return {status:422,error:{code:'judgment_basis_missing',message:'品牌缺已封版词表或已生效官方口径',details:{brand_id:context.brand_id,lexicon_ready:versions.length>0,official_fact_ready:approvedFacts.length>0}}};
 return {status:200,basis_ready:true,approved_lexicon_versions:versions,official_fact_ids:approvedFacts.map(f=>f.id)};
}
