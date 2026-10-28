import { describe, expect, it } from "vitest";
import { precheckSourceFixture as precheckCard } from "./source-fixtures.ts";

function card(data: Record<string, unknown>, mirrors = {}) {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { name: "测试角色", ...data },
    ...mirrors,
  };
}

function pendingPaths(result: ReturnType<typeof precheckCard>) {
  return result.pending.map((item) => item.pointer);
}

describe("known source aliases", () => {
  it.each(["", "作者原文\n  保留空白"])(
    "processes matching author notes once: %s",
    (text) => {
      const result = precheckCard(
        card(
          { creator_notes: text, creatorcomment: text },
          { creatorcomment: text },
        ),
      );
      expect(result.issues).toEqual([]);
      expect(pendingPaths(result)).not.toContain("/creatorcomment");
      expect(pendingPaths(result)).not.toContain("/data/creatorcomment");
      expect(result.character.creatorNotes).toBe(text);
      expect(pendingPaths(result)).toEqual([]);
      expect(
        result.written.filter((item) => item.targetPointer === "/creatorNotes"),
      ).toEqual([
        {
          sourcePointer: "/data/creator_notes",
          targetPointer: "/creatorNotes",
        },
      ]);
    },
  );
  it.each([
    ["原文", "另一份原文"],
    ["", null],
    ["0", 0],
  ])(
    "returns author-note conflicts without choosing a value: %s / %s",
    (canonical, alias) => {
      const result = precheckCard(
        card({ creator_notes: canonical }, { creatorcomment: alias }),
      );
      expect(pendingPaths(result)).toEqual([
        "/data/creator_notes",
        "/creatorcomment",
      ]);
      expect(result.character).not.toHaveProperty("creatorNotes");
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.pointer).toBe("/creatorcomment");
      expect(result.issues[0]?.message).toContain("/data/creator_notes");
    },
  );
  it("deduplicates matching aliases even when a third value conflicts", () => {
    const result = precheckCard(
      card(
        { creator_notes: "原文", creatorcomment: "原文" },
        { creatorcomment: "另一个值" },
      ),
    );
    expect(pendingPaths(result)).toEqual([
      "/data/creator_notes",
      "/creatorcomment",
    ]);
    expect(result.issues).toHaveLength(1);
  });
  it("keeps all distinct alias values", () => {
    const result = precheckCard(
      card(
        { creator_notes: "甲", creatorcomment: "乙" },
        { creatorcomment: "丙" },
      ),
    );
    expect(pendingPaths(result)).toEqual([
      "/data/creator_notes",
      "/data/creatorcomment",
      "/creatorcomment",
    ]);
    expect(result.issues).toHaveLength(2);
  });
  it.each([
    { name: "测试角色", creatorcomment: "作者原文" },
    card({ creator_notes: "作者原文", creatorcomment: "作者原文" }),
    card({ creator_notes: "作者原文" }, { creatorcomment: "作者原文" }),
  ])(
    "maps standalone author notes using the actual source pointer",
    (source) => {
      const original = structuredClone(source);
      const result = precheckCard(source);
      expect(result.character.creatorNotes).toBe("作者原文");
      const path = "data" in source ? "/data/creator_notes" : "/creatorcomment";
      expect(result.written).toContainEqual({
        sourcePointer: path,
        targetPointer: "/creatorNotes",
      });
      expect(source).toEqual(original);
    },
  );
  it("keeps author notes with variable-protocol markers for review", () => {
    const result = precheckCard({
      name: "测试角色",
      creatorcomment: "[mvu_update]原文",
    });
    expect(pendingPaths(result)).toEqual(["/creatorcomment"]);
    expect(result.character).not.toHaveProperty("creatorNotes");
    expect(result.pending[0]?.matches).toContainEqual({
      pointer: "/creatorcomment",
      feature: "MVU标记",
    });
  });
  it("reports an invalid standalone author-note type", () => {
    const result = precheckCard({ name: "测试角色", creatorcomment: null });
    expect(pendingPaths(result)).toEqual(["/creatorcomment"]);
    expect(result.issues[0]?.pointer).toBe("/creatorcomment");
    expect(result.character).not.toHaveProperty("creatorNotes");
  });
  it("uses the canonical author-note pointer when fields arrive in another order", () => {
    const result = precheckCard(
      card(
        { creatorcomment: "原文", creator_notes: "原文" },
        { creator_notes: "原文", creatorcomment: "原文" },
      ),
    );
    expect(
      result.written.filter((item) => item.targetPointer === "/creatorNotes"),
    ).toEqual([
      { sourcePointer: "/data/creator_notes", targetPointer: "/creatorNotes" },
    ]);
    expect(result.pending).toEqual([]);
  });
});

