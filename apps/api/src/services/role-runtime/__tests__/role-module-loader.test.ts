import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { RoleModuleLoader } from '../role-module-loader.js';
import type { RoleAssetService } from '../role-asset-service.js';
import { nativeModuleRuntimeConfigSchema } from '../native-module-runtime-config.schema.js';
import type { NativeModuleWorkerRequest } from '../native-module-worker.schema.js';
let root:string;
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});});
it('loads the authorized fixed-version module and resolves its relative imports from the resource directory',async()=>{
 root=await mkdtemp(join(tmpdir(),'role-module-'));
 await writeFile(join(root,'value.mjs'),'export const score=7;');
 await writeFile(join(root,'controller.mjs'),"import {score} from './value.mjs'; export function renderController(){return {text:String(score)}}; export function derive(){return {score}};");
 const resolveServerModule=vi.fn(async()=>join(root,'controller.mjs'));
 const loader=new RoleModuleLoader({resolveServerModule,nativeRevision:vi.fn(async()=>undefined)} as unknown as RoleAssetService);
 const module=await loader.loadModule('account','fixed-version','controller.mjs');
 expect(resolveServerModule).toHaveBeenCalledWith('account','fixed-version','controller.mjs');
 expect((module.renderController as ()=>unknown)()).toEqual({text:'7'});
 const derive=await loader.load('account','fixed-version','controller.mjs','derive');
 expect(derive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).toEqual({score:7});
 await expect(loader.load('account','fixed-version','controller.mjs','validate')).rejects.toThrow('does not export validate()');
});
it('propagates ownership or missing-file errors from the version resource service',async()=>{
 const failure=new Error('resource denied');
 const loader=new RoleModuleLoader({nativeRevision:vi.fn(async()=>undefined),resolveServerModule:vi.fn(async()=>{throw failure;})} as unknown as RoleAssetService);
 await expect(loader.loadModule('foreign','version','controller.mjs')).rejects.toBe(failure);
});

function nativeAssets(files: Record<string, { source: string; purpose?: "server_script" | "data" }>) {
 const content = new Map(Object.entries(files).map(([path, value]) => [path, Buffer.from(value.source)]));
 const snapshot = {
  cardId: "card", revision: 3, files: content,
  fileRecords: Object.entries(files).map(([path, value]) => ({path, purpose:value.purpose ?? "server_script"})),
 };
 return {nativeRevision:vi.fn(async()=>snapshot as never)} as unknown as RoleAssetService;
}

const config = {timeoutMs:5000,maxBufferBytes:2_097_152,maxInputBytes:8_388_608,maxModuleBytes:4_194_304,maxModuleFiles:128,maxConcurrentWorkers:4,maxOldGenerationSizeMb:64,evaluationTimeoutMs:1000};

class ControlledWorkerChild extends EventEmitter {
 stdout = new EventEmitter();
 stderr = new EventEmitter();
 stdin = Object.assign(new EventEmitter(), {end:(...args:unknown[])=>this.onInput?.(String(args[0] ?? ""))});
 exitCode: number | null = null;
 signalCode: NodeJS.Signals | null = null;
 private closed = false;

 constructor(private readonly onInput?: (input:string)=>void) { super(); }

 kill(signal: NodeJS.Signals = "SIGKILL") {
  this.finish(null, signal);
  return true;
 }

 finish(status: number | null, signal: NodeJS.Signals | null) {
  if (this.closed) return;
  this.closed = true;
  this.exitCode = status;
  this.signalCode = signal;
  this.emit("close", status, signal);
 }
}

function requestCaptureSpawner(
 capture: (request:NativeModuleWorkerRequest)=>void,
): typeof spawn {
 return new Proxy(spawn,{
  apply(_target,_thisArg){
   let child:ControlledWorkerChild;
   child=new ControlledWorkerChild((input)=>{
    capture(JSON.parse(input) as NativeModuleWorkerRequest);
    queueMicrotask(()=>{
     child.stdout.emit("data",Buffer.from(JSON.stringify({ok:true,value:"{}"})));
     child.finish(0,null);
    });
   });
   return child;
  },
 }) as unknown as typeof spawn;
}

