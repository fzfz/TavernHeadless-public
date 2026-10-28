import { describe, expect, it } from "vitest";
import { createOpeningInitialState } from "./opening-initial-state.js";

describe("opening initial state", () => {
  it("does not create initial state when the package has no schema", () => {
    expect(createOpeningInitialState(undefined)).toBeUndefined();
    expect(createOpeningInitialState({ type: "object" })).toEqual({ values: {}, missingRequired: [] });
  });

  it("fills declared properties with schema defaults or valid primitive values", () => {
    expect(createOpeningInitialState({
      type: "object",
      required: ["place", "hour", "active", "mood"],
      properties: {
        place: { type: "string", default: "雾港" },
        hour: { type: "integer", minimum: 1, maximum: 23 },
        active: { type: "boolean" },
        mood: { enum: ["平静", "紧张"] },
        optional: { type: "string", default: "保留默认值" },
      },
    })).toEqual({
      values: { place: "雾港", hour: 1, active: false, mood: "平静", optional: "保留默认值" },
      missingRequired: [],
    });
  });

  it("does not emit an initial object that cannot satisfy a required property", () => {
    expect(createOpeningInitialState({
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", pattern: "^[A-Z]{4}$" } },
    })).toEqual({ values: {}, missingRequired: ["code"] });
  });
});
