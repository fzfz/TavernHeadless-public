import {readFile} from 'node:fs/promises';
const out='.planning/native-card-maintenance/verbatim-state-assembly/deepseek-acceptance';
const s=JSON.parse(await readFile(out+'/server.json','utf8'));
const [key,phase,round,message,variant]=process.argv.slice(2);
const r=await fetch(s.controlAddress+'/acceptance/step',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,phase,round:Number(round),message,variant})});
const result=await r.json();
console.log(JSON.stringify(result));
if (!r.ok || result.ok===false) process.exitCode=1;
