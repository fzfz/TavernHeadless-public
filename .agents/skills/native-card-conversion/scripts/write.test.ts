import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { nativeCardWorldbookEntrySchema } from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { parseWorldBook } from "../../../../packages/adapters-sillytavern/src/parsers/worldbook-parser.ts";
import { triggerWorldBook } from "../../../../packages/adapters-sillytavern/src/worldbook/trigger-engine.ts";
import { begin } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import { commandStderr, readCommandData } from "./cli-test-result.ts";
import { mapEntry, mapEntryFile } from "./write.ts";

const run = promisify(execFile);
const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function entry(fields: Record<string, unknown> = {}) {
  return {
    id: 7,
    keys: ["主词"],
    insertion_order: 100,
    enabled: true,
    position: "before_char",
    content: "  正文\r\n😀\n<style>.x { color: red; }</style>\n<% code %>",
    ...fields,
  };
}
function mapped(fields: Record<string, unknown> = {}, copy = true) {
  return mapEntry([entry(fields)], 0, "/data/character_book/entries", copy);
}
async function fixture(entries: unknown[] = [entry()]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "map entry ")));
  cleanup.push(directory);
  const input = join(directory, "card.json");
  await writeFile(
    input,
    JSON.stringify(
      completeSourceFixture({ name: "角色", character_book: { entries } }),
    ),
  );
  const begun = await begin(input);
  const task = {
    ...(await readTaskContext(begun.taskFile)),
    taskFile: begun.taskFile,
  };
  cleanup.push(task.outputDirectory);
  const target = join(
    task.packageDirectory,
    "worldbooks",
    "book-0",
    "entries",
    "e0.json",
  );
  return { directory, task, target };
}

