// A tool start and completion describe one operation, not two UI log rows.
export function researchProgress(events, running, error) {
  const grouped=new Map();
  for(const event of events){
    const key=event.call_id??(event.kind==='model'?'model':`${event.kind}:${event.query??event.url??''}`);
    grouped.set(key,{...grouped.get(key),...event});
  }
  const rows=[...grouped.values()].map(event=>({...event,status:event.phase==='completed'?'完成':event.phase==='failed'?'未完成':running?'进行中':'已停止'}));
  const searches=rows.filter(row=>row.kind==='search'&&row.phase==='completed').length;
  const pages=rows.filter(row=>row.kind==='fetch'&&row.phase==='completed').length;
  const pending=rows.filter(row=>row.phase==='started').at(-1);
  const title=error?(pages?'资料已查到，事实整理未完成':'调查未完成'):running?(pending?.kind==='fetch'?'正在读取资料':pending?.kind==='search'?'正在搜索品牌资料':searches||pages?'正在整理事实块':'正在分析品牌资料'):events.length?'资料检索已结束':'准备检索品牌资料';
  return {title,searches,pages,rows};
}