function controlledWorkerSpawner(
 trigger: (child: ControlledWorkerChild) => void,
): typeof spawn {
 return new Proxy(spawn, {
  apply(_target, _thisArg) {
   const child = new ControlledWorkerChild();
   queueMicrotask(() => trigger(child));
   return child;
  },
 }) as unknown as typeof spawn;
}

it("validates the structured process-wide concurrency budget",()=>{
 expect(nativeModuleRuntimeConfigSchema.parse(config).maxConcurrentWorkers).toBe(4);
 expect(()=>nativeModuleRuntimeConfigSchema.parse({...config,maxConcurrentWorkers:0})).toThrow();
 expect(()=>nativeModuleRuntimeConfigSchema.parse({...config,maxConcurrentWorkers:33})).toThrow();
});

it("executes native derive in a restricted child and resolves declared JSON imports",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'import values from "./values.json" with { type: "json" }; export function derive(context) { return { score: context.candidate.score + values.increment }; }'},
  "backend/variable-tools/values.json":{source:'{"increment":3}',purpose:"data"},
 });
 const loader=new RoleModuleLoader(assets,config);
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{score:4},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).resolves.toEqual({score:7});
});

it("requires the declared JSON import attribute in the restricted worker",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'import values from "./values.json"; export function derive(context) { return values; }'},
  "backend/variable-tools/values.json":{source:'{"increment":3}',purpose:"data"},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/JSON data imports require the type=json import attribute/);
});

it("sends only the entry and its transitive static import closure to the worker",async()=>{
 const files:Record<string,{source:string;purpose?:"server_script"|"data"}>={
  "backend/variable-tools/derive.js":{source:'import { derive as compose } from "./one.js"; import { derive as repeated } from "./one.js"; import values from "./values.json" with { type: "json" }; export function derive(context) { const ignored = "import \'./ignored.js\'"; /* import "./comment.js" */ return { score: compose(context).score + values.increment + (typeof repeated === "function" && ignored ? 0 : 0) }; }'},
  "backend/variable-tools/one.js":{source:'import { validate as check } from "../validators/validate.js"; export function derive(context) { check(context); return context.candidate; }'},
  "backend/validators/validate.js":{source:'import { derive as cycle } from "../variable-tools/one.js"; export function validate(context) { if (typeof cycle !== "function") throw new Error("cycle was not linked"); return { issues: [] }; }'},
  "backend/variable-tools/values.json":{source:'{"increment":4}',purpose:"data"},
 };
 for(let index=0;index<129;index+=1){
  files[`worldbooks/harbor/entries/${index}.json`]={source:"x".repeat(32_768),purpose:"data"};
 }
 const assets=nativeAssets(files);
 const workerRequests:NativeModuleWorkerRequest[]=[];
 const loader=new RoleModuleLoader(assets,config,requestCaptureSpawner((request)=>workerRequests.push(request)));
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{score:1},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).resolves.toEqual({});

 expect(workerRequests).toHaveLength(1);
 expect(workerRequests[0]!.modules.map((module)=>module.path).sort()).toEqual([
  "backend/variable-tools/derive.js",
  "backend/variable-tools/one.js",
  "backend/validators/validate.js",
  "backend/variable-tools/values.json",
 ].sort());
});

it("executes transitive JavaScript imports with repeated edges and a circular dependency",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'import { derive as compose } from "./one.js"; import { derive as repeated } from "./one.js"; export function derive(context) { if (typeof repeated !== "function") return {}; return compose(context); }'},
  "backend/variable-tools/one.js":{source:'import { validate } from "../validators/validate.js"; export function derive(context) { const result = validate(context); return { score: context.candidate.score + result.issues.length + 1 }; }'},
  "backend/validators/validate.js":{source:'import { derive as cycle } from "../variable-tools/one.js"; export function validate(context) { return { issues: typeof cycle === "function" ? [] : [{ message: "cycle failed" }] }; }'},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{score:4},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).resolves.toEqual({score:5});
});