describe("map-entry deterministic fields", () => {
  it("maps fields, declared defaults and original text to the formal entry schema", () => {
    const result = mapped();
    expect(result.issues).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.entry).toEqual({
      uid: 7,
      key: ["主词"],
      keysecondary: [],
      selective: false,
      constant: false,
      comment: "",
      order: 100,
      disable: false,
      position: 0,
      selectiveLogic: 0,
      depth: 4,
      role: 0,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      excludeRecursion: false,
      preventRecursion: false,
      delayUntilRecursion: 0,
      outletName: "",
      content: entry().content,
    });
    expect(nativeCardWorldbookEntrySchema.parse(result.entry)).toEqual(
      result.entry,
    );
  });
  it.each([true, false])("inverts enabled=%s", (enabled) => {
    expect(mapped({ enabled }).entry.disable).toBe(!enabled);
  });
  it("uses the source consumer's disabled state when enabled is absent", () => {
    expect(mapped({ enabled: undefined }).entry.disable).toBe(true);
  });
  it.each(["before_char", "after_char", undefined])(
    "maps source position %j",
    (position) => {
      expect(mapped({ position }).entry.position).toBe(
        position === "before_char" ? 0 : 1,
      );
    },
  );
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "gives numeric extension position %s priority",
    (position) => {
      expect(
        mapped({ position: "after_char", extensions: { position } }).entry
          .position,
      ).toBe(position);
    },
  );
  it("uses source position when the extension position is null", () => {
    expect(mapped({ extensions: { position: null } }).entry.position).toBe(0);
  });
  it.each([0, 1, 2])("preserves role %s", (role) => {
    expect(mapped({ extensions: { role } }).entry.role).toBe(role);
  });
  it.each([false, true, 0, 1, 4])("maps recursion delay %j", (delay) => {
    expect(
      mapped({ extensions: { delay_until_recursion: delay } }).entry
        .delayUntilRecursion,
    ).toBe(Number(delay));
  });
  it("copies metadata and extended matching configuration", () => {
    const result = mapped({
      secondary_keys: ["次词"],
      selective: true,
      constant: true,
      comment: "[initvar] 原名",
      insertion_order: -2,
      extensions: {
        selectiveLogic: 3,
        depth: 0,
        scan_depth: 0,
        case_sensitive: false,
        match_whole_words: true,
        exclude_recursion: true,
        prevent_recursion: true,
        outlet_name: "命名出口",
      },
    });
    expect(result.entry).toMatchObject({
      keysecondary: ["次词"],
      selective: true,
      constant: true,
      comment: "[initvar] 原名",
      order: -2,
      selectiveLogic: 3,
      depth: 0,
      scanDepth: 0,
      caseSensitive: false,
      matchWholeWords: true,
      excludeRecursion: true,
      preventRecursion: true,
      outletName: "命名出口",
    });
    expect(result.issues).toEqual([]);
  });
  it("preserves supported runtime extensions and zero/false/null values", () => {
    const extensions = {
      probability: 0,
      useProbability: false,
      group: "组",
      group_override: true,
      group_weight: null,
      triggers: ["normal"],
      delay: 0,
      match_persona_description: true,
      match_character_description: false,
      match_character_personality: true,
      match_character_depth_prompt: false,
      match_scenario: true,
      match_creator_notes: false,
      ignore_budget: true,
    };
    const result = mapped({ extensions });
    expect(result.entry.extra).toEqual({ extensions });
    expect(result.issues).toEqual([]);
  });
  it.each([
    [{ keys: "bad" }, "key", "/keys"],
    [{ secondary_keys: null }, "keysecondary", "/secondary_keys"],
    [{ comment: ["名称"] }, "comment", "/comment"],
    [{ enabled: 1 }, "disable", "/enabled"],
    [{ selective: null }, "selective", "/selective"],
    [{ insertion_order: 1.5 }, "order", "/insertion_order"],
    [{ position: 4 }, "position", "/position"],
    [
      { extensions: { position: "before_char" } },
      "position",
      "/extensions/position",
    ],
    [{ extensions: { role: 3 } }, "role", "/extensions/role"],
    [{ extensions: { depth: -1 } }, "depth", "/extensions/depth"],
    [
      { extensions: { selectiveLogic: 4 } },
      "selectiveLogic",
      "/extensions/selectiveLogic",
    ],
    [
      { extensions: { delay_until_recursion: "1" } },
      "delayUntilRecursion",
      "/extensions/delay_until_recursion",
    ],
    [{ extensions: { scan_depth: -1 } }, "scanDepth", "/extensions/scan_depth"],
    [
      { extensions: { case_sensitive: 1 } },
      "caseSensitive",
      "/extensions/case_sensitive",
    ],
    [
      { extensions: { outlet_name: 2 } },
      "outletName",
      "/extensions/outlet_name",
    ],
    [{ content: {} }, "content", "/content"],
  ] as const)(
    "reports invalid fields without guessing a replacement %j",
    (fields, target, path) => {
      const result = mapped(fields);
      expect(result.entry).not.toHaveProperty(target);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          pointer: "/data/character_book/entries/0" + path,
        }),
      );
    },
  );
  it.each([
    { probability: 101 },
    { triggers: ["invalid"] },
    { group_weight: -1 },
    { match_scenario: "true" },
  ])("reports invalid runtime configuration %j", (extensions) => {
    const result = mapped({ extensions });
    expect(result.entry).not.toHaveProperty("extra");
    expect(result.issues).toHaveLength(1);
  });
  it("returns unmapped source positions, including escaped keys", () => {
    const result = mapped({
      use_regex: "vendor-mode",
      "custom/key": "原文",
      extensions: { sticky: 4, "~custom": { text: "原文" } },
    });
    expect(result.remaining).toEqual([
      "/data/character_book/entries/0/extensions/sticky",
      "/data/character_book/entries/0/extensions/~0custom",
      "/data/character_book/entries/0/use_regex",
      "/data/character_book/entries/0/custom~1key",
    ]);
  });
  it.each([0, 30, "editor-only", null, { invalid: "editor-only" }])(
    "discards editor display_index=%j without changing insertion order",
    (display_index) => {
      for (const location of [
        { display_index },
        { extensions: { display_index } },
        { display_index, extensions: { display_index } },
      ]) {
        const result = mapped(location);
        expect(result.remaining).toEqual([]);
        expect(result.issues).toEqual([]);
        expect(result.entry).toEqual(mapped().entry);
      }
    },
  );
  it.each([
    { use_group_scoring: false },
    { automation_id: "" },
    { vectorized: false },
    { sticky: 0 },
    { sticky: null },
    { cooldown: 0 },
    { cooldown: null },
  ])("omits disabled extension configuration %j", (extensions) => {
    const result = mapped({ extensions });
    expect(result.remaining).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.entry).toEqual(mapped().entry);
  });
  it.each([true, false, null])(
    "omits the unused root use_regex=%j flag",
    (use_regex) => {
      const result = mapped({ use_regex });
      expect(result.remaining).toEqual([]);
      expect(result.entry).toEqual(mapped().entry);
    },
  );
  it.each([true, false])(
    "preserves actual plain and regex keyword matching after removing use_regex=%s",
    (use_regex) => {
      for (const key of ["/target[0-9]+/i", "target7"]) {
        const native = nativeCardWorldbookEntrySchema.parse(
          mapped({ use_regex, keys: [key] }).entry,
        );
        const book = parseWorldBook({ entries: [native] });
        const context = {
          messages: ["TARGET7"],
          scanDepth: 2,
          caseSensitive: false,
          matchWholeWords: false,
        };
        expect(
          triggerWorldBook(book.entries, context).activated.map(
            (item) => item.uid,
          ),
        ).toEqual([7]);
        expect(
          triggerWorldBook(book.entries, { ...context, messages: ["other"] })
            .activated,
        ).toEqual([]);
        expect(native.key).toEqual([key]);
      }
    },
  );
  it.each([
    { use_group_scoring: true },
    { use_group_scoring: null },
    { use_group_scoring: "false" },
    { automation_id: "run-action" },
    { automation_id: " " },
    { automation_id: null },
    { vectorized: true },
    { vectorized: null },
    { vectorized: 0 },
    { sticky: 2 },
    { sticky: -1 },
    { sticky: "0" },
    { sticky: false },
    { cooldown: 3 },
    { cooldown: -1 },
    { cooldown: "0" },
    { cooldown: false },
  ])(
    "retains active, inherited or type-invalid extension %j for Agent judgment",
    (extensions) => {
      expect(mapped({ extensions }).remaining).toEqual([
        "/data/character_book/entries/0/extensions/" +
          Object.keys(extensions)[0],
      ]);
    },
  );
  it.each(["", 0, {}, []])(
    "retains an unknown root use_regex=%j value for Agent judgment",
    (use_regex) => {
      expect(mapped({ use_regex }).remaining).toEqual([
        "/data/character_book/entries/0/use_regex",
      ]);
    },
  );
  it("does not apply source-location rules to unrelated fields or extension placeholders", () => {
    const result = mapped({
      sticky: 0,
      unknown: null,
      extensions: { use_regex: null, unknown: false },
    });
    expect(result.remaining).toEqual([
      "/data/character_book/entries/0/extensions/use_regex",
      "/data/character_book/entries/0/extensions/unknown",
      "/data/character_book/entries/0/sticky",
      "/data/character_book/entries/0/unknown",
    ]);
  });
  it.each([
    { name: "条目名称", comment: "条目名称" },
    { name: "", comment: "" },
    { case_sensitive: false, extensions: { case_sensitive: false } },
    { case_sensitive: null, extensions: { case_sensitive: null } },
    { extensions: { uid: 7 } },
    { id: "source-id", extensions: { uid: "source-id" } },
    { extensions: { ignoreBudget: false, ignore_budget: false } },
    { extensions: { ignoreBudget: true, ignore_budget: true } },
  ])(
    "omits duplicate fields after their canonical field was mapped: %j",
    (fields) => {
      const result = mapped(fields);
      expect(result.remaining).toEqual([]);
      expect(result.issues).toEqual([]);
    },
  );
  it.each([
    { fields: { name: "名称", comment: "说明" }, path: "name" },
    { fields: { name: "名称" }, path: "name" },
    { fields: { name: null, comment: null }, path: "name" },
    { fields: { name: 4, comment: 4 }, path: "name" },
    {
      fields: { case_sensitive: false, extensions: { case_sensitive: true } },
      path: "case_sensitive",
    },
    { fields: { case_sensitive: false }, path: "case_sensitive" },
    {
      fields: {
        case_sensitive: "false",
        extensions: { case_sensitive: "false" },
      },
      path: "case_sensitive",
    },
    { fields: { extensions: { uid: 8 } }, path: "extensions/uid" },
    { fields: { id: -1, extensions: { uid: -1 } }, path: "extensions/uid" },
    {
      fields: { id: undefined, extensions: { uid: 0 } },
      path: "extensions/uid",
    },
    {
      fields: { extensions: { ignoreBudget: false, ignore_budget: true } },
      path: "extensions/ignoreBudget",
    },
    {
      fields: { extensions: { ignoreBudget: false } },
      path: "extensions/ignoreBudget",
    },
    {
      fields: { extensions: { ignoreBudget: "false", ignore_budget: "false" } },
      path: "extensions/ignoreBudget",
    },
  ])(
    "retains conflicting, unsupported or unrepresented aliases: %j",
    ({ fields, path }) => {
      expect(mapped(fields).remaining).toContain(
        "/data/character_book/entries/0/" + path,
      );
    },
  );
  it.each([true, false, null, "editor-only", { display: true }])(
    "ignores addMemo=%j in editor metadata locations",
    (addMemo) => {
      for (const fields of [{ addMemo }, { extensions: { addMemo } }]) {
        const result = mapped(fields);
        expect(result.remaining).toEqual([]);
        expect(result.issues).toEqual([]);
        expect(result.entry).toEqual(mapped().entry);
      }
    },
  );
  it("omits unconsumed extensions without overriding formal runtime fields", () => {
    const result = mapped({
      extensions: {
        secondary_keys_logic: "any",
        selectiveLogic: 3,
        weight: 10,
        group_weight: 100,
        cfSortKey: 4,
        display_index: 9,
      },
    });
    expect(result.remaining).toEqual([]);
    expect(result.entry.selectiveLogic).toBe(3);
    expect(result.entry.extra).toEqual({ extensions: { group_weight: 100 } });
    expect(result.entry.order).toBe(100);
    expect(result.entry).not.toHaveProperty("weight");
    expect(result.entry).not.toHaveProperty("cfSortKey");
    expect(result.entry).not.toHaveProperty("secondary_keys_logic");
  });
  it.each(["secondary_keys_logic", "weight", "cfSortKey"])(
    "ignores unused extension %s for all values while preserving other locations",
    (field) => {
      for (const value of [null, false, 0, "custom", [], { data: true }]) {
        expect(mapped({ extensions: { [field]: value } }).remaining).toEqual(
          [],
        );
        expect(mapped({ [field]: value }).remaining).toEqual([
          "/data/character_book/entries/0/" + field,
        ]);
      }
    },
  );
  it("omits content when copying was not requested", () => {
    expect(mapped({ content: {} }, false).entry).not.toHaveProperty("content");
    expect(mapped({ content: {} }, false).issues).toEqual([]);
  });
  it.each([null, [], "bad"])(
    "reports non-object extensions %j",
    (extensions) => {
      const result = mapped({ extensions });
      expect(result.issues).toEqual([
        expect.objectContaining({
          pointer: "/data/character_book/entries/0/extensions",
        }),
      ]);
      expect(result.entry.depth).toBe(4);
    },
  );
  it.each([
    "selectiveLogic",
    "depth",
    "role",
    "exclude_recursion",
    "prevent_recursion",
    "outlet_name",
  ])("reports explicit null for a non-nullable extension %s", (name) => {
    const result = mapped({ extensions: { [name]: null } });
    expect(result.issues).toEqual([
      expect.objectContaining({
        pointer: "/data/character_book/entries/0/extensions/" + name,
        valueType: "null",
      }),
    ]);
  });
  it("reports a non-object sibling while retaining the selected entry", () => {
    const result = mapEntry([entry(), null], 0, "/entries", true);
    expect(result.entry.uid).toBe(7);
    expect(result.issues[0]?.pointer).toBe("/entries/1");
  });
  it("does not mutate entries or embedded values", () => {
    const entries = [entry({ extensions: { depth: 4 } })];
    const original = structuredClone(entries);
    mapEntry(entries, 0, "/entries", true);
    expect(entries).toEqual(original);
  });
});

