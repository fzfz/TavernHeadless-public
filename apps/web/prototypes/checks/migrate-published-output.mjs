import fs from 'node:fs';
import assert from 'node:assert/strict';
import {migratePresetOutput} from './preset-output-migration.mjs';
const config=JSON.parse(fs.readFileSync(new URL('./published-prototype.config.json',import.meta.url)));
const api=async(method,path,body)=>{const r=await fetch(`http://localhost:${config.port}${path}`,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await r.json();assert(r.ok,JSON.stringify(result.error));return result.data;};
const releases=await api('GET','/role-releases?latest_per_character=true');
const migrated=new Map(),evidence=[];
for(const release of releases){
 let presetVersion=migrated.get(release.preset_id);
 if(!presetVersion){
  const versions=await api('GET',`/presets/${release.preset_id}/versions`);
  const source=versions.find(v=>v.id===release.preset_version_id).snapshot;
  const output=migratePresetOutput(source).extensions.tavern_headless.outputProcessing;
  const editor=await api('GET',`/presets/${release.preset_id}/editor`);
  editor.editor.top_level.extensions={...editor.editor.top_level.extensions,tavern_headless:{...editor.editor.top_level.extensions?.tavern_headless,outputProcessing:output}};
  await api('PUT',`/presets/${release.preset_id}`,{name:editor.name,editor:editor.editor,expected_version:editor.version});
  presetVersion=(await api('GET',`/presets/${release.preset_id}/versions`)).sort((a,b)=>b.version_no-a.version_no)[0].id;
  migrated.set(release.preset_id,presetVersion);
 }
 const keys=['name','character_id','character_version_id','preset_id','regex_profile_id','regex_profile_version_id','worldbook_id','worldbook_version_id','prompt_mode','default_user_id'];
 const body=Object.fromEntries(keys.map(k=>[k,release[k]]));
 body.preset_version_id=presetVersion;
 body.model_slots=release.model_slots.map(({slot,profile_id,params})=>({slot,profile_id,params}));
 const published=await api('POST','/role-releases',body);
 evidence.push({characterId:release.character_id,previousReleaseId:release.id,releaseId:published.id,presetVersionId:presetVersion});
}
fs.writeFileSync(new URL('../../../../docs/plans/evidence/published-backend/preset-output-migration.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
