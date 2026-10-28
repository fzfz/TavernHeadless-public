import { describe, expect, it } from "vitest";
import {
  precheckSourceFixture as precheckCard,
  completeSourceFixture,
} from "./source-fixtures.ts";
import { validateSourceCard } from "./source-format.ts";

const card = (data: Record<string, unknown>) => ({
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: { name: "人物", ...data },
});

describe("begin pending source values", () => {
  it("skips known empty settings without changing the source", () => {
    const source = card({
      avatar: "none",
      fav: false,
      talkativeness: 0,
      extensions: {
        world: "",
        depth_prompt: { prompt: "", depth: 4, role: "system" },
        tavern_helper: { variables: {} },
      },
    });
    const before = structuredClone(source);

    const result = precheckCard(source);

    expect(result.pending).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(source).toEqual(before);
  });

  it.each([
    ["avatar", "portrait.png"],
    ["avatar", "NONE"],
    ["avatar", null],
  ])("keeps non-placeholder %s for review", (key, value) => {
    expect(precheckCard(card({ [key]: value })).pending).toContainEqual(
      expect.objectContaining({ pointer: `/data/${key}` }),
    );
  });

  it.each([
    ["world", "关联世界书"],
    ["world", null],
    ["depth_prompt", { prompt: "提示", depth: 4, role: "system" }],
    ["depth_prompt", { prompt: "", custom: "设置" }],
    ["depth_prompt", null],
  ])("keeps nonempty extension %s for review", (key, value) => {
    expect(
      precheckCard(card({ extensions: { [key as string]: value } })).pending,
    ).toContainEqual(
      expect.objectContaining({ pointer: `/data/extensions/${key as string}` }),
    );
  });

  it.each([{ variables: {} }, [["variables", {}]]])(
    "skips empty helper-variable objects",
    (helper) => {
      expect(
        precheckCard(card({ extensions: { tavern_helper: helper } })).pending,
      ).toEqual([]);
    },
  );

  it("keeps nonempty helper variables and script source values for review", () => {
    const result = precheckCard(
      card({
        extensions: {
          tavern_helper: {
            variables: { mood: "calm" },
            scripts: [{ content: "保留脚本原文" }],
          },
        },
      }),
    );

    expect(result.pending.map((item) => item.pointer)).toEqual([
      "/data/extensions/tavern_helper/variables",
      "/data/extensions/tavern_helper/scripts/0",
    ]);
  });

  it("keeps unknown extension values in the pending index", () => {
    const result = precheckCard(
      card({
        first_mes: "",
        character_book: { entries: [], extensions: { custom: { flag: true } } },
        extensions: {
          unknown: {},
          tavern_helper: { other: {} },
        },
      }),
    );

    expect(result.pending.map((item) => item.pointer)).toEqual([
      "/data/character_book/extensions/custom",
      "/data/extensions/unknown",
      "/data/extensions/tavern_helper/other",
    ]);
  });

  it("rejects malformed source fields before mapping extension content", () => {
    const source = completeSourceFixture(
      card({
        alternate_greetings: [false],
        character_book: { entries: 3 },
        extensions: { regex_scripts: 1 },
      }),
    );
    const result = validateSourceCard(source);
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error("应拒绝错误源字段");
    expect(result.issues.map((item) => item.pointer)).toEqual([
      "/data/alternate_greetings/0",
      "/data/character_book/entries",
    ]);
    const valid = card({ extensions: { regex_scripts: 1 } });
    expect(precheckCard(valid).issues.map((item) => item.pointer)).toEqual([
      "/data/extensions/regex_scripts",
    ]);
  });
});
