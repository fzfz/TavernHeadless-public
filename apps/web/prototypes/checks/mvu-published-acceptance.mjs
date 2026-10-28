import fs from 'node:fs';import assert from 'node:assert/strict';
import {parse as parseYaml} from '../../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js';
import {importOpenings} from '../shared/import-openings.js';
import {readMvuInitialVariables} from './mvu-agent-migration.mjs';
import {validateMigratedMvu} from '../../../api/src/services/role-mvu-migration.mjs';
import {createFormalTransport} from '../shared/formal-transport.prototype.js';
const base='http://localhost:43876';
async function api(method,path,body){const r=await fetch(base+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(r.status===204)return;const j=await r.json();assert(r.ok,JSON.stringify(j.error));return j.data;}
const migrations=JSON.parse(fs.readFileSync(new URL('../../../../docs/plans/evidence/published-backend/mvu-agent-migration.json',import.meta.url)));const evidence=[];
for(const m of migrations){
 const release=await api('GET','/role-releases/'+m.releaseId);const snapshot=release.character_snapshot;
 const book=(await api('GET',`/worldbooks/${release.worldbook_id}/versions/${release.worldbook_version_id}`)).snapshot;
 const bundle=snapshot.extensions.tavern_headless.stateUpdate;
 assert.deepEqual(validateMigratedMvu(bundle,book),[]);
 const source=JSON.parse(fs.readFileSync(new URL(`../characters/${m.key}/snapshot.json`,import.meta.url)));
 const meta=JSON.parse(fs.readFileSync(new URL(`../characters/${m.key}/openings.json`,import.meta.url)));
 const expected=importOpenings(source,meta,readMvuInitialVariables(m.key,source.characterBook,parseYaml),{parseYaml});
 assert.deepEqual(snapshot.extensions.tavern_headless.openings.items.map(x=>x.variables),expected.items.map(x=>x.variables));
 const checks=[];
 for(const opening of release.openings){
  const created=await api('POST',`/role-releases/${release.id}/sessions`,{user_id:release.default_user_id,opening_id:opening.id});
  try{
   const transport=createFormalTransport({sessionId:created.session.id,fetchImpl:(url,options)=>fetch(base+url,options)});
   const loaded=await transport.loadSession();
   const original=expected.items.find(x=>x.id===opening.id).variables;
   assert.deepEqual(loaded.current.variables,JSON.parse(JSON.stringify(original).replaceAll('{{user}}',release.default_user_snapshot.name).replaceAll('{{char}}',snapshot.name)));
   const dry=await api('POST',`/sessions/${created.session.id}/respond/dry-run`,{message:'我在旁边坐下，安静地听她说话。'});
   const prompt=dry.messages.map(x=>x.content).join('\n');
   assert(!/<(?:UpdateVariable|JSONPatch|Analysis)>/.test(prompt));
   assert(!prompt.includes('<%'));
   checks.push({openingId:opening.id,initialMatches:true,noLegacyMvu:true,noEjs:true});
  }finally{await api('DELETE','/sessions/'+created.session.id);}
 }
 evidence.push({key:m.key,releaseId:m.releaseId,cleanAgentRules:true,openings:checks});
}
fs.writeFileSync(new URL('../../../../docs/plans/evidence/published-backend/mvu-published-acceptance.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
