import {readFile,writeFile} from 'node:fs/promises';
const out='.planning/native-card-maintenance/verbatim-state-assembly/deepseek-acceptance';
const read=async name=>JSON.parse(await readFile(out+'/'+name,'utf8'));
const save=async(name,value)=>writeFile(out+'/'+name,JSON.stringify(value,null,2)+'\n');
const credentials=JSON.parse(await readFile('/Users/developer/.config/tavern-headless/openrouter-linqian-test.json','utf8'));
const budget=await read('budget.json');
const records=(await read('model-call-records.json')).map(r=>JSON.parse(r.recordJson));
const allowed=['id','model','provider_name','total_cost','tokens_prompt','tokens_completion','native_tokens_reasoning','finish_reason'];
for(const call of budget.calls){
 if(call.actualUsd!==null)continue;
 const name=String(call.number).padStart(2,'0')+'-'+call.label;
 const captured=await read(name+'-provider-request.json');
 const request=captured.body;
 const original={...request};delete original.provider;
 const matches=records.filter(r=>r.status!=='succeeded'&&r.requestBody===JSON.stringify(original)&&Math.abs((r.sentAt??r.preparedAt)-Date.parse(captured.startedAt))<10000);
 const record=matches.length===1?matches[0]:undefined;
 if(!record)continue;
 const text=record.responseBody||'';
 if(record.status==='interrupted')await save(name+'-partial-provider-response.json',{captureCompleteness:'partial',status:record.httpStatus,text,error:record.error});
 const match=text.match(/"id"\s*:\s*"(gen-[^"]+)"/);
 if(!match)continue;
 const response=await fetch(credentials.baseUrl+'/generation?id='+encodeURIComponent(match[1]),{headers:{Authorization:'Bearer '+credentials.apiKey},signal:AbortSignal.timeout(10000)});
 const billing=await response.json();
 await save(name+'-final-billing.json',{status:response.status,data:billing.data?Object.fromEntries(allowed.filter(k=>k in billing.data).map(k=>[k,billing.data[k]])):null});
 if(response.ok&&typeof billing.data?.total_cost==='number'){
  call.actualUsd=billing.data.total_cost;
  budget.actualUsd+=call.actualUsd;
  budget.reservedUsd-=call.reservedUsd;
  await save('budget.json',budget);
 }
}
const response=await fetch(credentials.baseUrl+'/key',{headers:{Authorization:'Bearer '+credentials.apiKey},signal:AbortSignal.timeout(10000)});
const quota=await response.json();
await save('quota-after.json',{status:response.status,data:Object.fromEntries(['usage','usage_daily','limit_remaining'].filter(k=>k in quota.data).map(k=>[k,quota.data[k]]))});
const before=(await read('quota-before.json')).data.usage;
await save('billing-summary.json',{maximumUsd:budget.maximumUsd,confirmedGenerationCostsUsd:budget.actualUsd,unresolvedReservationsUsd:budget.reservedUsd,conservativeTotalUsd:budget.actualUsd+budget.reservedUsd,keyUsageBefore:before,keyUsageAfter:quota.data.usage,keyUsageChangeUsd:quota.data.usage-before,unresolvedRequestNumbers:budget.calls.filter(c=>c.actualUsd===null).map(c=>c.number)});
console.log(JSON.stringify({confirmedGenerationCostsUsd:budget.actualUsd,conservativeTotalUsd:budget.actualUsd+budget.reservedUsd,keyUsageChangeUsd:quota.data.usage-before}));