it("executes named and star re-exports through their static dependency closure",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export { derive } from "./one.js"; export * from "./two.js";'},
  "backend/variable-tools/one.js":{source:'import { validate } from "./two.js"; export function derive(context) { return { score: context.candidate.score + validate(context).issues.length + 1 }; }'},
  "backend/variable-tools/two.js":{source:'export function validate() { return { issues: [] }; }'},
 });
 const derive=await new RoleModuleLoader(assets,{...config,maxModuleFiles:3}).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{score:4},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).resolves.toEqual({score:5});
});

it("counts only unique reachable dependencies against the configured file limit",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'import { derive as compose } from "./one.js"; import { derive as repeated } from "./one.js"; export function derive(context) { return compose(context) + (typeof repeated === "function" ? 0 : 0); }'},
  "backend/variable-tools/one.js":{source:'import { validate } from "../validators/validate.js"; export function derive(context) { validate(context); return context.candidate; }'},
  "backend/validators/validate.js":{source:'import { derive as cycle } from "../variable-tools/one.js"; export function validate(context) { return { ok: typeof cycle === "function" }; }'},
 });
 const loader=new RoleModuleLoader(assets,{...config,maxModuleFiles:2});
 await expect(loader.load("account","fixed","backend/variable-tools/derive.js","derive")).rejects.toThrow(/configured 2-file limit/);
});

it("counts only reachable module bytes and continues to enforce the invocation input limit",async()=>{
 const oversizedModule=nativeAssets({
  "backend/variable-tools/derive.js":{source:`export function derive(context) { return "${"x".repeat(1_100)}"; }`},
 });
 const moduleLoader=new RoleModuleLoader(oversizedModule,{...config,maxModuleBytes:1_024});
 await expect(moduleLoader.load("account","fixed","backend/variable-tools/derive.js","derive")).rejects.toThrow(/configured 1024-byte limit/);

 const smallModule=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return context.candidate; }'},
 });
 const inputLoader=new RoleModuleLoader(smallModule,{...config,maxInputBytes:1_024});
 const derive=await inputLoader.load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{text:"x".repeat(2_000)},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/configured 1024-byte input limit/);
});

it.each([
 ["external modules","import value from \"node:fs\"; export function derive() { return value; }",{},/导入路径必须以/],
 ["undeclared files","import value from \"./missing.js\"; export function derive() { return value; }",{},/not a declared package file/],
 ["paths outside the package","import value from \"../../../../outside.js\"; export function derive() { return value; }",{},/相对导入必须指向原生包内的文件/],
 ["query paths","import value from \"./missing.js?raw\"; export function derive() { return value; }",{},/导入路径必须以/],
 ["fragment paths","import value from \"./missing.js#raw\"; export function derive() { return value; }",{},/导入路径必须以/],
 ["backslash paths","import value from \"./nested\\\\file.js\"; export function derive() { return value; }",{},/导入路径必须以/],
 ["unsupported extensions","import value from \"./value.txt\"; export function derive() { return value; }",{"backend/variable-tools/value.txt":{source:"value",purpose:"data"}},/must reference a declared JavaScript module or JSON data file/],
 ["JavaScript files without server_script purpose","import value from \"./value.js\"; export function derive() { return value; }",{"backend/variable-tools/value.js":{source:"export default 1",purpose:"data"}},/must be a declared server_script file/],
 ["JSON files without data purpose","import value from \"./value.json\" with { type: \"json\" }; export function derive() { return value; }",{"backend/variable-tools/value.json":{source:"{}",purpose:"server_script"}},/must have data purpose/],
] as const)("rejects %s during static dependency collection",async(_case,source,extra,expected)=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source},
  ...extra,
 } as Record<string,{source:string;purpose?:"server_script"|"data"}>);
 let spawnCount=0;
 const spawnWorker=new Proxy(spawn,{
  apply(target,thisArg,args){spawnCount+=1;return Reflect.apply(target,thisArg,args);},
 });
 const loader=new RoleModuleLoader(assets,config,spawnWorker);
 await expect(loader.load("account","fixed","backend/variable-tools/derive.js","derive")).rejects.toThrow(expected);
 expect(spawnCount).toBe(0);
});

