import { describe, expect, it } from "vitest";
import {
  analyzePageMacros,
  evaluatePageMacros,
  mountPageMacros,
  pageMacroRegistry,
  PageMacroError,
  parsePageMacros,
  validatePageMacroBindings,
} from "./page-macros.ts";

describe("page macro text evaluation", () => {
  it("expands every user placeholder and preserves names as literal text", () => {
    const performerName = "裴 修远 $& <b>🙂";
    expect(
      evaluatePageMacros("{{user}}、{{USER}}。原文", { performerName }),
    ).toBe("裴 修远 $& <b>🙂、裴 修远 $& <b>🙂。原文");
    expect(evaluatePageMacros("普通文本 {括号}", {})).toBe("普通文本 {括号}");
  });
});

describe("page macro syntax and binding admission", () => {
  it("evaluates scoped comment names and aliases with nested inline comments", () => {
    for (const template of [
      "前{{//}}隐藏文本{{///}}后",
      "前{{comment}}隐藏文本{{/comment}}后",
      "前{{comment}}隐藏文本{{///}}后",
      "前{{//}}隐藏文本{{/COMMENT}}后",
      "前{{comment}}外{{//}}内{{/comment}}层{{///}}后",
      "前{{//}}外{{comment::内联::注释}}层{{///}}后",
      "前{{#comment}}\n  隐藏文本\n{{/#//}}后",
      "前{{//}}{{///}}后",
    ]) {
      expect(analyzePageMacros(template).diagnostics).toEqual([]);
      expect(validatePageMacroBindings([{ id: "comment", template }])).toEqual(
        [],
      );
      expect(evaluatePageMacros(template, {})).toBe("前后");
    }
  });

  it("keeps scoped argument arity and unmatched closing boundaries", () => {
    expect(
      evaluatePageMacros(
        "{{reverse}}甲{{comment}}删除{{///}}乙{{/reverse}}",
        {},
      ),
    ).toBe("乙甲");
    expect(
      evaluatePageMacros(
        "{{trim}}\n  第一{{reverse}}甲乙{{/reverse}}\n{{/trim}}",
        {},
      ),
    ).toBe("第一乙甲");
    for (const template of [
      "{{/comment}}",
      "{{///}}",
      "{{reverse}}正文{{/comment}}",
      "{{if true}}正文{{/trim}}",
      "{{reverse::abc}}正文{{/reverse}}",
      "{{random}}正文{{/random}}",
    ]) {
      expect(analyzePageMacros(template).diagnostics[0]?.code).toBe(
        "INVALID_SYNTAX",
      );
    }
  });

  it("accepts empty and list comment arguments while evaluating nested macros", () => {
    for (const name of ["//", "comment"]) {
      for (const argumentsText of ["", "::", "::一::二::三"]) {
        const template = "前{{" + name + argumentsText + "}}后";
        expect(analyzePageMacros(template).diagnostics).toEqual([]);
        expect(evaluatePageMacros(template, {})).toBe("前后");
      }
    }
    let draws = 0;
    expect(
      evaluatePageMacros(
        "{{//}}{{random::一::二}}{{///}}{{comment::{{random::三::四}}}}",
        {
          random: () => {
            draws++;
            return 0;
          },
        },
      ),
    ).toBe("");
    expect(draws).toBe(2);
    expect(() => evaluatePageMacros("{{comment::{{user}}}}", {})).toThrow(
      PageMacroError,
    );
    expect(
      analyzePageMacros("{{comment::{{persona}}}}").diagnostics[0]?.code,
    ).toBe("HOST_CAPABILITY_REQUIRED");
  });

  it("uses configured prefixes and separators in parsing, conditions and random lists", () => {
    const syntax = { ...pageMacroRegistry.syntax };
    Object.assign(pageMacroRegistry.syntax, {
      localPrefix: "@.",
      globalPrefix: "$$",
      argumentSeparator: "|||",
      legacyArgumentSeparator: "~",
    });
    try {
      const conditions = { variables: { enabled: ["enabled"] } };
      const values = { state: { branchId: "b", variables: { enabled: 0 } } };
      const template = "{{@.enabled}}|{{if @.enabled}}是{{else}}否{{/if}}";
      expect(analyzePageMacros(template, { conditions }).diagnostics).toEqual(
        [],
      );
      expect(analyzePageMacros(template, { conditions }).statePaths).toEqual([
        ["enabled"],
      ]);
      expect(evaluatePageMacros(template, values, conditions)).toBe("0|否");
      expect(
        analyzePageMacros("{{if $$flag}}是{{/if}}").diagnostics[0],
      ).toMatchObject({
        code: "HOST_CAPABILITY_REQUIRED",
        macro: "getglobalvar",
      });
      expect(parsePageMacros("前{{reverse|||abc}}后").nodes[1]).toMatchObject({
        args: ["abc"],
        argumentOffsets: [13],
      });
      expect(parsePageMacros("{{@.enabled}}").nodes[0]).toMatchObject({
        name: "getvar",
        argumentOffsets: [4],
      });
      expect(evaluatePageMacros("{{reverse|||abc}}|{{reverse~abc}}", {})).toBe(
        "cba|cba",
      );
      expect(
        evaluatePageMacros("{{random {{user}}}}", {
          performerName: "first|||last",
          random: () => 0.99,
        }),
      ).toBe("last");
      expect(
        evaluatePageMacros("{{random|||first|||last}}", { random: () => 0.99 }),
      ).toBe("last");
    } finally {
      Object.assign(pageMacroRegistry.syntax, syntax);
    }
  });

  it("reads nested arguments and scopes while preserving inline body whitespace", () => {
    expect(
      evaluatePageMacros("{{reverse::a🙂b}}|{{space::0}}X{{newline::2}}Y", {}),
    ).toBe("b🙂a|X\n\nY");
    expect(
      evaluatePageMacros("{{#trim}}  第一行\n    第二行  {{/trim}}", {}),
    ).toBe("  第一行\n    第二行  ");
    expect(
      evaluatePageMacros("{{trim}}\n    第一行\n      第二行\n{{/trim}}", {}),
    ).toBe("第一行\n  第二行");
    expect(evaluatePageMacros("a\n{{trim}}\nb|a {{trim}} b", {})).toBe(
      "ab|a  b",
    );
    expect(
      evaluatePageMacros("{{comment::{{reverse::abc}}}}{{noop}}", {}),
    ).toBe("");
  });

  it("resolves only the chosen nested if branch and accepts source false values", () => {
    expect(
      evaluatePageMacros(
        "{{if true}}是{{if off}}错{{else}}对{{/if}}{{else}}{{user}}{{/if}}",
        {},
      ),
    ).toBe("是对");
    expect(evaluatePageMacros("{{if::!false::{{reverse::abc}}}}", {})).toBe(
      "cba",
    );
    for (const condition of ["false", "off", "0", ""]) {
      expect(
        evaluatePageMacros("{{if::" + condition + "::错{{else}}对}}", {}),
      ).toBe("对");
    }
    expect(evaluatePageMacros("{{#if true}}  是  {{/if}}", {})).toBe("  是  ");
  });

  it("recognizes implicit variables and optional aliases in analysis and evaluation", () => {
    const conditions = {
      card: "package-card" as const,
      variables: { enabled: ["enabled"] },
    };
    const values = {
      card: { name: "孟舟", first_mes: "开场" },
      state: { branchId: "b", variables: { enabled: false } },
    };
    const variable = "{{if !.enabled}}是{{else}}否{{/if}}";
    const variableAnalysis = analyzePageMacros(variable, { conditions });
    expect(variableAnalysis.statePaths).toEqual([["enabled"]]);
    expect(variableAnalysis.diagnostics).toEqual([]);
    expect(evaluatePageMacros(variable, values, conditions)).toBe("是");

    const alias = "{{if Greeting}}是{{else}}否{{/if}}";
    const aliasAnalysis = analyzePageMacros(alias, { conditions });
    expect(aliasAnalysis.macros).toContain("charFirstMessage");
    expect(aliasAnalysis.dependencies.card).toBe(true);
    expect(aliasAnalysis.diagnostics).toEqual([]);
    expect(evaluatePageMacros(alias, values, conditions)).toBe("是");

    const literal = "{{if reverse}}是{{else}}否{{/if}}";
    expect(analyzePageMacros(literal).macros).not.toContain("reverse");
    expect(evaluatePageMacros(literal, {})).toBe("是");
    expect(
      analyzePageMacros("{{if $flag}}是{{else}}否{{/if}}").diagnostics[0],
    ).toMatchObject({
      code: "HOST_CAPABILITY_REQUIRED",
      macro: "getglobalvar",
    });
  });

  it("reports source positions for unknown, unsupported and malformed macros", () => {
    expect(analyzePageMacros("前文{{persona}}").diagnostics[0]).toMatchObject({
      code: "HOST_CAPABILITY_REQUIRED",
      macro: "persona",
      start: 2,
    });
    expect(analyzePageMacros("{{missingMacro}}").diagnostics[0]).toMatchObject({
      code: "UNKNOWN_MACRO",
      macro: "missingMacro",
    });
    expect(analyzePageMacros("{{reverse}}").diagnostics[0]?.code).toBe(
      "INVALID_ARGUMENTS",
    );
    expect(() => parsePageMacros("{{if true}}缺少结束")).toThrow();
    expect(evaluatePageMacros("<USER>", { performerName: "裴修远" })).toBe(
      "裴修远",
    );
  });

  it("requires explicit purposes and variable paths at binding admission", () => {
    const analysis = analyzePageMacros(
      "{{user}} {{char}} {{getvar::level}} {{lastCharMessage}}",
    );
    expect(analysis.dependencies).toMatchObject({
      performerName: true,
      card: true,
      state: true,
      messages: true,
    });
    expect(analysis.diagnostics.map((item) => item.code)).toEqual([
      "PURPOSE_REQUIRED",
      "VARIABLE_BINDING_REQUIRED",
      "PURPOSE_REQUIRED",
    ]);
    expect(
      validatePageMacroBindings([
        {
          id: "intro",
          template: "{{char}} {{getvar::level}} {{lastCharMessage}}",
          conditions: {
            card: "package-card",
            variables: { level: ["stats", "level"] },
            messages: "saved-visible-active",
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe("page macro package fields and mapped state", () => {
  const conditions = {
    card: "package-card" as const,
    session: "single-character" as const,
    variables: {
      level: ["stats", "level"],
      enabled: ["enabled"],
      label: ["label"],
      missing: ["missing"],
    },
  };
  const card = {
    name: " 孟舟 ",
    description: " {{user}}遇见{{char}}。 ",
    personality: " 坚定 ",
    scenario: " 雨夜 ",
    mes_example: " 示例 ",
    creator_notes: " 注释 ",
    character_version: " 1.0 ",
    first_mes: " {{charDescription}} ",
    alternate_greetings: [" 第二段 "],
    extensions: { depth_prompt: { prompt: " 深度 " } },
  };
  it("expands all fixed card fields recursively with the source first-message index", () => {
    const values = { performerName: "裴修远", card };
    expect(
      evaluatePageMacros(
        "{{char}}|{{charDescription}}|{{charPersonality}}|{{charScenario}}|{{mesExamplesRaw}}|{{charDepthPrompt}}|{{charCreatorNotes}}|{{charVersion}}",
        values,
        conditions,
      ),
    ).toBe("孟舟|裴修远遇见孟舟。|坚定|雨夜|示例|深度|注释| 1.0 ");
    expect(
      evaluatePageMacros(
        "{{charFirstMessage}}|{{charFirstMessage::1}}|{{charFirstMessage::3}}",
        values,
        conditions,
      ),
    ).toBe("裴修远遇见孟舟。|第二段|");
    expect(
      evaluatePageMacros(
        "<BOT>|<CHAR>|<GROUP>|<CHARIFNOTGROUP>|{{groupNotMuted}}|{{notChar}}",
        values,
        conditions,
      ),
    ).toBe("孟舟|孟舟|孟舟|孟舟|孟舟|裴修远");
  });

  it("reads first-message fields and nested dependencies from the registered paths", () => {
    const definition = pageMacroRegistry.macros.find(
      (item) => item.name === "charFirstMessage",
    )!;
    const original = {
      cardPath: definition.cardPath,
      alternatePath: definition.alternatePath,
    };
    const configuredCard = {
      name: "孟舟",
      scenario: "雨夜",
      first_mes: "原开场",
      alternate_greetings: ["原备选"],
      extensions: {
        depth_prompt: { prompt: "{{user}}" },
        greetings: ["{{charScenario}}", "{{user}}"],
      },
    };
    try {
      definition.cardPath = ["extensions", "depth_prompt", "prompt"];
      definition.alternatePath = ["extensions", "greetings"];
      expect(
        evaluatePageMacros(
          "{{charFirstMessage}}|{{charFirstMessage::1}}|{{charFirstMessage::2}}|{{charFirstMessage::3}}",
          { performerName: "裴修远", card: configuredCard },
          conditions,
        ),
      ).toBe("裴修远|雨夜|裴修远|");
      expect(
        analyzePageMacros("{{charFirstMessage}}", {
          conditions,
          card: configuredCard,
        }).dependencies.performerName,
      ).toBe(true);
      const dynamic = analyzePageMacros(
        "{{charFirstMessage::{{getvar::level}}}}",
        { conditions, card: configuredCard },
      );
      expect(dynamic.dependencies).toMatchObject({
        card: true,
        performerName: true,
        state: true,
      });
      expect(dynamic.diagnostics).toEqual([]);
    } finally {
      Object.assign(definition, original);
    }
  });

  it("discovers nested card dependencies and diagnoses field chains before generation", () => {
    const analysis = analyzePageMacros("{{charFirstMessage}}", {
      conditions,
      card,
    });
    expect(analysis.dependencies.performerName).toBe(true);
    expect(analysis.diagnostics).toEqual([]);
    const cyclic = {
      ...card,
      description: "{{charScenario}}",
      scenario: "{{charDescription}}",
    };
    expect(
      validatePageMacroBindings(
        [{ id: "intro", template: "{{charDescription}}", conditions }],
        { card: cyclic },
      )[0],
    ).toMatchObject({
      code: "CARD_REFERENCE_CYCLE",
      fieldChain: ["description", "scenario", "description"],
      bindingId: "intro",
    });
    expect(() =>
      evaluatePageMacros("{{charDescription}}", { card: cyclic }, conditions),
    ).toThrow(/description.*scenario.*description/);
    expect(
      analyzePageMacros("{{char}}", {
        conditions,
        card: { ...card, name: "{{persona}}" },
      }).diagnostics[0]?.code,
    ).toBe("HOST_CAPABILITY_REQUIRED");
  });

  it("distinguishes absent fields from zero, false, empty strings, arrays and numbers", () => {
    const state = {
      branchId: "b1",
      variables: { stats: { level: "001.5" }, enabled: false, label: "" },
    };
    expect(
      evaluatePageMacros(
        "{{getvar::level}}|{{hasvar::level}}|{{getvar::enabled}}|{{hasvar::enabled}}|{{getvar::label}}|{{hasvar::label}}|{{getvar::missing}}|{{hasvar::missing}}",
        { state },
        conditions,
      ),
    ).toBe("1.5|true|0|true||true||false");
    expect(
      evaluatePageMacros(
        "{{if .enabled}}错{{else}}{{.level}}{{/if}}",
        { state },
        conditions,
      ),
    ).toBe("1.5");
    expect(
      evaluatePageMacros(
        "{{getvar::items}}",
        {
          state: { branchId: "b", variables: { items: [1, "二"] } },
        },
        { variables: { items: ["items"] } },
      ),
    ).toBe('[1,"二"]');
  });

  it("treats a performer name containing macro-like text as literal text", () => {
    expect(
      evaluatePageMacros("{{user}}", { performerName: "{{trim}}\n<USER> $&" }),
    ).toBe("{{trim}}\n<USER> $&");
  });
});

describe("page macro controlled time, random and browser values", () => {
  const values = { now: () => new Date(2026, 0, 2, 3, 4, 5) };
  it("uses the source local Moment formats and signed humanized differences", () => {
    expect(
      evaluatePageMacros(
        "{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}|{{datetimeformat::[日期] YYYY-MM-DD HH:mm:ss}}",
        values,
      ),
    ).toBe(
      "3:04 AM|January 2, 2026|Friday|03:04|2026-01-02|日期 2026-01-02 03:04:05",
    );
    const utc = { now: () => new Date("2026-01-01T23:50:00Z") };
    expect(
      evaluatePageMacros(
        "{{time::UTC+8}}|{{time_UTC+16}}|{{time::UTC-8}}",
        utc,
      ),
    ).toBe("7:50 AM|12:06 AM|3:50 PM");
    expect(
      evaluatePageMacros(
        "{{timeDiff::2026-01-01T12:00:00Z::2026-01-01T15:00:00Z}}|{{timeDiff::2026-01-01T15:00:00Z::2026-01-01T12:00:00Z}}",
        {},
      ),
    ).toBe("3 hours ago|in 3 hours");
    expect(
      evaluatePageMacros(
        "{{timeDiff::2026-01-01T00:00:44Z::2026-01-01T00:00:00Z}}|{{timeDiff::2026-01-01T00:00:45Z::2026-01-01T00:00:00Z}}",
        {},
      ),
    ).toBe("in a few seconds|in a minute");
    const diagnostics: unknown[] = [];
    expect(
      evaluatePageMacros("{{timeDiff::2026-99-99::2026-01-01}}", {
        onDiagnostic: (item) => diagnostics.push(item),
      }),
    ).toBe("Invalid date");
    expect(diagnostics).toMatchObject([
      { code: "INVALID_VALUE", macro: "timeDiff" },
    ]);
  });

  it("evaluates every random candidate and handles legacy escaped comma lists", () => {
    expect(
      evaluatePageMacros("{{random::{{reverse::abc}}::尾}}", {
        random: () => 0,
      }),
    ).toBe("cba");
    expect(
      evaluatePageMacros("{{random::首::尾}}", { random: () => 0.9999 }),
    ).toBe("尾");
    expect(evaluatePageMacros("{{random:a\\,b,c}}", { random: () => 0 })).toBe(
      "a,b",
    );
    expect(
      evaluatePageMacros("{{random:a::b::c}}", { random: () => 0.9999 }),
    ).toBe("c");
    expect(evaluatePageMacros("{{random}}", { random: () => 0 })).toBe("");
    expect(() =>
      evaluatePageMacros("{{random::首::{{user}}}}", { random: () => 0 }),
    ).toThrow(/performerName/);
  });

  it("uses the exact source dice grammar at the lowest and highest random values", () => {
    expect(
      evaluatePageMacros(
        "{{roll::d6}}|{{roll::2d6+3}}|{{roll::2D6-1}}|{{roll::6}}",
        { random: () => 0 },
      ),
    ).toBe("1|5|1|1");
    expect(
      evaluatePageMacros("{{roll::2d6+3}}", { random: () => 0.9999 }),
    ).toBe("15");
    const diagnostics: unknown[] = [];
    expect(
      evaluatePageMacros("{{roll::0d6}}|{{roll::1d0}}", {
        onDiagnostic: (item) => diagnostics.push(item),
      }),
    ).toBe("|");
    expect(diagnostics).toMatchObject([{ macro: "roll" }, { macro: "roll" }]);
  });

  it("uses UA platform type for mobile, tablet and desktop", () => {
    const mobile =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const tablet =
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
    const desktop =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    expect(evaluatePageMacros("{{isMobile}}", { userAgent: mobile })).toBe(
      "true",
    );
    expect(evaluatePageMacros("{{isMobile}}", { userAgent: tablet })).toBe(
      "true",
    );
    expect(evaluatePageMacros("{{isMobile}}", { userAgent: desktop })).toBe(
      "false",
    );
  });
});

describe("page macro mounting", () => {
  it("renders each original template independently and restores it before a missing-data error", async () => {
    const shown = new Map<string, string>();
    const render = (id: string, text: string) => {
      shown.set(id, text);
    };
    const first = await mountPageMacros({
      bindings: [{ id: "a", template: "{{user}}和{{user}}" }],
      values: { performerName: "裴修远" },
      render,
    });
    const second = await mountPageMacros({
      bindings: [{ id: "b", template: "{{user}}" }],
      values: { performerName: "孟舟" },
      render,
    });
    expect([...shown]).toEqual([
      ["a", "裴修远和裴修远"],
      ["b", "孟舟"],
    ]);
    first.dispose();
    second.dispose();
    await expect(
      mountPageMacros({
        bindings: [{ id: "bad", template: "姓名：{{user}}" }],
        values: {
          performerName: () => {
            throw Object.assign(new Error("not found"), {
              code: "DATA_NOT_FOUND",
            });
          },
        },
        render,
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        code: "DATA_NOT_FOUND",
        macro: "user",
        dataKey: "performerName",
      },
    });
    expect(shown.get("bad")).toBe("姓名：{{user}}");
  });

  it("subscribes only to used state and releases subscriptions on disposal and mount failure", async () => {
    const shown = new Map<string, string>(),
      stop: string[] = [];
    let change:
      | ((state: {
          branchId: string;
          variables: Record<string, unknown>;
        }) => Promise<void>)
      | undefined;
    const mounting = await mountPageMacros({
      bindings: [
        { id: "fixed", template: "{{random::首::尾}}" },
        {
          id: "state",
          template: "{{getvar::level}}",
          conditions: { variables: { level: ["level"] } },
        },
      ],
      values: {
        random: () => 0,
        state: { branchId: "b1", variables: { level: 0 } },
      },
      watchState: (callback) => {
        change = callback;
        void callback({ branchId: "b1", variables: { level: 0 } });
        return () => {
          stop.push("state");
        };
      },
      watchMessages: () => {
        throw new Error("messages are unused");
      },
      render: (id, text) => {
        shown.set(id, text);
      },
    });
    expect(shown.get("state")).toBe("0");
    await change!({ branchId: "b1", variables: { level: 7 } });
    expect(shown.get("state")).toBe("7");
    expect(shown.get("fixed")).toBe("首");
    mounting.dispose();
    mounting.dispose();
    await change!({ branchId: "b1", variables: { level: 9 } });
    expect(shown.get("state")).toBe("7");
    expect(stop).toEqual(["state"]);
  });
});

describe("page macro saved messages and asynchronous lifetime", () => {
  const bindings = [
    {
      id: "history",
      template: "{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}",
      conditions: { messages: "saved-visible-active" as const },
    },
  ];
  it("selects saved visible messages by their supplied history order and speaker role", async () => {
    const shown: string[] = [];
    const mount = await mountPageMacros({
      bindings,
      values: { state: { branchId: "b1", variables: {} } },
      readMessages: async () => [
        { role: "assistant", text: "开场" },
        { role: "user", text: "用户" },
        { role: "assistant", text: "角色" },
        { role: "agent", text: "补充" },
      ],
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown).toEqual(["补充|用户|角色"]);
    mount.dispose();
    expect(
      evaluatePageMacros(
        bindings[0]!.template,
        { messages: [] },
        bindings[0]!.conditions,
      ),
    ).toBe("||");
  });

  it("discards earlier message queries, changed branches and results after disposal", async () => {
    const shown: string[] = [],
      requests: {
        branch: string;
        resolve: (value: { role: "assistant"; text: string }[]) => void;
      }[] = [];
    let changeState:
      | ((snapshot: {
          branchId: string;
          variables: Record<string, unknown>;
        }) => Promise<void>)
      | undefined;
    let changeMessages: (() => Promise<void>) | undefined;
    const mounting = mountPageMacros({
      bindings: [
        {
          id: "m",
          template: "{{lastCharMessage}}",
          conditions: bindings[0]!.conditions,
        },
      ],
      values: { state: { branchId: "b1", variables: {} } },
      readMessages: (branch) =>
        new Promise((resolve) => {
          requests.push({ branch, resolve });
        }),
      watchState: (callback) => {
        changeState = callback;
        return () => {};
      },
      watchMessages: (callback) => {
        changeMessages = callback;
        return () => {};
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(requests[0]?.branch).toBe("b1");
    const newer = changeMessages!();
    requests[1]!.resolve([{ role: "assistant", text: "较新" }]);
    await newer;
    requests[0]!.resolve([{ role: "assistant", text: "过期" }]);
    const mount = await mounting;
    expect(shown).toEqual(["较新"]);
    const oldBranch = changeMessages!();
    const newBranch = changeState!({ branchId: "b2", variables: {} });
    requests[3]!.resolve([{ role: "assistant", text: "分支二" }]);
    await newBranch;
    requests[2]!.resolve([{ role: "assistant", text: "分支一过期" }]);
    await oldBranch;
    expect(shown).toEqual(["较新", "分支二"]);
    const pending = changeMessages!();
    mount.dispose();
    requests[4]!.resolve([{ role: "assistant", text: "已卸载" }]);
    await pending;
    expect(shown).toEqual(["较新", "分支二"]);
  });

  it("preserves actual API errors and ends disposed host reads without rendering", async () => {
    const shown: string[] = [];
    await expect(
      mountPageMacros({
        bindings,
        values: { state: { branchId: "b1", variables: {} } },
        readMessages: async () => {
          throw new Error("transport failed");
        },
        render: (_id, text) => {
          shown.push(text);
        },
      }),
    ).rejects.toThrow("transport failed");
    expect(shown).toEqual([bindings[0]!.template]);
    const discarded: string[] = [],
      stop: string[] = [];
    const disposed = await mountPageMacros({
      bindings,
      values: { state: { branchId: "b1", variables: {} } },
      readMessages: async () => {
        throw Object.assign(new Error("view closed"), {
          code: "VIEW_DISPOSED",
        });
      },
      watchMessages: () => () => {
        stop.push("messages");
      },
      render: (_id, text) => {
        discarded.push(text);
      },
    });
    expect(discarded).toEqual([]);
    expect(stop).toEqual(["messages"]);
    disposed.dispose();
  });
});

describe("page macro dependency updates", () => {
  it("subscribes to state referenced through fixed card fields and skips unrelated fields", async () => {
    let callback:
      | ((state: {
          branchId: string;
          variables: Record<string, unknown>;
        }) => Promise<void>)
      | undefined;
    let draw = 0;
    const shown: string[] = [];
    const conditions = {
      card: "package-card" as const,
      variables: { level: ["level"] },
    };
    const mount = await mountPageMacros({
      bindings: [{ id: "card", template: "{{charDescription}}", conditions }],
      values: {
        card: () => ({
          name: "孟舟",
          description: "{{getvar::level}}：{{random::首::尾}}",
        }),
        state: { branchId: "b1", variables: { level: 0, unused: 0 } },
        random: () => {
          return draw++ === 0 ? 0 : 0.999;
        },
      },
      watchState: (listener) => {
        callback = listener;
        return () => {};
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown).toEqual(["0：首"]);
    await callback!({ branchId: "b1", variables: { level: 0, unused: 7 } });
    expect(shown).toEqual(["0：首"]);
    await callback!({ branchId: "b1", variables: { level: 2, unused: 7 } });
    expect(shown).toEqual(["0：首", "2：尾"]);
    mount.dispose();
  });

  it("does not query saved messages on a same-branch variable-only update", async () => {
    let callback:
      | ((state: {
          branchId: string;
          variables: Record<string, unknown>;
        }) => Promise<void>)
      | undefined;
    const shown: string[] = [];
    const mount = await mountPageMacros({
      bindings: [
        {
          id: "history",
          template: "{{lastMessage}}",
          conditions: { messages: "saved-visible-active" },
        },
      ],
      values: { state: { branchId: "b1", variables: {} } },
      readMessages: async () => [{ role: "user", text: "已保存" }],
      watchState: (listener) => {
        callback = listener;
        return () => {};
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    await callback!({ branchId: "b1", variables: { unused: 1 } });
    expect(shown).toEqual(["已保存"]);
    mount.dispose();
  });

  it("disposes subscriptions after failed mounting and preserves other successfully rendered bindings", async () => {
    const shown = new Map<string, string>(),
      stopped: string[] = [];
    await expect(
      mountPageMacros({
        bindings: [
          {
            id: "valid",
            template: "{{getvar::level}}",
            conditions: { variables: { level: ["level"] } },
          },
          { id: "bad", template: "{{user}}" },
        ],
        values: { state: { branchId: "b", variables: { level: 2 } } },
        watchState: () => () => {
          stopped.push("state");
        },
        render: (id, text) => {
          shown.set(id, text);
        },
      }),
    ).rejects.toMatchObject({ diagnostic: { macro: "user" } });
    expect([...shown]).toEqual([
      ["valid", "2"],
      ["bad", "{{user}}"],
    ]);
    expect(stopped).toEqual(["state"]);
  });

  it("resolves a dynamic mapped variable and diagnoses unmapped resolved names", () => {
    const state = { branchId: "b", variables: { selected: "level", level: 7 } };
    const conditions = {
      variables: { selected: ["selected"], level: ["level"] },
    };
    expect(
      evaluatePageMacros(
        "{{getvar::{{getvar::selected}}}}",
        { state },
        conditions,
      ),
    ).toBe("7");
    expect(() =>
      evaluatePageMacros("{{getvar::{{reverse::bad}}}}", { state }, conditions),
    ).toThrow(/dab/);
    expect(() => evaluatePageMacros("{{space::+2}}", {})).toThrow();
    const diagnostics: unknown[] = [];
    expect(
      evaluatePageMacros("{{roll::01d6}}", {
        onDiagnostic: (item) => diagnostics.push(item),
      }),
    ).toBe("");
    expect(diagnostics).toMatchObject([{ macro: "roll" }]);
    expect(
      evaluatePageMacros(
        "{{timeDiff::Fri, 02 Jan 2026 12:00:00 GMT::Fri, 02 Jan 2026 15:00:00 GMT}}",
        {},
      ),
    ).toBe("3 hours ago");
  });
});

describe("page macro support inventory", () => {
  const unsupported = [
    ["lastMessageId", "ST 消息数组下标"],
    ["firstIncludedMessageId", "lastInContextMessageId"],
    ["firstDisplayedMessageId", "mesid"],
    ["lastSwipeId", "swipes"],
    ["currentSwipeId", "swipe_id"],
    ["allChatRange", "完整 ST 消息数组长度"],
    ["input", "当前聊天输入框草稿的读取"],
    ["maxPrompt", "提示词可用 token 上限"],
    ["maxContext", "上下文 token 上限"],
    ["maxResponse", "回复 token 上限"],
    ["pick", "pick_reroll_seed"],
    ["banned", "生成禁词列表的写入"],
    ["outlet", "世界书 outlet 的已组装文本"],
    ["charPrompt", "prefer_character_prompt"],
    ["charInstruction", "prefer_character_jailbreak"],
    ["persona", "当前会话固定人设的完整描述"],
    ["mesExamples", "示例覆盖文本及示例格式化配置"],
    ["model", "当前生成模型名称"],
    ["original", "original 原文及其单次消费"],
    ["systemPrompt", "sysprompt.enabled"],
    ["lastGenerationType", "GENERATION_STARTED"],
    ["hasExtension", "指定 ST 扩展的安装及启用状态"],
    ["idleDuration", "send_date"],
    ["setvar", "ST 本地变量的持久化赋值"],
    ["addvar", "ST 本地变量的持久化追加"],
    ["incvar", "ST 本地变量的持久化加一"],
    ["decvar", "ST 本地变量的持久化减一"],
    ["deletevar", "ST 本地变量的持久化删除"],
    ["setglobalvar", "ST 全局变量的持久化赋值"],
    ["addglobalvar", "ST 全局变量的持久化追加"],
    ["incglobalvar", "ST 全局变量的持久化加一"],
    ["decglobalvar", "ST 全局变量的持久化减一"],
    ["getglobalvar", "ST 全局变量的值读取"],
    ["hasglobalvar", "ST 全局变量的存在性查询"],
    ["deleteglobalvar", "ST 全局变量的持久化删除"],
    ["instructStoryStringPrefix", "instruct.story_string_prefix"],
    ["instructStoryStringSuffix", "instruct.story_string_suffix"],
    ["instructUserPrefix", "instruct.input_sequence"],
    ["instructUserSuffix", "instruct.input_suffix"],
    ["instructAssistantPrefix", "instruct.output_sequence"],
    ["instructAssistantSuffix", "instruct.output_suffix"],
    ["instructSystemPrefix", "instruct.system_sequence"],
    ["instructSystemSuffix", "instruct.system_suffix"],
    ["instructFirstAssistantPrefix", "instruct.first_output_sequence"],
    ["instructLastAssistantPrefix", "instruct.last_output_sequence"],
    ["instructStop", "instruct.stop_sequence"],
    ["instructUserFiller", "instruct.user_alignment_message"],
    ["instructSystemInstructionPrefix", "instruct.last_system_sequence"],
    ["instructFirstUserPrefix", "instruct.first_input_sequence"],
    ["instructLastUserPrefix", "instruct.last_input_sequence"],
    ["defaultSystemPrompt", "sysprompt.content"],
    ["exampleSeparator", "context.example_separator"],
    ["chatStart", "context.chat_start"],
    ["authorsNote", "chat_metadata 中的当前聊天作者注释"],
    ["charAuthorsNote", "note.chara 中的当前角色作者注释"],
    ["defaultAuthorsNote", "note.default"],
    ["reasoningPrefix", "reasoning.prefix"],
    ["reasoningSuffix", "reasoning.suffix"],
    ["reasoningSeparator", "reasoning.separator"],
    ["charPrefix", "sd.character_prompts"],
    ["charNegativePrefix", "sd.character_negative_prompts"],
    ["summary", "memory_contents"],
  ];
  const aliases = [
    ["maxPromptTokens", "maxPrompt"],
    ["maxContextTokens", "maxContext"],
    ["maxResponseTokens", "maxResponse"],
    ["comment", "//"],
    ["charIfNotGroup", "group"],
    ["description", "charDescription"],
    ["personality", "charPersonality"],
    ["scenario", "charScenario"],
    ["creatorNotes", "charCreatorNotes"],
    ["greeting", "charFirstMessage"],
    ["version", "charVersion"],
    ["char_version", "charVersion"],
    ["idle_duration", "idleDuration"],
    ["varexists", "hasvar"],
    ["flushvar", "deletevar"],
    ["globalvarexists", "hasglobalvar"],
    ["flushglobalvar", "deleteglobalvar"],
    ["instructInput", "instructUserPrefix"],
    ["instructOutput", "instructAssistantPrefix"],
    ["instructSeparator", "instructAssistantSuffix"],
    ["instructFirstOutputPrefix", "instructFirstAssistantPrefix"],
    ["instructLastOutputPrefix", "instructLastAssistantPrefix"],
    ["instructFirstInput", "instructFirstUserPrefix"],
    ["instructLastInput", "instructLastUserPrefix"],
    ["instructSystem", "defaultSystemPrompt"],
    ["instructSystemPrompt", "defaultSystemPrompt"],
    ["chatSeparator", "exampleSeparator"],
  ];
  const conditions = {
    card: "package-card" as const,
    session: "single-character" as const,
    variables: { level: ["level"] },
    messages: "saved-visible-active" as const,
  };
  const values = {
    performerName: "裴修远",
    card: {
      name: "孟舟",
      description: "资料",
      personality: "性格",
      scenario: "场景",
      mes_example: "示例",
      creator_notes: "注释",
      character_version: "v1",
      first_mes: "开场",
      alternate_greetings: ["备选"],
      extensions: { depth_prompt: { prompt: "深度" } },
    },
    state: { branchId: "b1", variables: { level: 0 } },
    messages: [
      { role: "user" as const, text: "用户正文" },
      { role: "assistant" as const, text: "角色正文" },
    ],
    now: () => new Date(2026, 0, 2, 3, 4, 5),
    random: () => 0,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  };
  const supported: [string, string, string][] = [
    ["user", "{{user}}", "裴修远"],
    ["space", "{{space}}", " "],
    ["newline", "{{newline}}", "\n"],
    ["noop", "{{noop}}", ""],
    ["trim", "甲\n{{trim}}\n乙", "甲乙"],
    ["if", "{{if true}}是{{else}}否{{/if}}", "是"],
    ["else", "{{else}}", ""],
    ["reverse", "{{reverse::abc}}", "cba"],
    ["//", "{{//::说明}}", ""],
    ["roll", "{{roll::d6}}", "1"],
    ["isotime", "{{isotime}}", "03:04"],
    ["isodate", "{{isodate}}", "2026-01-02"],
    ["time", "{{time}}", "3:04 AM"],
    ["date", "{{date}}", "January 2, 2026"],
    ["weekday", "{{weekday}}", "Friday"],
    ["datetimeformat", "{{datetimeformat::YYYY}}", "2026"],
    [
      "timeDiff",
      "{{timeDiff::2026-01-01T12:00:00Z::2026-01-01T15:00:00Z}}",
      "3 hours ago",
    ],
    ["random", "{{random::首::尾}}", "首"],
    ["isMobile", "{{isMobile}}", "false"],
    ["char", "{{char}}", "孟舟"],
    ["charDescription", "{{charDescription}}", "资料"],
    ["charPersonality", "{{charPersonality}}", "性格"],
    ["charScenario", "{{charScenario}}", "场景"],
    ["mesExamplesRaw", "{{mesExamplesRaw}}", "示例"],
    ["charDepthPrompt", "{{charDepthPrompt}}", "深度"],
    ["charCreatorNotes", "{{charCreatorNotes}}", "注释"],
    ["charFirstMessage", "{{charFirstMessage}}", "开场"],
    ["charVersion", "{{charVersion}}", "v1"],
    ["group", "{{group}}", "孟舟"],
    ["groupNotMuted", "{{groupNotMuted}}", "孟舟"],
    ["notChar", "{{notChar}}", "裴修远"],
    ["getvar", "{{getvar::level}}", "0"],
    ["hasvar", "{{hasvar::level}}", "true"],
    ["lastMessage", "{{lastMessage}}", "角色正文"],
    ["lastUserMessage", "{{lastUserMessage}}", "用户正文"],
    ["lastCharMessage", "{{lastCharMessage}}", "角色正文"],
  ];

  it.each(supported)(
    "evaluates the approved %s macro",
    (_name, template, expected) => {
      expect(evaluatePageMacros(template, values, conditions)).toBe(expected);
      expect(
        analyzePageMacros(template, { conditions, card: values.card })
          .diagnostics,
      ).toEqual([]);
    },
  );
  it.each(unsupported)("returns the recorded host gap for %s", (name, gap) => {
    const diagnostics = analyzePageMacros("位置{{" + name + "}}").diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "HOST_CAPABILITY_REQUIRED",
      macro: name,
      start: 2,
      end: name.length + 6,
    });
    expect(diagnostics[0]?.message).toContain(gap);
  });
  it.each(aliases)(
    "preserves the approved alias %s for %s",
    (alias, primary) => {
      const specimen = supported.find(([name]) => name === primary);
      if (specimen) {
        expect(
          evaluatePageMacros(
            specimen[1].replace(primary, alias),
            values,
            conditions,
          ),
        ).toBe(specimen[2]);
      } else {
        const gap = unsupported.find(([name]) => name === primary)![1];
        const diagnostic = analyzePageMacros("{{" + alias + "}}")
          .diagnostics[0];
        expect(diagnostic).toMatchObject({
          code: "HOST_CAPABILITY_REQUIRED",
          macro: alias,
        });
        expect(diagnostic?.message).toContain(gap);
      }
    },
  );
  it("covers every main registration, alias and legacy form", () => {
    expect(pageMacroRegistry.macros.map((item) => item.name).sort()).toEqual(
      [
        ...supported.map(([name]) => name),
        ...unsupported.map(([name]) => name),
      ].sort(),
    );
    expect(aliases).toHaveLength(27);
    expect(
      pageMacroRegistry.macros.filter((item) => item.condition),
    ).toHaveLength(17);
    expect(pageMacroRegistry.legacyForms).toHaveLength(9);
    for (const [name, equivalent] of [
      ["instructFirstOutput", "instructFirstAssistantPrefix"],
      ["instructLastOutput", "instructLastAssistantPrefix"],
      ["charJailbreak", "charInstruction"],
    ]) {
      const gap = unsupported.find(([macro]) => macro === equivalent)![1];
      const diagnostic = analyzePageMacros("{{" + name + "}}").diagnostics[0];
      expect(diagnostic).toMatchObject({
        code: "HOST_CAPABILITY_REQUIRED",
        macro: name,
      });
      expect(diagnostic?.message).toContain(gap);
    }
  });
  it("requires the declared purpose for every conditional registration", () => {
    for (const name of [
      "char",
      "charDescription",
      "charPersonality",
      "charScenario",
      "mesExamplesRaw",
      "charDepthPrompt",
      "charCreatorNotes",
      "charFirstMessage",
      "charVersion",
      "group",
      "groupNotMuted",
      "notChar",
      "lastMessage",
      "lastUserMessage",
      "lastCharMessage",
    ])
      expect(analyzePageMacros("{{" + name + "}}").diagnostics[0]?.code).toBe(
        "PURPOSE_REQUIRED",
      );
    for (const name of ["getvar", "hasvar"])
      expect(
        analyzePageMacros("{{" + name + "::level}}").diagnostics[0]?.code,
      ).toBe("VARIABLE_BINDING_REQUIRED");
  });
});

describe("page macro parameter and lazy-data boundaries", () => {
  it("diagnoses literal integer errors before files are generated", () => {
    expect(analyzePageMacros("{{newline::+2}}").diagnostics[0]?.code).toBe(
      "INVALID_ARGUMENTS",
    );
    expect(
      analyzePageMacros("{{charFirstMessage::word}}", {
        conditions: { card: "package-card" },
      }).diagnostics[0]?.code,
    ).toBe("INVALID_ARGUMENTS");
    expect(
      analyzePageMacros("{{space::{{getvar::count}}}}", {
        conditions: { variables: { count: ["count"] } },
      }).diagnostics,
    ).toEqual([]);
  });
  it("keeps nested if data lazy and accepts nested inline scoped branches", async () => {
    expect(
      evaluatePageMacros(
        "{{if::true::{{if false}}错{{else}}{{reverse::abc}}{{/if}}}}",
        {},
      ),
    ).toBe("cba");
    const shown: string[] = [];
    const handle = await mountPageMacros({
      bindings: [
        { id: "branch", template: "{{if true}}是{{else}}{{user}}{{/if}}" },
      ],
      values: {
        performerName: () => {
          throw new Error("unselected");
        },
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown).toEqual(["是"]);
    handle.dispose();
  });
  it("keeps random and time values until an explicit evaluation and remounts independently", async () => {
    let index = 0;
    const shown: string[] = [];
    const handle = await mountPageMacros({
      bindings: [{ id: "value", template: "{{random::首::尾}}|{{isotime}}" }],
      values: {
        random: () => (index++ === 0 ? 0 : 0.999),
        now: () => new Date(2026, 0, 2, index, 0),
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown).toEqual(["首|01:00"]);
    await handle.refresh();
    expect(shown).toEqual(["首|01:00", "尾|02:00"]);
    handle.dispose();
    const remount = await mountPageMacros({
      bindings: [{ id: "value", template: "{{user}}" }],
      values: { performerName: "第二个会话" },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown.at(-1)).toBe("第二个会话");
    remount.dispose();
  });
});

describe("page macro source field normalization order", () => {
  it("preserves version fields literally in evaluation and binding analysis", () => {
    const conditions = { card: "package-card" as const };
    for (const name of ["charVersion", "version", "char_version"]) {
      for (const version of [
        "  {{user}} {{charVersion}} {{persona}}  ",
        "{{unfinished",
      ]) {
        const template = "{{" + name + "}}";
        const card = { name: "孟舟", character_version: version };
        const analysis = analyzePageMacros(template, { card, conditions });
        expect(analysis.diagnostics).toEqual([]);
        expect(analysis.macros).toEqual(["charVersion"]);
        expect(analysis.dependencies.performerName).toBe(false);
        expect(analysis.dependencies.card).toBe(true);
        expect(
          validatePageMacroBindings([{ id: "version", template, conditions }], {
            card,
          }),
        ).toEqual([]);
        expect(evaluatePageMacros(template, { card }, conditions)).toBe(
          version,
        );
      }
    }
  });

  it("trims fixed field source text before expanding literal performer names", () => {
    expect(
      evaluatePageMacros(
        "{{charDescription}}",
        {
          performerName: " 裴修远 ",
          card: { name: "孟舟", description: "  {{user}}  " },
        },
        { card: "package-card" },
      ),
    ).toBe(" 裴修远 ");
  });
});

describe("page macro lazy asynchronous branches", () => {
  it("avoids message reads in an unselected if branch", async () => {
    const shown: string[] = [];
    const handle = await mountPageMacros({
      bindings: [
        {
          id: "lazy",
          template: "{{if true}}选中{{else}}{{lastMessage}}{{/if}}",
          conditions: { messages: "saved-visible-active" },
        },
      ],
      values: {},
      readMessages: async () => {
        throw new Error("unselected read");
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(shown).toEqual(["选中"]);
    handle.dispose();
  });
  it("evaluates preceding random values once before awaiting a selected message", async () => {
    const events: string[] = [],
      shown: string[] = [];
    const handle = await mountPageMacros({
      bindings: [
        {
          id: "order",
          template: "{{random::首::尾}}|{{lastMessage}}",
          conditions: { messages: "saved-visible-active" },
        },
      ],
      values: {
        state: { branchId: "b1", variables: {} },
        random: () => {
          events.push("random");
          return 0;
        },
      },
      readMessages: async () => {
        events.push("messages");
        return [{ role: "user", text: "正文" }];
      },
      render: (_id, text) => {
        shown.push(text);
      },
    });
    expect(events).toEqual(["random", "messages"]);
    expect(shown).toEqual(["首|正文"]);
    handle.dispose();
  });
});
