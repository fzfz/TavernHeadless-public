import { describe, expect, expectTypeOf, it } from "vitest";

import type { RuntimeParamsResponse } from "../llm-generation-params.js";
import {
  type CreateRoleReleaseBody,
  roleReleaseModelSlotInputSchema,
} from "../role-release.js";

type ReleaseModelSlot = CreateRoleReleaseBody["model_slots"][number];

describe("role release model parameters", () => {
  it("accepts a subset of generation parameters in publication input", () => {
    const input: ReleaseModelSlot = {
      slot: "narrator",
      profile_id: "model",
      params: { temperature: 0.7 },
    };

    expectTypeOf<
      NonNullable<ReleaseModelSlot["params"]>
    >().toEqualTypeOf<RuntimeParamsResponse>();
    expect(roleReleaseModelSlotInputSchema.parse(input)).toEqual(input);
  });

  it.each([undefined, null, {}, { temperature: null }])(
    "preserves omitted, empty, and nullable parameters: %j",
    (params) => {
      const input: ReleaseModelSlot = {
        slot: "narrator",
        profile_id: "model",
        ...(params === undefined ? {} : { params }),
      };

      expect(roleReleaseModelSlotInputSchema.parse(input)).toEqual(input);
    },
  );

  it.each([
    { temperature: 3 },
    { seed: 0.5 },
    { stream: "true" },
    { unsupported: true },
  ])("rejects invalid generation parameters: %j", (params) => {
    expect(
      roleReleaseModelSlotInputSchema.safeParse({
        slot: "narrator",
        profile_id: "model",
        params,
      }),
    ).toMatchObject({ success: false });
  });
});