it("keeps asynchronous controller invocation inside the same JSON boundary",async()=>{
 const assets=nativeAssets({
  "backend/controllers/prompt.js":{source:'export async function renderController(context) { return { text: `${context.bookId}:${context.entryId}:${context.variables.name}` }; }'},
 });
 const module=await new RoleModuleLoader(assets,config).loadModule("account","fixed","backend/controllers/prompt.js");
 await expect((module.renderController as (context:unknown)=>Promise<unknown>)({bookId:"harbor",entryId:110,variables:{name:"雾港"},characterBook:{entries:[]}})).resolves.toEqual({text:"harbor:110:雾港"});
});

it("blocks host globals, dynamic imports, unregistered fields and asynchronous derive returns",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return process.env; }'},
 });
 const loader=new RoleModuleLoader(assets,config);
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/restricted native module process/);
 await expect(derive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{},extra:true} as never)).rejects.toThrow(/not in the registered API contract/);

 const asyncAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export async function derive(context) { return context.candidate; }'},
 });
 const asyncDerive=await new RoleModuleLoader(asyncAssets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(asyncDerive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/must return synchronously/);

 const dynamicAssets=nativeAssets({
  "backend/controllers/prompt.js":{source:'export async function renderController(context) { return import("node:fs"); }'},
 });
 const dynamic=await new RoleModuleLoader(dynamicAssets,config).loadModule("account","fixed","backend/controllers/prompt.js");
 await expect((dynamic.renderController as (context:unknown)=>Promise<unknown>)({bookId:"harbor",entryId:1,variables:{},characterBook:{entries:[]}})).rejects.toThrow(/Dynamic imports are not available/);

 const stringCodeAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return ({}).constructor.constructor("return 1")(); }'},
 });
 const stringCode=await new RoleModuleLoader(stringCodeAssets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(stringCode({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/Code generation from strings disallowed/);
});

it("does not emulate an allowlisted API with JSON stringification",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return structuredClone(context.candidate); }'},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{score:2},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/structuredClone is not defined/);
});

it("deep-freezes native derive and validator contexts in the VM realm",async()=>{
 const payload={before:{stats:{score:1}},candidate:{stats:{score:2}},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 const deriveAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { if (!Object.isFrozen(context) || !Object.isFrozen(context.before.stats)) throw new Error("context is not deeply frozen"); context.before.stats.score = 9; return context.candidate; }'},
 });
 const derive=await new RoleModuleLoader(deriveAssets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive(payload)).rejects.toThrow(/read only property|Cannot assign/);
 expect(payload.before.stats.score).toBe(1);

 const validateAssets=nativeAssets({
  "backend/validators/validate.js":{source:'export function validate(context) { if (!Object.isFrozen(context) || !Object.isFrozen(context.candidate.stats)) throw new Error("context is not deeply frozen"); context.candidate.stats.score = 9; return { issues: [] }; }'},
 });
 const validate=await new RoleModuleLoader(validateAssets,config).load("account","fixed","backend/validators/validate.js","validate");
 await expect(validate(payload)).rejects.toThrow(/read only property|Cannot assign/);
 expect(payload.candidate.stats.score).toBe(2);
});

