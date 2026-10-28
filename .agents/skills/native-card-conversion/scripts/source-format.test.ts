import { describe, expect, it } from "vitest";
import { validateSourceCard } from "./source-format.ts";
import {
  sourceBook,
  sourceEntry,
  v1Card,
  v2Card,
  v3Card,
} from "./source-fixtures.ts";

describe("源卡格式准入", () => {
  it("定位V3世界书数组标题并保留输入原值", () => {
    const source = v3Card({
      character_book: sourceBook([sourceEntry({ comment: ["城市烟火人间"] })]),
    });
    const before = structuredClone(source);
    const result = validateSourceCard(source);
    expect(result).toMatchObject({
      success: false,
      code: "SOURCE_CARD_FORMAT_INVALID",
      issues: [
        {
          pointer: "/data/character_book/entries/0/comment",
          rule: "invalid_type",
          expected: "string",
          actualType: "array",
        },
      ],
    });
    expect(source).toEqual(before);
  });
  it.each([
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
  ])("V1允许缺少%s并诊断已经存在的错误类型", (field) => {
    const source: Record<string, unknown> = v1Card();
    delete source[field];
    const before = structuredClone(source);
    const admitted = validateSourceCard(source);
    expect(admitted.success).toBe(true);
    if (admitted.success) expect(admitted.source).toBe(source);
    expect(source).toEqual(before);
    expect(validateSourceCard(v1Card({ [field]: [] }))).toMatchObject({
      success: false,
    });
  });
  it.each([v2Card, v3Card])(
    "封装格式允许缺少已知字段并诊断已经存在的错误类型",
    (card) => {
      for (const field of [
        "name",
        "description",
        "personality",
        "scenario",
        "first_mes",
        "mes_example",
        "creator_notes",
        "system_prompt",
        "post_history_instructions",
        "alternate_greetings",
        "tags",
        "creator",
        "character_version",
        "extensions",
      ]) {
        const source = card();
        delete (source.data as Record<string, unknown>)[field];
        const before = structuredClone(source);
        const admitted = validateSourceCard(source);
        expect(admitted.success, field).toBe(true);
        if (admitted.success) expect(admitted.source).toBe(source);
        expect(source).toEqual(before);
        expect(
          validateSourceCard(card({ [field]: null })),
          field,
        ).toMatchObject({ success: false });
      }
    },
  );
  it.each([v2Card, v3Card])(
    "世界书已经存在的字段保持类型与成员诊断",
    (card) => {
      for (const [field, value] of Object.entries({
        name: [],
        description: 0,
        scan_depth: "2",
        token_budget: "5",
        recursive_scanning: 1,
        extensions: [],
        entries: {},
      })) {
        expect(
          validateSourceCard(
            card({ character_book: sourceBook([], { [field]: value }) }),
          ),
          field,
        ).toMatchObject({
          success: false,
          issues: expect.arrayContaining([
            expect.objectContaining({
              pointer: "/data/character_book/" + field,
            }),
          ]),
        });
      }
      for (const [field, value] of Object.entries({
        keys: [1],
        content: [],
        extensions: [],
        enabled: 1,
        insertion_order: "1",
        case_sensitive: "false",
        name: [],
        priority: "1",
        id: [],
        comment: [],
        selective: 0,
        secondary_keys: [1],
        constant: 1,
        position: [],
      })) {
        expect(
          validateSourceCard(
            card({
              character_book: sourceBook([sourceEntry({ [field]: value })]),
            }),
          ),
          field,
        ).toMatchObject({
          success: false,
          issues: expect.arrayContaining([
            expect.objectContaining({
              pointer:
                "/data/character_book/entries/0/" +
                field +
                (["keys", "secondary_keys"].includes(field) ? "/0" : ""),
            }),
          ]),
        });
      }
      for (const field of [
        "keys",
        "content",
        "extensions",
        "enabled",
        "insertion_order",
      ]) {
        const entry: Record<string, unknown> = sourceEntry();
        delete entry[field];
        expect(
          validateSourceCard(card({ character_book: sourceBook([entry]) })),
          field,
        ).toMatchObject({ success: true });
      }
      expect(validateSourceCard(card({ character_book: null }))).toMatchObject({
        success: false,
      });
      expect(
        validateSourceCard(card({ character_book: sourceBook([null]) })),
      ).toMatchObject({ success: false });
    },
  );
  it("V3校验已经存在的开场、资源与可选字段类型", () => {
    for (const [field, value] of Object.entries({
      group_only_greetings: [0],
      alternate_greetings: [false],
      tags: [{}],
      nickname: [],
      source: [1],
      creation_date: "0",
      modification_date: null,
      creator_notes_multilingual: { en: 1 },
    }))
      expect(
        validateSourceCard(v3Card({ [field]: value })),
        field,
      ).toMatchObject({ success: false });
    const source = v3Card();
    delete (source.data as Record<string, unknown>).group_only_greetings;
    expect(validateSourceCard(source)).toMatchObject({ success: true });
    const entry: Record<string, unknown> = sourceEntry();
    delete entry.use_regex;
    expect(
      validateSourceCard(v3Card({ character_book: sourceBook([entry]) })),
    ).toMatchObject({ success: true });
    expect(
      validateSourceCard(
        v3Card({ character_book: sourceBook([sourceEntry({ use_regex: 1 })]) }),
      ),
    ).toMatchObject({ success: false });
    for (const field of ["type", "uri", "name", "ext"]) {
      const asset: Record<string, unknown> = {
        type: "icon",
        uri: "ccdefault:",
        name: "main",
        ext: "png",
      };
      delete asset[field];
      expect(
        validateSourceCard(v3Card({ assets: [asset] })),
        field,
      ).toMatchObject({ success: true });
      asset[field] = [];
      expect(
        validateSourceCard(v3Card({ assets: [asset] })),
        field,
      ).toMatchObject({ success: false });
    }
    for (const key of ["en-US", "zz", "EN"])
      expect(
        validateSourceCard(
          v3Card({ creator_notes_multilingual: { [key]: "正文" } }),
        ),
        key,
      ).toMatchObject({ success: true });
    expect(
      validateSourceCard(
        v3Card({
          assets: [
            {
              type: "icon",
              uri: "relative/file.png",
              name: "main",
              ext: "png",
            },
          ],
        }),
      ),
    ).toMatchObject({ success: true });
  });
  it.each([
    "relative/file.png",
    "vendor:a b",
    "https://",
    "data:image/png,raw",
    "data:image/png;base64,not-encoded",
    "__asset:图像/ a\\b",
    "embeded://",
    "",
  ])("资源字符串作为待判断原文保留 %#", (uri) => {
    const source = v3Card({
      assets: [
        { type: "icon", uri, name: "preview", ext: ".PNG" },
        { type: "icon", uri, name: "preview", ext: "custom.extension" },
      ],
    });
    const before = structuredClone(source);
    const admitted = validateSourceCard(source);
    expect(admitted.success).toBe(true);
    if (admitted.success) expect(admitted.source).toBe(source);
    expect(source).toEqual(before);
  });

  it("世界书位置与语言键按现有字符串保留", () => {
    const source = v3Card({
      creator_notes_multilingual: { "en-US": "作者说明", 自定义: "平台说明" },
      character_book: sourceBook([sourceEntry({ position: "平台自定义位置" })]),
    });
    const before = structuredClone(source);
    const admitted = validateSourceCard(source);
    expect(admitted.success).toBe(true);
    if (admitted.success) expect(admitted.source).toBe(source);
    expect(source).toEqual(before);
  });

  it.each([
    [
      "人物描述",
      {},
      { description: "她在码头等候。" },
      { description: [] },
      "/data/description",
      "string",
      "array",
    ],
    [
      "群聊开场",
      {},
      { group_only_greetings: ["雨声从窗外传来。"] },
      { group_only_greetings: [1] },
      "/data/group_only_greetings/0",
      "string",
      "number",
    ],
    [
      "书级扩展",
      { character_book: {} },
      { character_book: { extensions: { platform: true } } },
      { character_book: { extensions: [] } },
      "/data/character_book/extensions",
      "object",
      "array",
    ],
    [
      "条目扩展",
      { character_book: { entries: [{}] } },
      { character_book: { entries: [{ extensions: { position: 4 } }] } },
      { character_book: { entries: [{ extensions: "platform" }] } },
      "/data/character_book/entries/0/extensions",
      "object",
      "string",
    ],
  ])(
    "%s分别验证缺失、正确类型和错误类型",
    (
      _label,
      absent,
      present,
      invalid,
      fieldPointer,
      expectedType,
      actualType,
    ) => {
      for (const data of [absent, present]) {
        const source = { spec: "chara_card_v3", spec_version: "3.0", data };
        const before = structuredClone(source);
        const admitted = validateSourceCard(source);
        expect(admitted.success).toBe(true);
        if (admitted.success) expect(admitted.source).toBe(source);
        expect(source).toEqual(before);
      }
      const source = {
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: invalid,
      };
      const before = structuredClone(source);
      expect(validateSourceCard(source)).toMatchObject({
        success: false,
        issues: [{ pointer: fieldPointer, expected: expectedType, actualType }],
      });
      expect(source).toEqual(before);
    },
  );

  it("源数据与嵌套对象允许缺少全部已知字段", () => {
    for (const source of [
      {},
      { spec: "chara_card_v2", spec_version: "2.0", data: {} },
      {
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
          character_book: { entries: [{}] },
          assets: [{}],
        },
      },
      v3Card({ character_book: {} }),
    ]) {
      const before = structuredClone(source);
      const admitted = validateSourceCard(source);
      expect(admitted.success).toBe(true);
      if (admitted.success) expect(admitted.source).toBe(source);
      expect(source).toEqual(before);
    }
  });

  it("合法可选值与开放字段原样通过，校验保留对象身份", () => {
    const source = v3Card({
      nickname: "",
      source: [],
      assets: [
        {
          type: "vendor/type",
          uri: "ftp://example.com/a",
          name: "任意名称",
          ext: "custom",
          vendor: [null],
        },
        ...[
          "ccdefault:",
          "__asset:assets/icon.png",
          "embeded://assets/icon.png",
          "data:image/png;base64,AAAA",
        ].map((uri, index) => ({
          type: "icon",
          uri,
          name: index === 0 ? "main" : `icon-${index}`,
          ext: "png",
        })),
      ],
      creator_notes_multilingual: { en: "", zh: "中文" },
      creation_date: -0.5,
      modification_date: 0,
      character_book: sourceBook(
        [
          sourceEntry({
            id: -1.5,
            priority: -2.1,
            insertion_order: -5.5,
            comment: "[城市烟火]",
            secondary_keys: [],
            constant: false,
            "future/key~": { value: null },
          }),
        ],
        { scan_depth: -0.5, token_budget: 1.5, future: { value: [] } },
      ),
      extensions: { "vendor/key~": [null, { body: ["原值"] }] },
      future: { value: [] },
    });
    const before = structuredClone(source);
    const result = validateSourceCard(source);
    expect(result).toMatchObject({ success: true, format: "chara_card_v3" });
    if (result.success) expect(result.source).toBe(source);
    expect(source).toEqual(before);
    expect(validateSourceCard(v1Card())).toMatchObject({
      success: true,
      format: "v1",
    });
    expect(
      validateSourceCard(
        v2Card({ character_book: sourceBook([sourceEntry({ id: 2.5 })]) }),
      ),
    ).toMatchObject({ success: true, format: "chara_card_v2" });
    expect(
      validateSourceCard(
        v2Card({
          character_book: sourceBook([sourceEntry({ id: "string-id" })]),
        }),
      ),
    ).toMatchObject({ success: false });
    expect(validateSourceCard(v3Card())).toMatchObject({ success: true });
  });
  it.each([
    [null, "SOURCE_CARD_FORMAT_INVALID"],
    [[], "SOURCE_CARD_FORMAT_INVALID"],
    [{ spec: "chara_card_v3", data: {} }, "SOURCE_CARD_FORMAT_INVALID"],
    [{ spec_version: "3.0", data: {} }, "SOURCE_CARD_FORMAT_INVALID"],
    [{ spec: 3, spec_version: "3.0", data: {} }, "SOURCE_CARD_FORMAT_INVALID"],
    [
      { spec: "chara_card_v3", spec_version: 3, data: {} },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v3", spec_version: "2.0", data: {} },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v2", spec_version: "3.0", data: {} },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v3", spec_version: "3.1", data: {} },
      "SOURCE_CARD_VERSION_UNSUPPORTED",
    ],
    [
      { spec: "chara_card_v4", spec_version: "4.0", data: {} },
      "SOURCE_CARD_VERSION_UNSUPPORTED",
    ],
    [
      { spec: "chara_card_v3", spec_version: "3.0" },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v3", spec_version: "3.0", data: null },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
    [
      { spec: "chara_card_v3", spec_version: "3.0", data: [] },
      "SOURCE_CARD_FORMAT_INVALID",
    ],
  ])("区分错误声明与未支持版本 %#", (source, code) =>
    expect(validateSourceCard(source)).toMatchObject({ success: false, code }),
  );
  it("未声明封装格式时按根对象读取并保留未知data字段", () => {
    const source = { data: v1Card() };
    const admitted = validateSourceCard(source);
    expect(admitted).toMatchObject({ success: true, root: "", format: "v1" });
    if (admitted.success) {
      expect(admitted.source).toBe(source);
      expect(admitted.data).toBe(source);
    }
  });

  it.each([Infinity, -Infinity])(
    "reports finite-number constraints for %s",
    (value) => {
      const source = v3Card({ creation_date: value });
      const before = structuredClone(source);
      expect(validateSourceCard(source)).toMatchObject({
        success: false,
        issues: [
          {
            pointer: "/data/creation_date",
            rule: "invalid_type",
            expected: "有限数值",
            actualType: "number",
          },
        ],
      });
      expect(source).toEqual(before);
    },
  );

  it.each([
    ["chara_card_v2", "3.0", '"2.0"'],
    ["chara_card_v3", "2.0", '"3.0"'],
  ])(
    "reports the required version for a conflicting %s declaration",
    (spec, specVersion, requiredVersion) => {
      expect(
        validateSourceCard({ spec, spec_version: specVersion, data: {} }),
      ).toMatchObject({
        success: false,
        issues: [
          {
            pointer: "/spec_version",
            rule: "invalid_value",
            expected: requiredVersion,
            actualType: "string",
          },
        ],
      });
    },
  );

  it("reports the required string length for empty format declarations", () => {
    expect(
      validateSourceCard({ spec: "", spec_version: "", data: {} }),
    ).toMatchObject({
      success: false,
      issues: [
        {
          pointer: "/spec",
          rule: "too_small",
          expected: "长度至少为 1 的 string",
          actualType: "string",
        },
        {
          pointer: "/spec_version",
          rule: "too_small",
          expected: "长度至少为 1 的 string",
          actualType: "string",
        },
      ],
    });
  });

  it("reports both identifier types for a rejected V3 entry identifier", () => {
    for (const id of [2.5, "chapter/id"])
      expect(
        validateSourceCard(
          v3Card({ character_book: sourceBook([sourceEntry({ id })]) }),
        ),
      ).toMatchObject({ success: true });
    const source = v3Card({
      character_book: sourceBook([sourceEntry({ id: [] })]),
    });
    const before = structuredClone(source);
    expect(validateSourceCard(source)).toMatchObject({
      success: false,
      issues: [
        {
          pointer: "/data/character_book/entries/0/id",
          rule: "invalid_union",
          expected: "number | string",
          actualType: "array",
        },
      ],
    });
    expect(source).toEqual(before);
  });

  it("一次返回所有已定位错误，转义JSON Pointer且诊断不包含正文", () => {
    const result = validateSourceCard(
      v3Card({
        description: [],
        tags: [2],
        creator_notes_multilingual: { "en/~US": 0 },
        character_book: sourceBook([
          sourceEntry({ comment: ["不进入诊断的正文"] }),
        ]),
      }),
    );
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error("应拒绝错误输入");
    expect(result.issues.map((issue) => issue.pointer)).toEqual(
      expect.arrayContaining([
        "/data/description",
        "/data/tags/0",
        "/data/creator_notes_multilingual/en~1~0US",
        "/data/character_book/entries/0/comment",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("不进入诊断的正文");
  });
});
