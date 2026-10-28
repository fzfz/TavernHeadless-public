const unwrap=body=>body?.data??body;
export async function listInspectionRecords(client,path){
  const result=[];
  for(let offset=0;;offset+=100){
    const body=await client.request(`${path}${path.includes('?')?'&':'?'}limit=100&offset=${offset}`,{raw:true});
    result.push(...unwrap(body));
    if(!body.meta?.has_more)return result;
  }
}
export async function loadInspectionSections(client,floor,pages,config){
  const specs=[...config.floor.map(spec=>({...spec,path:spec.path.replaceAll('{floor}',encodeURIComponent(floor.id)).replaceAll('{session}',encodeURIComponent(floor.session_id))})),
    ...pages.flatMap(page=>config.page.map(spec=>({...spec,key:`${page.id}:${spec.key}`,label:`第 ${page.page_no} 页 · ${spec.label}`,path:spec.path.replaceAll('{page}',encodeURIComponent(page.id))}))),
    ...pages.flatMap(page=>(page.messages||[]).flatMap(message=>(config.message||[]).map(spec=>({...spec,key:`${message.id}:${spec.key}`,label:`第 ${page.page_no} 页 · 消息 ${message.seq} · ${spec.label}`,path:spec.path.replaceAll('{message}',encodeURIComponent(message.id))}))))];
  const selected=specs.filter(spec=>!spec.committed||floor.state==='committed');
  const results=await Promise.allSettled(selected.map(spec=>spec.list?listInspectionRecords(client,spec.path):client.request(spec.path)));
  return selected.map((spec,i)=>({...spec,...(results[i].status==='fulfilled'?{value:unwrap(results[i].value)}:{error:results[i].reason})}));
}
