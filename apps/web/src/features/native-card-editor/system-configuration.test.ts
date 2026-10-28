import { describe, expect, it } from "vitest";
import { stateUpdaterSlot } from "@tavern/shared";
import { buildNativeCardSystemConfiguration } from "./system-configuration.js";

const base = {
  presetId: "preset-1",
  presetVersionId: "preset-version-1",
  defaultUserId: "user-1",
  promptMode: "native" as const,
  narratorProfileId: "narrator-profile",
};

describe("native card system configuration", () => {
  it("binds the narrator and state updater to their dedicated model profiles", () => {
    expect(buildNativeCardSystemConfiguration({
      ...base,
      stateUpdateRequired: true,
      stateUpdaterProfileId: "updater-profile",
    })).toEqual({
      presetId: "preset-1",
      presetVersionId: "preset-version-1",
      defaultUserId: "user-1",
      promptMode: "native",
      modelSlots: [
        { slot: "narrator", profile_id: "narrator-profile" },
        { slot: stateUpdaterSlot, profile_id: "updater-profile" },
      ],
    });
  });

  it("requires an explicit narrator and updater profile when state updates are configured", () => {
    expect(buildNativeCardSystemConfiguration({
      ...base,
      narratorProfileId: "",
      stateUpdateRequired: true,
      stateUpdaterProfileId: "updater-profile",
    })).toBeUndefined();
    expect(buildNativeCardSystemConfiguration({
      ...base,
      stateUpdateRequired: true,
      stateUpdaterProfileId: "",
    })).toBeUndefined();
  });

  it("adds an optional versioned state prompt override and history window", () => {
    expect(buildNativeCardSystemConfiguration({
      ...base,
      stateUpdateRequired: true,
      stateUpdaterProfileId: "updater-profile",
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 0,
    })).toMatchObject({
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 0,
    });
    expect(buildNativeCardSystemConfiguration({
      ...base,
      stateUpdateRequired: true,
      stateUpdaterProfileId: "updater-profile",
      statePresetId: "state-preset",
    })).toBeUndefined();
  });

  it("omits the updater slot only when the card has no state update profile", () => {
    expect(buildNativeCardSystemConfiguration({ ...base, stateUpdateRequired: false })).toEqual({
      presetId: "preset-1",
      presetVersionId: "preset-version-1",
      defaultUserId: "user-1",
      promptMode: "native",
      modelSlots: [{ slot: "narrator", profile_id: "narrator-profile" }],
    });
  });
});
