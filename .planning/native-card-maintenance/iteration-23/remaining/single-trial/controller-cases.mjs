import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const root=resolve('.tmp/native-card-conversion/run-pdG3cp/package');
const json=async p=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const config=await json('worldbooks/linxi/book.json');
const entries=await Promise.all(config.entryFiles.map(async p=>{const e=await json(p);return {...e,id:e.uid};}));
const book={name:config.name,entries};
const initial=await json('state/initial/first.json');
const {renderController}=await import(pathToFileURL(resolve(root,'backend/controllers/linxi.js')));
const source=JSON.parse(await readFile(resolve('.tmp/native-card-inputs/USER002-v1.3.32/input.json'),'utf8')).data.character_book;
async function original(entryId,variables){
 const entry=source.entries.find(e=>e.id===entryId);
 const match=entry.content.match(/^\s*<%_([\s\S]*?)_%>\s*$/);
 if(!match)throw new Error('Selected source must contain exactly one EJS code block');
 const text=[],ids=[];
 const value=path=>path.split('.').slice(1).reduce((o,k)=>o?.[k],variables);
 const getwi=async(name,comment)=>{const e=source.entries.find(e=>e.comment===comment);if(!e)throw new Error(comment);ids.push(e.id);return e.content;};
 await runInNewContext('(async()=>{'+match[1]+'})()', {charLoreBook:source.name,getvar:value,getwi,print:v=>text.push(String(v))}, {timeout:1000});
 return {text:text.join(''),referencedEntryIds:ids};
}
const results=[];
for(const stage of ['Z000','Z001','Z003','Z004']){
 const variables=structuredClone(initial);
 for(const k of Object.keys(variables.世界.已触发事件))variables.世界.已触发事件[k]=!['事件_E048','事件_E049'].includes(k);
 variables.林茜.堕落=999;variables.林茜.感情=504.85;variables.世界.终局路线='结局三_隔离守婚';variables.世界.终局阶段=stage;
 const result=await renderController({entryId:106,variables,characterBook:book});
 const comparison=await original(106,variables);
 const sourceEqual=result.text===comparison.text && JSON.stringify(result.referencedEntryIds)===JSON.stringify(comparison.referencedEntryIds);
 results.push({kind:'isolation-route',stage,sourceEqual,referencedEntryIds:result.referencedEntryIds,selectedComments:entries.filter(e=>result.referencedEntryIds.includes(e.id)).map(e=>e.comment),text:result.text});
}
for(const [feeling,fall] of [[299,80],[300,81],[449,199],[450,200],[450,219],[450,220],[450,379],[450,380],[450,619],[450,620]]){
 const variables=structuredClone(initial);variables.林茜.感情=feeling;variables.林茜.堕落=fall;variables.世界.已触发事件.事件_E012=true;variables.世界.已触发事件.事件_E035=false;
 const result=await renderController({entryId:104,variables,characterBook:book});
 const comparison=await original(104,variables);
 const sourceEqual=result.text===comparison.text && JSON.stringify(result.referencedEntryIds)===JSON.stringify(comparison.referencedEntryIds);
 results.push({kind:'body-boundary',feeling,fall,sourceEqual,referencedEntryIds:result.referencedEntryIds,selectedComments:entries.filter(e=>result.referencedEntryIds.includes(e.id)).map(e=>e.comment)});
}
for(const mode of ['默认拆迁旧楼','旧楼电话纠缠','原始首次撞见','远程监控','画室监控','302监控','王授军私宅3P','黑哥逃脱','跪倒屈服','繁衍','画室赴约']){
 const variables=structuredClone(initial);variables.世界.开局模式=mode;
 const result=await renderController({entryId:122,variables,characterBook:book});
 const comparison=await original(122,variables);
 const sourceEqual=result.text===comparison.text && JSON.stringify(result.referencedEntryIds)===JSON.stringify(comparison.referencedEntryIds);
 results.push({kind:'opening-premise',mode,sourceEqual,referencedEntryIds:result.referencedEntryIds,selectedComments:entries.filter(e=>result.referencedEntryIds.includes(e.id)).map(e=>e.comment),text:result.text});
}
const output={scope:'direct converted-module execution; no application configuration changes; does not prove formal session execution',results};
await writeFile(resolve('.planning/native-card-maintenance/iteration-23/remaining/single-trial/controller-results.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(results.map(({text,...r})=>r),null,2));
