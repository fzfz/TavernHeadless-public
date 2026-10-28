import { describe, expect, it } from "vitest";
import type { CreateRoleReleaseBody, RoleReleasePublic } from "@tavern/shared";
import defaults from "../config/role-app-defaults.json";
import { roleConfigurationIsPublished } from "./role-publication.js";

describe("publication configuration comparison", () => {
  const config = {
    ...defaults,
    model_slots: [
      {
        slot: "narrator",
        profile_id: "model",
        params: { temperature: 0.5, max_output_tokens: 100 },
      },
    ],
  } as CreateRoleReleaseBody;
  const release = {
    ...config,
    model_slots: [
      {
        slot: "narrator",
        profile_id: "model",
        params: { max_output_tokens: 100, temperature: 0.5 },
        profile_snapshot: null,
      },
    ],
  } as RoleReleasePublic;
  it("compares parameters regardless of object field order", () => {
    expect(roleConfigurationIsPublished(config, release)).toBe(true);
  });
  it("compares explicitly selected state configuration against release fields", () => {
    const input = {
      ...config,
      statePresetId: "state",
      statePresetVersionId: "state-v1",
      stateHistoryTurns: 0,
    };
    const published = {
      ...release,
      state_preset_id: "state",
      state_preset_version_id: "state-v1",
      state_history_turns: 0,
    };
    expect(roleConfigurationIsPublished(input, published)).toBe(true);
    expect(
      roleConfigurationIsPublished(
        { ...input, statePresetId: "other" },
        published,
      ),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished(
        { ...input, statePresetVersionId: "other" },
        published,
      ),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished(
        { ...input, stateHistoryTurns: 1 },
        published,
      ),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished(
        {
          ...config,
          statePresetId: undefined,
          statePresetVersionId: undefined,
          stateHistoryTurns: undefined,
        },
        published,
      ),
    ).toBe(true);
  });
  it("recognizes missing publication and changed bindings or parameters", () => {
    expect(roleConfigurationIsPublished(config, undefined)).toBe(false);
    expect(
      roleConfigurationIsPublished(
        { ...config, character_version_id: "other" },
        release,
      ),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished({ ...config, model_slots: [] }, release),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished(
        {
          ...config,
          model_slots: [{ ...config.model_slots[0]!, profile_id: "other" }],
        },
        release,
      ),
    ).toBe(false);
    expect(
      roleConfigurationIsPublished(
        {
          ...config,
          model_slots: [
            { ...config.model_slots[0]!, params: { temperature: 0.7 } },
          ],
        },
        release,
      ),
    ).toBe(false);
  });
  it("compares nested provider parameters structurally", () => {
    const params = {
      stop_sequences: ["END"],
      logit_bias: { "123": 1 },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "output",
          schema: { type: "object", properties: { text: { type: "string" } } },
        },
      },
    } satisfies NonNullable<
      CreateRoleReleaseBody["model_slots"][number]["params"]
    >;
    const input = {
      ...config,
      model_slots: [{ ...config.model_slots[0]!, params }],
    };
    const published = {
      ...release,
      model_slots: [
        { ...release.model_slots[0]!, params: structuredClone(params) },
      ],
    };
    expect(roleConfigurationIsPublished(input, published)).toBe(true);
    published.model_slots[0]!.params!.stop_sequences = ["OTHER"];
    expect(roleConfigurationIsPublished(input, published)).toBe(false);
  });
  it("treats absent and null optional parameters as the same empty set", () => {
    expect(
      roleConfigurationIsPublished(
        { ...config, model_slots: [{ slot: "narrator", profile_id: "model" }] },
        {
          ...release,
          model_slots: [{ ...release.model_slots[0]!, params: null }],
        },
      ),
    ).toBe(true);
  });
});
