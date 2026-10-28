import {readFile} from 'node:fs/promises';
const out='.planning/native-card-maintenance/verbatim-state-assembly/live-acceptance';
const s=JSON.parse(await readFile(out+'/server.json','utf8'));
const [key,phase,round,message]=process.argv.slice(2);
const r=await fetch(s.controlAddress+'/acceptance/step',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,phase,round:Number(round),message})});
console.log(await r.text());