describe("map-entry UID allocation", () => {
  it("reserves numeric and missing IDs before allocating strings", () => {
    const entries = [
      entry({ id: "alpha" }),
      entry({ id: 0 }),
      entry({ id: undefined }),
      entry({ id: "beta" }),
      entry({ id: "0" }),
    ];
    expect(
      entries.map((_, i) => mapEntry(entries, i, "/entries", false).entry.uid),
    ).toEqual([1, 0, 2, 3, 4]);
  });
  it.each([-1, 1.5, null, {}, true])("reports invalid ID %j", (id) => {
    const result = mapped({ id });
    expect(result.entry).not.toHaveProperty("uid");
    expect(result.issues[0]?.pointer).toBe("/data/character_book/entries/0/id");
  });
  it.each([
    [entry({ id: 1 }), entry({ id: 1 })],
    [entry({ id: "same" }), entry({ id: "same" })],
    [entry({ id: 1 }), entry({ id: undefined })],
  ])("reports duplicate IDs in the book", (first, second) => {
    const result = mapEntry([first, second], 0, "/entries", false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        pointer: "/entries/1/id",
        message: expect.stringContaining("重复"),
      }),
    );
  });
});

describe("map-entry file and CLI", () => {
  it("accepts the entry JSON produced by extract and writes an equivalent native file", async () => {
    const { task, target } = await fixture();
    const extractResult = (await readCommandData(
      (
        await run(process.execPath, [
          entrypoint,
          "extract",
          task.taskFile,
          "/character_book/entries/0",
        ])
      ).stdout,
    )) as { items: { contentFile: string }[] };
    const sourceEntry = JSON.parse(
      await readFile(extractResult.items[0]!.contentFile, "utf8"),
    );
    const actual = await readCommandData(
      (
        await run(process.execPath, [
          entrypoint,
          "map-entry",
          task.taskFile,
          "/character_book/entries/0",
          relative(task.packageDirectory, target),
          "--copy-content",
        ])
      ).stdout,
    );
    expect(actual.file).toBe(target);
    expect(actual.passed).toBe(true);
    expect(actual.issues).toEqual([]);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(
      mapEntry([sourceEntry], 0, "/character_book/entries", true).entry,
    );
  });
  it("updates only mapped configuration and preserves Agent-written content and data", async () => {
    const { task, target } = await fixture([
      entry({ extensions: { probability: 20 } }),
    ]);
    await mkdir(join(task.packageDirectory, "worldbooks/book-0/entries"), {
      recursive: true,
    });
    await writeFile(
      target,
      JSON.stringify({
        content: "Agent拆分后的原文",
        extra: {
          note: "自有资料",
          extensions: { custom: "已处理", probability: 1 },
        },
      }),
    );
    await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      false,
    );
    const result = JSON.parse(await readFile(target, "utf8"));
    expect(result.content).toBe("Agent拆分后的原文");
    expect(result.extra).toEqual({
      note: "自有资料",
      extensions: { custom: "已处理", probability: 20 },
    });
    await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      true,
    );
    expect(JSON.parse(await readFile(target, "utf8")).content).toBe(
      entry().content,
    );
  });
  it("keeps the entry file unchanged and returns issues for invalid values", async () => {
    const { task, target } = await fixture([entry({ comment: ["原名称"] })]);
    await mkdir(join(task.packageDirectory, "worldbooks/book-0/entries"), {
      recursive: true,
    });
    const previous = mapEntry(
      [entry()],
      0,
      "/character_book/entries",
      false,
    ).entry;
    await writeFile(target, JSON.stringify(previous));
    const before = await readFile(target);
    const result = await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      false,
    );
    expect(result.file).toBe(target);
    expect(result.passed).toBe(false);
    expect(result.issues[0]?.pointer).toBe("/character_book/entries/0/comment");
    expect(await readFile(target)).toEqual(before);
    try {
      await run(process.execPath, [
        entrypoint,
        "map-entry",
        task.taskFile,
        "/character_book/entries/0",
        relative(task.packageDirectory, target),
      ]);
      throw new Error("Expected map-entry to exit unsuccessfully");
    } catch (error) {
      const result = await readCommandData(commandStderr(error));
      expect((error as { code: number }).code).toBe(1);
      expect(result).toMatchObject({
        passed: false,
        issues: [
          expect.objectContaining({
            pointer: "/character_book/entries/0/comment",
          }),
        ],
      });
    }
  });
  it.each([
    "/name",
    "/character_book/entries/01",
    "/character_book/entries/-",
    "/character_book/entries/10",
  ])("reports invalid source selection %s", async (pointer) => {
    const { task, target } = await fixture();
    await expect(
      mapEntryFile(
        task.taskFile,
        pointer,
        relative(task.packageDirectory, target),
        false,
      ),
    ).rejects.toThrow();
  });
  it.each([
    "wrong.json",
    "../outside.json",
    "character.json",
    "worldbooks/book-0/book.json",
  ])("rejects a target outside the entry file rule %s", async (name) => {
    const { task } = await fixture();
    await expect(
      mapEntryFile(task.taskFile, "/character_book/entries/0", name, false),
    ).rejects.toThrow("目标文件");
  });
  it("accepts an absolute package target and normalizes it for formal rules", async () => {
    const safeEntry = entry({ content: "普通正文" });
    const { task } = await fixture([safeEntry]);
    const target = join(
      task.packageDirectory,
      "worldbooks",
      "book-0",
      "entries",
      "e0.json",
    );
    const result = await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      target,
      false,
    );
    expect(result.file).toBe(target);
    expect(result.passed).toBe(true);
    expect(JSON.parse(await readFile(target, "utf8")).content).toBe(
      safeEntry.content,
    );
  });
  it.each([
    "worldbooks/book-0/entries/../entries/e0.json",
    "package/worldbooks/book-0/entries/e0.json",
  ])(
    "rejects parent traversal and pseudo-prefixed package paths: %s",
    async (path) => {
      const { task } = await fixture();
      await expect(
        mapEntryFile(task.taskFile, "/character_book/entries/0", path, false),
      ).rejects.toThrow("目标文件");
    },
  );
  it("rejects an absolute target outside the current package", async () => {
    const { task, directory } = await fixture();
    await expect(
      mapEntryFile(
        task.taskFile,
        "/character_book/entries/0",
        join(directory, "outside.json"),
        false,
      ),
    ).rejects.toThrow("目标文件");
  });
  it("keeps source, task and character file unchanged", async () => {
    const { task, target } = await fixture();
    const paths = [
      task.sourceFile,
      task.taskFile,
      join(task.packageDirectory, "character.json"),
    ];
    const before = await Promise.all(paths.map((file) => readFile(file)));
    await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      true,
    );
    expect(await Promise.all(paths.map((file) => readFile(file)))).toEqual(
      before,
    );
  });
  it("rejects directory and file symlinks without changing their targets", async () => {
    const { task, target, directory } = await fixture();
    const external = join(directory, "external");
    await mkdir(external);
    const entriesDirectory = join(
      task.packageDirectory,
      "worldbooks/book-0/entries",
    );
    await rm(entriesDirectory, { recursive: true, force: true });
    await symlink(external, entriesDirectory);
    await expect(
      mapEntryFile(task.taskFile, "/character_book/entries/0", target, true),
    ).rejects.toThrow("符号链接");
    await rm(entriesDirectory);
    await mkdir(entriesDirectory, { recursive: true });
    await symlink(task.sourceFile, target);
    const before = await readFile(task.sourceFile);
    const result = await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      true,
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("符号链接");
    expect(await readFile(task.sourceFile)).toEqual(before);
  });
  it("reports invalid existing target JSON instead of overwriting it", async () => {
    const { task, target } = await fixture();
    await mkdir(join(task.packageDirectory, "worldbooks/book-0/entries"), {
      recursive: true,
    });
    await writeFile(target, "[]");
    const result = await mapEntryFile(
      task.taskFile,
      "/character_book/entries/0",
      relative(task.packageDirectory, target),
      true,
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("JSON 对象");
    expect(await readFile(target, "utf8")).toBe("[]");
  });
  it("resolves a relative task path in the caller directory", async () => {
    const safeEntry = entry({ content: "普通正文" });
    const { task, target } = await fixture([safeEntry]);
    const { stdout } = await run(
      process.execPath,
      [
        entrypoint,
        "map-entry",
        "task.json",
        "/character_book/entries/0",
        relative(task.packageDirectory, target),
      ],
      { cwd: task.outputDirectory },
    );
    expect((await readCommandData(stdout)).file).toBe(target);
    expect(JSON.parse(await readFile(target, "utf8")).content).toBe(
      safeEntry.content,
    );
  });
  it.each([[], ["a", "b"], ["a", "b", "c", "--invalid"]])(
    "rejects invalid command arguments %j",
    async (...args) => {
      try {
        await run(process.execPath, [entrypoint, "map-entry", ...args]);
        throw new Error("Expected map-entry to fail.");
      } catch (error) {
        expect(error).toMatchObject({ code: 1 });
        const result = await readCommandData(commandStderr(error));
        expect(result.error).toBeTypeOf("string");
        expect(result.action).toContain("map-entry");
        expect(result.error).toContain("示例");
      }
    },
  );
});
