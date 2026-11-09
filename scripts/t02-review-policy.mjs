// Human-review routing only; never used for production authorization.
export function requiredReviewRisks(e) {
  const payload = JSON.stringify([e.request, e.response]);
  const tags = [];
  if (/"(?:raw_answer|excerpt)"/.test(payload) || ['probe_result.read_raw','probe_result.access','diagnosis_report.excerpt','objection.view','objection.grant','offboarding.execute','offboarding.cleanup','deletion_ledger.append','audit_log.append','audit_log.read'].includes(e.id)) tags.push('raw_answer');
  if (['keyword_raw','question_pool'].includes(e.resource) || ['offboarding.execute','offboarding.cleanup'].includes(e.id)) tags.push('C_data');
  if (['tenant','scoring_snapshot','probe_batch','api_token'].includes(e.resource) || e.id==='probe_result.judge') tags.push('quota');
  return tags;
}
