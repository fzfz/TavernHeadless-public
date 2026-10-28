import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { nativeCardFileRules, type NativeCardPackageFile } from "@tavern/shared";
import { validateNativeCardModules } from "../module-static-checker.js";

function moduleFile(path: string, content: string): NativeCardPackageFile {
  return { path, content: Buffer.from(content, "utf8") };
}

describe("native card backend module static checks", () => {
  it("accepts documented entry exports and a relative same-package module import", () => {
const files = [
      moduleFile(
        "backend/variable-tools/derive.js",
        'import { validate } from "../validators/validate.js";\nexport function derive({ candidate }) { const next = { ...candidate }; return next; }',
      ),
      moduleFile(
        "backend/validators/validate.js",
        "export function validate({ before, candidate, sourceMessages, priorFacts, floorBefore, facts }) { return { issues: [] }; }",
      ),
      moduleFile(
        "backend/controllers/prompt.js",
        "export async function renderController({ bookId, entryId, variables, characterBook }) { return { text: String(variables.location), referencedEntryIds: [entryId] }; }",
      ),
    ];
    expect(validateNativeCardModules(files, nativeCardFileRules.backendModuleApi)).toEqual([]);
  });

  it("accepts a named context parameter, package JSON imports and the complete harbor fixture", async () => {
    const jsonFiles = [
      moduleFile("backend/variable-tools/derive.js", 'import limits from "../../data/limits.json" with { type: "json" }; export function derive(context) { return context.candidate.score < limits.max ? context.candidate : context.before; }'),
      moduleFile("data/limits.json", '{"max":100}'),
    ];
    expect(validateNativeCardModules(jsonFiles, nativeCardFileRules.backendModuleApi)).toEqual([]);

    const fixture = JSON.parse(await readFile(new URL("../../../../test/fixtures/native-card/harbor.files.json", import.meta.url), "utf8")) as Record<string, string>;
    const files = Object.entries(fixture).map(([path, content]) => moduleFile(path, content));
    expect(validateNativeCardModules(files, nativeCardFileRules.backendModuleApi)).toEqual([]);
  });

  it("accepts local values in shorthand and explicit object properties", () => {
    const sources = [
      "export function validate({ candidate }) { const issues = []; return { issues }; }",
      "export function validate({ candidate }) { const issues = []; return { issues: issues }; }",
    ];
    for (const source of sources) {
      expect(validateNativeCardModules([
        moduleFile("backend/validators/validate.js", source),
      ], nativeCardFileRules.backendModuleApi)).toEqual([]);
    }
  });

  it("keeps nested context parameters separate from the entry context", () => {
    const source = [
      "export function validate(context) {",
      "  function normalize(context) { return context; }",
      "  return { issues: normalize([]) };",
      "}",
    ].join("\n");
    expect(validateNativeCardModules([
      moduleFile("backend/validators/validate.js", source),
    ], nativeCardFileRules.backendModuleApi)).toEqual([]);
  });

  it.each([
    ["destructured values", "export function validate({ candidate }) { const { issues } = candidate; return { issues }; }"],
    ["renamed destructured values", "export function validate(context) { const { issues: local } = context.candidate; return { issues: local }; }"],
    ["renamed helper parameters", "export function validate(context) { function normalize({ issues: local }) { return local; } return { issues: normalize(context.candidate) }; }"],
    ["computed destructuring with a local key", "export function validate(context) { const key = 'issues'; const { [key]: local } = context.candidate; return { issues: local }; }"],
    ["destructuring assignment defaults", "export function validate(context) { let issues; const fallback = []; ({ issues = fallback } = context.candidate); return { issues }; }"],
    ["closure values", "export function validate({ candidate }) { const issues = []; function result() { return { issues }; } return result(); }"],
    ["nested local context values", "export function validate(context) { { const context = []; return { issues: context }; } }"],
    ["nested local context shorthand", "export function validate(context) { function result(context) { return { context }; } return { issues: result([]).context }; }"],
    ["nested local context properties", "export function validate(context) { function result(context) { return context.privateField; } return { issues: result({ privateField: [] }) }; }"],
    ["allowed global shorthand", "export function validate({ candidate }) { const helpers = { Math }; return { issues: helpers.Math.max(0, 1) > 0 ? [] : [] }; }"],
    ["documented context fields", "export function validate(context) { return { issues: context.candidate.issues }; }"],
  ])("accepts %s through their own variable bindings", (_name, source) => {
    expect(validateNativeCardModules([
      moduleFile("backend/validators/validate.js", source),
    ], nativeCardFileRules.backendModuleApi)).toEqual([]);
  });

  it.each([
    {
      name: "undeclared computed destructuring key",
      source: "export function validate(context) {\n  const { [missingKey]: local } = context.candidate;\n  return { issues: local };\n}",
      expected: "Global missingKey is not part of the role module API.",
      line: 2,
      column: 12,
    },
    {
      name: "undeclared computed parameter key",
      source: "export function validate(context) {\n  function pick({ [missingKey]: local }) { return local; }\n  return { issues: pick(context.candidate) };\n}",
      expected: "Global missingKey is not part of the role module API.",
      line: 2,
      column: 20,
    },
    {
      name: "prohibited global assignment default",
      source: "export function validate(context) {\n  let issues; ({ issues = process } = context.candidate);\n  return { issues };\n}",
      expected: "Global process is not part of the role module API.",
      line: 2,
      column: 27,
    },
    {
      name: "whole entry context assignment default",
      source: "export function validate(context) {\n  let issues; ({ issues = context } = context.candidate);\n  return { issues };\n}",
      expected: "Read the role API through one of the documented top-level context fields.",
      line: 2,
      column: 27,
    },
    {
      name: "undeclared shorthand",
      source: "export function validate({ candidate }) {\n  return { missingIssues };\n}",
      expected: "Global missingIssues is not part of the role module API.",
      line: 2,
      column: 12,
    },
    {
      name: "out-of-scope shorthand",
      source: "export function validate({ candidate }) {\n  if (candidate) { const issues = []; }\n  return { issues };\n}",
      expected: "Global issues is not part of the role module API.",
      line: 3,
      column: 12,
    },
    {
      name: "prohibited global shorthand",
      source: "export function validate({ candidate }) {\n  return { process };\n}",
      expected: "Global process is not part of the role module API.",
      line: 2,
      column: 12,
    },
    {
      name: "entry context shorthand",
      source: "export function validate(context) {\n  return { context };\n}",
      expected: "Read the role API through one of the documented top-level context fields.",
      line: 2,
      column: 12,
    },
    {
      name: "whole entry context passed to a helper",
      source: "export function validate(context) {\n  function consume(value) { return { issues: [] }; }\n  return consume(context);\n}",
      expected: "Read the role API through one of the documented top-level context fields.",
      line: 3,
      column: 18,
    },
    {
      name: "private entry context field",
      source: "export function validate(context) {\n  return { issues: context.privateField };\n}",
      expected: "The validate context does not expose privateField.",
      line: 2,
      column: 20,
    },
    {
      name: "dynamic entry context field",
      source: "export function validate(context) {\n  const key = 'candidate';\n  return { issues: context[key].issues };\n}",
      expected: "Context fields must be selected by a static documented field name.",
      line: 3,
      column: 20,
    },
    {
      name: "closure reference to a private entry context field",
      source: "export function validate(context) {\n  function result() { return context.privateField; }\n  return { issues: result() };\n}",
      expected: "The validate context does not expose privateField.",
      line: 2,
      column: 30,
    },
  ])("rejects $name at its source position", ({ source, expected, line, column }) => {
    const issues = validateNativeCardModules([
      moduleFile("backend/validators/validate.js", source),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_MODULE_INVALID",
        path: "backend/validators/validate.js",
        expected,
        line,
        column,
      }),
    ]);
  });

  it("reports JavaScript syntax errors with source positions", () => {
    const issues = validateNativeCardModules([
      moduleFile("backend/validators/validate.js", "export function validate( { return { issues: [] }; }"),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues).toContainEqual(expect.objectContaining({
      code: "NATIVE_CARD_MODULE_INVALID",
      path: "backend/validators/validate.js",
      line: expect.any(Number),
      column: expect.any(Number),
    }));
  });

  it("requires the path-specific named export and one documented context argument", () => {
    const issues = validateNativeCardModules([
      moduleFile("backend/validators/validate.js", "export function derive(context) { return context.candidate; }"),
      moduleFile("backend/variable-tools/derive.js", "export default function derive(context) { return context.candidate; }"),
      moduleFile("backend/controllers/prompt.js", "export function renderController(context, options) { return { text: \"ok\" }; }"),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "backend/validators/validate.js",
      "backend/variable-tools/derive.js",
      "backend/controllers/prompt.js",
    ]));
    expect(issues.every((issue) => issue.code === "NATIVE_CARD_MODULE_INVALID")).toBe(true);
  });

  it("rejects undeclared context fields and ambient host APIs", () => {
    const issues = validateNativeCardModules([
      moduleFile(
        "backend/validators/validate.js",
        "export function validate(context) { process.exit(1); return { issues: context.privateApi() }; }",
      ),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "backend/validators/validate.js", code: "NATIVE_CARD_MODULE_INVALID", line: 1 }),
    ]));
    expect(issues.some((issue) => issue.expected?.includes("process"))).toBe(true);
    expect(issues.some((issue) => issue.expected?.includes("privateApi"))).toBe(true);
  });

  it("rejects external, missing, traversing and dynamic module imports", () => {
    const issues = validateNativeCardModules([
      moduleFile(
        "backend/variable-tools/derive.js",
        'import fs from "node:fs"; import { helper } from "./missing.js"; export async function derive(context) { const x = await import("./dynamic.js"); return context.candidate; }',
      ),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });

  it("parses module code without executing any source", () => {
    delete (globalThis as Record<string, unknown>).__nativeCardStaticCheckExecuted;
    const issues = validateNativeCardModules([
      moduleFile(
        "backend/variable-tools/derive.js",
        "globalThis.__nativeCardStaticCheckExecuted = true; export function derive({ candidate }) { return candidate; }",
      ),
    ], nativeCardFileRules.backendModuleApi);
    expect(issues.length).toBeGreaterThan(0);
    expect((globalThis as Record<string, unknown>).__nativeCardStaticCheckExecuted).toBeUndefined();
  });
});
