import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

import { convertOpenApi30Document } from "../openapi-schema.js";

function convertSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return convertOpenApi30Document({
    openapi: "3.0.3",
    components: { schemas: { Value: schema } },
  }).components.schemas.Value;
}

describe("OpenAPI 3.0 schema conversion", () => {
  it("preserves declared property constraints and required names while closing finite keys", () => {
    const source = {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["write"] },
        count: { type: "integer", minimum: 1 },
      },
      required: ["operation", "count"],
      propertyNames: { anyOf: [{ enum: ["operation", "count"] }] },
    };

    const converted = convertSchema(source);
    expect(converted).toEqual({
      type: "object",
      properties: source.properties,
      required: ["operation", "count"],
      additionalProperties: false,
    });
    const validate = new Ajv({ strict: false }).compile(converted);
    expect(validate({ operation: "write", count: 1 })).toBe(true);
    expect(validate({ operation: "move", count: 1 })).toBe(false);
    expect(validate({ operation: "write", count: 0 })).toBe(false);
    expect(validate({ operation: "write" })).toBe(false);
    expect(validate({ operation: "write", count: 1, unknown: true })).toBe(
      false,
    );
    expect(source.propertyNames).toEqual({
      anyOf: [{ enum: ["operation", "count"] }],
    });
    expect(source).not.toHaveProperty("additionalProperties");
  });
  it("expands finite dictionaries from their value schema and preserves existing overrides", () => {
    const converted = convertSchema({
      type: "object",
      propertyNames: { enum: ["read", "write", "delete"] },
      properties: { read: { type: "integer", minimum: 2 } },
      additionalProperties: { type: "integer", minimum: 0 },
      required: ["read"],
    });

    expect(converted).toEqual({
      type: "object",
      properties: {
        read: { type: "integer", minimum: 2 },
        write: { type: "integer", minimum: 0 },
        delete: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
      required: ["read"],
    });
    const validate = new Ajv({ strict: false }).compile(converted);
    expect(validate({ read: 2, write: 0, delete: 1 })).toBe(true);
    expect(validate({ read: 1 })).toBe(false);
    expect(validate({ read: 2, write: "0" })).toBe(false);
    expect(validate({ read: 2, delete: -1 })).toBe(false);
    expect(validate({ read: 2, other: 1 })).toBe(false);
  });

  it("keeps allowed missing properties optional and honors closed dictionaries", () => {
    expect(
      convertSchema({
        type: "object",
        propertyNames: { enum: ["first", "second"] },
      }),
    ).toEqual({
      type: "object",
      properties: { first: {}, second: {} },
      additionalProperties: false,
    });

    const converted = convertSchema({
      type: "object",
      properties: { first: { type: "string" }, forbidden: { type: "string" } },
      propertyNames: { enum: ["first", "second"] },
      additionalProperties: false,
    });
    expect(converted).toEqual({
      type: "object",
      properties: { first: { type: "string" } },
      additionalProperties: false,
    });
    const validate = new Ajv({ strict: false }).compile(converted);
    expect(validate({ first: "allowed" })).toBe(true);
    expect(validate({ second: "closed" })).toBe(false);
    expect(validate({ forbidden: "excluded" })).toBe(false);
  });

  it.each(["anyOf", "oneOf"])(
    "keeps %s branches strict without changing their alternatives",
    (keyword) => {
      const branches = [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["write"] },
            text: { type: "string" },
          },
          required: ["kind", "text"],
          propertyNames: { anyOf: [{ enum: ["kind", "text"] }] },
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["delete"] },
            path: { type: "string" },
          },
          required: ["kind", "path"],
          propertyNames: { anyOf: [{ enum: ["kind", "path"] }] },
        },
      ];
      const converted = convertSchema({ [keyword]: branches });
      const ajv = new Ajv({ strict: false });
      const validateSource = ajv.compile({ [keyword]: branches });
      const validateConverted = ajv.compile(converted);
      for (const [value, valid] of [
        [{ kind: "write", text: "value" }, true],
        [{ kind: "delete", path: "path" }, true],
        [{ kind: "write", text: "value", unknown: 1 }, false],
        [{ kind: "delete", path: "path", text: "wrong branch" }, false],
        [{ kind: "write", text: 1 }, false],
        [{ kind: "delete" }, false],
      ] as const) {
        expect(validateSource(value)).toBe(valid);
        expect(validateConverted(value)).toBe(valid);
      }
    },
  );

  it("retains arbitrary dictionary values and nested value restrictions", () => {
    const source = {
      type: "object",
      propertyNames: { type: "string" },
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          properties: { count: { type: "integer" } },
          propertyNames: { enum: ["count"] },
        },
      },
    };
    const converted = convertSchema(source);
    expect(converted).not.toHaveProperty("propertyNames");
    const validate = new Ajv({ strict: false }).compile(converted);
    expect(validate({ arbitrary: [{ count: 1 }], another: [] })).toBe(true);
    expect(validate({ arbitrary: [{ count: "1" }] })).toBe(false);
    expect(validate({ arbitrary: [{ extra: 1 }] })).toBe(false);
    expect(validate({ arbitrary: 1 })).toBe(false);
  });

  it("preserves schema-shaped business data in examples, defaults, enums and extensions", () => {
    const value = {
      propertyNames: { pattern: "^business" },
      properties: { sample: { propertyNames: false } },
      schema: { propertyNames: { enum: ["business"] } },
    };
    const source = {
      openapi: "3.0.3",
      components: {
        schemas: {
          Value: {
            type: "object",
            propertyNames: { type: "string" },
            example: value,
            default: value,
            enum: [value],
            "x-business": value,
            properties: { propertyNames: { type: "string" } },
          },
        },
        examples: { Value: { value } },
      },
      paths: {
        "/example": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    propertyNames: { type: "string" },
                    example: value,
                  },
                  example: value,
                  examples: { Value: { value } },
                },
              },
            },
          },
        },
      },
    };
    const converted = convertOpenApi30Document(source);
    expect(converted.components.schemas.Value).not.toHaveProperty(
      "propertyNames",
    );
    expect(converted.components.schemas.Value.properties.propertyNames).toEqual(
      { type: "string" },
    );
    expect(converted.components.schemas.Value.example).toEqual(value);
    expect(converted.components.schemas.Value.default).toEqual(value);
    expect(converted.components.schemas.Value.enum).toEqual([value]);
    expect(converted.components.schemas.Value["x-business"]).toEqual(value);
    expect(converted.components.examples).toEqual(source.components.examples);
    const media =
      converted.paths["/example"].post.requestBody.content["application/json"];
    expect(media.schema).not.toHaveProperty("propertyNames");
    expect(media.schema.example).toEqual(value);
    expect(media.example).toEqual(value);
    expect(media.examples).toEqual({ Value: { value } });
    expect(source.components.schemas.Value.propertyNames).toEqual({
      type: "string",
    });
  });

  it("converts schemas in parameters, headers, request bodies, responses, encoding and callbacks", () => {
    const schema = () => ({
      type: "object",
      propertyNames: { type: "string" },
    });
    const content = () => ({
      content: { "application/json": { schema: schema() } },
    });
    const callback = () => ({
      "{$request.body#/url}": { post: { requestBody: content() } },
    });
    const source = {
      components: {
        parameters: { Value: { schema: schema() } },
        headers: { Value: { schema: schema() } },
        requestBodies: { Value: content() },
        responses: {
          Value: { ...content(), headers: { Value: { schema: schema() } } },
        },
        callbacks: { Value: callback() },
      },
      paths: {
        "/value": {
          parameters: [{ schema: schema() }],
          post: {
            parameters: [content()],
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: schema(),
                  encoding: {
                    file: { headers: { Value: { schema: schema() } } },
                  },
                },
              },
            },
            responses: {
              "200": { ...content(), headers: { Value: { schema: schema() } } },
            },
            callbacks: { Value: callback() },
          },
        },
      },
    };
    const converted = convertOpenApi30Document(source);
    const components = converted.components;
    const pathItem = converted.paths["/value"];
    for (const node of [
      components.parameters.Value.schema,
      components.headers.Value.schema,
      components.requestBodies.Value.content["application/json"].schema,
      components.responses.Value.content["application/json"].schema,
      components.responses.Value.headers.Value.schema,
      components.callbacks.Value["{$request.body#/url}"].post.requestBody
        .content["application/json"].schema,
      pathItem.parameters[0]?.schema,
      pathItem.post.parameters[0]?.content["application/json"].schema,
      pathItem.post.requestBody.content["multipart/form-data"].schema,
      pathItem.post.requestBody.content["multipart/form-data"].encoding.file
        .headers.Value.schema,
      pathItem.post.responses["200"].content["application/json"].schema,
      pathItem.post.responses["200"].headers.Value.schema,
      pathItem.post.callbacks.Value["{$request.body#/url}"].post.requestBody
        .content["application/json"].schema,
    ]) {
      expect(node).toEqual({ type: "object" });
    }
  });

  it("preserves OpenAPI extension business data in path and response maps", () => {
    const value = {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { propertyNames: { type: "string" } },
            },
          },
        },
      },
      content: {
        "application/json": { schema: { propertyNames: { type: "string" } } },
      },
    };
    const source = {
      paths: {
        "x-business": value,
        "/value": {
          post: {
            responses: { "x-business": value },
            callbacks: { "x-business": value },
          },
        },
      },
    };
    expect(convertOpenApi30Document(source)).toEqual(source);
  });

  it.each([
    [{ exclusiveMinimum: 1 }, [0, 1, 1.01], [false, false, true]],
    [
      { minimum: 2, exclusiveMinimum: 1 },
      [1, 1.5, 2, 3],
      [false, false, true, true],
    ],
    [{ minimum: 1, exclusiveMinimum: 2 }, [1, 2, 2.01], [false, false, true]],
    [{ minimum: 2, exclusiveMinimum: 2 }, [1, 2, 2.01], [false, false, true]],
    [{ exclusiveMaximum: 2 }, [1.99, 2, 3], [true, false, false]],
    [
      { maximum: 1, exclusiveMaximum: 2 },
      [0, 1, 1.5, 2],
      [true, true, false, false],
    ],
    [{ maximum: 2, exclusiveMaximum: 1 }, [0.99, 1, 2], [true, false, false]],
    [{ maximum: 1, exclusiveMaximum: 1 }, [0.99, 1, 2], [true, false, false]],
    [
      { exclusiveMinimum: -1, exclusiveMaximum: 1 },
      [-1, 0, 1],
      [false, true, false],
    ],
  ])(
    "preserves inclusive and exclusive numeric limits: %j",
    (limits, values, expected) => {
      const source = { type: "number", ...limits };
      const converted = convertSchema(source);
      expect(typeof converted.exclusiveMinimum).not.toBe("number");
      expect(typeof converted.exclusiveMaximum).not.toBe("number");
      const ajv = new Ajv({ strict: false });
      const originalValidator = ajv.compile(source);
      const lowerBound = converted.minimum;
      const upperBound = converted.maximum;
      for (const [index, value] of values.entries()) {
        expect(originalValidator(value)).toBe(expected[index]);
        const aboveMinimum =
          typeof lowerBound !== "number" ||
          (converted.exclusiveMinimum === true
            ? value > lowerBound
            : value >= lowerBound);
        const belowMaximum =
          typeof upperBound !== "number" ||
          (converted.exclusiveMaximum === true
            ? value < upperBound
            : value <= upperBound);
        expect(aboveMinimum && belowMaximum).toBe(expected[index]);
      }
    },
  );

  it.each([
    [
      { then: { required: ["enabled"] }, else: { required: ["disabled"] } },
      [
        [{ mode: "on", enabled: true }, true],
        [{ mode: "on", disabled: true }, false],
        [{ mode: "off", disabled: true }, true],
        [{ mode: "off", enabled: true }, false],
      ],
    ],
    [
      { then: { required: ["enabled"] } },
      [
        [{ mode: "on", enabled: true }, true],
        [{ mode: "on" }, false],
        [{ mode: "off" }, true],
      ],
    ],
    [
      { else: { required: ["disabled"] } },
      [
        [{ mode: "on" }, true],
        [{ mode: "off", disabled: true }, true],
        [{ mode: "off" }, false],
      ],
    ],
    [
      {},
      [
        [{ mode: "on" }, true],
        [{ mode: "off" }, true],
      ],
    ],
    [
      { then: false, else: true },
      [
        [{ mode: "on" }, false],
        [{ mode: "off" }, true],
      ],
    ],
  ])(
    "preserves conditional branches and their missing alternatives: %j",
    (branches, samples) => {
      const source = {
        type: "object",
        properties: { mode: { type: "string" } },
        required: ["mode"],
        allOf: [{ properties: { mode: { minLength: 2 } } }],
        anyOf: [{ required: ["mode"] }],
        if: { properties: { mode: { enum: ["on"] } }, required: ["mode"] },
        ...branches,
      };
      const converted = convertSchema(source);
      expect(converted).not.toHaveProperty("if");
      expect(converted).not.toHaveProperty("then");
      expect(converted).not.toHaveProperty("else");
      const ajv = new Ajv({ strict: false });
      const originalValidator = ajv.compile(source);
      const convertedValidator = ajv.compile(converted);
      for (const [value, valid] of samples) {
        expect(originalValidator(value)).toBe(valid);
        expect(convertedValidator(value)).toBe(valid);
      }
      expect(convertedValidator({ mode: "x" })).toBe(false);
      expect(convertedValidator({})).toBe(false);
    },
  );

  it("removes ignored conditional branches and converts nested conditions", () => {
    expect(
      convertSchema({
        type: "string",
        then: { minLength: 3 },
        else: { maxLength: 1 },
      }),
    ).toEqual({ type: "string" });
    const converted = convertSchema({
      if: { type: "object", propertyNames: { enum: ["key"] } },
      then: {
        properties: { key: { type: "number", minimum: 1 } },
        if: { required: ["key"] },
        then: { required: ["key"] },
      },
      else: false,
    });
    expect(JSON.stringify(converted)).not.toContain('"propertyNames"');
    expect(JSON.stringify(converted)).not.toContain('"if"');
    const validate = new Ajv({ strict: false }).compile(converted);
    expect(validate({ key: 1 })).toBe(true);
    expect(validate({ key: 0 })).toBe(false);
    expect(validate({ other: 1 })).toBe(false);
  });

  it.each([
    { pattern: "^key" },
    { type: "string", minLength: 1 },
    { allOf: [{ enum: ["key"] }] },
    { anyOf: [{ enum: ["key"] }, { type: "string", pattern: "^other" }] },
    false,
  ])(
    "rejects property-name constraints that cannot be represented exactly: %j",
    (propertyNames) => {
      expect(() => convertSchema({ type: "object", propertyNames })).toThrow(
        /#\/components\/schemas\/Value\/propertyNames.*OpenAPI 3\.0\.3/,
      );
    },
  );

  it.each([
    { patternProperties: { "^key": { type: "string" } } },
    { $ref: "#/components/schemas/Other" },
  ])(
    "rejects finite-key conversion with unevaluated name constraints: %j",
    (constraints) => {
      expect(() =>
        convertSchema({
          type: "object",
          propertyNames: { enum: ["key"] },
          ...constraints,
        }),
      ).toThrow(/propertyNames.*patternProperties or \$ref/);
    },
  );
});
