import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../../../apps/api/src/app.js';
import { loadStorageConfig } from '../../../../apps/api/src/storage-config.js';
import { characterVersions, modelCallRecords, roleDisplaySnapshots } from '../../../../apps/api/src/db/schema.js';
import { roleFixture } from '../../../../apps/api/test/helpers/role-fixture.js';
import { createTavernClient } from '../../../../packages/official-integration-kit/sdk/src/index.js';
import { preparePresetImport, migratePresetOutput, compileRegexMigration } from '@tavern/adapters-sillytavern';
import { roleStateBundleSchema, rolePresetSourceSchema, presetImportPolicySchema, presetOutputMigrationSchema, roleRegexSourceSchema, regexMigrationSchema } from '@tavern/shared';

const root = process.cwd();
const out = resolve(root, '.planning/native-card-maintenance/verbatim-state-assembly/live-acceptance');
const fixtures = resolve(root, 'fixtures/role-apps');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const credentials = await json('/Users/developer/.config/tavern-headless/openrouter-linqian-test.json');
const model = process.env.ACCEPTANCE_MODEL ?? 'qwen/qwen3.8-27b:free';
const resume = process.env.ACCEPTANCE_RESUME === '1';
const catalog = await json(join(out, 'models.json'));
const entry = catalog.data.find((item: any) => item.id === model);
if (!entry || entry.pricing.prompt !== '0' || entry.pricing.completion !== '0') throw new Error('Free catalog entry required');
process.env.APP_SECRETS_MASTER_KEY = resume ? await readFile(resolve(root, '.tmp/state-live/master-key'), 'utf8') : randomUUID();
await writeFile(resolve(root, '.tmp/state-live/master-key'), process.env.APP_SECRETS_MASTER_KEY, {mode:0o600});
const redact = (value: unknown) => JSON.stringify(value, (key, item) => /^(apiKey|api_key|authorization)$/i.test(key) ? '[redacted]' : item, 2).split(credentials.apiKey).join('[redacted]');
const save = async (name: string, value: unknown) => writeFile(join(out, name), redact(value) + '\n');
const originalFetch = globalThis.fetch;
let count = Number(process.env.ACCEPTANCE_START_COUNT ?? 0);
let label = 'prepare';
const pending: Promise<unknown>[] = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(credentials.baseUrl) || !(url.endsWith('/chat/completions') || url.endsWith('/responses'))) return originalFetch(input, init);
  const requestText = init?.body === undefined && input instanceof Request ? await input.clone().text() : String(init?.body);
  const request = JSON.parse(requestText);
  if (request.model !== model || ++count > 24) throw new Error('Acceptance request cap/model mismatch');
  const name = `${String(count).padStart(2, '0')}-${label}`;
  const start = Date.now();
  await save(`${name}-provider-request.json`, {url, startedAt: new Date(start).toISOString(), body: request});
  try {
    const response = await originalFetch(input, init);
    pending.push(response.clone().text().then(text => save(`${name}-provider-response.json`, {status:response.status, contentType:response.headers.get('content-type'), elapsedMs:Date.now()-start, text})));
    return response;
  } catch (error) {
    await save(`${name}-provider-response.json`, {elapsedMs:Date.now()-start, error:String(error)});
    throw error;
  }
};
const storage = resume ? await json(resolve(root, '.tmp/state-live/storage.json')) : loadStorageConfig({DATA_DIR:resolve(root, '.tmp/state-live', randomUUID())});
const built = await buildApp({databasePath:storage.databasePath, storage, logger:false, auth:{mode:'off'}, llmProfileApiMode:'chat', enableSseChat:true, enablePromptDryRun:true, enableMemory:false, enableMemoryConsolidation:false, enableBackupWorker:false, enableAgentRuntimeWorker:false, orchestration:{providers:[{id:'acceptance-openrouter', type:'openai-compatible', apiMode:'chat', baseURL:credentials.baseUrl, apiKey:credentials.apiKey}], defaultModel:{providerId:'acceptance-openrouter',modelId:model}}});
const app = built.app;
const call = async (method: any, url: string, payload?: any) => {
  const res = await app.inject({method,url,...(payload === undefined ? {} : {payload})});
  if (res.statusCode >= 400) throw new Error(`${res.statusCode} ${url}: ${res.body}`);
  return res.json().data;
};
const version = async (url: string) => (await call('GET',url)).sort((a:any,b:any)=>b.version_no-a.version_no)[0];
const cases: Record<string, any> = resume ? await json(join(out, 'cases.json')) : {};
if (!resume) {
const bundle = await json(join(fixtures,'linqian/prompt-bundle.json'));
const presetData = migratePresetOutput(preparePresetImport(rolePresetSourceSchema.parse(await json(join(fixtures,'presets/tianqin-beta-3.9.json'))), presetImportPolicySchema.parse(bundle.presetImport)).data, presetOutputMigrationSchema.parse(await json(join(fixtures,'migrations/preset-output-migration.json'))));
presetData.wi_format = '{0}';
const preset = await call('POST','/import/preset',{name:bundle.presetName,data:presetData});
const editor = await call('GET',`/presets/${preset.id}/editor`);
editor.editor.default_character_id = 100001;
await call('PUT',`/presets/${preset.id}`,{name:editor.name,editor:editor.editor,expected_version:editor.version});
const presetVersion = await version(`/presets/${preset.id}/versions`);
const statePresets: Record<string, any> = {};
for (const name of ['primary-state-update','backup-mvu-state-update']) {
  const resource = await call('POST','/import/preset',{name,data:await json(resolve(out,'../presets',`${name}.json`))});
  const e = await call('GET',`/presets/${resource.id}/editor`);
  e.editor.default_character_id = 100001;
  await call('PUT',`/presets/${resource.id}`,{name:e.name,editor:e.editor,expected_version:e.version});
  statePresets[name] = {resource,version:await version(`/presets/${resource.id}/versions`)};
}
const profile = await call('POST','/llm-profiles',{preset_name:'OpenRouter actual free acceptance', provider:'openai-compatible',model_id:model,api_key:credentials.apiKey,base_url:credentials.baseUrl});
const personas: Record<string, any> = {
  linqian:{name:'裴修远',description:'裴修远，男，32岁，是林茜的丈夫，在建筑公司担任中层干部，负责人员调动、审批和工地事务。夫妻正在备孕。他爱妻子，习惯先核对时间、地点和事情经过，再表达判断；说话简短，遇到疑点会继续追问，同时仍会照顾妻子的实际需要。眼前出现危险时，他会先制止现场，再询问经过。当前是周一中午，他下班回家途中在拆迁旧楼后窗目击了林茜与杨桃子的房内过程，尚未被两人发现。'},
  gushengman:{name:'周听澜',description:'周听澜，男，17岁，是天州市第一私立高中的学生。他性格安静，愿意认真听别人弹琴，能够用具体听感回应音乐。他连续七天在傍晚来到旧教学楼三楼的走廊，在尽头的窗边停留片刻。今天他听到了活动室里的钢琴演奏，正准备离开，顾声慢追出活动室问他的名字。他此前没有与顾声慢交谈，不知道她的匿名创作者身份、酒吧兼职、家庭经历或脑内心声。'}
};
for (const role of ['linqian','gushengman']) {
  const {source,payload} = await roleFixture(role);
  const identity = await call('POST','/import/character',payload);
  const v = built.database.select().from(characterVersions).where(eq(characterVersions.id,identity.character_version_id)).get()!;
  const state = roleStateBundleSchema.parse(JSON.parse(v.dataJson).extensions.tavern_headless.stateUpdate);
  const directory = join(fixtures,role);
  const manifest = await json(join(directory,'manifest.json'));
  const inputs = new Map<string,string>([['manifest.json','manifest'],[manifest.html,'template'],[manifest.css,'template'],[manifest.script,'browser_script']]);
  if (manifest.floorHtml) inputs.set(manifest.floorHtml,'template');
  for (const asset of Object.values(manifest.assets) as any[]) inputs.set(asset.file,'media');
  for (const path of Object.keys(state.files)) inputs.set(path,path.endsWith('.js')?'server_script':'data');
  const mime:Record<string,string> = {'.json':'application/json','.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpeg':'image/jpeg','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
  const files = [];
  for (const [name,purpose] of inputs) {
    const content = state.files[name] === undefined ? await readFile(join(directory,name)) : Buffer.from(state.files[name]);
    if (!mime[extname(name)]) throw new Error(`MIME missing: ${name}`);
    files.push({name,purpose,mime:mime[extname(name)],base64:content.toString('base64')});
  }
  await call('POST',`/role-assets/${identity.character_version_id}`,{character_id:identity.character_id,files});
  const regex = compileRegexMigration([roleRegexSourceSchema.parse({key:role,kind:'character',name:source.name,resourceId:identity.character_id,versionId:identity.character_version_id,scripts:source.extensions.regex_scripts}),roleRegexSourceSchema.parse({key:'preset',kind:'preset',name:bundle.presetName,resourceId:preset.id,versionId:presetVersion.id,scripts:presetData.extensions?.regex_scripts})],regexMigrationSchema.parse(await json(join(fixtures,'migrations/regex-migration.json'))));
  const regexResource = await call('POST','/import/regex',{name:source.name,data:regex.scripts});
  const regexVersion = await version(`/regex-profiles/${regexResource.id}/versions`);
  const user = await call('POST','/users',{snapshot:personas[role]});
  for (const [stateName,sp] of Object.entries(statePresets)) {
    const params = {max_context_tokens:128000,max_output_tokens:8192,temperature:0.7,timeout_ms:180000,max_retries:0,reasoning_effort:'none'};
    const releaseInput = {name:`${source.name} ${stateName}`,character_id:identity.character_id,character_version_id:identity.character_version_id,preset_id:preset.id,preset_version_id:presetVersion.id,regex_profile_id:regexResource.id,regex_profile_version_id:regexVersion.id,worldbook_id:identity.worldbook.id,worldbook_version_id:identity.worldbook.version_id,prompt_mode:'compat_plus',default_user_id:user.id,statePresetId:sp.resource.id,statePresetVersionId:sp.version.id,stateHistoryTurns:5,model_slots:[{slot:'narrator',profile_id:profile.id,params},{slot:'verifier',profile_id:profile.id,params:{...params,max_output_tokens:6000,temperature:0.2}}]};
    const release = await call('POST','/role-releases',releaseInput);
    const created = await call('POST',`/role-releases/${release.id}/sessions`,{});
    const key = `${role}-${stateName}`;
    cases[key] = {sessionId:created.session.id,releaseInput,created,persona:personas[role],initialView:await call('GET',`/sessions/${created.session.id}/role-view`)};
  }
}
}
let client: ReturnType<typeof createTavernClient>;
let busy = false;
const control = Fastify({logger:false});
control.post('/acceptance/step',async (req,reply) => {
  if (busy) return reply.code(409).send({error:'Acceptance step already running'});
  busy = true;
  const {key,phase,round,message} = req.body as any;
  const c = cases[key];
  label = `${key}-r${round}-${phase}`;
  try {
    if (!c) throw new Error('Unknown acceptance case');
    await save(`${label}-arguments.json`,{key,phase,round,message,sessionId:c.sessionId});
    let result: any;
    if (phase === 'body-dry') result = await client.sessions.respondDryRun({sessionId:c.sessionId,message,debugOptions:{includeWorldbookMatches:true}});
    else if (phase === 'body') {
      const events: any[] = [];
      try {
        result = await client.sessions.respondStream({sessionId:c.sessionId,message,config:{enableTools:false,enableDirector:false,enableVerifier:false,enableMemoryConsolidation:false,maxRetries:0},debugOptions:{includePromptSnapshot:true,includeRuntimeTrace:true,includeWorldbookMatches:true},onEvent:event=>events.push(event)});
        c.lastBody = result;
      } finally { await save(`${label}-sse-events.json`,events); }
    } else if (phase === 'state-dry') {
      const view = await client.roleRuntime.getView({sessionId:c.sessionId});
      c.expectedSnapshotId = view.current.snapshotId;
      result = await client.roleRuntime.previewStateUpdate({sessionId:c.sessionId,floorId:c.lastBody.floorId,expectedSnapshotId:c.expectedSnapshotId});
    } else if (phase === 'state') result = await client.roleRuntime.updateState({sessionId:c.sessionId,floorId:c.lastBody.floorId});
    else if (phase === 'inspect') result = {view:await client.roleRuntime.getView({sessionId:c.sessionId}),messages:c.lastBody ? await client.roleRuntime.getMessages({sessionId:c.sessionId,branchId:c.lastBody.branchId,floorId:c.lastBody.floorId}):[]};
    else throw new Error('Unknown phase');
    await Promise.all(pending);
    await save(`${label}-result.json`,result);
    await save('model-call-records.json',built.database.select().from(modelCallRecords).all());
    await save('state-snapshots.json',built.database.select().from(roleDisplaySnapshots).all());
    await save('cases.json',cases);
    return {ok:true,label,count,file:`${label}-result.json`,floorId:c.lastBody?.floorId};
  } catch (error:any) {
    const result = {ok:false,label,count,error:String(error),code:error.code,status:error.status,details:error.details};
    await save(`${label}-error.json`,result);
    await save('model-call-records.json',built.database.select().from(modelCallRecords).all());
    return result;
  } finally {busy=false;}
});
await mkdir(out,{recursive:true});
const address = await app.listen({host:'127.0.0.1',port:0});
client = createTavernClient({baseUrl:address});
const controlAddress = await control.listen({host:'127.0.0.1',port:0});
await save('cases.json',cases);
await save('server.json',{address,controlAddress,model,cap:24,automaticRetries:0,sourceCommit:'32df2e5d0354f76180f5cf742c99304d133d5e12',sourceChanges:['apps/api/src/routes/role-view.ts','apps/api/src/routes/__tests__/role-view.test.ts']});
await writeFile(resolve(root, '.tmp/state-live/storage.json'), JSON.stringify(storage));
console.log(JSON.stringify({address,controlAddress,model,cases:Object.keys(cases)}));
process.on('SIGTERM',async ()=>{await control.close();await app.close();process.exit(0);});
