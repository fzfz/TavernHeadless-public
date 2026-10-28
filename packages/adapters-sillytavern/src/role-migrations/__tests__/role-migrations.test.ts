import { describe, expect, it } from "vitest";
import {
  roleImportCharacterSchema,
  type MvuMigrationPlan,
  type RoleWorldbook,
  type RoleRegexSource,
} from "@tavern/shared";
import { compileRegexMigration } from "../regex.js";
import { migrateMvuToAgent, readMvuInitialVariables } from "../mvu-agent.js";
import { compileMvuController } from "../mvu-controller.js";
import { preparePresetImport } from "../preset-import.js";
import { migratePresetOutput } from "../preset-output.js";
import { importOpenings } from "../openings.js";

const plan: MvuMigrationPlan = {
  disabledEntryIds: [2, 3],
  ruleEntryIds: [2],
  readonlyPaths: ["/time"],
  cleanRuleFiles: ["rules.json"],
  controllerEntryIds: [4],
  initialEntryId: 1,
};
const book: RoleWorldbook = {
  entries: [
    { uid: 1, content: '{"score":0,"time":1}' },
    { uid: 2, comment: "Score rule", content: "Increase score by one." },
    { uid: 3, content: "Old protocol" },
    {
      uid: 4,
      content:
        '<% setvar("stat_data.time", 2); %>Time <%= getvar("stat_data.time") %>',
    },
  ],
};
function character() {
  return roleImportCharacterSchema.parse({
    name: "Role",
    greeting: "Hello",
    characterBook: book,
    extensions: {
      tavern_headless: {
        stateUpdate: {
          profile: {
            updaterPrompt: "Update",
            writablePaths: ["/score", "/time"],
            ruleFiles: ["rules.json"],
          },
          files: {
            "rules.json": JSON.stringify({
              entries: [
                { sourceId: 2, content: "Duplicate" },
                { sourceId: 9, content: "Keep" },
              ],
            }),
          },
        },
      },
    },
  });
}