it("rejects context values that JSON.stringify would omit or change",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return context.candidate; }'},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 const base={before:{},candidate:{score:1},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 await expect(derive({...base,facts:{missing:undefined}})).rejects.toThrow(/JSON-compatible data only/);
 await expect(derive({...base,facts:{score:Number.NaN}})).rejects.toThrow(/JSON-compatible data only/);
 await expect(derive({...base,facts:{callback:()=>true}})).rejects.toThrow(/JSON-compatible data only/);
 await expect(derive({...base,facts:{score:-0}})).rejects.toThrow(/JSON-compatible data only/);
 const cyclic:Record<string,unknown>={}; cyclic.self=cyclic;
 await expect(derive({...base,facts:cyclic})).rejects.toThrow(/JSON-compatible data only/);
 const symbolic={...base,facts:{score:1}}; Object.defineProperty(symbolic.facts,Symbol("hidden"),{value:1});
 await expect(derive(symbolic)).rejects.toThrow(/JSON-compatible data only/);
});

it("rejects native module outputs that JSON serialization would change or invoke", async () => {
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:`export function derive(context) {
   switch (context.candidate.kind) {
    case "nan": return { score: NaN };
    case "undefined": return { score: undefined };
    case "array-undefined": return [undefined];
    case "getter": { const value = {}; Object.defineProperty(value, "score", { enumerable: true, get() { return 7; } }); return value; }
    case "toJSON-function": return { score: 1, toJSON() { return { score: 7 }; } };
    case "toJSON-data": return { score: 7, toJSON: "literal" };
    case "cycle": { const value = {}; value.self = value; return value; }
    default: return Object.assign(Object.create(null), { score: 7 });
   }
  }`},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 const invoke=(kind:string)=>derive({before:{},candidate:{kind},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}});

 await expect(invoke("nan")).rejects.toThrow(/number that JSON serialization would change/);
 await expect(invoke("undefined")).rejects.toThrow(/return value\.score contains undefined/);
 await expect(invoke("array-undefined")).rejects.toThrow(/return value\[0\] contains undefined/);
 await expect(invoke("getter")).rejects.toThrow(/return value\.score must be an enumerable data property/);
 await expect(invoke("toJSON-function")).rejects.toThrow(/return value\.toJSON contains function/);
 await expect(invoke("toJSON-data")).resolves.toEqual({score:7,toJSON:"literal"});
 await expect(invoke("cycle")).rejects.toThrow(/return value\.self contains a circular reference/);
 await expect(invoke("null-prototype")).resolves.toEqual({score:7});
});

it("rejects Proxy contexts before invoking their traps or toJSON methods", async () => {
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return context.candidate; }'},
 });
 const derive=await new RoleModuleLoader(assets,config).load("account","fixed","backend/variable-tools/derive.js","derive");
 const base={before:{},candidate:{score:1},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 let invoked = 0;
 const candidateProxy = new Proxy({ score: 1 }, {
  get(target, key, receiver) {
   if (key === "toJSON") {
    invoked += 1;
    return () => ({ score: 7 });
   }
   return Reflect.get(target, key, receiver);
  },
 });
 const contextProxy = new Proxy(base, {
  get(target, key, receiver) {
   if (key === "toJSON") {
    invoked += 1;
    return () => ({ ...base, candidate: { score: 7 } });
   }
   return Reflect.get(target, key, receiver);
  },
 });

 await expect(derive({ ...base, candidate: candidateProxy })).rejects.toThrow(/context must contain JSON-compatible data only/);
 await expect(derive(contextProxy)).rejects.toThrow(/context must not be a Proxy/);
 await expect(derive({ ...base, candidate: { score: 3, toJSON: "literal" } })).resolves.toEqual({ score: 3, toJSON: "literal" });
 expect(invoked).toBe(0);
});

