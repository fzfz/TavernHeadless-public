import { loadStorageConfig } from "../../storage-config.js";
import { RoleFileStore } from "../../services/storage/role-file-store.js";
import { RoleAssetService } from "../../services/role-runtime/role-asset-service.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTestApp } from "../../../test/helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { ensureTestDefaultWorkspace } from "../../__tests__/helpers/workspace-project.js";
import type { AppDb } from "../../../test/helpers/create-test-db.js";
import { roleReleases } from "../../db/role-release-schema.js";
import {
  roleAssets,
  accounts,
  accountUsers,
  characters,
  characterVersions,
  llmProfileBindings,
  llmProfiles,
  presets,
  presetVersions,
  regexProfiles,
  regexProfileVersions,
  sessions,
  worldbooks,
  worldbookVersions,
} from "../../db/schema.js";
import { LlmInstanceService } from "../../services/llm-instance-service.js";
import {
  buildRoleModelCapabilities,
  type RoleModelCapabilitiesRuntime,
} from "../../services/role-model-capabilities.js";
import { ClientService } from "../../services/client-service.js";
import { repairCrossAccountSessionCharacterBindings } from "../../services/resource-ownership.js";
import { ClientApiKeyService } from "../../services/client-api-key-service.js";
import { registerRoleReleaseRoutes } from "../role-releases.js";

type Built = Awaited<ReturnType<typeof buildTestApp>>;

const OWNER = "role-release-owner";
const OTHER = "role-release-other";
const OWNER_KEY = "role-release-owner-key";
const OTHER_KEY = "role-release-other-key";

const fixtureIds = {
  character: "char_role_release",
  characterVersion: "charver_role_release_v1",
  user: "usr_role_release",
  preset: "preset_role_release",
  presetVersion: "presetver_role_release_v1",
  regex: "regex_role_release",
  regexVersion: "regexver_role_release_v1",
  worldbook: "worldbook_role_release",
  worldbookVersion: "worldbookver_role_release_v1",
  profile: "profile_role_release",
};

const characterSnapshot = {
  name: "Release Hero",
  description: "A versioned release character.",
  primaryGreeting: "Primary greeting for {{user}} and {{char}}.",
  alternateGreetings: [
    "First alternate greeting.",
    "Second alternate greeting.",
  ],
  extensions: {
    tavern_headless: {
      openings: {
        defaultOpeningId: "alternate-1",
        items: [
          {
            id: "first",
            title: "Introduction",
            summary: "Character introduction.",
            kind: "introduction",
            displayText: "Introduction for {{user}}.",
            variables: { scene: "introduction" },
          },
          {
            id: "alternate-1",
            title: "Story start",
            summary: "The default story opening.",
            kind: "story",
            displayText: "Story start for {{user}}.",
            variables: { scene: "story" },
          },
          {
            id: "alternate-2",
            title: "Second story",
            summary: "A second story opening.",
            kind: "story",
            displayText: "Second story for {{user}}.",
            variables: { scene: "second-story" },
          },
        ],
      },
    },
  },
};

const releaseBody = {
  name: "Release Hero v1",
  character_id: fixtureIds.character,
  character_version_id: fixtureIds.characterVersion,
  preset_id: fixtureIds.preset,
  preset_version_id: fixtureIds.presetVersion,
  regex_profile_id: fixtureIds.regex,
  regex_profile_version_id: fixtureIds.regexVersion,
  worldbook_id: fixtureIds.worldbook,
  worldbook_version_id: fixtureIds.worldbookVersion,
  prompt_mode: "native",
  model_slots: [
    {
      slot: "narrator",
      profile_id: fixtureIds.profile,
      params: {
        temperature: 0.4,
        max_output_tokens: 256,
        reasoning_effort: "none",
      },
    },
  ],
  default_user_id: fixtureIds.user,
} as const;

