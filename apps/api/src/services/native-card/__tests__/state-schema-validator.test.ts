import { describe, expect, it } from "vitest";
import {
  compileNativeCardStateSchema,
  createNativeCardStateSchemaCompiler,
} from "../state-schema-validator.js";

describe("native card state schema validation", () => {
  it("reports every candidate-state violation with locations and expected constraints", () => {
    const compiled = compileNativeCardStateSchema(
      {
        type: "object",
        properties: { score: { type: "integer" } },
        additionalProperties: false,
      },
      "state/schema.json",
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("The state schema must compile.");
    expect(
      compiled.validate(
        { score: "2", extra: true },
        "state/initial/start.json",
      ),
    ).toEqual([
      {
        file: "state/initial/start.json",
        pointer: "",
        schemaPath: "#/additionalProperties",
        keyword: "additionalProperties",
        expected: { additionalProperty: "extra" },
        message: "must NOT have additional properties",
      },
      {
        file: "state/initial/start.json",
        pointer: "/score",
        schemaPath: "#/properties/score/type",
        keyword: "type",
        expected: { type: "integer" },
        message: "must be integer",
      },
    ]);
  });
  it("locates invalid schema keyword values through the AJV meta-schema", () => {
    const compiled = compileNativeCardStateSchema(
      { properties: { score: { type: 42 } } },
      "state/schema.json",
    );

    expect(compiled).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          file: "state/schema.json",
          pointer: "/properties/score/type",
          schemaPath: "#/$defs/simpleTypes/enum",
          keyword: "enum",
          expected: {
            allowedValues: [
              "array",
              "boolean",
              "integer",
              "null",
              "number",
              "object",
              "string",
            ],
          },
          message: "must be equal to one of the allowed values",
        },
      ]),
    });
  });
  it("locates an unresolved reference and escapes its schema property name", () => {
    const compiled = compileNativeCardStateSchema(
      { properties: { "a/b~": { $ref: "#/$defs/missing" } } },
      "state/schema.json",
    );

    expect(compiled).toEqual({
      ok: false,
      issues: [
        {
          file: "state/schema.json",
          pointer: "/properties/a~1b~0/$ref",
          schemaPath: "#/properties/a~1b~0/$ref",
          keyword: "$ref",
          expected: { missingRef: "#/$defs/missing", missingSchema: "" },
          message: "can't resolve reference #/$defs/missing from id #",
        },
      ],
    });
  });
  it("resolves reference diagnostics within nested $id scopes", () => {
    const compiled = compileNativeCardStateSchema(
      {
        $id: "https://example.test/root.json",
        properties: {
          score: {
            $id: "nested/",
            $ref: "missing.json",
          },
        },
      },
      "state/schema.json",
    );

    expect(compiled).toMatchObject({
      ok: false,
      issues: [
        {
          pointer: "/properties/score/$ref",
          schemaPath: "#/properties/score/$ref",
          keyword: "$ref",
          expected: {
            missingRef: "https://example.test/nested/missing.json",
            missingSchema: "https://example.test/nested/missing.json",
          },
        },
      ],
    });
  });

  it("reports ambiguous reference locations as explicit candidates", () => {
    const compiled = compileNativeCardStateSchema(
      {
        properties: {
          first: { $ref: "#/$defs/missing" },
          second: { $ref: "#/$defs/missing" },
        },
      },
      "state/schema.json",
    );

    expect(compiled).toMatchObject({
      ok: false,
      issues: [
        {
          pointer: "",
          schemaPath: "#",
          keyword: "$ref",
          expected: {
            missingRef: "#/$defs/missing",
            missingSchema: "",
            candidateReferences: [
              {
                pointer: "/properties/first/$ref",
                ref: "#/$defs/missing",
                baseId: "",
              },
              {
                pointer: "/properties/second/$ref",
                ref: "#/$defs/missing",
                baseId: "",
              },
            ],
          },
        },
      ],
    });
  });

  it.each([
    {
      name: "object type",
      schema: { type: "object" },
      invalid: [],
      valid: {},
      keyword: "type",
    },
    {
      name: "array item structure",
      schema: { type: "array", items: { type: "object", required: ["score"] } },
      invalid: [{}],
      valid: [{ score: 1 }],
      keyword: "required",
    },
    {
      name: "required properties",
      schema: { type: "object", required: ["score"] },
      invalid: {},
      valid: { score: 1 },
      keyword: "required",
    },
    {
      name: "integer type",
      schema: { type: "integer" },
      invalid: 1.5,
      valid: 1,
      keyword: "type",
    },
    {
      name: "boolean type",
      schema: { type: "boolean" },
      invalid: "false",
      valid: false,
      keyword: "type",
    },
    {
      name: "nullable type",
      schema: { type: ["null", "string"] },
      invalid: 0,
      valid: null,
      keyword: "type",
    },
    {
      name: "enum values",
      schema: { enum: ["calm", "alert"] },
      invalid: "angry",
      valid: "calm",
      keyword: "enum",
    },
    {
      name: "constant value",
      schema: { const: false },
      invalid: true,
      valid: false,
      keyword: "const",
    },
    {
      name: "minimum value",
      schema: { type: "number", minimum: 0 },
      invalid: -1,
      valid: 0,
      keyword: "minimum",
    },
    {
      name: "maximum value",
      schema: { type: "number", maximum: 5 },
      invalid: 6,
      valid: 5,
      keyword: "maximum",
    },
    {
      name: "exclusive lower bound",
      schema: { type: "number", exclusiveMinimum: 0 },
      invalid: 0,
      valid: 1,
      keyword: "exclusiveMinimum",
    },
    {
      name: "exclusive upper bound",
      schema: { type: "number", exclusiveMaximum: 5 },
      invalid: 5,
      valid: 4,
      keyword: "exclusiveMaximum",
    },
    {
      name: "numeric multiple",
      schema: { type: "number", multipleOf: 2 },
      invalid: 3,
      valid: 4,
      keyword: "multipleOf",
    },
    {
      name: "minimum string length",
      schema: { type: "string", minLength: 2 },
      invalid: "a",
      valid: "ab",
      keyword: "minLength",
    },
    {
      name: "maximum string length",
      schema: { type: "string", maxLength: 2 },
      invalid: "abc",
      valid: "ab",
      keyword: "maxLength",
    },
    {
      name: "string pattern",
      schema: { type: "string", pattern: "^A" },
      invalid: "B",
      valid: "A",
      keyword: "pattern",
    },
    {
      name: "minimum array size",
      schema: { type: "array", minItems: 1 },
      invalid: [],
      valid: [0],
      keyword: "minItems",
    },
    {
      name: "maximum array size",
      schema: { type: "array", maxItems: 1 },
      invalid: [0, 1],
      valid: [0],
      keyword: "maxItems",
    },
    {
      name: "unique array items",
      schema: { type: "array", uniqueItems: true },
      invalid: [0, 0],
      valid: [0, 1],
      keyword: "uniqueItems",
    },
    {
      name: "tuple item type",
      schema: { type: "array", prefixItems: [{ type: "string" }] },
      invalid: [1],
      valid: ["one"],
      keyword: "type",
    },
    {
      name: "tuple additional items",
      schema: {
        type: "array",
        prefixItems: [{ type: "string" }],
        items: false,
      },
      invalid: ["one", "two"],
      valid: ["one"],
      keyword: "items",
    },
    {
      name: "allOf constraints",
      schema: { allOf: [{ minimum: 0 }, { maximum: 5 }] },
      invalid: 6,
      valid: 5,
      keyword: "maximum",
    },
    {
      name: "anyOf alternatives",
      schema: { anyOf: [{ type: "number" }, { type: "boolean" }] },
      invalid: "1",
      valid: 1,
      keyword: "anyOf",
    },
    {
      name: "oneOf exclusivity",
      schema: { oneOf: [{ type: "number" }, { type: "integer" }] },
      invalid: 1,
      valid: 1.5,
      keyword: "oneOf",
    },
    {
      name: "not constraint",
      schema: { not: { const: "blocked" } },
      invalid: "blocked",
      valid: "allowed",
      keyword: "not",
    },
    {
      name: "conditional then",
      schema: {
        if: { properties: { mode: { const: "active" } } },
        then: { required: ["score"] },
      },
      invalid: { mode: "active" },
      valid: { mode: "active", score: 1 },
      keyword: "required",
    },
    {
      name: "conditional else",
      schema: {
        if: { properties: { mode: { const: "active" } } },
        else: { required: ["reason"] },
      },
      invalid: { mode: "idle" },
      valid: { mode: "idle", reason: "rest" },
      keyword: "required",
    },
    {
      name: "property dependency",
      schema: { dependentRequired: { score: ["mode"] } },
      invalid: { score: 1 },
      valid: { score: 1, mode: "active" },
      keyword: "dependentRequired",
    },
    {
      name: "schema dependency",
      schema: {
        dependentSchemas: {
          score: {
            properties: { mode: { const: "active" } },
            required: ["mode"],
          },
        },
      },
      invalid: { score: 1, mode: "idle" },
      valid: { score: 1, mode: "active" },
      keyword: "const",
    },
    {
      name: "local references",
      schema: {
        $defs: { score: { type: "integer" } },
        properties: { score: { $ref: "#/$defs/score" } },
      },
      invalid: { score: "1" },
      valid: { score: 1 },
      keyword: "type",
    },
  ])(
    "validates $name and accepts its valid boundary",
    ({ schema, invalid, valid, keyword }) => {
      const compiled = compileNativeCardStateSchema(
        schema,
        "state/schema.json",
      );

      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error("The state schema must compile.");
      expect(compiled.validate(invalid, "state/initial/start.json")).toEqual(
        expect.arrayContaining([expect.objectContaining({ keyword })]),
      );
      expect(compiled.validate(valid, "state/initial/start.json")).toEqual([]);
    },
  );

  it("preserves candidate values and schema defaults during validation", () => {
    const schema = {
      type: "object",
      required: ["mode"],
      properties: {
        mode: { type: "string", default: "calm" },
        score: { type: "number" },
      },
      additionalProperties: false,
    };
    const value = { score: "2", extra: true };
    const compiled = compileNativeCardStateSchema(schema, "state/schema.json");

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("The state schema must compile.");
    expect(compiled.validate(value, "state/initial/start.json")).toHaveLength(
      3,
    );
    expect(value).toEqual({ score: "2", extra: true });
    expect(schema.properties.mode).toEqual({ type: "string", default: "calm" });
  });

  it("keeps optional fields absent and does not enable unregistered formats", () => {
    const compiled = compileNativeCardStateSchema(
      {
        type: "object",
        properties: {
          contact: { type: "string", format: "email" },
          score: { type: "number", default: 0 },
        },
      },
      "state/schema.json",
    );
    const value = { contact: "this is not an email" };

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("The state schema must compile.");
    expect(compiled.validate(value, "state/initial/start.json")).toEqual([]);
    expect(value).toEqual({ contact: "this is not an email" });
  });

  it.each([null, "object", 42, []])(
    "returns diagnostics for an invalid schema document %j",
    (schema) => {
      const compiled = compileNativeCardStateSchema(
        schema,
        "state/schema.json",
      );

      expect(compiled).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            file: "state/schema.json",
            pointer: expect.any(String),
            schemaPath: expect.any(String),
            keyword: expect.any(String),
            expected: expect.any(Object),
            message: expect.any(String),
          }),
        ]),
      });
    },
  );

  it("accepts boolean schemas and preserves a root false-schema violation", () => {
    const accept = compileNativeCardStateSchema(true, "state/schema.json");
    const reject = compileNativeCardStateSchema(false, "state/schema.json");

    expect(accept.ok).toBe(true);
    expect(reject.ok).toBe(true);
    if (!accept.ok || !reject.ok)
      throw new Error("Boolean schemas must compile.");
    expect(accept.validate({ score: 1 }, "state/initial/start.json")).toEqual(
      [],
    );
    expect(reject.validate({}, "state/initial/start.json")).toEqual([
      {
        file: "state/initial/start.json",
        pointer: "",
        schemaPath: "#/false schema",
        keyword: "false schema",
        expected: {},
        message: "boolean schema is false",
      },
    ]);
  });
  it("shares declared schema references within one compiler session", () => {
    const compile = createNativeCardStateSchemaCompiler();
    const state = compile(
      {
        $id: "https://example.test/state.json",
        type: "object",
        required: ["score"],
      },
      "state/schema.json",
    );
    const facts = compile(
      { $ref: "https://example.test/state.json" },
      "agents/state-update/profile.json",
    );

    expect(state.ok).toBe(true);
    expect(facts.ok).toBe(true);
    if (!facts.ok) throw new Error("The facts schema reference must compile.");
    expect(facts.validate({}, "facts.json")).toEqual([
      {
        file: "facts.json",
        pointer: "",
        schemaPath: "https://example.test/state.json/required",
        keyword: "required",
        expected: { missingProperty: "score" },
        message: "must have required property 'score'",
      },
    ]);
  });
  it("rejects an asynchronous schema at the synchronous compilation boundary", () => {
    expect(
      compileNativeCardStateSchema(
        { $async: true, type: "object" },
        "state/schema.json",
      ),
    ).toEqual({
      ok: false,
      issues: [
        {
          file: "state/schema.json",
          pointer: "/$async",
          schemaPath: "#/$async",
          keyword: "$async",
          expected: { $async: false },
          message:
            "状态校验接口只支持同步执行，请将 $async 设为 false 或移除该字段。",
        },
      ],
    });
  });
  it("accepts an explicitly synchronous schema", () => {
    const compiled = compileNativeCardStateSchema(
      { $async: false, type: "integer" },
      "state/schema.json",
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("The synchronous schema must compile.");
    expect(compiled.validate(1, "state/initial/start.json")).toEqual([]);
    expect(compiled.validate("1", "state/initial/start.json")).toEqual([
      expect.objectContaining({
        keyword: "type",
        expected: { type: "integer" },
      }),
    ]);
  });

  it("preserves diagnostics from earlier validations when the same compiler is reused", () => {
    const compile = createNativeCardStateSchemaCompiler();
    const compiled = compile({ type: "integer" }, "state/schema.json");

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("The integer schema must compile.");
    const issues = compiled.validate("1", "state/initial/start.json");
    expect(compiled.validate(1, "state/initial/second.json")).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({
        file: "state/initial/start.json",
        keyword: "type",
        expected: { type: "integer" },
      }),
    ]);
    const invalid = compile({ required: "score" }, "first-schema.json");
    const missingReference = compile(
      { $ref: "#/$defs/missing" },
      "second-schema.json",
    );
    expect(invalid).toMatchObject({ ok: false });
    expect(missingReference).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          file: "second-schema.json",
          keyword: "$ref",
        }),
      ],
    });
  });
});