it("executes native derive, validate and controller modules through the API tsx development loader", () => {
 const script = `
  import { RoleModuleLoader } from "./src/services/role-runtime/role-module-loader.ts";
  const modules = [
   { path: "backend/variable-tools/derive.js", purpose: "server_script", source: "export function derive(context) { return { score: context.candidate.score + 1 }; }" },
   { path: "backend/validators/validate.js", purpose: "server_script", source: "export function validate(context) { return { issues: context.candidate.score < 0 ? [{ message: 'negative' }] : [] }; }" },
   { path: "backend/controllers/prompt.js", purpose: "server_script", source: "export async function renderController(context) { return { text: context.bookId + ':' + context.entryId }; }" },
  ];
  const assets = { nativeRevision: async () => ({ cardId: 'card', revision: 1, files: new Map(modules.map((item) => [item.path, Buffer.from(item.source)])), fileRecords: modules.map(({path, purpose, source}) => ({path, purpose, byteSize: Buffer.byteLength(source)})) }) };
  const loader = new RoleModuleLoader(assets);
  const derive = await loader.load('account', 'fixed', modules[0].path, 'derive');
  const validate = await loader.load('account', 'fixed', modules[1].path, 'validate');
  const controller = await loader.loadModule('account', 'fixed', modules[2].path);
  const context = { before: { score: 1 }, candidate: { score: 2 }, sourceMessages: [], priorFacts: [], toolEvidence: [], floorBefore: { score: 1 }, facts: {} };
  if (JSON.stringify(await derive(context)) !== '{"score":3}') throw new Error('derive output mismatch');
  if (JSON.stringify(await validate({...context, candidate: {score: -1}})) !== '{"issues":[{"message":"negative"}]}') throw new Error('validator output mismatch');
  const rendered = await controller.renderController({bookId: 'harbor', entryId: 110, variables: {}, characterBook: {entries: []}});
  if (JSON.stringify(rendered) !== '{"text":"harbor:110"}') throw new Error('controller output mismatch');
  process.stdout.write('tsx native worker smoke passed');
 `;
 const child = spawnSync(
  process.execPath,
  ["--conditions=development", "--import", "tsx", "--input-type=module", "-e", script],
  { cwd: new URL("../../../../", import.meta.url), encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 },
 );

 expect(child.error).toBeUndefined();
 expect(child.status, child.stderr).toBe(0);
 expect(child.stdout).toContain("tsx native worker smoke passed");
});

it("keeps timers and independent native requests moving while a module reaches its timeout",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { while (true) {} }'},
 });
 const loader=new RoleModuleLoader(assets,{...config,timeoutMs:900});
 const slowDerive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 const fastAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return context.candidate; }'},
 });
 const fastLoader=new RoleModuleLoader(fastAssets,config);
 const fastDerive=await fastLoader.load("account","fixed","backend/variable-tools/derive.js","derive");
 const context={before:{},candidate:{ready:true},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 let timerAdvanced = false;
 const pending = slowDerive(context);
 const independentRequest = fastDerive(context);
 await new Promise<void>((resolve) => setTimeout(() => { timerAdvanced = true; resolve(); }, 15));
 expect(timerAdvanced).toBe(true);
 await expect(independentRequest).resolves.toEqual({ready:true});
 await expect(pending).rejects.toThrow(/backend\/variable-tools\/derive\.js.*limit/);
});

it("enforces the configured combined worker output limit",async()=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive() { return { text: "x".repeat(8192) }; }'},
 });
 const loader=new RoleModuleLoader(assets,{...config,maxBufferBytes:1024});
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 await expect(derive({before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}})).rejects.toThrow(/Output exceeded the configured 1024-byte limit/);
});

it("shares the process concurrency budget across loader instances and releases timed-out slots",async()=>{
 const workerConfig={...config,timeoutMs:350};
 const slowAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive() { while (true) {} }'},
 });
 const loaders=Array.from({length:config.maxConcurrentWorkers+1},()=>new RoleModuleLoader(slowAssets,workerConfig));
 const derives=await Promise.all(loaders.map(loader=>loader.load("account","fixed","backend/variable-tools/derive.js","derive")));
 const context={before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 const active=derives.slice(0,config.maxConcurrentWorkers).map(derive=>derive(context));
 await expect(derives[config.maxConcurrentWorkers]!(context)).rejects.toThrow(/configured limit of 4 concurrent native module workers/);
 await Promise.all(active.map(pending=>expect(pending).rejects.toThrow(/configured 350-millisecond limit/)));

 const fastAssets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return { ready: true }; }'},
 });
 const fastLoader=new RoleModuleLoader(fastAssets,config);
 const fastDerives=await Promise.all(Array.from({length:config.maxConcurrentWorkers},()=>fastLoader.load("account","fixed","backend/variable-tools/derive.js","derive")));
 await expect(Promise.all(fastDerives.map(derive=>derive(context)))).resolves.toEqual(Array.from({length:config.maxConcurrentWorkers},()=>({ready:true})));
});

