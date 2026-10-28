import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import { buildZodObjectSchema } from "../json-schema-zod.js";

describe("JSON Schema object conversion", () => {
  it("preserves required and optional object property types", () => {
    type Parameters = { profile_id: string; temperature?: number | null };
    const schema = buildZodObjectSchema<Parameters>({
      type: "object",
      required: ["profile_id"],
      properties: {
        profile_id: { type: "string" },
        temperature: { type: ["number", "null"], minimum: 0, maximum: 2 },
      },
      additionalProperties: false,
    });
    const parameters: z.infer<typeof schema> = { profile_id: "model" };

    expectTypeOf<z.infer<typeof schema>>().toEqualTypeOf<Parameters>();
    expect(schema.parse(parameters)).toEqual({ profile_id: "model" });
    expect(schema.parse({ profile_id: "model", temperature: null })).toEqual({
      profile_id: "model",
      temperature: null,
    });
    expect(schema.safeParse({})).toMatchObject({ success: false });
    expect(
      schema.safeParse({ profile_id: "model", temperature: 3 }),
    ).toMatchObject({ success: false });
  });

  it("parses configured defaults through field transforms", () => {
    const schema = buildZodObjectSchema(
      {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
        },
      },
      {
        trimStringFields: ["label"],
        coerceBooleanFields: ["enabled"],
        defaultValues: { label: "  configured  ", enabled: 1 },
      },
    );

    expect(schema.parse({})).toEqual({ label: "configured", enabled: true });
  });

  it("rejects configured defaults that violate field constraints", () => {
    const schema = buildZodObjectSchema(
      {
        type: "object",
        properties: { label: { type: "string", minLength: 1 } },
      },
      {
        trimStringFields: ["label"],
        defaultValues: { label: "   " },
      },
    );

    const result = schema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ["label"], code: "too_small" }),
      ]);
    }
  });

  it("reports the object property limit and accepts its boundary", () => {
    const schema = buildZodObjectSchema({
      type: "object",
      additionalProperties: true,
      maxProperties: 2,
    });

    expect(schema.parse({ first: 1, second: 2 })).toEqual({
      first: 1,
      second: 2,
    });

    const result = schema.safeParse({ first: 1, second: 2, third: 3 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          code: "too_big",
          origin: "object",
          maximum: 2,
          inclusive: true,
          path: [],
        }),
      ]);
    }
  });
});
