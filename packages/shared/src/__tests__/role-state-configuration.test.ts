import { describe, expect, it } from "vitest";
import {
  roleStatePolicy,
  roleStateProfileSchema,
  roleStateRuntimeConfigurationSchema,
} from "../schemas/role-state.js";
import { nativeCardSystemConfigurationSchema } from "../schemas/native-card-api.js";
import { nativeCardStateUpdateProfileSchema } from "../schemas/native-card-package/schema.js";
import { createRoleReleaseBodySchema } from "../schemas/role-release.js";

const statePresetRef = {
  presetId: "state-preset",
  presetVersionId: "state-preset-version",
};

describe("role state preset configuration", () => {
  it("accepts an optional versioned default preset on a package profile", () => {
    const profile = {
      updaterPrompt: "Legacy profile prompt",
      writablePaths: ["/mood"],
      presetRef: statePresetRef,
    };

    expect(roleStateProfileSchema.parse(profile).presetRef).toEqual(statePresetRef);
    expect(nativeCardStateUpdateProfileSchema.parse(profile).presetRef).toEqual(statePresetRef);
    expect(
      roleStateProfileSchema.safeParse({ ...profile, presetRef: { presetId: "state-preset" } }).success,
    ).toBe(false);
  });

  it("uses the shared default history window and accepts zero as an override", () => {
    expect(roleStatePolicy.defaultHistoryTurns).toBe(5);
    expect(
      roleStateRuntimeConfigurationSchema.parse({
        statePresetId: statePresetRef.presetId,
        statePresetVersionId: statePresetRef.presetVersionId,
        stateHistoryTurns: 0,
      }),
    ).toEqual({
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 0,
    });
    expect(
      roleStateRuntimeConfigurationSchema.safeParse({ stateHistoryTurns: -1 }).success,
    ).toBe(false);
    expect(
      roleStateRuntimeConfigurationSchema.safeParse({
        statePresetId: "state-preset",
      }).success,
    ).toBe(false);
  });

  it("accepts the same state runtime overrides on both publication inputs", () => {
    const overrides = {
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 3,
    };
    expect(
      nativeCardSystemConfigurationSchema.parse({
        presetId: "body-preset",
        presetVersionId: "body-version",
        defaultUserId: "persona",
        promptMode: "native",
        modelSlots: [{ slot: "narrator", profile_id: "body-model" }],
        ...overrides,
      }),
    ).toMatchObject(overrides);
    expect(
      createRoleReleaseBodySchema.parse({
        name: "Role",
        character_id: "character",
        character_version_id: "character-version",
        preset_id: "body-preset",
        preset_version_id: "body-version",
        regex_profile_id: null,
        regex_profile_version_id: null,
        worldbook_id: null,
        worldbook_version_id: null,
        prompt_mode: "native",
        model_slots: [{ slot: "narrator", profile_id: "body-model" }],
        default_user_id: "persona",
        ...overrides,
      }),
    ).toMatchObject(overrides);
  });
});
