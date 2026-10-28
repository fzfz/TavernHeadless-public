import { describe, expect, it } from "vitest";
import { apiErrorMessages, type NativeCardPackage } from "@tavern/shared";
import { validateNativeCardStatePackage } from "../state-package-validator.js";

function stateFile(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function packageForStateValidation(
  options: {
    files?: Record<string, Uint8Array>;
    stateSchemaFile?: string;
    factsSchema?: unknown;
    initialState?: Uint8Array;
  } = {},
): NativeCardPackage {
  const files = new Map<string, Uint8Array>(
    Object.entries(options.files ?? {}),
  );
  if (options.initialState) {
    files.set("state/initial/start.json", options.initialState);
  }
  return {
    files,
    openings: {
      items: [{ initialStateFile: "state/initial/start.json" }],
    },
    stateUpdateProfile: options.stateSchemaFile
      ? {
          stateSchemaFile: options.stateSchemaFile,
          ...(options.factsSchema !== undefined
            ? { factsSchema: options.factsSchema }
            : {}),
        }
      : undefined,
  } as unknown as NativeCardPackage;
}

describe("native card state package validation", () => {
  it("uses the fixed state schema before the profile path", () => {
    const nativePackage = packageForStateValidation({
      files: {
        "state/schema.json": stateFile({
          type: "object",
          required: ["fixed"],
        }),
        "state/custom-schema.json": stateFile({
          type: "object",
          required: ["profile"],
        }),
      },
      stateSchemaFile: "state/custom-schema.json",
      initialState: stateFile({ fixed: true }),
    });

    expect(validateNativeCardStatePackage(nativePackage)).toEqual([]);
  });

  it("reports facts schema compilation failures at the profile path", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({ type: "object" }),
        },
        stateSchemaFile: "state/schema.json",
        factsSchema: { $ref: "#/$defs/missing" },
        initialState: stateFile({}),
      }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
      path: "agents/state-update/profile.json",
      message: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
      action: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
    });
  });

  it("reports a state schema compilation failure before the opening missing-schema issue", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({ $ref: "#/$defs/missing" }),
        },
        stateSchemaFile: "state/schema.json",
        initialState: stateFile({ mood: "calm" }),
      }),
    );

    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/schema.json",
      },
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/initial/start.json",
      },
    ]);
  });

  it("uses a profile schema when the fixed schema file is absent", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/custom-schema.json": Buffer.from("{invalid", "utf8"),
        },
        stateSchemaFile: "state/custom-schema.json",
        initialState: stateFile({ mood: "calm" }),
      }),
    );

    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/custom-schema.json",
      },
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/initial/start.json",
      },
    ]);
  });

  it("reports schema parse, facts compilation, and opening parse issues in order", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": Buffer.from("{invalid", "utf8"),
        },
        stateSchemaFile: "state/schema.json",
        factsSchema: { $ref: "#/$defs/missing" },
        initialState: Buffer.from("{invalid", "utf8"),
      }),
    );

    expect(issues).toHaveLength(3);
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/schema.json",
      },
      {
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "agents/state-update/profile.json",
      },
      {
        code: "NATIVE_CARD_INITIAL_STATE_INVALID",
        path: "state/initial/start.json",
      },
    ]);
    expect(issues[0]?.message).toBe(
      apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
    );
    expect(issues[2]?.message).toBe(
      apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
    );
  });

  it("uses the profile schema fallback and reports every initial state violation", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/custom-schema.json": stateFile({
            type: "object",
            required: ["mood", "score"],
          }),
        },
        stateSchemaFile: "state/custom-schema.json",
        initialState: stateFile({}),
      }),
    );

    expect(issues).toHaveLength(2);
    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_INITIAL_STATE_INVALID",
        path: "state/initial/start.json",
        pointer: "/",
        message: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        action: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        expected: expect.stringContaining("must have required property"),
      }),
      expect.objectContaining({
        code: "NATIVE_CARD_INITIAL_STATE_INVALID",
        path: "state/initial/start.json",
        pointer: "/",
        message: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        action: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        expected: expect.stringContaining("must have required property"),
      }),
    ]);
  });

  it("reports an initial state whose schema file is missing", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        stateSchemaFile: "state/missing-schema.json",
        initialState: stateFile({ mood: "calm" }),
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/initial/start.json",
        message: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        action: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        expected:
          "The package must declare state/schema.json before it can provide opening initial state.",
      }),
    ]);
  });

  it("skips an initial state file that is absent from the package files", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({ type: "object" }),
        },
        stateSchemaFile: "state/schema.json",
      }),
    );

    expect(issues).toEqual([]);
  });
  it("reports the invalid state schema keyword location through package issues", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({ type: "object", required: "score" }),
        },
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/schema.json",
        pointer: "/required",
        message: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        action: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        expected: "type: must be array",
      }),
    ]);
  });
  it("keeps facts schema references to the compiled state schema available", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({
            $id: "https://example.test/state.json",
            type: "object",
            required: ["score"],
          }),
        },
        stateSchemaFile: "state/schema.json",
        factsSchema: { $ref: "https://example.test/state.json" },
        initialState: stateFile({ score: 1 }),
      }),
    );

    expect(issues).toEqual([]);
  });

  it("locates an invalid facts schema keyword inside the profile document", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: { "state/schema.json": stateFile({ type: "object" }) },
        stateSchemaFile: "state/schema.json",
        factsSchema: { required: "score" },
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "agents/state-update/profile.json",
        pointer: "/factsSchema/required",
        expected: "type: must be array",
      }),
    ]);
  });

  it("locates an unresolved state schema reference in package diagnostics", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({
            properties: { score: { $ref: "#/$defs/missing" } },
          }),
        },
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/schema.json",
        pointer: "/properties/score/$ref",
        expected: "can't resolve reference #/$defs/missing from id #",
      }),
    ]);
  });

  it("requires a state schema when an opening supplies initial state without a profile", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({ initialState: stateFile({ score: 1 }) }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/initial/start.json",
      }),
    ]);
  });

  it.each([
    {
      name: "structure, required properties, additional properties and scalar types",
      schema: {
        type: "object",
        properties: { score: { type: "integer" }, mode: { type: "string" } },
        required: ["mode"],
        additionalProperties: false,
      },
      invalid: { score: "1", extra: true },
      valid: { mode: "active", score: 1 },
      expected: [
        "required: must have required property 'mode'",
        "additionalProperties: must NOT have additional properties",
        "type: must be integer",
      ],
    },
    {
      name: "value constraints",
      schema: {
        properties: {
          score: { type: "number", maximum: 5 },
          mode: { enum: ["calm"] },
          tag: { type: "string", pattern: "^A", minLength: 2 },
        },
      },
      invalid: { score: 6, mode: "angry", tag: "B" },
      valid: { score: 5, mode: "calm", tag: "AB" },
      expected: [
        "maximum: must be <= 5",
        "enum: must be equal to one of the allowed values",
        'pattern: must match pattern "^A"',
        "minLength: must NOT have fewer than 2 characters",
      ],
    },
    {
      name: "array constraints",
      schema: {
        properties: {
          events: {
            type: "array",
            items: { type: "integer" },
            uniqueItems: true,
            maxItems: 1,
          },
        },
      },
      invalid: { events: [1, 1] },
      valid: { events: [1] },
      expected: [
        "maxItems: must NOT have more than 1 items",
        expect.stringContaining("uniqueItems: must NOT have duplicate items"),
      ],
    },
    {
      name: "combination and dependent constraints",
      schema: {
        properties: {
          score: { anyOf: [{ type: "integer" }, { type: "boolean" }] },
          mode: { oneOf: [{ const: "calm" }, { const: "angry" }] },
        },
        dependentRequired: { score: ["tag"] },
      },
      invalid: { score: "1", mode: "alert" },
      valid: { score: 1, mode: "calm", tag: "A" },
      expected: [
        "anyOf: must match a schema in anyOf",
        "oneOf: must match exactly one schema in oneOf",
        "dependentRequired: must have property tag when property score is present",
      ],
    },
  ])(
    "validates opening $name through the formal package interface",
    ({ schema, invalid, valid, expected }) => {
      const nativePackage = packageForStateValidation({
        files: { "state/schema.json": stateFile(schema) },
        initialState: stateFile(invalid),
      });

      const issues = validateNativeCardStatePackage(nativePackage);
      expect(issues.map((issue) => issue.expected)).toEqual(
        expect.arrayContaining(expected),
      );
      expect(
        issues.every(
          (issue) =>
            issue.code === "NATIVE_CARD_INITIAL_STATE_INVALID" &&
            issue.path === "state/initial/start.json",
        ),
      ).toBe(true);
      const validPackage = packageForStateValidation({
        files: { "state/schema.json": stateFile(schema) },
        initialState: stateFile(valid),
      });
      expect(validateNativeCardStatePackage(validPackage)).toEqual([]);
    },
  );

  it.each([
    { file: "state/schema.json", code: "NATIVE_CARD_STATE_SCHEMA_INVALID" },
    {
      file: "state/initial/start.json",
      code: "NATIVE_CARD_INITIAL_STATE_INVALID",
    },
  ])("reports invalid UTF-8 in $file", ({ file, code }) => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({ type: "object" }),
          [file]: Uint8Array.of(0xff),
        },
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code,
        path: file,
        expected: expect.stringContaining("encoded data"),
      }),
    ]);
  });
  it("rejects asynchronous state schemas before accepting opening initial state", () => {
    const issues = validateNativeCardStatePackage(
      packageForStateValidation({
        files: {
          "state/schema.json": stateFile({
            $async: true,
            type: "object",
            required: ["score"],
          }),
        },
        initialState: stateFile({}),
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/schema.json",
        pointer: "/$async",
        expected: expect.stringContaining("同步执行"),
      }),
      expect.objectContaining({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: "state/initial/start.json",
      }),
    ]);
  });
});