it("releases its worker slot after a synchronous process startup failure",async()=>{
 let failStartup=true;
 const failingSpawn=new Proxy(spawn,{
  apply(target,thisArg,args){
   if(failStartup){failStartup=false;throw new Error("simulated startup failure");}
   return Reflect.apply(target,thisArg,args);
  },
 });
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive(context) { return { ready: true }; }'},
 });
 const loader=new RoleModuleLoader(assets,config,failingSpawn);
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 const context={before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 await expect(derive(context)).rejects.toThrow(/could not start the restricted native module process: simulated startup failure/);
 const retryDerives=await Promise.all(Array.from({length:config.maxConcurrentWorkers},()=>loader.load("account","fixed","backend/variable-tools/derive.js","derive")));
 await expect(Promise.all(retryDerives.map(retry=>retry(context)))).resolves.toEqual(Array.from({length:config.maxConcurrentWorkers},()=>({ready:true})));
});

const failedWorkerScenarios = [
 {
  name: "output overflow",
  config: {maxBufferBytes:1024},
  expected: /Output exceeded the configured 1024-byte limit/,
  trigger: (child:ControlledWorkerChild) => child.stdout.emit("data",Buffer.alloc(1025,120)),
 },
 {
  name: "asynchronous process startup error",
  config: {},
  expected: /Could not start the restricted native module process: simulated asynchronous startup failure/,
  trigger: (child:ControlledWorkerChild) => {
   child.emit("error",new Error("simulated asynchronous startup failure"));
   child.finish(-2,null);
  },
 },
 {
  name: "stdin error",
  config: {},
  expected: /process input failed: simulated stdin failure/,
  trigger: (child:ControlledWorkerChild) => child.stdin.emit("error",new Error("simulated stdin failure")),
 },
 {
  name: "invalid worker response",
  config: {},
  expected: /returned an invalid response/,
  trigger: (child:ControlledWorkerChild) => {
   child.stdout.emit("data",Buffer.from("not-json"));
   child.finish(0,null);
  },
 },
 {
  name: "non-zero worker exit",
  config: {},
  expected: /worker exited with status 1/,
  trigger: (child:ControlledWorkerChild) => {
   child.stdout.emit("data",Buffer.from(JSON.stringify({ok:true,value:"{}"})));
   child.finish(1,null);
  },
 },
] as const;

it.each(failedWorkerScenarios)("restores all worker slots after $name",async(scenario)=>{
 const assets=nativeAssets({
  "backend/variable-tools/derive.js":{source:'export function derive() { return { ready: true }; }'},
 });
 const loader=new RoleModuleLoader(
  assets,
  {...config,...scenario.config},
  controlledWorkerSpawner(scenario.trigger),
 );
 const derive=await loader.load("account","fixed","backend/variable-tools/derive.js","derive");
 const context={before:{},candidate:{},sourceMessages:[],priorFacts:[],toolEvidence:[],floorBefore:{},facts:{}};
 await expect(derive(context)).rejects.toThrow(scenario.expected);

 const recoveryLoaders=Array.from({length:config.maxConcurrentWorkers},()=>new RoleModuleLoader(assets,config));
 const recoveryDerives=await Promise.all(recoveryLoaders.map((recovery)=>recovery.load("account","fixed","backend/variable-tools/derive.js","derive")));
 await expect(Promise.all(recoveryDerives.map((recovery)=>recovery(context)))).resolves.toEqual(
  Array.from({length:config.maxConcurrentWorkers},()=>({ready:true})),
 );
});
