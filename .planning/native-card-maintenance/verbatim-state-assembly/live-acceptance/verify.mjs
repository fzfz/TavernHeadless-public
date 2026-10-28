import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const out=resolve('.planning/native-card-maintenance/verbatim-state-assembly/live-acceptance');
const load=async name=>JSON.parse(await readFile(out+'/'+name,'utf8'));
const cases=await load('cases.json');
const records=(await load('model-call-records.json')).map(x=>JSON.parse(x.recordJson));
const files=await readdir(out);
const rows=[];
for(const [key,c] of Object.entries(cases)){
 const body=await load(key+'-r1-body-result.json');
 const bodyDry=await load(key+'-r1-body-dry-result.json');
 const stateDry=await load(key+'-r1-state-dry-result.json');
 const inspect=await load(key+'-r1-inspect-result.json');
 const request=await load(files.find(x=>/^\d+/.test(x)&&x.endsWith(key+'-r1-body-provider-request.json')&&Number(x.slice(0,2))>=8));
 const response=await load(files.find(x=>/^\d+/.test(x)&&x.endsWith(key+'-r1-body-provider-response.json')&&Number(x.slice(0,2))>=8));
 const stateRequest=await load(files.find(x=>/^\d+/.test(x)&&x.endsWith(key+'-r1-state-provider-request.json')&&Number(x.slice(0,2))>=9));
 const chunks=response.text.split('\n').filter(x=>x.startsWith('data: {')).map(x=>JSON.parse(x.slice(6)));
 const content=chunks.flatMap(x=>x.choices??[]).map(x=>x.delta?.content??'').join('');
 const source=stateDry.sources.find(x=>x.role==='assistant');
 const record=records.find(x=>x.runId===stateDry.sourceIdentity.runId&&x.outputMessageId===source.messageId&&x.purpose==='narration'&&x.status==='succeeded');
 const publicMessage=inspect.messages.find(x=>x.id===source.messageId);
 const stateText=stateDry.messages.map(x=>x.content).join('\n');
 const page=await load(key+'-page.json');
 const checks={
  bodyDryMessagesEqualProvider:isDeepStrictEqual(bodyDry.messages,request.body.messages),
  stateDryMessagesEqualProvider:isDeepStrictEqual(stateDry.messages,stateRequest.body.messages),
  outputSchemaEqualProvider:isDeepStrictEqual(stateDry.outputSchema,stateRequest.body.response_format.json_schema.schema),
  fullPersonaInBody:bodyDry.messages.some(x=>x.content.includes(c.persona.description)),
  fullPersonaInState:stateDry.messages.some(x=>x.content.includes(c.persona.description)),
  bodyInputRetainsBoundName:bodyDry.assembly.preprocessedUserMessage.includes(c.persona.name),
  stateInputRetainsBoundName:stateDry.messages.some(x=>x.role==='user'&&x.content.includes(stateDry.sources.find(x=>x.role==='user').text)),
  openingInBody:bodyDry.messages.some(x=>x.role==='assistant'&&x.content===stateDry.messages[3].content),
  stateHistoryEmptyOnFirstUpdate:stateDry.variableHistory.length===0,
  sixStateSourcesHaveTokenUsage:['stateDefinition','stateRules','stateBefore','stateHistory','stateEvidence','stateOutputContract'].every(x=>stateDry.token_usage.bySection[x]>0),
  beforeValuesInState:stateText.includes(JSON.stringify({before:stateDry.before,floorBefore:stateDry.before,previousSnapshotId:stateDry.previousSnapshotId})),
  contractInState:stateText.includes(JSON.stringify({outputSchema:stateDry.outputSchema})),
  sourceCallIdentityMatchesCommittedOutput:Boolean(record)&&record.outputPageId===stateDry.sourceIdentity.outputPageId&&record.attemptNo===stateDry.sourceIdentity.attemptNo,
  selectedWorldbookEntriesReused:isDeepStrictEqual(body.promptSnapshot.worldbookActivatedEntryUids,stateDry.prompt_snapshot.worldbookActivatedEntryUids),
  providerContentEqualsSavedModelText:content===body.generatedText&&content===record?.text,
  publicTextEqualsStateEvidence:publicMessage?.content===source.text&&stateDry.messages.some(x=>x.role==='assistant'&&x.content===source.text),
  currentSnapshotUnchangedAfterFailedState:inspect.view.current.snapshotId===stateDry.previousSnapshotId&&isDeepStrictEqual(inspect.view.current.variables,stateDry.before),
  pageLoadedWithoutRuntimeExceptions:page.errors.length===0&&page.dom.shadows.length>0&&page.dom.url.startsWith('http://127.0.0.1:')
 };
 rows.push({key,sessionId:c.sessionId,bodyFloorId:body.floorId,bodyFloorNo:body.floorNo,assistantMessageId:source.messageId,providerContentCharacters:content.length,publicTextCharacters:source.text.length,namesBehavior:bodyDry.assembly.namesBehaviorApplied,statePreset:stateDry.preset,bodyWorldbookEntries:body.promptSnapshot.worldbookActivatedEntryUids,checks,pageScope:key.startsWith('linqian')?'opening_and_generated_body':'opening_only_current_snapshot_is_initial'});
}
await writeFile(out+'/deterministic-verification.json',JSON.stringify({scope:'four_qwen_samples_first_floor_only',cases:rows},null,2)+'\n');
for(const row of rows)console.log(row.key,JSON.stringify(Object.fromEntries(Object.entries(row.checks).filter(([,value])=>!value))));
