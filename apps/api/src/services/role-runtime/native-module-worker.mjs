import { SourceTextModule, SyntheticModule, createContext, runInContext } from "node:vm";
import { types as nodeTypes } from "node:util";

function copyExactJson(value, path, active, vmObjectPrototype, vmArrayPrototype) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError(`${path} contains a number that JSON serialization would change.`);
    return value;
  }
  if (typeof value !== "object")
    throw new TypeError(`${path} contains ${typeof value}, which is not a JSON value.`);
  if (nodeTypes.isProxy(value)) throw new TypeError(`${path} must not be a Proxy.`);
  if (active.has(value)) throw new TypeError(`${path} contains a circular reference.`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== vmArrayPrototype : prototype !== vmObjectPrototype && prototype !== null)
    throw new TypeError(`${path} must be a plain JSON object or array.`);
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
    throw new TypeError(`${path} contains a symbol property.`);

  active.add(value);
  try {
    if (array) {
      const source = value;
      const result = [];
      const ownKeys = Reflect.ownKeys(source);
      for (let index = 0; index < source.length; index += 1) {
        const key = String(index);
        if (!ownKeys.includes(key)) throw new TypeError(`${path}[${index}] is an array hole.`);
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new TypeError(`${path}[${index}] must be an enumerable data property.`);
        result.push(copyExactJson(descriptor.value, `${path}[${index}]`, active, vmObjectPrototype, vmArrayPrototype));
      }
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= source.length)
          throw new TypeError(`${path} contains a non-index array property.`);
      }
      Object.setPrototypeOf(result, null);
      return result;
    }

    const result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} contains a symbol property.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new TypeError(`${path}.${key} must be an enumerable data property.`);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: copyExactJson(descriptor.value, `${path}.${key}`, active, vmObjectPrototype, vmArrayPrototype),
        writable: true,
      });
    }
    return result;
  } finally {
    active.delete(value);
  }
}

async function run() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const inputText = Buffer.concat(chunks).toString("utf8");
  try {
    const request = JSON.parse(inputText);
    const context = createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
      name: "native-role-package",
    });
    const vmObjectPrototype = runInContext("Object.prototype", context);
    const vmArrayPrototype = runInContext("Array.prototype", context);
    const allowlist = new Set(request.globals);
    runInContext(
      `for (const key of Object.getOwnPropertyNames(globalThis)) { if (key !== "globalThis" && !${JSON.stringify([...allowlist])}.includes(key)) delete globalThis[key]; }`,
      context,
    );
    const moduleSources = new Map(request.modules.map((item) => [item.path, item]));
    const moduleInstances = new Map();
    const posixNormalize = (base, specifier) => {
      const parts = [];
      const combined = `${base.slice(0, base.lastIndexOf("/") + 1)}${specifier}`;
      for (const part of combined.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
          if (parts.length === 0) throw new Error("Relative imports must remain inside the package.");
          parts.pop();
        } else parts.push(part);
      }
      return parts.join("/");
    };
    const makeModule = (path) => {
      const existing = moduleInstances.get(path);
      if (existing) return existing;
      const source = moduleSources.get(path);
      if (!source) throw new Error(`Relative import ${path} is not a declared package file.`);
      if (source.purpose === "server_script" && path.endsWith(".js")) {
        const module = new SourceTextModule(source.source, {
          context,
          identifier: `package:/${path}`,
          importModuleDynamically: async () => { throw new Error("Dynamic imports are not available to native role modules."); },
        });
        moduleInstances.set(path, module);
        return module;
      }
      if (source.purpose !== "data" || !path.endsWith(".json"))
        throw new Error(`Relative import ${path} must reference a declared JavaScript module or JSON data file.`);
      const parsed = runInContext(`JSON.parse(${JSON.stringify(source.source)})`, context);
      const module = new SyntheticModule(["default"], function () {
        this.setExport("default", parsed);
      }, { context, identifier: `package:/${path}` });
      moduleInstances.set(path, module);
      return module;
    };
    const linker = async (specifier, referencingModule, extra) => {
      if (!(specifier.startsWith("./") || specifier.startsWith("../")) || specifier.includes("\\") || specifier.includes("?") || specifier.includes("#"))
        throw new Error("Imports must use a plain relative package path.");
      const targetPath = posixNormalize(referencingModule.identifier.replace(/^package:\//, ""), specifier);
      const source = moduleSources.get(targetPath);
      if (!source) throw new Error(`Relative import ${targetPath} is not a declared package file.`);
      if (targetPath.endsWith(".json")) {
        if (extra?.attributes?.type !== "json") throw new Error("JSON data imports require the type=json import attribute.");
        if (source.purpose !== "data") throw new Error(`JSON import ${targetPath} must have data purpose.`);
      } else if (!targetPath.endsWith(".js") || source.purpose !== "server_script") {
        throw new Error(`JavaScript import ${targetPath} must be a declared server_script file.`);
      }
      return makeModule(targetPath);
    };
    const entry = makeModule(request.entryPath);
    const wrapperSource = `import * as entry from ${JSON.stringify(`./${request.entryPath}`)};\nfunction freezeDeep(value) { if (value && typeof value === "object") { for (const key of Object.keys(value)) freezeDeep(value[key]); Object.freeze(value); } return value; }\nexport function execute(input) { const context = freezeDeep(input); return entry[${JSON.stringify(request.exportName)}](context); }`;
    const wrapper = new SourceTextModule(wrapperSource, {
      context,
      identifier: "package:/__runtime_wrapper__.js",
      importModuleDynamically: async () => { throw new Error("Dynamic imports are not available to native role modules."); },
    });
    await wrapper.link(linker);
    if (wrapper.status === "linked") await wrapper.evaluate({ timeout: request.evaluationTimeoutMs });
    if (entry.status === "unlinked") throw new Error("The module wrapper was not linked to its entry module.");
    const namespace = wrapper.namespace;
    if (typeof namespace.execute !== "function") throw new Error("The restricted module wrapper failed to initialize.");
    const inputValue = runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(request.context))})`, context);
    const returned = namespace.execute(inputValue);
    let value = returned;
    if (nodeTypes.isPromise(returned)) {
      if (!request.contract.async)
        throw new Error(`${request.exportName}() must return synchronously.`);
      value = await returned;
    }
    const jsonValue = copyExactJson(value, "return value", new WeakSet(), vmObjectPrototype, vmArrayPrototype);
    const serialized = JSON.stringify(jsonValue);
    if (typeof serialized !== "string") throw new Error(`${request.exportName}() returned a value that cannot be represented as JSON.`);
    JSON.parse(serialized);
    process.stdout.write(JSON.stringify({ ok: true, value: serialized }));
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

await run();
