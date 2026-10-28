import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { nativeCardFileRules, type NativeCardPackageFile } from "@tavern/shared";
import { validateNativeCardFrontendModules } from "../frontend-module-static-checker.js";

function moduleFile(path: string, content: string): NativeCardPackageFile {
  return { path, content: Buffer.from(content, "utf8") };
}

const api = nativeCardFileRules.frontendModuleApi;

describe("native card frontend module static checks", () => {
  it("accepts registered layout methods and checks aliases, kinds of access and argument counts", () => {
    const check = (body: string) => validateNativeCardFrontendModules([
      moduleFile("frontend/main.js", `export function mount({ api }) {
        const panel = api.ui.register("panel", {elements:{bar:{selector:"#bar",kind:"fill"}}});
        ${body}
      }`),
    ], "frontend/main.js", api);
    expect(check('panel.update({bar:{percent:50.5}}); panel.animateVisibility("body", {visible:true,durationMs:300,easing:"swing",queue:"append"});')).toEqual([]);
    expect(check('const alias = panel; alias.animateVisibility("body");')[0]?.expected).toContain("pass 2 argument");
    expect(check('panel.privateMethod();')[0]).toMatchObject({path:"frontend/main.js",line:3});
    expect(check('panel[method]();')[0]?.expected).toContain("static method name");
    expect(check('panel.animateVisibility(...args);')[0]?.expected).toContain("pass each argument explicitly");
    expect(check('api.ui.register("other", {}).unknown();')[0]?.expected).toContain("documented layout method");
    expect(check('{ const panel = {unknown(){}}; panel.unknown(); }')).toEqual([]);
    expect(check('(panel.animateVisibility)("body");')[0]?.expected).toContain("pass 2 argument");
    expect(check('let mutable = panel; mutable = {render(){}}; mutable.render();')).toEqual([]);
    expect(check('let mutable = api.ui.register("other",{}); mutable = {render(){}}; mutable.render();')).toEqual([]);
  });
  it("accepts the full Harbor package frontend and browser DOM APIs", async () => {
    const fixture = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const files = Object.entries(fixture).map(([path, content]) => moduleFile(path, content));
    expect(validateNativeCardFrontendModules(files, "frontend/main.js", api)).toEqual([]);
  });

  it("accepts every method in the shared public API table with its configured argument count", () => {
    const statements = Object.entries(api.methods).flatMap(([namespace, methods]) =>
      Object.entries(methods).map(([method, contract]) =>
        `api.${namespace}.${method}(${Array.from({ length: contract.minArguments }, () => "undefined").join(",")});`,
      ),
    ).join("\n");
    const files = [moduleFile("frontend/main.js", `export function mount({ api }) { ${statements} document.querySelector("main"); }`)];
    expect(validateNativeCardFrontendModules(files, "frontend/main.js", api)).toEqual([]);
  });

  it("checks every frontend module's syntax and enforces the configured mount export", () => {
    const files = [
      moduleFile("frontend/main.js", `export default function mount({ api }) { api.chat.send({ text: "hi" }); }
export function extra() {}`),
      moduleFile("frontend/broken.js", "export function help( { return 2; }"),
    ];
    const issues = validateNativeCardFrontendModules(files, "frontend/main.js", api);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "frontend/main.js", code: "NATIVE_CARD_FRONTEND_MODULE_INVALID" }),
      expect.objectContaining({ path: "frontend/broken.js", code: "NATIVE_CARD_FRONTEND_MODULE_INVALID" }),
    ]));
    const invalidContext = validateNativeCardFrontendModules([
      moduleFile("frontend/main.js", 'export function mount({ api, container }) { api.chat.send({ text: "hi" }); }'),
    ], "frontend/main.js", api);
    expect(invalidContext.some((issue) => issue.expected?.includes("mount context exposes only"))).toBe(true);
  });

  it("rejects unknown API namespaces, methods, dynamic keys, and invalid argument counts", () => {
    const files = [moduleFile("frontend/main.js", `export function mount({ api }) {
      api.private.send();
      api.chat.privateMethod();
      api.chat.send();
      api["chat"][name]();
      const chat = api.chat;
      chat.privateMethod();
    }`)];
    const issues = validateNativeCardFrontendModules(files, "frontend/main.js", api);
    expect(issues.some((issue) => issue.expected?.includes("private.send"))).toBe(true);
    expect(issues.some((issue) => issue.expected?.includes("chat.privateMethod"))).toBe(true);
    expect(issues.some((issue) => issue.expected?.includes("send() accepts 1 argument"))).toBe(true);
    expect(issues.some((issue) => issue.expected?.includes("static property names"))).toBe(true);
    expect(issues.some((issue) => issue.expected?.includes("namespace reference"))).toBe(true);
  });

  it("validates relative JavaScript and JSON imports against declared package files", () => {
    const files = [
      moduleFile("frontend/main.js", 'import { label } from "./helpers.js"; import payload from "../data/payload.json" with { type: "json" }; export function mount({ api }) { api.data.get(payload[label]); }'),
      moduleFile("frontend/helpers.js", 'export const label = "greeting";'),
      moduleFile("data/payload.json", '{"greeting":"hello"}'),
    ];
    expect(validateNativeCardFrontendModules(files, "frontend/main.js", api)).toEqual([]);

    const invalid = [
      moduleFile("frontend/main.js", 'import { missing } from "../backend/validate.js"; export function mount({ api }) { api.chat.send({ text: missing }); }'),
      moduleFile("backend/validate.js", "export function validate() {}"),
    ];
    const issues = validateNativeCardFrontendModules(invalid, "frontend/main.js", api);
    expect(issues.some((issue) => issue.expected?.includes("only modules under frontend/"))).toBe(true);
    const missing = validateNativeCardFrontendModules([
      moduleFile("frontend/main.js", 'import { missing } from "./missing.js"; export function mount({ api }) { api.chat.send({ text: missing }); }'),
    ], "frontend/main.js", api);
    expect(missing.some((issue) => issue.expected?.includes("existing package file"))).toBe(true);
  });

  it("parses package scripts without executing source code", () => {
    delete (globalThis as Record<string, unknown>).__nativeCardFrontendStaticCheckExecuted;
    const files = [moduleFile("frontend/main.js", "globalThis.__nativeCardFrontendStaticCheckExecuted = true; export function mount({ api }) { api.history.latest(); }")];
    const issues = validateNativeCardFrontendModules(files, "frontend/main.js", api);
    expect(issues).toEqual([]);
    expect((globalThis as Record<string, unknown>).__nativeCardFrontendStaticCheckExecuted).toBeUndefined();
  });
});
