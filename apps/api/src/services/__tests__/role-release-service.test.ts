import { describe, expect, it, vi } from "vitest";
import { apiErrorMessages } from "@tavern/shared";

import { roleReleaseModelParamsSchema } from "../../routes/schemas/role-releases.js";
import { buildRoleReleaseOpenings, selectRoleReleaseOpening } from "../role-release-service.js";
import { RoleReleaseService, type CreateRoleReleaseSnapshot } from "../role-release-service.js";
import type { DbExecutor } from "../../../test/helpers/create-test-db.js";
import { roleReleases } from "../../db/role-release-schema.js";

describe("role release contract", () => {
  it("uses the shared LLM parameter schema, including reasoning_effort none", () => {
    expect(
      roleReleaseModelParamsSchema.parse({
        reasoning_effort: "none",
        temperature: 0.4,
        max_output_tokens: 256,
      }),
    ).toEqual({
      reasoning_effort: "none",
      temperature: 0.4,
      max_output_tokens: 256,
    });
    expect(
      roleReleaseModelParamsSchema.safeParse({ temperature: 3 }).success,
    ).toBe(false);
    expect(
      roleReleaseModelParamsSchema.safeParse({ unsupported: true }).success,
    ).toBe(false);
  });

  it("freezes primary and alternate greeting metadata into public openings", () => {
    const openings = buildRoleReleaseOpenings({
      name: "Hero",
      primaryGreeting: "Primary",
      alternateGreetings: ["Alternate one", "Alternate two"],
      extensions: {
        tavern_headless: {
          openings: {
            defaultOpeningId: "alternate-1",
            items: [
              {
                id: "first",
                title: "Intro",
                kind: "introduction",
                displayText: "Visible intro",
              },
              {
                id: "alternate-1",
                title: "Start",
                kind: "story",
                variables: { scene: 1 },
              },
            ],
          },
        },
      },
    });

    expect(openings).toEqual([
      expect.objectContaining({
        id: "first",
        source_index: 0,
        display_text: "Visible intro",
        default: false,
      }),
      expect.objectContaining({
        id: "alternate-1",
        source_index: 1,
        variables: { scene: 1 },
        default: true,
      }),
      expect.objectContaining({
        id: "alternate-2",
        source_index: 2,
        title: "备用开场 2",
        default: false,
      }),
    ]);
  });

  it("numbers alternate-only greetings from one", () => {
    expect(
      buildRoleReleaseOpenings({
        name: "Hero",
        alternateGreetings: ["Only alternate"],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "alternate-1",
        title: "备用开场 1",
        default: true,
      }),
    ]);
  });

  it("preserves individual and group defaults from a native package separately", () => {
    const openings = buildRoleReleaseOpenings({
      name: "Native Hero",
      extensions: {
        tavern_headless: {
          nativePackage: { cardId: "card", revision: 1 },
          openings: {
            defaultOpeningIds: {
              individual: "shared-opening",
              group: "group-opening",
            },
            items: [
              {
                id: "shared-opening",
                title: "Shared",
                summary: "",
                kind: "story",
                audience: "both",
                text: "Single-player opening.",
                displayText: "Single-player opening.",
              },
              {
                id: "group-opening",
                title: "Group",
                summary: "",
                kind: "story",
                audience: "group",
                text: "Group opening.",
                displayText: "Group opening.",
              },
            ],
          },
        },
      },
    });

    expect(openings).toMatchObject([
      { id: "shared-opening", default_for: ["individual"] },
      { id: "group-opening", default_for: ["group"] },
    ]);
    expect(selectRoleReleaseOpening(openings, undefined, "individual")?.id).toBe("shared-opening");
    expect(selectRoleReleaseOpening(openings, undefined, "group")?.id).toBe("group-opening");
    expect(selectRoleReleaseOpening(openings)?.id).toBe("shared-opening");

    const nativeSnapshotWithoutGroupDefault = {
      name: "Native Hero",
      extensions: {
        tavern_headless: {
          nativePackage: { cardId: "card", revision: 1 },
          openings: {
            defaultOpeningIds: { individual: "shared-opening" },
            items: [
              {
                id: "shared-opening",
                title: "Shared",
                summary: "",
                kind: "story",
                audience: "both",
                text: "Shared opening.",
                displayText: "Shared opening.",
              },
            ],
          },
        },
      },
    };
    const noGroupDefault = buildRoleReleaseOpenings(nativeSnapshotWithoutGroupDefault);
    expect(() => selectRoleReleaseOpening(noGroupDefault, undefined, "group"))
      .toThrow(expect.objectContaining({
        code: "role_release_default_opening_not_found",
        message: apiErrorMessages.ROLE_RELEASE_DEFAULT_OPENING_NOT_FOUND,
      }));
  });

  it("persists the complete opening snapshots while returning only public opening fields", () => {
    const openings = [
      {
        id: "first",
        title: "邮局",
        kind: "story" as const,
        summary: "",
        display_text: "首个开场",
        text: "首个开场正文",
        variables: { location: "邮局" },
        default: true,
        source_index: 0,
        audience: "individual" as const,
        default_for: ["individual" as const],
      },
    ];
    const input: CreateRoleReleaseSnapshot = {
      accountId: "owner",
      name: "Role",
      character_id: "character",
      character_version_id: "version",
      characterSnapshot: { name: "Role" },
      preset_id: "preset",
      preset_version_id: "preset-version",
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 0,
      regex_profile_id: null,
      regex_profile_version_id: null,
      worldbook_id: null,
      worldbook_version_id: null,
      prompt_mode: "native",
      modelSlots: [],
      default_user_id: "user",
      defaultUserSnapshot: { name: "User" },
      openings,
      now: 1,
    };
    let inserted: typeof roleReleases.$inferInsert | undefined;
    const run = vi.fn();
    const tx = {
      update: () => ({ set: () => ({ where: () => ({ run }) }) }),
      insert: () => ({
        values: (value: typeof roleReleases.$inferInsert) => {
          inserted = value;
          return { run };
        },
      }),
    } as unknown as DbExecutor;

    const release = new RoleReleaseService({} as never).createInTransaction(tx, input);

    expect(JSON.parse(inserted!.openingsJson!)).toEqual(openings);
    expect(inserted).toMatchObject({
      statePresetId: "state-preset",
      statePresetVersionId: "state-preset-version",
      stateHistoryTurns: 0,
    });
    expect(release).toMatchObject({
      state_preset_id: "state-preset",
      state_preset_version_id: "state-preset-version",
      state_history_turns: 0,
    });
    expect(release.opening_snapshots).toEqual(openings);
    expect(release.openings[0]).not.toHaveProperty("source_index");
    expect(release.openings[0]).not.toHaveProperty("variables");
    expect(release.openings[0]).not.toHaveProperty("default_for");
  });

  it.each([
    [
      "unknown default",
      { defaultOpeningId: "missing", items: [] },
      "role_release_default_opening_not_found",
    ],
    [
      "unknown item",
      { defaultOpeningId: "first", items: [{ id: "missing" }] },
      "role_release_opening_metadata_mismatch",
    ],
    [
      "duplicate item",
      { defaultOpeningId: "first", items: [{ id: "first" }, { id: "first" }] },
      "role_release_opening_metadata_invalid",
    ],
    [
      "invalid kind",
      { defaultOpeningId: "first", items: [{ id: "first", kind: "other" }] },
      "role_release_opening_kind_invalid",
    ],
  ])("rejects %s opening metadata", (_label, metadata, code) => {
    expect(() =>
      buildRoleReleaseOpenings({
        name: "Hero",
        primaryGreeting: "Primary",
        extensions: { tavern_headless: { openings: metadata } },
      }),
    ).toThrow(expect.objectContaining({ code }));
  });
});
