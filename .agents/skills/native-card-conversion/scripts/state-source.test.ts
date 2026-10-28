import { describe, expect, it } from "vitest";

import { extractSourceStateFields } from "./state-source.ts";

describe("源 Zod 状态字段清单", () => {
  it.each([
    "z.record(z.string(), Imported)",
    "z.map(z.string(), Imported)",
    "z.set(Imported)",
    "z.promise(Imported)",
    "z.tuple([Imported])",
  ])("保留容器字段并定位其中的外部schema：%s", (expression) => {
    const text = `const Schema = z.object({ 容器: ${expression} });`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual(["/容器"]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
      })),
    ).toEqual([{ kind: "external-symbol", text: "Imported" }]);
  });
  it("定位元组静态成员及局部成员数组中的源操作", () => {
    const text = `const members = [z.object({ 值: z.coerce.number().default(1) })];
const Schema = z.object({ 元组: z.tuple(members), 内联: z.tuple([z.string().prefault("x")]) });`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/元组",
      "/内联",
    ]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
      })),
    ).toEqual([
      { kind: "coerce", text: "coerce" },
      { kind: "default", text: "default" },
      { kind: "prefault", text: "prefault" },
    ]);
  });
  it("列出无法展开的表达式、缺失初始化值及重名声明", () => {
    const factory = "const Schema = buildSchema();";
    const built = extractSourceStateFields(factory, "Schema");
    expect(built.fields).toEqual([]);
    expect(
      built.unresolved.map((item) => ({
        kind: item.kind,
        text: factory.slice(item.start, item.end),
      })),
    ).toEqual([{ kind: "factory-call", text: "buildSchema()" }]);
    expect(
      extractSourceStateFields("let Schema;", "Schema").unresolved.map(
        (item) => item.kind,
      ),
    ).toEqual(["uninitialized-symbol"]);
    const ambiguous = `function one() { const Schema = z.object({ 甲: z.string() }); }
function two() { const Schema = z.object({ 乙: z.number() }); }`;
    const result = extractSourceStateFields(ambiguous, "Schema");
    expect(result.fields).toEqual([]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: ambiguous.slice(item.start, item.end),
      })),
    ).toEqual([
      { kind: "ambiguous-symbol", text: "Schema" },
      { kind: "ambiguous-symbol", text: "Schema" },
    ]);
  });

  it("将源脚本及默认值和transform回调作为文本读取", () => {
    const text = `throw new Error("source-executed");
const Schema = z.object({
  值: z.boolean().default((() => { throw new Error("default-executed"); })()),
}).transform(() => { throw new Error("transform-executed"); });`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual(["/值"]);
    expect(result.unresolved.map((item) => item.kind)).toEqual([
      "default",
      "transform",
    ]);
    expect(extractSourceStateFields(text, "Schema")).toEqual(result);
  });
  it("为外部根schema和遮蔽的本地符号返回声明或引用位置", () => {
    const imported = 'import { Schema } from "./shared";';
    const root = extractSourceStateFields(imported, "Schema");
    expect(root.fields).toEqual([]);
    expect(
      root.unresolved.map((item) => ({
        kind: item.kind,
        text: imported.slice(item.start, item.end),
      })),
    ).toEqual([{ kind: "external-symbol", text: "Schema" }]);

    const text = `const Leaf = z.object({ 错误层级: z.boolean() });
function create({ Leaf }) {
  const Schema = z.object({ 当前: Leaf });
  return Schema;
}`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual(["/当前"]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
      })),
    ).toEqual([{ kind: "external-symbol", text: "Leaf" }]);
  });
  it("将数组字段保留为整体并列出元素schema中的源操作", () => {
    const text = `const item = z.object({ 值: z.coerce.number().default(0) });
const Schema = z.object({
  列表: z.array(item),
  另一列表: z.string().transform((value) => value).array(),
});`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/列表",
      "/另一列表",
    ]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
      })),
    ).toEqual([
      { kind: "coerce", text: "coerce" },
      { kind: "default", text: "default" },
      { kind: "transform", text: "transform" },
    ]);
  });
  it("按词法作用域读取局部引用并识别Zod导入别名", () => {
    const text = `import { z as shape } from "zod";
const inner = shape.object({ 外层字段: shape.boolean() });
function create(leaf) {
  const inner = shape.object({ 内层字段: shape.number() });
  const Schema = shape.object({ 当前: inner, 参数: leaf });
  return Schema;
}`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/当前",
      "/当前/内层字段",
      "/参数",
    ]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
        line: item.line,
      })),
    ).toEqual([{ kind: "external-symbol", text: "leaf", line: 5 }]);
    const shadowed = `const z = external;
const Schema = z.object({ 假字段: z.boolean() });`;
    const shadowResult = extractSourceStateFields(shadowed, "Schema");
    expect(shadowResult.fields).toEqual([]);
    expect(shadowResult.unresolved.map((item) => item.kind)).toEqual([
      "factory-call",
    ]);
  });
  it("解析本文件schema、shape和叶子变量引用，并定位循环引用", () => {
    const text = `const shared = z.string().optional();
const innerShape = { "a/b": z.boolean(), 标签: shared };
const inner = z.object(innerShape).nullable();
const baseShape = { 内层: inner, shared };
let Schema = z.object(baseShape).describe("引用");
const Loop = z.object({ 继续: Loop });`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/内层",
      "/内层/a~1b",
      "/内层/标签",
      "/shared",
    ]);
    expect(result.unresolved).toEqual([]);
    expect(text.slice(result.fields[1]!.start, result.fields[1]!.end)).toBe(
      '"a/b"',
    );
    const loop = extractSourceStateFields(text, "Loop");
    expect(loop.fields.map((field) => field.pointer)).toEqual(["/继续"]);
    expect(
      loop.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
        line: item.line,
      })),
    ).toEqual([{ kind: "circular-reference", text: "Loop", line: 6 }]);
  });
  it("穿过常规包装并保留transform、coerce及默认值操作的位置", () => {
    const text = `const Schema = (z.object({
  状态: z.object({
    分数: z.coerce.number().default(0),
    已触发: z.boolean().prefault(false),
  }).optional().transform((value) => value),
  项目: z.string().min(1).nullable(),
  数组: z.object({ 不展开: z.string() }).array(),
}).strict().describe("状态")) satisfies SchemaType;`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/状态",
      "/状态/分数",
      "/状态/已触发",
      "/项目",
      "/数组",
    ]);
    expect(
      result.unresolved.map((item) => ({
        kind: item.kind,
        text: text.slice(item.start, item.end),
        line: item.line,
      })),
    ).toEqual([
      { kind: "coerce", text: "coerce", line: 3 },
      { kind: "default", text: "default", line: 3 },
      { kind: "prefault", text: "prefault", line: 4 },
      { kind: "transform", text: "transform", line: 5 },
    ]);
  });
  it("为动态键、spread、外部符号和工厂调用返回可读源位置", () => {
    const text = `const Schema = z.object({
  保留: z.string(),
  [key]: z.number(),
  ...shared,
  外部: Imported,
  工厂: buildSchema(),
});`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/保留",
      "/外部",
      "/工厂",
    ]);
    expect(
      result.unresolved.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: text.slice(item.start, item.end),
        line: item.line,
        column: item.column,
      })),
    ).toEqual([
      {
        id: "source-1",
        kind: "dynamic-key",
        text: "[key]",
        line: 3,
        column: 3,
      },
      { id: "source-2", kind: "spread", text: "...shared", line: 4, column: 3 },
      {
        id: "source-3",
        kind: "external-symbol",
        text: "Imported",
        line: 5,
        column: 7,
      },
      {
        id: "source-4",
        kind: "factory-call",
        text: "buildSchema()",
        line: 6,
        column: 7,
      },
    ]);
    expect(extractSourceStateFields(text, "Missing")).toEqual({
      fields: [],
      unresolved: [
        {
          id: "source-1",
          kind: "missing-symbol",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });
  it("保留各层静态字段，转义路径并将数组作为整体字段", () => {
    const text = `const Schema = z.object({
  "状态/详情": z.object({
    "a~b": z.number(),
    ["显示/名"]: z.string(),
    7: z.boolean(),
    列表: z.array(z.object({ 子项: z.string() })),
  }),
  空对象: z.object({}),
});`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/状态~1详情",
      "/状态~1详情/a~0b",
      "/状态~1详情/显示~1名",
      "/状态~1详情/7",
      "/状态~1详情/列表",
      "/空对象",
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.fields[1]).toMatchObject({
      pointer: "/状态~1详情/a~0b",
      line: 3,
      column: 5,
    });
    expect(text.slice(result.fields[1]!.start, result.fields[1]!.end)).toBe(
      '"a~b"',
    );
  });
  it("列出字面声明中的全部36个事件字段", () => {
    const text = `const Schema = z.object({
      事件_E001: z.boolean(), 事件_E002: z.boolean(), 事件_E003: z.boolean(),
      事件_E004: z.boolean(), 事件_E005: z.boolean(), 事件_E006: z.boolean(),
      事件_E007: z.boolean(), 事件_E008: z.boolean(), 事件_E009: z.boolean(),
      事件_E010: z.boolean(), 事件_E011: z.boolean(), 事件_E012: z.boolean(),
      事件_E013: z.boolean(), 事件_E014: z.boolean(), 事件_E015: z.boolean(),
      事件_E016: z.boolean(), 事件_E017: z.boolean(), 事件_E018: z.boolean(),
      事件_E019: z.boolean(), 事件_E020: z.boolean(), 事件_E021: z.boolean(),
      事件_E022: z.boolean(), 事件_E023: z.boolean(), 事件_E024: z.boolean(),
      事件_E025: z.boolean(), 事件_E026: z.boolean(), 事件_E027: z.boolean(),
      事件_E028: z.boolean(), 事件_E029: z.boolean(), 事件_E030: z.boolean(),
      事件_E031: z.boolean(), 事件_E032: z.boolean(), 事件_E033: z.boolean(),
      事件_E034: z.boolean(), 事件_E035: z.boolean(), 事件_E036: z.boolean(),
    });`;
    const result = extractSourceStateFields(text, "Schema");
    expect(result.fields.map((field) => field.pointer)).toEqual([
      "/事件_E001",
      "/事件_E002",
      "/事件_E003",
      "/事件_E004",
      "/事件_E005",
      "/事件_E006",
      "/事件_E007",
      "/事件_E008",
      "/事件_E009",
      "/事件_E010",
      "/事件_E011",
      "/事件_E012",
      "/事件_E013",
      "/事件_E014",
      "/事件_E015",
      "/事件_E016",
      "/事件_E017",
      "/事件_E018",
      "/事件_E019",
      "/事件_E020",
      "/事件_E021",
      "/事件_E022",
      "/事件_E023",
      "/事件_E024",
      "/事件_E025",
      "/事件_E026",
      "/事件_E027",
      "/事件_E028",
      "/事件_E029",
      "/事件_E030",
      "/事件_E031",
      "/事件_E032",
      "/事件_E033",
      "/事件_E034",
      "/事件_E035",
      "/事件_E036",
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.fields[0]).toEqual({
      pointer: "/事件_E001",
      start: 32,
      end: 39,
      line: 2,
      column: 7,
    });
  });
});