const openApps: FastifyInstance[] = [];
const tempDirs: string[] = [];
const assetServices = new WeakMap<AppDb, RoleAssetService>();

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("role release routes", () => {
  it("requires the confirmed persona revision for a new public session and recovers existing operations after deletion", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER);
    const headers = { authorization: `Bearer ${OTHER_KEY}` };
    const release = await createRelease(built.app, {
      authorization: `Bearer ${OWNER_KEY}`,
    });
    const persona = (
      await built.app.inject({
        method: "POST",
        url: "/users",
        headers,
        payload: {
          snapshot: {
            name: "江宁",
            description: "江宁，女性，二十七岁，信件整理员，耐心谨慎。",
          },
        },
      })
    ).json().data;
    const updated = await built.app.inject({
      method: "PATCH",
      url: `/users/${persona.id}`,
      headers,
      payload: {
        expected_revision: persona.revision,
        snapshot: {
          name: "江宁",
          description: "江宁，女性，二十七岁，信件整理员，行动果断。",
        },
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const input = {
      user_id: persona.id,
      opening_id: "alternate-1",
      operation_id: "persona-cas-start",
      expected_user_revision: persona.revision,
    };
    const stale = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: input,
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("PUBLIC_ROLE_PERSONA_CHANGED");
    expect(
      (await built.app.inject({ url: "/sessions", headers })).json().meta.total,
    ).toBe(0);
    const currentInput = {
      ...input,
      expected_user_revision: updated.json().data.revision,
    };
    const created = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: currentInput,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.session.id;
    expect(
      created.json().data.session.user_binding.snapshot.description,
    ).toContain("行动果断");
    await built.app.inject({
      method: "DELETE",
      url: `/users/${persona.id}`,
      headers,
    });
    const repeated = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: input,
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().data.session.id).toBe(id);
    expect(
      (
        await built.app.inject({
          url: `/public/role-session-operations/${input.operation_id}`,
          headers,
        })
      ).json().data.session.id,
    ).toBe(id);
  });
  it("preserves only authorized published character bindings through application restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-session-restart-"));
    tempDirs.push(root);
    const first = await buildMultiAccountRoleReleaseApp(false, root);
    await seedRoleReleaseFixture(first.database, OWNER);
    const headers = { authorization: `Bearer ${OTHER_KEY}` };
    const release = await createRelease(first.app, {
      authorization: `Bearer ${OWNER_KEY}`,
    });
    const persona = await first.app.inject({
      method: "POST",
      url: "/users",
      headers,
      payload: {
        snapshot: {
          name: "裴修远",
          description: "裴修远，男性，二十八岁，藏书修复师。",
        },
      },
    });
    const creation = await first.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: {
        user_id: persona.json().data.id,
        opening_id: "alternate-1",
        operation_id: "restart-owned",
      },
    });
    expect(creation.statusCode, creation.body).toBe(201);
    const id = creation.json().data.session.id;
    const illegal = await first.app.inject({
      method: "POST",
      url: "/sessions",
      headers,
      payload: { title: "ungranted control" },
    });
    first.database
      .update(sessions)
      .set({
        characterId: fixtureIds.character,
        characterVersionId: fixtureIds.characterVersion,
        characterSnapshotJson: JSON.stringify(characterSnapshot),
      })
      .where(eq(sessions.id, illegal.json().data.id))
      .run();
    await first.app.close();
    const second = await buildMultiAccountRoleReleaseApp(false, root);
    const view = await second.app.inject({
      url: `/sessions/${id}/role-view`,
      headers,
    });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().data.character_version_id).toBe(
      fixtureIds.characterVersion,
    );
    const detail = await second.app.inject({ url: `/sessions/${id}`, headers });
    expect(detail.json().data.user_binding.snapshot.description).toBe(
      "裴修远，男性，二十八岁，藏书修复师。",
    );
    expect(
      second.database
        .select()
        .from(sessions)
        .where(eq(sessions.id, illegal.json().data.id))
        .get(),
    ).toMatchObject({
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
    });
  });
  it("assembles the user's fixed persona with publisher resources through the dry-run HTTP boundary", async () => {
    vi.stubEnv("APP_SECRETS_MASTER_KEY", "public-release-test-master-key");
    const built = await buildMultiAccountRoleReleaseApp(true);
    await seedRoleReleaseFixture(built.database, OWNER);
    const ownerHeaders = { authorization: `Bearer ${OWNER_KEY}` };
    const headers = { authorization: `Bearer ${OTHER_KEY}` };
    const credential = await built.app.inject({
      method: "PATCH",
      url: `/llm-profiles/${fixtureIds.profile}`,
      headers: ownerHeaders,
      payload: {
        api_key: "test-publisher-secret",
        model_id: "frozen-publisher-model",
      },
    });
    expect(credential.statusCode, credential.body).toBe(200);
    built.database
      .update(regexProfiles)
      .set({ dataJson: "[]" })
      .where(eq(regexProfiles.id, fixtureIds.regex))
      .run();
    built.database
      .update(regexProfileVersions)
      .set({ dataJson: "[]" })
      .where(eq(regexProfileVersions.id, fixtureIds.regexVersion))
      .run();
    const release = await createRelease(built.app, ownerHeaders);
    const persona = await built.app.inject({
      method: "POST",
      url: "/users",
      headers,
      payload: {
        name: "裴修远",
        snapshot: {
          name: "裴修远",
          description: "男性，二十八岁，谨慎的藏书修复师。",
        },
      },
    });
    const created = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: {
        user_id: persona.json().data.id,
        opening_id: "alternate-1",
        operation_id: "dry-run-create-one",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const sessionId = created.json().data.session.id;
    await built.app.inject({
      method: "PATCH",
      url: `/llm-profiles/${fixtureIds.profile}`,
      headers: ownerHeaders,
      payload: { model_id: "later-edited-publisher-model" },
    });
    const runtime = await built.app.inject({
      url: `/llm-profiles/runtime?session_id=${sessionId}`,
      headers,
    });
    expect(runtime.statusCode, runtime.body).toBe(200);
    expect(runtime.body).toContain("frozen-publisher-model");
    expect(runtime.body).not.toContain("test-publisher-secret");
    expect(
      (
        await built.app.inject({
          url: `/llm-profiles/${fixtureIds.profile}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const dryRun = await built.app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/respond/dry-run`,
      headers,
      payload: { message: "“我叫裴修远。”" },
    });
    expect(dryRun.statusCode, dryRun.body).toBe(200);
    const prompt = dryRun.json().data;
    expect(JSON.stringify(prompt.messages)).toContain("裴修远");
    expect(JSON.stringify(prompt.messages)).toContain(
      "男性，二十八岁，谨慎的藏书修复师。",
    );
    expect(JSON.stringify(prompt.messages)).toContain("我叫裴修远");
    expect(JSON.stringify(prompt.messages)).not.toContain("Persona One");
    await built.app.inject({
      method: "DELETE",
      url: `/users/${persona.json().data.id}`,
      headers,
    });
    const again = await built.app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/respond/dry-run`,
      headers,
      payload: { message: "“我还记得昨夜的书页。”" },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(JSON.stringify(again.json().data.messages)).toContain(
      "男性，二十八岁，谨慎的藏书修复师。",
    );
  });

  it("creates an owned session from another publisher with a required owned persona and safe idempotent result", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER);
    const release = await createRelease(built.app, {
      authorization: `Bearer ${OWNER_KEY}`,
    });
    const headers = { authorization: `Bearer ${OTHER_KEY}` };
    const persona = await built.app.inject({
      method: "POST",
      url: "/users",
      headers,
      payload: {
        name: "裴修远",
        snapshot: {
          name: "裴修远",
          description: "男性，二十八岁，谨慎的藏书修复师。",
        },
      },
    });
    expect(persona.statusCode).toBe(201);
    const input = {
      user_id: persona.json().data.id,
      opening_id: "alternate-1",
      operation_id: "public-session-operation-one",
    };
    const missing = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: { operation_id: "missing-persona" },
    });
    expect(missing.statusCode).toBe(400);
    const foreign = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: { ...input, user_id: fixtureIds.user },
    });
    expect(foreign.statusCode).toBe(404);
    const created = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: input,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.release).not.toHaveProperty("model_slots");
    const session = created.json().data.session;
    expect(session).toMatchObject({
      user_binding: {
        user_id: input.user_id,
        snapshot: {
          name: "裴修远",
          description: "男性，二十八岁，谨慎的藏书修复师。",
        },
      },
    });
    expect(
      (await built.app.inject({ url: `/sessions/${session.id}`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await built.app.inject({
          url: `/sessions/${session.id}`,
          headers: { authorization: `Bearer ${OWNER_KEY}` },
        })
      ).statusCode,
    ).toBe(404);
    const repeated = await built.app.inject({
      method: "POST",
      url: `/public/roles/${release.id}/sessions`,
      headers,
      payload: input,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.session.id).toBe(session.id);
    const operation = await built.app.inject({
      url: `/public/role-session-operations/${input.operation_id}`,
      headers,
    });
    expect(operation.statusCode).toBe(200);
    expect(operation.json().data.session.id).toBe(session.id);
    expect(
      await repairCrossAccountSessionCharacterBindings(built.database),
    ).toBe(0);
    const ungranted = await built.app.inject({
      method: "POST",
      url: "/sessions",
      headers,
      payload: { title: "ungranted control" },
    });
    expect(ungranted.statusCode).toBe(201);
    built.database
      .update(sessions)
      .set({
        characterId: fixtureIds.character,
        characterVersionId: fixtureIds.characterVersion,
        characterSnapshotJson: JSON.stringify(characterSnapshot),
      })
      .where(eq(sessions.id, ungranted.json().data.id))
      .run();
    expect(
      await repairCrossAccountSessionCharacterBindings(built.database),
    ).toBe(1);
    expect(
      built.database
        .select()
        .from(sessions)
        .where(eq(sessions.id, ungranted.json().data.id))
        .get(),
    ).toMatchObject({
      characterId: null,
      characterVersionId: null,
      characterSnapshotJson: null,
    });
    const view = await built.app.inject({
      url: `/sessions/${session.id}/role-view`,
      headers,
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().data.delivery.html).toContain("Role");
    const asset = await built.app.inject({
      url: `/role-assets/${fixtureIds.characterVersion}/view.html`,
      headers,
    });
    expect(asset.statusCode).toBe(200);
    const forged = await built.app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      headers,
      payload: { preset_id: fixtureIds.preset, user_id: fixtureIds.user },
    });
    expect(forged.statusCode).toBe(409);
    await built.app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}`,
      headers,
      payload: { title: "本人存档" },
    });
    for (const keyword of ["裴修远", "Release Hero", "本人存档"]) {
      const result = await built.app.inject({
        url: `/sessions?keyword=${encodeURIComponent(keyword)}&limit=1`,
        headers,
      });
      expect(result.json().meta.total, keyword).toBe(1);
      expect(result.json().data[0].id).toBe(session.id);
    }
  });

  it("serves a safe active catalogue across publisher accounts with complete filtering", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER, {
      ...characterSnapshot,
      description: "雨夜中的旧书楼故事",
      creator: "作者甲",
      tags: ["古风", "书楼"],
    });
    const release = await createRelease(built.app, {
      authorization: `Bearer ${OWNER_KEY}`,
    });
    const listed = await built.app.inject({
      url: "/public/roles?keyword=书楼&tag=古风&limit=1&offset=0",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      data: [{ id: release.id, creator: "作者甲", tags: ["古风", "书楼"] }],
      meta: { total: 1, limit: 1, offset: 0, tags: ["书楼", "古风"] },
    });
    const role = listed.json().data[0];
    expect(Object.keys(role).sort()).toEqual([
      "character_id",
      "created_at",
      "creator",
      "description",
      "id",
      "name",
      "openings",
      "tags",
    ]);
    expect(JSON.stringify(role)).not.toMatch(
      /profile|preset|default_user|snapshot|api_key/i,
    );
    expect(
      (await built.app.inject(`/public/roles/${release.id}`)).statusCode,
    ).toBe(200);
    const empty = await built.app.inject("/public/roles?keyword=不存在");
    expect(empty.json().meta.total).toBe(0);
    await built.app.inject({
      method: "PUT",
      url: `/role-releases/${release.id}/publication`,
      headers: { authorization: `Bearer ${OWNER_KEY}` },
      payload: { active: false },
    });
    expect((await built.app.inject("/public/roles")).json().meta.total).toBe(0);
    expect(
      (await built.app.inject(`/public/roles/${release.id}`)).statusCode,
    ).toBe(404);
  });

  it("resolves a profile default state preset and freezes runtime settings in a preview session", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    const snapshotWithState = {
      ...characterSnapshot,
      extensions: {
        tavern_headless: {
          ...characterSnapshot.extensions.tavern_headless,
          stateUpdate: {
            profile: {
              updaterPrompt: "Legacy prompt is retained as profile data.",
              writablePaths: ["/mood"],
              stateSchema: {
                type: "object",
                properties: {
                  mood: { type: "string" },
                  scene: { type: "string" },
                },
                additionalProperties: true,
              },
              modelSlot: "narrator",
              presetRef: {
                presetId: fixtureIds.preset,
                presetVersionId: fixtureIds.presetVersion,
              },
            },
            files: {},
          },
        },
      },
    };
    await seedRoleReleaseFixture(
      built.database,
      DEFAULT_ADMIN_ACCOUNT_ID,
      snapshotWithState,
    );
    built.database
      .insert(presets)
      .values({
        id: "state-preset-override",
        name: "State prompt override",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: ensureTestDefaultWorkspace(
          built.database,
          DEFAULT_ADMIN_ACCOUNT_ID,
        ).workspaceId,
        dataJson: "{}",
        version: 1,
        createdAt: 1_780_000_000_000,
        updatedAt: 1_780_000_000_000,
      })
      .run();
    built.database
      .insert(presetVersions)
      .values({
        id: "state-preset-override-v1",
        presetId: "state-preset-override",
        versionNo: 1,
        dataJson: "{}",
        contentHash: "state-preset-override-hash",
        createdAt: 1_780_000_000_000,
      })
      .run();

    const created = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: { configuration: releaseBody },
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json().data;
    expect(draft.configuration).toMatchObject({
      statePresetId: fixtureIds.preset,
      statePresetVersionId: fixtureIds.presetVersion,
      stateHistoryTurns: 5,
    });

    const preview = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: draft.revision },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    expect(preview.json().data.session.metadata.statePrompt).toEqual({
      presetId: fixtureIds.preset,
      presetVersionId: fixtureIds.presetVersion,
      historyTurns: 5,
    });

    const override = await built.app.inject({
      method: "PUT",
      url: `/role-apps/${draft.id}`,
      payload: {
        expected_revision: draft.revision,
        configuration: {
          ...releaseBody,
          statePresetId: "state-preset-override",
          statePresetVersionId: "state-preset-override-v1",
          stateHistoryTurns: 0,
        },
      },
    });
    expect(override.statusCode, override.body).toBe(200);
    expect(override.json().data.configuration).toMatchObject({
      statePresetId: "state-preset-override",
      statePresetVersionId: "state-preset-override-v1",
      stateHistoryTurns: 0,
    });

    const overridePreview = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: override.json().data.revision },
    });
    expect(overridePreview.statusCode, overridePreview.body).toBe(201);
    expect(overridePreview.json().data.session.metadata.statePrompt).toEqual({
      presetId: "state-preset-override",
      presetVersionId: "state-preset-override-v1",
      historyTurns: 0,
    });

    const published = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/releases`,
      payload: { expected_revision: override.json().data.revision },
    });
    expect(published.statusCode, published.body).toBe(201);
    expect(published.json().data).toMatchObject({
      state_preset_id: "state-preset-override",
      state_preset_version_id: "state-preset-override-v1",
      state_history_turns: 0,
    });

    const formalSession = await built.app.inject({
      method: "POST",
      url: `/role-releases/${published.json().data.id}/sessions`,
      payload: {},
    });
    expect(formalSession.statusCode, formalSession.body).toBe(201);
    expect(formalSession.json().data.session.metadata.statePrompt).toEqual({
      presetId: "state-preset-override",
      presetVersionId: "state-preset-override-v1",
      historyTurns: 0,
    });
  });

  it("requires a versioned state prompt preset instead of using the legacy updater prompt", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    const snapshotWithoutStatePreset = {
      ...characterSnapshot,
      extensions: {
        tavern_headless: {
          ...characterSnapshot.extensions.tavern_headless,
          stateUpdate: {
            profile: {
              updaterPrompt:
                "Legacy prompt must not become the formal task prompt.",
              writablePaths: ["/mood"],
              stateSchema: {
                type: "object",
                properties: {
                  mood: { type: "string" },
                  scene: { type: "string" },
                },
                additionalProperties: true,
              },
              modelSlot: "narrator",
            },
            files: {},
          },
        },
      },
    };
    await seedRoleReleaseFixture(
      built.database,
      DEFAULT_ADMIN_ACCOUNT_ID,
      snapshotWithoutStatePreset,
    );

    const response = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: { configuration: releaseBody },
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe("ROLE_STATE_PRESET_MISSING");
  });

  it("allows an authorized actor to use a draft created by another client in the same account", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const client = new ClientService(built.database).create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Role author client",
      kind: "advanced",
    });
    const key = new ClientApiKeyService(built.database).create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      clientId: client.id,
    });
    const saved = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      headers: { "x-tavern-client-key": key.secret },
      payload: {
        configuration: {
          ...releaseBody,
          model_capabilities: {
            enabled: true,
            allowed: ["random"],
            slot: "narrator",
            transport: "native_function_call",
          },
        },
      },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const draft = saved.json().data;
    const preview = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: draft.revision },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    expect(
      preview.json().data.session.metadata.role_preview.creator_id,
    ).not.toBe(client.id);
    const sessionId = preview.json().data.session.id as string;
    const capability = await buildRoleModelCapabilities(
      built.database,
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(
      (await capability!.provider.listTools()).map((tool) => tool.name),
    ).toEqual(["random"]);
    const result = await capability!.provider.executeTool(
      "random",
      {
        domain: { kind: "integer_range", min: 4, max: 4 },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      {
        sessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        floorId: "cross-actor-capability-floor",
        callerSlot: "narrator",
        variableContext: { sessionId, accountId: DEFAULT_ADMIN_ACCOUNT_ID },
      },
    );
    expect(result).toMatchObject({
      data: { ok: true, data: { samples: [4], indices: null } },
    });
  });

  it("freezes role preview capability grants and checks draft revocation on every execution", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const grant = {
      enabled: true,
      allowed: ["random"],
      slot: "narrator",
      transport: "native_function_call",
      limits: { maxCallsPerTurn: 3, maxResultBytes: 1024 },
    } as const;
    const overLimit = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: {
        configuration: {
          ...releaseBody,
          model_capabilities: {
            ...grant,
            limits: { maxCallsPerTurn: 17 },
          },
        },
      },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().error.code).toBe("VALIDATION_ERROR");

    const saved = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: { configuration: { ...releaseBody, model_capabilities: grant } },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const draft = saved.json().data;
    expect(draft.configuration.model_capabilities).toMatchObject({
      ...grant,
      limits: { maxCallsPerTurn: 3, maxResultBytes: 1024 },
    });

    const preview = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: 1 },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    const sessionId = preview.json().data.session.id as string;
    const previewSession = built.database
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get()!;
    const metadata = JSON.parse(previewSession.metadataJson!) as Record<
      string,
      unknown
    >;
    expect(
      JSON.parse(previewSession.roleModelCapabilitiesSnapshotJson!),
    ).toMatchObject({
      metadata: {
        role_preview: {
          draft_id: draft.id,
          draft_revision: 1,
          creator_id: expect.any(String),
        },
        model_capabilities: {
          enabled: true,
          allowed: ["random"],
          slot: "narrator",
          transport: "native_function_call",
        },
      },
      character_id: fixtureIds.character,
      character_version_id: fixtureIds.characterVersion,
    });
    expect(metadata.model_capabilities).toMatchObject({
      ...grant,
      limits: {
        maxCallsPerTurn: 3,
        maxStepsPerGeneration: 8,
        maxRandomSamples: 32,
        maxRandomCandidates: 1024,
        maxCalculateNodes: 256,
        maxCalculateDepth: 32,
        maxCandidateDepth: 32,
        maxInputBytes: 65_536,
        maxResultBytes: 1_024,
      },
    });
    expect(metadata.role_preview).not.toHaveProperty("model_capabilities");

    const runtime = await buildRoleModelCapabilities(
      built.database,
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
      { maxCallsPerTurn: 2 },
    );
    expect(runtime?.modelCapabilities.limits?.maxCallsPerTurn).toBe(2);
    const exposedTools = await runtime!.provider.listTools();
    expect(exposedTools.map((tool) => tool.name)).toEqual(["random"]);
    expect(runtime!.provider.id).toBe("system:role-model-capabilities");
    await expect(
      buildRoleModelCapabilities(
        built.database,
        sessionId,
        DEFAULT_ADMIN_ACCOUNT_ID,
        { maxCallsPerTurn: 4 },
      ),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });

    const published = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/releases`,
      payload: { expected_revision: 1 },
    });
    expect(published.statusCode, published.body).toBe(201);
    expect(published.json().data.model_capabilities).toMatchObject({
      ...grant,
      limits: { maxCallsPerTurn: 3, maxResultBytes: 1024 },
    });
    const releaseId = published.json().data.id as string;
    const formalSessionResponse = await built.app.inject({
      method: "POST",
      url: `/role-releases/${releaseId}/sessions`,
      payload: {},
    });
    expect(formalSessionResponse.statusCode, formalSessionResponse.body).toBe(
      201,
    );
    const formalSessionId = formalSessionResponse.json().data.session
      .id as string;
    const formalMetadata = JSON.parse(
      built.database
        .select()
        .from(sessions)
        .where(eq(sessions.id, formalSessionId))
        .get()!.metadataJson!,
    ) as Record<string, unknown>;
    expect(formalMetadata).toMatchObject({
      role_release_id: releaseId,
      model_capabilities: published.json().data.model_capabilities,
    });
    const formalRuntime = await buildRoleModelCapabilities(
      built.database,
      formalSessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(formalRuntime?.provider.id).toBe("system:role-model-capabilities");
    expect(
      (await formalRuntime?.provider.listTools())?.map((tool) => tool.name),
    ).toEqual(["random"]);
    const disabledPublication = await built.app.inject({
      method: "PUT",
      url: `/role-releases/${releaseId}/publication`,
      payload: { active: false },
    });
    expect(disabledPublication.statusCode, disabledPublication.body).toBe(200);
    const formalExecution = await formalRuntime!.provider.executeTool(
      "random",
      {
        domain: { kind: "integer_range", min: 1, max: 6 },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      {
        sessionId: formalSessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        floorId: "floor-role-release-capability-test",
        callerSlot: "narrator",
        variableContext: {
          sessionId: formalSessionId,
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        },
      },
    );
    expect(formalExecution.executionStatus).toBe("denied");
    expect(formalExecution.executionReasonCode).toBe("CAPABILITY_DENIED");

    const revisedCharacterVersionId = `${fixtureIds.characterVersion}-v2`;
    const revisedCharacterSnapshot = {
      ...characterSnapshot,
      description: "A revised character resource version.",
    };
    const now = Date.now();
    built.database
      .insert(characterVersions)
      .values({
        id: revisedCharacterVersionId,
        characterId: fixtureIds.character,
        versionNo: 2,
        dataJson: JSON.stringify(revisedCharacterSnapshot),
        contentHash: "character-hash-v2",
        createdAt: now,
      })
      .run();
    built.database
      .update(characters)
      .set({ latestVersionNo: 2, revision: 1, updatedAt: now })
      .where(eq(characters.id, fixtureIds.character))
      .run();
    const assets = assetServices.get(built.database)!;
    const existingAssetFiles = built.database
      .select()
      .from(roleAssets)
      .where(eq(roleAssets.versionId, fixtureIds.characterVersion))
      .all();
    const revisedAssetFiles = await Promise.all(
      existingAssetFiles.map(async (file) => ({
        name: file.name,
        purpose:
          file.purpose as import("@tavern/shared").RoleAssetFile["purpose"],
        mime: file.mime,
        base64: (
          await assets.read(
            DEFAULT_ADMIN_ACCOUNT_ID,
            fixtureIds.characterVersion,
            file.name,
          )
        ).content.toString("base64"),
      })),
    );
    await assets.import(DEFAULT_ADMIN_ACCOUNT_ID, revisedCharacterVersionId, {
      character_id: fixtureIds.character,
      files: revisedAssetFiles,
    });
    const revisedDraft = await built.app.inject({
      method: "PUT",
      url: `/role-apps/${draft.id}`,
      payload: {
        expected_revision: 1,
        configuration: {
          ...releaseBody,
          character_version_id: revisedCharacterVersionId,
          model_capabilities: grant,
        },
      },
    });
    expect(revisedDraft.statusCode, revisedDraft.body).toBe(200);
    expect(revisedDraft.json().data.revision).toBe(2);
    const stillAuthorized = await runtime!.provider.executeTool(
      "random",
      {
        domain: { kind: "integer_range", min: 1, max: 6 },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      {
        sessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        floorId: "floor-role-preview-version-edit",
        callerSlot: "narrator",
        variableContext: { sessionId, accountId: DEFAULT_ADMIN_ACCOUNT_ID },
      },
    );
    expect(stillAuthorized.executionStatus).toBe("success");

    const edited = await built.app.inject({
      method: "PUT",
      url: `/role-apps/${draft.id}`,
      payload: {
        expected_revision: 2,
        configuration: {
          ...releaseBody,
          character_version_id: revisedCharacterVersionId,
          model_capabilities: {
            enabled: false,
            allowed: [],
            slot: "narrator",
            transport: "native_function_call",
          },
        },
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const execution = await runtime!.provider.executeTool(
      "random",
      {
        domain: { kind: "integer_range", min: 1, max: 6 },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      {
        sessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        floorId: "floor-role-preview-capability-test",
        callerSlot: "narrator",
        variableContext: { sessionId, accountId: DEFAULT_ADMIN_ACCOUNT_ID },
      },
    );
    expect(execution.executionStatus).toBe("denied");
    expect(execution.executionReasonCode).toBe("CAPABILITY_DENIED");

    const revokedRuntime = await buildRoleModelCapabilities(
      built.database,
      sessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(await revokedRuntime!.provider.listTools()).toEqual([]);
  });

  it("restricts draft administration and release publication to authorized administrators", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER);
    const created = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      headers: { "x-api-key": OWNER_KEY },
      payload: { configuration: releaseBody },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id;
    for (const url of ["/role-apps", "/role-releases"]) {
      const denied = await built.app.inject({
        method: "POST",
        url,
        headers: { "x-api-key": OTHER_KEY },
        payload:
          url === "/role-apps" ? { configuration: releaseBody } : releaseBody,
      });
      expect(denied.statusCode).toBe(403);
    }
    built.database
      .update(accounts)
      .set({ role: "admin" })
      .where(eq(accounts.id, OTHER))
      .run();
    const other = await built.app.inject({
      url: `/role-apps/${id}`,
      headers: { "x-api-key": OTHER_KEY },
    });
    expect(other.statusCode).toBe(404);
  });

  it("saves a draft, freezes preview revisions, exchanges scoped access and publishes only on request", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const saved = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: { configuration: releaseBody },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const draft = saved.json().data;
    expect(draft.revision).toBe(1);
    expect((await built.app.inject("/role-releases")).json().data).toEqual([]);
    const preview = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: 1, opening_id: "alternate-2" },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    const sessionId = preview.json().data.session.id;
    const persisted = built.database
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get()!;
    expect(JSON.parse(persisted.metadataJson!)).toMatchObject({
      role_preview: {
        draft_id: draft.id,
        draft_revision: 1,
        creator_id: DEFAULT_ADMIN_ACCOUNT_ID,
      },
      draft_revision: 1,
    });
    expect(JSON.parse(persisted.metadataJson!)).not.toHaveProperty(
      "role_release_id",
    );
    const info = await built.app.inject(`/sessions/${sessionId}`);
    expect(info.statusCode, info.body).toBe(200);
    expect(info.json().data.metadata.role_preview).toMatchObject({
      draft_id: draft.id,
      draft_revision: 1,
    });
    const edited = await built.app.inject({
      method: "PUT",
      url: `/role-apps/${draft.id}`,
      payload: {
        expected_revision: 1,
        configuration: { ...releaseBody, name: "Updated draft" },
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().data.revision).toBe(2);
    expect(
      built.database
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get()?.title,
    ).toBe(releaseBody.name);
    const listed = await built.app.inject(
      `/role-apps/${draft.id}/preview-sessions`,
    );
    expect(listed.json().data).toEqual([
      expect.objectContaining({ id: sessionId, draft_revision: 1 }),
    ]);
    for (const action of ["preview-sessions", "releases"]) {
      const stale = await built.app.inject({
        method: "POST",
        url: `/role-apps/${draft.id}/${action}`,
        payload: { expected_revision: 1 },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("ROLE_APP_REVISION_CONFLICT");
    }
    const published = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/releases`,
      payload: { expected_revision: 2 },
    });
    expect(published.statusCode, published.body).toBe(201);
    expect(published.json().data.name).toBe("Updated draft");
    expect((await built.app.inject("/role-releases")).json().data).toHaveLength(
      1,
    );
    expect(built.database.select().from(sessions).all()).toHaveLength(1);
  });

  it("keeps native opening defaults scoped to individual and group sessions in preview and releases", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    const requireBundle = vi
      .spyOn(RoleAssetService.prototype, "requireCompleteBundle")
      .mockResolvedValue();
    const nativeSnapshot = {
      name: "Native default test",
      primaryGreeting: "Single-player opening.",
      extensions: {
        tavern_headless: {
          nativePackage: { cardId: "native-default-test", revision: 1 },
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
                variables: {},
              },
              {
                id: "group-opening",
                title: "Group",
                summary: "",
                kind: "story",
                audience: "group",
                text: "Group opening.",
                displayText: "Group opening.",
                variables: {},
              },
            ],
          },
        },
      },
    };
    await seedRoleReleaseFixture(
      built.database,
      DEFAULT_ADMIN_ACCOUNT_ID,
      nativeSnapshot,
    );

    const saved = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: { configuration: releaseBody },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const draft = saved.json().data;
    const previewGroup = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: 1, session_type: "group" },
    });
    expect(previewGroup.statusCode, previewGroup.body).toBe(201);
    expect(previewGroup.json().data.opening_id).toBe("group-opening");
    const previewIndividual = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/preview-sessions`,
      payload: { expected_revision: 1, session_type: "individual" },
    });
    expect(previewIndividual.statusCode, previewIndividual.body).toBe(201);
    expect(previewIndividual.json().data.opening_id).toBe("shared-opening");

    const published = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draft.id}/releases`,
      payload: { expected_revision: 1 },
    });
    expect(published.statusCode, published.body).toBe(201);
    const groupSession = await built.app.inject({
      method: "POST",
      url: `/role-releases/${published.json().data.id}/sessions`,
      payload: { session_type: "group" },
    });
    expect(groupSession.statusCode, groupSession.body).toBe(201);
    expect(groupSession.json().data.opening_id).toBe("group-opening");
    const individualSession = await built.app.inject({
      method: "POST",
      url: `/role-releases/${published.json().data.id}/sessions`,
      payload: { session_type: "individual" },
    });
    expect(individualSession.statusCode, individualSession.body).toBe(201);
    expect(individualSession.json().data.opening_id).toBe("shared-opening");
    requireBundle.mockRestore();
  });

  it("rejects stale draft saves and leaves the current revision intact", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const draft = (
      await built.app.inject({
        method: "POST",
        url: "/role-apps",
        payload: { configuration: releaseBody },
      })
    ).json().data;
    const response = await built.app.inject({
      method: "PUT",
      url: `/role-apps/${draft.id}`,
      payload: {
        expected_revision: 2,
        configuration: { ...releaseBody, name: "stale" },
      },
    });
    expect(response.statusCode).toBe(409);
    const stored = await built.app.inject(`/role-apps/${draft.id}`);
    expect(stored.json().data).toEqual(draft);
    expect((await built.app.inject("/role-apps/missing")).statusCode).toBe(404);
  });

  it("lists only the latest release per character for the user catalog", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    const empty = await built.app.inject({
      method: "GET",
      url: "/role-releases?latest_per_character=true",
    });
    expect(empty.json().data).toEqual([]);
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const first = await createRelease(built.app);
    const second = await createRelease(built.app);
    const latest = await built.app.inject({
      method: "GET",
      url: "/role-releases?latest_per_character=true",
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().data.map((item: { id: string }) => item.id)).toEqual([
      second.id,
    ]);
    const all = await built.app.inject({
      method: "GET",
      url: "/role-releases",
    });
    expect(all.json().data.map((item: { id: string }) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    const invalid = await built.app.inject({
      method: "GET",
      url: "/role-releases?latest_per_character=invalid",
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("keeps fixed release grants live across publication changes and persists explicit revocation", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "role-release-grant-revocation-"),
    );
    tempDirs.push(directory);
    const databasePath = join(directory, "role-release.sqlite");
    const grant = {
      enabled: true,
      allowed: ["random"],
      slot: "narrator",
      transport: "native_function_call",
    } as const;
    let built = await buildRoleReleaseApp(databasePath);
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);

    const originalResponse = await built.app.inject({
      method: "POST",
      url: "/role-releases",
      payload: { ...releaseBody, model_capabilities: grant },
    });
    expect(originalResponse.statusCode, originalResponse.body).toBe(201);
    expect(originalResponse.json().data).not.toHaveProperty(
      "model_capabilities_revoked_at",
    );
    const originalReleaseId = originalResponse.json().data.id as string;
    const originalSessionResponse = await built.app.inject({
      method: "POST",
      url: `/role-releases/${originalReleaseId}/sessions`,
      payload: {},
    });
    expect(
      originalSessionResponse.statusCode,
      originalSessionResponse.body,
    ).toBe(201);
    const originalSessionId = originalSessionResponse.json().data.session
      .id as string;
    const originalRuntime = await buildRoleModelCapabilities(
      built.database,
      originalSessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(originalRuntime).not.toBeNull();

    const draftResponse = await built.app.inject({
      method: "POST",
      url: "/role-apps",
      payload: {
        configuration: {
          ...releaseBody,
          name: "Release Hero v2",
          model_capabilities: grant,
        },
      },
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const publishedResponse = await built.app.inject({
      method: "POST",
      url: `/role-apps/${draftResponse.json().data.id}/releases`,
      payload: { expected_revision: 1 },
    });
    expect(publishedResponse.statusCode, publishedResponse.body).toBe(201);
    expect(publishedResponse.json().data).not.toHaveProperty(
      "model_capabilities_revoked_at",
    );
    const newerReleaseId = publishedResponse.json().data.id as string;
    const originalReleaseRow = built.database
      .select()
      .from(roleReleases)
      .where(eq(roleReleases.id, originalReleaseId))
      .get();
    expect(originalReleaseRow?.isActive).toBe(false);
    expect(originalReleaseRow?.modelCapabilitiesRevokedAt).toBeNull();

    const newerSessionResponse = await built.app.inject({
      method: "POST",
      url: `/role-releases/${newerReleaseId}/sessions`,
      payload: {},
    });
    expect(newerSessionResponse.statusCode, newerSessionResponse.body).toBe(
      201,
    );
    const newerSessionId = newerSessionResponse.json().data.session
      .id as string;
    const newerRuntime = await buildRoleModelCapabilities(
      built.database,
      newerSessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(
      (await newerRuntime?.provider.listTools())?.map((tool) => tool.name),
    ).toEqual(["random"]);
    expect(
      (
        await runReleaseRandom(
          originalRuntime!,
          originalSessionId,
          "old-after-publication",
        )
      ).executionStatus,
    ).toBe("success");

    await built.app.close();
    openApps.splice(openApps.indexOf(built.app), 1);
    built = await buildRoleReleaseApp(databasePath);
    const restartedRuntime = await buildRoleModelCapabilities(
      built.database,
      originalSessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(restartedRuntime).not.toBeNull();
    expect(
      (
        await runReleaseRandom(
          restartedRuntime!,
          originalSessionId,
          "old-after-restart",
        )
      ).executionStatus,
    ).toBe("success");

    const deactivated = await built.app.inject({
      method: "PUT",
      url: `/role-releases/${originalReleaseId}/publication`,
      payload: { active: false },
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect(deactivated.json().data).not.toHaveProperty(
      "model_capabilities_revoked_at",
    );
    const revokedReleaseRow = built.database
      .select()
      .from(roleReleases)
      .where(eq(roleReleases.id, originalReleaseId))
      .get();
    expect(revokedReleaseRow?.isActive).toBe(false);
    expect(revokedReleaseRow?.modelCapabilitiesRevokedAt).toEqual(
      expect.any(Number),
    );
    const deniedAfterDeactivation = await runReleaseRandom(
      restartedRuntime!,
      originalSessionId,
      "old-after-deactivation",
    );
    expect(deniedAfterDeactivation.executionStatus).toBe("denied");
    expect(deniedAfterDeactivation.executionReasonCode).toBe(
      "CAPABILITY_DENIED",
    );

    const reactivated = await built.app.inject({
      method: "PUT",
      url: `/role-releases/${originalReleaseId}/publication`,
      payload: { active: true },
    });
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(
      built.database
        .select()
        .from(roleReleases)
        .where(eq(roleReleases.id, originalReleaseId))
        .get()?.modelCapabilitiesRevokedAt,
    ).toBeNull();
    expect(
      (
        await runReleaseRandom(
          restartedRuntime!,
          originalSessionId,
          "old-after-reactivation",
        )
      ).executionStatus,
    ).toBe("success");

    const deactivatedAgain = await built.app.inject({
      method: "PUT",
      url: `/role-releases/${originalReleaseId}/publication`,
      payload: { active: false },
    });
    expect(deactivatedAgain.statusCode, deactivatedAgain.body).toBe(200);
    const deniedAfterSecondDeactivation = await runReleaseRandom(
      restartedRuntime!,
      originalSessionId,
      "old-after-second-deactivation",
    );
    expect(deniedAfterSecondDeactivation.executionStatus).toBe("denied");
    expect(deniedAfterSecondDeactivation.executionReasonCode).toBe(
      "CAPABILITY_DENIED",
    );

    await built.app.close();
    openApps.splice(openApps.indexOf(built.app), 1);
    built = await buildRoleReleaseApp(databasePath);
    const persistedRevocationRuntime = await buildRoleModelCapabilities(
      built.database,
      originalSessionId,
      DEFAULT_ADMIN_ACCOUNT_ID,
    );
    expect(await persistedRevocationRuntime!.provider.listTools()).toEqual([]);
    const deniedAfterRevocationRestart = await runReleaseRandom(
      persistedRevocationRuntime!,
      originalSessionId,
      "old-after-revocation-restart",
    );
    expect(deniedAfterRevocationRestart.executionStatus).toBe("denied");
    expect(deniedAfterRevocationRestart.executionReasonCode).toBe(
      "CAPABILITY_DENIED",
    );
  });

  it("stops and restores publication without changing existing sessions or historical snapshots", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const first = await createRelease(built.app);
    const session = await built.app.inject({
      method: "POST",
      url: `/role-releases/${first.id}/sessions`,
      payload: {},
    });
    expect(session.statusCode).toBe(201);
    const sessionId = session.json().data.session.id;
    const second = await createRelease(built.app);
    const activeIds = async () =>
      (
        await built.app.inject({
          method: "GET",
          url: "/role-releases?active_only=true",
        })
      )
        .json()
        .data.map((r: { id: string }) => r.id);
    expect(await activeIds()).toEqual([second.id]);
    expect(
      (
        await built.app.inject({
          method: "PUT",
          url: `/role-releases/${second.id}/publication`,
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(await activeIds()).toEqual([]);
    const blocked = await built.app.inject({
      method: "POST",
      url: `/role-releases/${second.id}/sessions`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("ROLE_RELEASE_INACTIVE");
    expect(
      (await built.app.inject({ method: "GET", url: `/sessions/${sessionId}` }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await built.app.inject({
          method: "PUT",
          url: `/role-releases/${first.id}/publication`,
          payload: { active: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(await activeIds()).toEqual([first.id]);
    expect(
      (
        await built.app.inject({
          method: "GET",
          url: `/role-releases/${first.id}`,
        })
      ).json().data,
    ).toEqual(first);
    expect(
      (
        await built.app.inject({
          method: "POST",
          url: `/role-releases/${first.id}/sessions`,
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
    // Stopping an already inactive historical version must not stop the active one.
    await built.app.inject({
      method: "PUT",
      url: `/role-releases/${second.id}/publication`,
      payload: { active: false },
    });
    expect(await activeIds()).toEqual([first.id]);
    expect(
      (
        await built.app.inject({
          method: "PUT",
          url: `/role-releases/${first.id}/publication`,
          payload: { active: "yes" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await built.app.inject({
          method: "PUT",
          url: "/role-releases/missing/publication",
          payload: { active: true },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("keeps publication changes scoped to the owning account", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER);
    const release = await createRelease(built.app, { "x-api-key": OWNER_KEY });
    expect(
      (
        await built.app.inject({
          method: "PUT",
          url: `/role-releases/${release.id}/publication`,
          headers: { "x-api-key": OTHER_KEY },
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(403);
    const own = await built.app.inject({
      method: "GET",
      url: "/role-releases?active_only=true",
      headers: { "x-api-key": OWNER_KEY },
    });
    expect(own.json().data.map((r: { id: string }) => r.id)).toEqual([
      release.id,
    ]);
  });

  it("persists an immutable release and reads the same snapshot after reopening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "role-release-persist-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "role-release.sqlite");

    const first = await buildRoleReleaseApp(databasePath);
    await seedRoleReleaseFixture(first.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const created = await createRelease(first.app);
    expect(created.character_snapshot.name).toBe("Release Hero");
    expect(created.model_slots[0]).toMatchObject({
      slot: "narrator",
      profile_id: fixtureIds.profile,
      profile_snapshot: {
        preset_name: "Release profile",
        provider: "openai",
        model_id: "test-model",
        base_url: null,
      },
    });
    expect(created.openings).toEqual([
      expect.objectContaining({
        id: "first",
        kind: "introduction",
        default: false,
      }),
      expect.objectContaining({
        id: "alternate-1",
        kind: "story",
        default: true,
      }),
      expect.objectContaining({
        id: "alternate-2",
        kind: "story",
        default: false,
      }),
    ]);

    await first.app.close();
    openApps.splice(openApps.indexOf(first.app), 1);

    const second = await buildRoleReleaseApp(databasePath);
    const response = await second.app.inject({
      method: "GET",
      url: `/role-releases/${created.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(created);
  });

  it("rejects a resource/version mismatch and invalid model slot parameters", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);

    const mismatch = await built.app.inject({
      method: "POST",
      url: "/role-releases",
      payload: { ...releaseBody, preset_version_id: fixtureIds.regexVersion },
    });
    expect(mismatch.statusCode).toBe(404);
    expect(mismatch.json().error.code).toBe("asset_version_not_found");

    const invalidParams = await built.app.inject({
      method: "POST",
      url: "/role-releases",
      payload: {
        ...releaseBody,
        model_slots: [
          {
            slot: "narrator",
            profile_id: fixtureIds.profile,
            params: { temperature: 3 },
          },
        ],
      },
    });
    expect(invalidParams.statusCode).toBe(400);
    expect(invalidParams.json().error.code).toBe("validation_error");
  });

  it("keeps releases invisible to another account", async () => {
    const built = await buildMultiAccountRoleReleaseApp();
    await seedRoleReleaseFixture(built.database, OWNER);
    ensureTestDefaultWorkspace(built.database, OTHER);
    const created = await createRelease(built.app, { "x-api-key": OWNER_KEY });

    const list = await built.app.inject({
      method: "GET",
      url: "/role-releases",
      headers: { "x-api-key": OTHER_KEY },
    });
    const detail = await built.app.inject({
      method: "GET",
      url: `/role-releases/${created.id}`,
      headers: { "x-api-key": OTHER_KEY },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
    expect(detail.statusCode).toBe(404);
    expect(detail.json().error.code).toBe("role_release_not_found");
  });

  it("creates formal sessions with fixed resources, persona, model slot and selected opening pages", async () => {
    const onSessionCreated = vi.fn();
    const built = await buildRoleReleaseApp(":memory:", { onSessionCreated });
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const release = await createRelease(built.app);

    const defaultResponse = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: {},
    });
    expect(defaultResponse.statusCode).toBe(201);
    expect(defaultResponse.json().data.opening_id).toBe("alternate-1");

    const explicitResponse = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: { user_id: fixtureIds.user, opening_id: "alternate-2" },
    });
    expect(explicitResponse.statusCode).toBe(201);
    expect(explicitResponse.json().data.opening_id).toBe("alternate-2");

    const firstSessionId = defaultResponse.json().data.session.id as string;
    const secondSessionId = explicitResponse.json().data.session.id as string;
    const persisted = built.database
      .select()
      .from(sessions)
      .where(eq(sessions.id, firstSessionId))
      .get();
    expect(persisted).toMatchObject({
      characterId: fixtureIds.character,
      characterVersionId: fixtureIds.characterVersion,
      userId: fixtureIds.user,
      presetId: fixtureIds.preset,
      presetVersionId: fixtureIds.presetVersion,
      regexProfileId: fixtureIds.regex,
      regexProfileVersionId: fixtureIds.regexVersion,
      worldbookProfileId: fixtureIds.worldbook,
      worldbookVersionId: fixtureIds.worldbookVersion,
      promptMode: "native",
      deepBinding: true,
    });
    expect(JSON.parse(persisted!.metadataJson!)).toEqual({
      role_release_id: release.id,
      opening_id: "alternate-1",
      model_capabilities: null,
    });

    const binding = built.database
      .select()
      .from(llmProfileBindings)
      .where(eq(llmProfileBindings.scopeId, firstSessionId))
      .get();
    expect(binding).toMatchObject({
      scope: "session",
      profileId: fixtureIds.profile,
      instanceSlot: "narrator",
    });
    expect(JSON.parse(binding!.paramsJson!)).toMatchObject({
      temperature: 0.4,
      maxOutputTokens: 256,
      reasoningEffort: "none",
    });
    expect(JSON.parse(binding!.profileSnapshotJson!)).toEqual(
      release.model_slots[0].profile_snapshot,
    );
    expect(activeGreetingPageVersion(built.database, firstSessionId)).toBe(2);
    expect(activeGreetingPageVersion(built.database, secondSessionId)).toBe(3);
    expect(onSessionCreated).toHaveBeenCalledTimes(2);
    expect(onSessionCreated.mock.calls[0]![0].opening).toMatchObject({
      id: "alternate-1",
      variables: { scene: "story" },
    });
  });

  it("isolates released sessions from global generation slot overrides", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const release = await createRelease(built.app);
    const global = await built.app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: {
        scope: "global",
        enabled: false,
        model_id_override: "wrong-model",
        params: { temperature: 1.9 },
      },
    });
    expect(global.statusCode).toBe(200);
    const created = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().data.session.id;
    const service = new LlmInstanceService(built.database);
    const check = async () => {
      const slots = await service.resolveConfigs(
        DEFAULT_ADMIN_ACCOUNT_ID,
        sessionId,
      );
      expect(slots.find((slot) => slot.slot === "narrator")).toMatchObject({
        source: "session_config",
        enabled: true,
        modelIdOverride: null,
        params: null,
        presetId: null,
      });
      expect(
        slots.filter((slot) => slot.enabled).map((slot) => slot.slot),
      ).toEqual(["narrator"]);
    };
    await check();
    await built.app.inject({
      method: "PUT",
      url: "/llm-instances/director",
      payload: { scope: "global", enabled: true },
    });
    await check();
  });

  it("keeps a published model configuration fixed after the credential profile is edited", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const release = await createRelease(built.app);

    const update = await built.app.inject({
      method: "PATCH",
      url: `/llm-profiles/${fixtureIds.profile}`,
      payload: {
        preset_name: "Edited profile",
        provider: "anthropic",
        model_id: "edited-model",
        base_url: "https://edited.example/v1",
      },
    });
    expect(update.statusCode).toBe(200);

    const detail = await built.app.inject({
      method: "GET",
      url: `/role-releases/${release.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.model_slots[0]).toEqual(release.model_slots[0]);

    const createdSession = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: {},
    });
    expect(createdSession.statusCode).toBe(201);
    const sessionId = createdSession.json().data.session.id as string;
    const binding = built.database
      .select()
      .from(llmProfileBindings)
      .where(eq(llmProfileBindings.scopeId, sessionId))
      .get();
    expect(JSON.parse(binding!.profileSnapshotJson!)).toEqual({
      preset_name: "Release profile",
      provider: "openai",
      model_id: "test-model",
      base_url: null,
    });
  });

  it("marks legacy releases without a profile snapshot and requires republishing", async () => {
    const built = await buildRoleReleaseApp(":memory:");
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const release = await createRelease(built.app);
    built.database.$client
      .prepare("UPDATE role_release SET model_slots_json = ? WHERE id = ?")
      .run(
        JSON.stringify(
          release.model_slots.map(
            ({
              profile_snapshot: _profileSnapshot,
              ...binding
            }: Record<string, unknown>) => binding,
          ),
        ),
        release.id,
      );

    const detail = await built.app.inject({
      method: "GET",
      url: `/role-releases/${release.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.model_slots[0].profile_snapshot).toBeNull();

    const createSession = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: {},
    });
    expect(createSession.statusCode).toBe(409);
    expect(createSession.json().error.code).toBe(
      "role_release_profile_snapshot_missing",
    );
    expect(built.database.select().from(sessions).all()).toEqual([]);
  });

  it("deletes a created session when the initialization hook fails", async () => {
    const built = await buildRoleReleaseApp(":memory:", {
      onSessionCreated: async () => {
        throw new Error("initial state failed");
      },
    });
    await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
    const release = await createRelease(built.app);

    const response = await built.app.inject({
      method: "POST",
      url: `/role-releases/${release.id}/sessions`,
      payload: { opening_id: "first" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe(
      "role_release_initialization_failed",
    );
    expect(built.database.select().from(sessions).all()).toEqual([]);
    expect(built.database.select().from(llmProfileBindings).all()).toEqual([]);
  });
});

async function buildRoleReleaseApp(
  databasePath: string,
  options: Parameters<typeof registerRoleReleaseRoutes>[2] = {},
): Promise<Built> {
  const dataRoot =
    databasePath === ":memory:"
      ? await mkdtemp(join(tmpdir(), "release-assets-"))
      : dirname(databasePath);
  if (databasePath === ":memory:") tempDirs.push(dataRoot);
  const storage = loadStorageConfig({ DATA_DIR: dataRoot });
  const built = await buildTestApp({
    databasePath,
    storage,
    logger: false,
    onRoleSessionCreated: options.onSessionCreated,
  });
  assetServices.set(
    built.database,
    new RoleAssetService(built.database, new RoleFileStore(storage)),
  );
  openApps.push(built.app);
  return built;
}

async function buildMultiAccountRoleReleaseApp(
  chat = false,
  existingRoot?: string,
): Promise<Built> {
  const dataRoot =
    existingRoot ?? (await mkdtemp(join(tmpdir(), "release-assets-")));
  if (!existingRoot) tempDirs.push(dataRoot);
  const storage = loadStorageConfig({ DATA_DIR: dataRoot });
  const built = await buildTestApp({
    databasePath: existingRoot
      ? join(existingRoot, "restart.sqlite")
      : ":memory:",
    storage,
    logger: false,
    accountMode: "multi",
    ...(chat
      ? {
          enablePromptDryRun: true,
          orchestration: {
            providers: [
              {
                id: "public-test",
                type: "openai-compatible" as const,
                apiKey: "test",
                baseURL: "https://public-role-test.invalid/v1",
              },
            ],
            defaultModel: { providerId: "public-test", modelId: "test-model" },
          },
        }
      : {}),
    auth: {
      mode: "api_key",
      apiKeys: [OWNER_KEY, OTHER_KEY],
      apiKeyAccountMap: { [OWNER_KEY]: OWNER, [OTHER_KEY]: OTHER },
    },
  });
  assetServices.set(
    built.database,
    new RoleAssetService(built.database, new RoleFileStore(storage)),
  );
  ensureTestDefaultWorkspace(built.database, OWNER);
  built.database
    .update(accounts)
    .set({ role: "admin" })
    .where(eq(accounts.id, OWNER))
    .run();
  ensureTestDefaultWorkspace(built.database, OTHER);
  openApps.push(built.app);
  return built;
}

async function seedRoleReleaseFixture(
  db: AppDb,
  accountId: string,
  snapshot: { name: string } & Record<string, unknown> = characterSnapshot,
): Promise<void> {
  const now = 1_780_000_000_000;
  const { workspaceId } = ensureTestDefaultWorkspace(db, accountId, now);
  db.insert(characters)
    .values({
      id: fixtureIds.character,
      name: snapshot.name,
      source: "test",
      accountId,
      workspaceId,
      status: "active",
      revision: 0,
      latestVersionNo: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(characterVersions)
    .values({
      id: fixtureIds.characterVersion,
      characterId: fixtureIds.character,
      versionNo: 1,
      dataJson: JSON.stringify(snapshot),
      contentHash: "character-hash",
      createdAt: now,
    })
    .run();
  const file = (
    name: string,
    purpose: import("@tavern/shared").RoleAssetFile["purpose"],
    content: string,
  ) => ({
    name,
    purpose,
    mime: "text/plain",
    base64: Buffer.from(content).toString("base64"),
  });
  await assetServices.get(db)!.import(accountId, fixtureIds.characterVersion, {
    character_id: fixtureIds.character,
    files: [
      file(
        "manifest.json",
        "manifest",
        JSON.stringify({
          apiVersion: 1,
          html: "view.html",
          css: "view.css",
          script: "main.js",
          assets: {},
          data: {},
        }),
      ),
      file("view.html", "template", "<p>Role</p>"),
      file("view.css", "template", ""),
      file("main.js", "browser_script", "export {}"),
    ],
  });
  db.insert(accountUsers)
    .values({
      id: fixtureIds.user,
      accountId,
      workspaceId,
      name: "Persona One",
      snapshotJson: JSON.stringify({
        name: "Persona One",
        description: "A fixed persona.",
      }),
      status: "active",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(presets)
    .values({
      id: fixtureIds.preset,
      name: "Release preset",
      source: "test",
      accountId,
      workspaceId,
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(presetVersions)
    .values({
      id: fixtureIds.presetVersion,
      presetId: fixtureIds.preset,
      versionNo: 1,
      dataJson: "{}",
      contentHash: "preset-hash",
      createdAt: now,
    })
    .run();
  db.insert(regexProfiles)
    .values({
      id: fixtureIds.regex,
      name: "Release regex",
      source: "test",
      accountId,
      workspaceId,
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(regexProfileVersions)
    .values({
      id: fixtureIds.regexVersion,
      regexProfileId: fixtureIds.regex,
      versionNo: 1,
      dataJson: "{}",
      contentHash: "regex-hash",
      createdAt: now,
    })
    .run();
  db.insert(worldbooks)
    .values({
      id: fixtureIds.worldbook,
      name: "Release worldbook",
      source: "test",
      accountId,
      workspaceId,
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(worldbookVersions)
    .values({
      id: fixtureIds.worldbookVersion,
      worldbookId: fixtureIds.worldbook,
      versionNo: 1,
      dataJson: "{}",
      contentHash: "worldbook-hash",
      createdAt: now,
    })
    .run();
  db.insert(llmProfiles)
    .values({
      id: fixtureIds.profile,
      presetName: "Release profile",
      accountId,
      workspaceId,
      provider: "openai",
      modelId: "test-model",
      apiKeyEncrypted: "unused-in-route-test",
      apiKeyMasked: "****test",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function createRelease(
  app: FastifyInstance,
  headers: Record<string, string> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/role-releases",
    headers,
    payload: releaseBody,
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as Record<string, any>;
}

function runReleaseRandom(
  runtime: RoleModelCapabilitiesRuntime,
  sessionId: string,
  floorId: string,
) {
  return runtime.provider.executeTool(
    "random",
    {
      domain: { kind: "integer_range", min: 1, max: 6 },
      distribution: { kind: "uniform" },
      count: 1,
      replacement: true,
    },
    {
      sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      floorId,
      callerSlot: "narrator",
      variableContext: {
        sessionId,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      },
    },
  );
}

function activeGreetingPageVersion(
  db: AppDb,
  sessionId: string,
): number | undefined {
  const row = db.$client
    .prepare(
      `
    SELECT message_page.version AS version
    FROM message_page
    INNER JOIN floor ON floor.id = message_page.floor_id
    WHERE floor.session_id = ? AND message_page.is_active = 1
    LIMIT 1
  `,
    )
    .get(sessionId) as { version: number } | undefined;
  return row?.version;
}

it("preflights complete bindings without publishing and identifies missing model slots and browser files", async () => {
  const built = await buildRoleReleaseApp(":memory:");
  await seedRoleReleaseFixture(built.database, DEFAULT_ADMIN_ACCOUNT_ID);
  const check = (configuration: unknown) =>
    built.app.inject({
      method: "POST",
      url: "/role-apps/validate",
      payload: { configuration },
    });
  const complete = (await check(releaseBody)).json().data;
  expect(complete).toMatchObject({
    valid: true,
    versionId: fixtureIds.characterVersion,
    stateUpdate: null,
  });
  expect(complete.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "main.js", purpose: "browser_script" }),
    ]),
  );
  expect(
    (await built.app.inject({ url: "/role-releases" })).json().data,
  ).toEqual([]);
  const missingSlot = await check({
    ...releaseBody,
    model_slots: [{ ...releaseBody.model_slots[0], slot: "memory" }],
  });
  expect(missingSlot.statusCode).toBe(400);
  expect(missingSlot.json().error).toMatchObject({
    code: "ROLE_RELEASE_MODEL_SLOT_MISSING",
    details: { slots: ["narrator"] },
  });
  built.database.delete(roleAssets).where(eq(roleAssets.name, "main.js")).run();
  const missingScript = await check(releaseBody);
  expect(missingScript.statusCode).toBe(409);
  expect(missingScript.json().error.details).toMatchObject({
    path: "main.js",
    purpose: "browser_script",
  });
});
