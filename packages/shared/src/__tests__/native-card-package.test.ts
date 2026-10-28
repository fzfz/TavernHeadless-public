import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateNativeCardPackage } from "../native-card-package.js";
import { nativeCardFileRules, nativeCardFileRuleSchema } from "../schemas/native-card-package/schema.js";

it("declares creation templates for author-named state updater rule files", () => {
  const rules = nativeCardFileRules.versions["1.0.0"]!.directoryRules;
  for (const [pattern, id, content] of [
    ["agents/state-update/*.json", "stateUpdateRules", { rules: [] }],
    ["agents/state-update/*.txt", "stateUpdateRulesText", ""],
  ] as const) {
    const rule = rules.find((item) => item.pathPattern === pattern)!;
    expect(rule).toHaveProperty("creationTemplateId", id);
    expect(nativeCardFileRules.creationTemplates.find((item) => item.id === id)?.content).toEqual(content);
    expect(nativeCardFileRuleSchema.safeParse({ ...rule, creationTemplateId: "" }).success).toBe(false);
  }
});

function fixtureFiles(): Map<string, string> {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../../apps/api/test/fixtures/native-card/harbor.files.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  return new Map(Object.entries(fixture));
}

function check(files: Map<string, string>) {
  return validateNativeCardPackage(
    [...files].map(([path, content]) => ({
      path,
      content: new TextEncoder().encode(content),
    })),
  );
}

function minimalFiles(extra: Record<string, unknown> = {}) {
  const contents: Record<string, unknown> = {
    "character.json": { name: "向导" },
    "openings.json": { defaultOpeningIds: {}, items: [] },
    ...extra,
  };
  const manifest = {
    format: "tavern_headless_role_package",
    formatVersion: "1.0.0",
    packageId: "minimal",
    character: "character.json",
    openings: "openings.json",
    files: Object.keys(contents).map((path) => ({
      path,
      mediaType: path.endsWith(".txt") ? "text/plain" : "application/json",
      purpose: "data",
    })),
  };
  return new Map(
    Object.entries({ ...contents, "manifest.json": manifest }).map(
      ([path, value]) => [
        path,
        typeof value === "string" ? value : JSON.stringify(value),
      ],
    ),
  );
}

it("accepts registered package directories and enables frontend files from the root manifest", () => {
  const result = check(fixtureFiles());
  expect(result.issues).toEqual([]);
  expect(result.valid).toBe(true);
  expect(result.package?.worldbooks.size).toBe(2);
  expect(result.package?.frontendManifest?.script).toBe("frontend/main.js");
  expect(result.package?.parsedJson.get("regex/first.json")).toEqual(JSON.parse(fixtureFiles().get("regex/first.json")!));
});

it("accepts a minimal conversation package without optional runtime resources", () => {
  expect(check(minimalFiles())).toMatchObject({ valid: true, issues: [] });
});

it.each(["manifest.json", "character.json", "openings.json"])("rejects missing fixed file %s", (path) => {
  const files = minimalFiles();
  files.delete(path);
  expect(check(files).valid).toBe(false);
});

it.each(["../outside.json", "/absolute.json", "data/../escape.json", "data\\escape.json", "data//empty.json"])("rejects unsafe package path %s", (path) => {
  const files = minimalFiles();
  files.set(path, "{}");
  expect(check(files).valid).toBe(false);
});

it.each(["2.0.0", "0.0.1"])("rejects unsupported format version %s", (formatVersion) => {
  const files = minimalFiles();
  const manifest = JSON.parse(files.get("manifest.json")!);
  files.set("manifest.json", JSON.stringify({ ...manifest, formatVersion }));
  expect(check(files).valid).toBe(false);
});

it("rejects duplicate manifest paths and malformed JSON", () => {
  const files = minimalFiles();
  const manifest = JSON.parse(files.get("manifest.json")!);
  manifest.files.push(manifest.files[0]);
  files.set("manifest.json", JSON.stringify(manifest));
  expect(check(files).valid).toBe(false);
  files.set("character.json", "{broken}");
  expect(check(files).valid).toBe(false);
});