describe.each(["fav", "talkativeness"])("excluded source field %s", (field) => {
  it.each([false, true, "true", null, { arbitrary: "value" }])(
    "excludes every known field location regardless of value: %s",
    (value) => {
      const source = card(
        { [field]: value, extensions: { [field]: value, other: "保留" } },
        { [field]: !value },
      );
      const original = structuredClone(source);
      const result = precheckCard(source);
      expect(result.character).toMatchObject({ name: "测试角色" });
      expect(pendingPaths(result)).toEqual(["/data/extensions/other"]);
      expect(result.issues).toEqual([]);
      expect(source).toEqual(original);
    },
  );
  it("excludes source metadata from unwrapped cards", () => {
    expect(
      precheckCard({
        name: "测试角色",
        [field]: true,
        extensions: { [field]: false },
      }).pending,
    ).toEqual([]);
  });
  it("excludes root extension metadata in wrapped cards", () => {
    const source = card({}, { extensions: { [field]: true } });
    const original = structuredClone(source);
    const result = precheckCard(source);
    expect(result.pending).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(source).toEqual(original);
  });
  it("ignores metadata differences between root and data extensions", () => {
    const result = precheckCard(
      card(
        { extensions: { [field]: false } },
        { extensions: { [field]: true } },
      ),
    );
    expect(result.pending).toEqual([]);
    expect(result.issues).toEqual([]);
  });
  it("keeps unrelated root extension contents", () => {
    const result = precheckCard(
      card(
        {},
        {
          extensions: { [field]: true, plugin: { content: "原文" } },
        },
      ),
    );
    expect(pendingPaths(result)).toEqual(["/extensions/plugin"]);
    expect(result.pending[0]?.category).toBe("extension");
  });
  it("still reports unrelated root extension conflicts", () => {
    const result = precheckCard(
      card(
        { extensions: { [field]: false, plugin: "甲" } },
        { extensions: { [field]: true, plugin: "乙" } },
      ),
    );
    expect(pendingPaths(result)).toEqual([
      "/extensions/plugin",
      "/data/extensions/plugin",
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.pointer).toBe("/extensions/plugin");
    expect(result.issues[0]?.message).toContain("/data/extensions/plugin");
  });
  it("deduplicates identical unrelated root extensions", () => {
    const result = precheckCard(
      card(
        { extensions: { [field]: false, plugin: "原文" } },
        { extensions: { [field]: true, plugin: "原文" } },
      ),
    );
    expect(pendingPaths(result)).toEqual(["/data/extensions/plugin"]);
    expect(result.issues).toEqual([]);
  });
  it("preserves unrelated extension and worldbook content", () => {
    const result = precheckCard(
      card({
        extensions: { plugin: { [field]: "插件数据" } },
        character_book: {
          entries: [
            {
              id: 0,
              keys: [],
              comment: field,
              content: "人物喜欢的物品",
              insertion_order: 100,
            },
          ],
        },
      }),
    );
    expect(pendingPaths(result)).toEqual(["/data/extensions/plugin"]);
    expect(result.worldbook?.entries[0]?.value.content).toBe("人物喜欢的物品");
  });
});
