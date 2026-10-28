import { describe, it, expect } from "vitest";
import { createPresetOutput, presetOutputSchema } from "../preset-output.js";
const policy = {
  version: 1,
  delivery: "complete",
  rules: [
    {
      sourceRuleId: "preset-rule",
      pattern: "^[\\s\\S]*END:",
      flags: "g",
      replacement: "",
    },
  ],
};
describe("preset output delivery", () => {
  it("passes unconfigured text incrementally and at completion", () => {
    const p = createPresetOutput(undefined);
    expect(p.project("hello", "streaming")).toBe("hello");
    expect(p.project("hello", "completed")).toBe("hello");
  });
  it("buffers whole-response rules and extracts only the last body boundary", () => {
    const p = createPresetOutput(policy);
    const raw = "example END:wrong\nactual END:body";
    for (let n = 0; n <= raw.length; n++)
      expect(p.project(raw.slice(0, n), "streaming")).toBe("");
    expect(p.project(raw, "completed")).toBe("body");
    expect(p.project(raw, "completed")).toBe("body");
    expect(p.project("", "completed")).toBe("");
  });
  it("preserves card markup and rule order", () => {
    const p = createPresetOutput({
      ...policy,
      rules: [
        ...policy.rules,
        {
          sourceRuleId: "comment",
          pattern: "<!--.*?-->",
          flags: "g",
          replacement: "",
        },
      ],
    });
    expect(
      p.project(
        "END:<gametext><!--comment-->[bg|school]</gametext>",
        "completed",
      ),
    ).toBe("<gametext>[bg|school]</gametext>");
  });
  it("rejects malformed policies and patterns", () => {
    expect(() =>
      presetOutputSchema.parse({ ...policy, delivery: "guess" }),
    ).toThrow();
    expect(() =>
      createPresetOutput({
        ...policy,
        rules: [{ ...policy.rules[0], pattern: "[" }],
      }),
    ).toThrow();
    expect(() => createPresetOutput(null)).toThrow();
  });
});

it("streams body before completion and holds split protocol tokens and private blocks", () => {
  const p = createPresetOutput({
    version: 1,
    delivery: "streaming",
    streaming: {
      startMarkers: ["BODY:"],
      hiddenBlocks: [
        { start: "<!--", end: "-->" },
        { start: "<thinking>", end: "</thinking>" },
      ],
      removedTokens: ["</正文>"],
    },
    rules: [
      {
        sourceRuleId: "body",
        pattern: "^[\\s\\S]*BODY:",
        flags: "g",
        replacement: "",
      },
    ],
  });
  expect(p.project("private reasoning BO", "streaming")).toBe("");
  expect(p.project("private reasoning BODY:hello", "streaming")).toBe("hello");
  expect(p.project("BODY:hello<!", "streaming")).toBe("hello");
  expect(p.project("BODY:hello<!--private", "streaming")).toBe("hello");
  expect(p.project("BODY:hello<!--private-->world</正", "streaming")).toBe(
    "helloworld",
  );
  expect(
    p.project("BODY:hello<thinking>secret</thinking>world</正文>", "streaming"),
  ).toBe("helloworld");
  expect(() =>
    presetOutputSchema.parse({
      version: 1,
      delivery: "streaming",
      rules: [{ sourceRuleId: "x", pattern: "x", flags: "g", replacement: "" }],
    }),
  ).toThrow();
});

it("holds whitespace-prefixed content headers until their closing delimiter", () => {
  const p = createPresetOutput({
    ...policy,
    delivery: "streaming",
    streaming: {
      startMarkers: ["END:"],
      removedTokens: [],
      hiddenBlocks: [{ start: "<content>", startSuffix: "##", end: "---" }],
    },
  });
  for (const gap of ["", " ", "\n", "\r\n\t"]) {
    expect(p.project("END:body<content>" + gap, "streaming")).toBe("body");
    expect(p.project("END:body<content>" + gap + "#", "streaming")).toBe(
      "body",
    );
    expect(
      p.project("END:body<content>" + gap + "## private header", "streaming"),
    ).toBe("body");
    expect(
      p.project(
        "END:body<content>" + gap + "## private header---visible",
        "streaming",
      ),
    ).toBe("bodyvisible");
  }
  expect(p.project("END:<content>plain body", "streaming")).toBe(
    "<content>plain body",
  );
});

it("does not publish a quoted body marker from preparation text", () => {
  const p = createPresetOutput({
    ...policy,
    delivery: "streaming",
    streaming: {
      startMarkers: ["END:"],
      startMarkerLineBreak: true,
      hiddenBlocks: [
        { start: "<!--", end: "-->", removeFollowingWhitespace: true },
      ],
      removedTokens: [],
    },
  });
  expect(
    p.project('Instructions: say "END:", then write the body.', "streaming"),
  ).toBe("");
  expect(
    p.project(
      'Instructions: say "END:", then write the body.END:',
      "streaming",
    ),
  ).toBe("");
  expect(
    p.project(
      'Instructions: say "END:", then write the body.END:\nhello<!--comment-->\nworld',
      "streaming",
    ),
  ).toBe("\nhelloworld");
});
