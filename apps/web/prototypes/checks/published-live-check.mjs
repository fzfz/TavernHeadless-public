import fs from 'node:fs';
import {createFormalTransport} from '../shared/formal-transport.prototype.js';
import * as validators from '../shared/script-validators.prototype.js';
const config=JSON.parse(fs.readFileSync(new URL('./published-prototype.config.json',import.meta.url),'utf8'));
const base=`http://127.0.0.1:${config.port}`;
const api=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const b=await r.json();if(!r.ok)throw new Error(JSON.stringify(b.error));return b.data;};
const release=(await api('/role-releases'))[0];
const created=await api(`/role-releases/${release.id}/sessions`,{user_id:release.default_user_id,opening_id:release.openings.find(o=>o.default).id});
const evidence={releaseId:release.id,sessionId:created.session.id,requests:[],events:[],startedAt:new Date().toISOString()};
console.log(JSON.stringify({sessionId:created.session.id}));
const transport=createFormalTransport({sessionId:created.session.id,fetchImpl:async(url,options)=>{evidence.requests.push({method:options?.method||'GET',url});return fetch(base+url,options);}});
const loaded=await transport.loadSession();
try {
 await transport.send({text:'我在门外敲了敲门，说：“林茜，我们回家吃午饭吧。”',current:loaded.current,route:'/send',testHeaders:{},emit(envelope){
   evidence.events.push({type:envelope.type,textStatus:envelope.data.status,chars:envelope.data.text?.length,runId:envelope.data.runId,snapshotId:envelope.data.snapshotId});
   if(envelope.type==='text'&&!validators.textStreamEvent(envelope.data))throw new Error(JSON.stringify(validators.textStreamEvent.errors));
 }});
 evidence.success=true;
 const restored=await transport.loadSession();evidence.snapshotId=restored.current.snapshotId;evidence.source=restored.current.source;
} catch(error){evidence.success=false;evidence.error={code:error.code,message:error.message};}
evidence.finishedAt=new Date().toISOString();
fs.mkdirSync('docs/plans/evidence/published-backend',{recursive:true});
fs.writeFileSync('docs/plans/evidence/published-backend/live-check.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({success:evidence.success,error:evidence.error,events:evidence.events.length,snapshotId:evidence.snapshotId}));