it("keeps equal entry IDs in distinct worldbooks while rejecting duplicates within one book", () => {
  const files = fixtureFiles();
  const valid = check(files);
  expect(valid.valid).toBe(true);
  const book = JSON.parse(files.get("worldbooks/harbor/book.json")!);
  book.entryFiles.push(book.entryFiles[0]);
  files.set("worldbooks/harbor/book.json", JSON.stringify(book));
  expect(check(files).valid).toBe(false);
});

it("rejects non-UTF8 JSON and text files", () => {
  const source = [...minimalFiles()].map(([path, content]) => ({path,content:new TextEncoder().encode(content)}));
  source.find(f=>f.path==="character.json")!.content = new Uint8Array([0xff,0xfe]);
  expect(validateNativeCardPackage(source).valid).toBe(false);
});

it.each(["frontend/main.js", "frontend/index.html", "frontend/style.css"])("rejects non-UTF8 source file %s", (path) => {
  const source = [...fixtureFiles()].map(([path, content]) => ({path,content:new TextEncoder().encode(content)}));
  source.find(f=>f.path===path)!.content = new Uint8Array([0xff,0xfe]);
  expect(validateNativeCardPackage(source).issues).toContainEqual(expect.objectContaining({ code:"NATIVE_CARD_FILE_ENCODING_INVALID", path }));
});

it("rejects module references that point to a different backend directory", () => {
  const files = fixtureFiles();
  const profile = JSON.parse(files.get("agents/state-update/profile.json")!);
  profile.deriveScript = "backend/validators/validate.js";
  files.set("agents/state-update/profile.json", JSON.stringify(profile));
  const result = check(files);
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "NATIVE_CARD_REFERENCE_SCOPE_INVALID",
      path: "agents/state-update/profile.json",
      pointer: "/deriveScript",
    }),
  );
});

it("requires the fixed state schema whenever an opening declares initial state", () => {
  const files = minimalFiles({
    "openings.json": {
      defaultOpeningIds: { individual: "first" },
      items: [
        {
          id: "first",
          title: "相遇",
          summary: "",
          kind: "story",
          audience: "individual",
          textFile: "openings/first.txt",
          initialStateFile: "state/initial/first.json",
        },
      ],
    },
    "openings/first.txt": "向导停在门边。",
    "state/initial/first.json": { location: "门边" },
  });
  expect(check(files).issues).toContainEqual(
    expect.objectContaining({
      code: "NATIVE_CARD_FILE_MISSING",
      path: "state/schema.json",
    }),
  );
});

it("rejects variable-rule source entries that do not belong to the referenced worldbook", () => {
  const files = fixtureFiles();
  files.set(
    "agents/state-update/rules.json",
    JSON.stringify({
      rules: [
        {
          id: "source",
          instruction: "读取人物资料。",
          sourceEntries: [{ bookId: "people", entryId: 120 }],
        },
      ],
    }),
  );
  const result = check(files);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "NATIVE_CARD_REFERENCE_ENTRY_MISSING",
      path: "agents/state-update/rules.json",
      pointer: "/rules/0/sourceEntries/0/entryId",
    }),
  );
});

it("validates native frontend data keys as references to declared data JSON files", () => {
  const files = fixtureFiles();
  const frontend = JSON.parse(files.get("frontend/manifest.json")!);
  frontend.data.caseFile = "data/missing.json";
  files.set("frontend/manifest.json", JSON.stringify(frontend));
  expect(check(files).issues).toContainEqual(expect.objectContaining({ path: "frontend/manifest.json", pointer: "/data/caseFile", code: "NATIVE_CARD_REFERENCE_MISSING" }));
  frontend.data.caseFile = "state/initial/first.json";
  files.set("frontend/manifest.json", JSON.stringify(frontend));
  expect(check(files).issues).toContainEqual(expect.objectContaining({ path: "frontend/manifest.json", pointer: "/data/caseFile", code: "NATIVE_CARD_REFERENCE_SCOPE_INVALID" }));
});

it("returns configured actionable issue text while preserving schema diagnostics", () => {
  const files = fixtureFiles();
  files.set("character.json", JSON.stringify({ name: 42 }));
  const result = check(files);
  const issue = result.issues.find((entry) => entry.code === "NATIVE_CARD_FILE_SCHEMA_INVALID");
  expect(issue).toMatchObject({ path: "character.json", pointer: "/name" });
  expect(issue?.message).toContain("字段");
  expect(issue?.action).toContain("修正");
  expect(issue?.expected).toContain("expected string, received number");
});