describe("formal role import transforms", () => {
  it("keeps reviewed regex rules with provenance and a complete audit without changing the source", () => {
    const source: RoleRegexSource = {
      key: "role",
      kind: "character",
      name: "Role",
      resourceId: "character",
      versionId: "version",
      scripts: [
        { id: "one", findRegex: "/x/g", replaceString: "y" },
        { id: "two", findRegex: "/z/g", replaceString: "" },
      ],
    };
    const result = compileRegexMigration([source], {
      sources: {
        role: {
          rules: [
            { id: "one", name: "One", decision: "keep", reason: "Needed" },
            { id: "two", name: "Two", decision: "remove", reason: "Moved" },
          ],
        },
      },
    });
    expect(result.scripts).toHaveLength(1);
    expect(result.audit).toHaveLength(2);
    expect(result.scripts[0]).toMatchObject({
      id: "one",
      minDepth: -1,
      maxDepth: -1,
      source: {
        ruleId: "one",
        index: 0,
        resourceId: "character",
        versionId: "version",
      },
    });
    expect(source.scripts[0]).not.toHaveProperty("source");
    expect(() => compileRegexMigration([source], { sources: {} })).toThrow();
    expect(() =>
      compileRegexMigration([source], { sources: { role: { rules: [] } } }),
    ).toThrow();
    expect(() =>
      compileRegexMigration(
        [{ ...source, scripts: [source.scripts[0]!, source.scripts[0]!] }],
        {
          sources: {
            role: {
              rules: [
                { id: "one", name: "", decision: "keep", reason: "Needed" },
              ],
            },
          },
        },
      ),
    ).toThrow();
  });
  it("moves MVU rules once, retires old protocol and reserves controller paths", () => {
    const source = character();
    const result = migrateMvuToAgent(source, book, {
      ...plan,
      updaterPrompt: "New update",
      maxTokens: 400,
    });
    const update = result.snapshot.extensions.tavern_headless.stateUpdate;
    expect(update.profile).toMatchObject({
      updaterPrompt: "New update",
      maxTokens: 400,
      writablePaths: ["/score"],
      controllerOwnedPaths: ["/time"],
      ruleFiles: ["rules.json", "migrated-variable-rules.json"],
    });
    expect(JSON.parse(update.files["rules.json"]!).entries).toEqual([
      { sourceId: 9, content: "Keep" },
    ]);
    expect(
      JSON.parse(update.files["migrated-variable-rules.json"]!).entries,
    ).toHaveLength(1);
    const entries = Object.values(result.worldbook.entries);
    expect(entries.find((entry) => entry.uid === 1)).toMatchObject({
      enabled: false,
      extensions: { tavern_headlessMigration: { usage: "opening-state" } },
    });
    expect(entries.find((entry) => entry.uid === 2)).toMatchObject({
      enabled: false,
      extensions: { tavern_headlessMigration: { usage: "variable-rule" } },
    });
    expect(
      source.extensions.tavern_headless.stateUpdate.profile.writablePaths,
    ).toEqual(["/score", "/time"]);
    expect(readMvuInitialVariables(book, plan, JSON.parse)).toEqual({
      score: 0,
      time: 1,
    });
    expect(() =>
      readMvuInitialVariables(
        book,
        { ...plan, initialEntryId: 99 },
        JSON.parse,
      ),
    ).toThrow();
    expect(() => readMvuInitialVariables(book, plan, () => [])).toThrow();
  });
  it.each([
    { ...plan, ruleEntryIds: [99] },
    { ...plan, disabledEntryIds: [99] },
    { ...plan, initialEntryId: 99 },
    { ...plan, cleanRuleFiles: ["missing"] },
    { ...plan, controllerEntryIds: [99] },
  ])("rejects incomplete MVU migration references", (invalid) => {
    expect(() => migrateMvuToAgent(character(), book, invalid)).toThrow();
  });
  it("compiles reviewed controllers and preserves writes and worldbook references", async () => {
    const source = compileMvuController(
      [
        {
          uid: 4,
          content:
            '<% setvar("stat_data.time", 2); %>Time <%= getvar("stat_data.time") %> <%- await getwi("", "Event") %>',
        },
      ],
      [4],
    );
    const module = await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
    );
    expect(
      await module.renderController({
        entryId: 4,
        variables: { time: 1 },
        characterBook: {
          entries: [{ id: 8, comment: "Event", content: "Started" }],
        },
      }),
    ).toEqual({
      text: "{{setvar::stat_data.time::2}}Time 1 Started",
      referencedEntryIds: [8],
    });
    await expect(
      module.renderController({
        entryId: 4,
        variables: {},
        characterBook: { entries: [] },
      }),
    ).rejects.toThrow();
  });
  it("converts only configured preset roles and macros, preserving output rules", () => {
    const source = {
      prompts: [
        {
          identifier: "p",
          role: "model",
          content: "A{{// note}}\n{{trim}}\nB",
        },
      ],
      extensions: {
        regex_scripts: [
          {
            id: "rule",
            findRegex: "/<think>[\\s\\S]*?<\\/think>/g",
            replaceString: "",
          },
        ],
      },
    };
    const result = preparePresetImport(source, {
      roleAliases: { model: "assistant" },
      commentMacros: true,
      trimMacro: true,
    });
    expect(result.data.prompts?.[0]).toMatchObject({
      role: "assistant",
      content: "AB",
    });
    expect(result.conversions).toHaveLength(3);
    expect(source.prompts[0]?.role).toBe("model");
    expect(
      migratePresetOutput(result.data, {
        sourceRuleIds: ["rule"],
        delivery: "complete",
      }).extensions?.tavern_headless?.outputProcessing,
    ).toMatchObject({
      version: 1,
      delivery: "complete",
      rules: [{ sourceRuleId: "rule", flags: "g" }],
    });
    expect(() =>
      migratePresetOutput(source, {
        sourceRuleIds: ["missing"],
        delivery: "complete",
      }),
    ).toThrow();
    expect(() =>
      migratePresetOutput(
        {
          extensions: {
            regex_scripts: [
              { id: "rule", findRegex: "invalid", replaceString: "" },
            ],
          },
        },
        { sourceRuleIds: ["rule"], delivery: "complete" },
      ),
    ).toThrow();
    expect(
      preparePresetImport(source, {
        roleAliases: {},
        commentMacros: false,
        trimMacro: false,
      }).data,
    ).toEqual(source);
  });
  it("imports every opening and applies init variables and replacement patches without mutating originals", () => {
    const initial = { score: 0 };
    const result = importOpenings(
      {
        greeting: "Hello {{user}}",
        alternateGreetings: [
          '<initvar>{"score":1}</initvar><UpdateVariable><JSONPatch>[{"op":"replace","path":"/score","value":2}]</JSONPatch></UpdateVariable>Welcome<StatusPlaceHolderImpl/>',
        ],
      },
      {
        defaultOpeningId: "alternate-1",
        entries: { "alternate-1": { title: "Second" } },
      },
      initial,
      { parseYaml: JSON.parse, performerName: "Alice" },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.displayText).toBe("Hello Alice");
    expect(result.items[1]).toMatchObject({
      title: "Second",
      variables: { score: 2 },
    });
    expect(result.items[1]?.displayText).not.toContain("UpdateVariable");
    expect(initial).toEqual({ score: 0 });
  });
  it("preserves card display markers for the card's display rules", () => {
    for (const marker of [
      "<StatusPlaceHolderImpl/>",
      "<StatusPlaceHolderImpl />",
      "<CustomPanel/>",
    ]) {
      const greeting = `Before${marker}After`;
      const result = importOpenings(
        { greeting },
        { defaultOpeningId: "first", entries: {} },
        {},
      );
      expect(result.items[0]?.text).toBe(greeting);
      expect(result.items[0]?.displayText).toBe(greeting);
    }
  });
  it("rejects unknown openings, unavailable parsers and invalid patch paths", () => {
    const metadata = { defaultOpeningId: "first", entries: {} };
    expect(() =>
      importOpenings(
        { greeting: "" },
        { ...metadata, entries: { missing: {} } },
        {},
      ),
    ).toThrow();
    expect(() =>
      importOpenings(
        { greeting: "" },
        { defaultOpeningId: "missing", entries: {} },
        {},
      ),
    ).toThrow();
    expect(() =>
      importOpenings({ greeting: "<initvar>x</initvar>" }, metadata, {}),
    ).toThrow();
    expect(() =>
      importOpenings(
        { greeting: "<initvar>x</initvar>" },
        metadata,
        {},
        { parseYaml: () => [] },
      ),
    ).toThrow();
    for (const patch of [
      { op: "add", path: "/score", value: 2 },
      { op: "replace", path: "/missing", value: 2 },
      { op: "replace", path: "/missing/nested", value: 2 },
    ]) {
      expect(() =>
        importOpenings(
          { greeting: `<JSONPatch>${JSON.stringify([patch])}</JSONPatch>` },
          metadata,
          { score: 0 },
        ),
      ).toThrow();
    }
  });
});
