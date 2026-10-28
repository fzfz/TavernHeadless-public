import type { CreateRoleReleaseBody } from "@tavern/shared";
import { buildTestApp } from "./create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID as accountId } from "../../src/accounts/constants.js";
import {
  accountUsers,
  characterVersions,
  characters,
  llmProfiles,
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
} from "../../src/db/schema.js";
import { RoleAssetService } from "../../src/services/role-runtime/role-asset-service.js";
import { RoleFileStore } from "../../src/services/storage/role-file-store.js";
import { loadStorageConfig } from "../../src/storage-config.js";
import { ensureTestDefaultWorkspace } from "../../src/__tests__/helpers/workspace-project.js";
export const ids = {
  character: "char_role_workspace_sdk",
  characterVersion: "charver_role_workspace_sdk_v1",
  user: "usr_role_workspace_sdk",
  preset: "preset_role_workspace_sdk",
  presetVersion: "presetver_role_workspace_sdk_v1",
  regex: "regex_role_workspace_sdk",
  regexVersion: "regexver_role_workspace_sdk_v1",
  profile: "profile_role_workspace_sdk",
};

const characterSnapshot = {
  name: "SDK Role",
  description: "A role used by the SDK to Fastify integration test.",
  primaryGreeting: "The lighthouse keeper greets {{user}}.",
};

function file(name: string, purpose: Parameters<RoleAssetService["import"]>[2]["files"][number]["purpose"], content: string) {
  return {
    name,
    purpose,
    mime: "text/plain",
    base64: Buffer.from(content).toString("base64"),
  };
}

export function configuration(): CreateRoleReleaseBody {
  return {
    name: "SDK Lighthouse",
    character_id: ids.character,
    character_version_id: ids.characterVersion,
    preset_id: ids.preset,
    preset_version_id: ids.presetVersion,
    regex_profile_id: ids.regex,
    regex_profile_version_id: ids.regexVersion,
    worldbook_id: null,
    worldbook_version_id: null,
    prompt_mode: "native",
    model_slots: [
      {
        slot: "narrator",
        profile_id: ids.profile,
        params: { temperature: 0.4, max_output_tokens: 128 },
      },
    ],
    default_user_id: ids.user,
  };
}

export async function seedRoleResources(
  db: Awaited<ReturnType<typeof buildTestApp>>["database"],
  storage: ReturnType<typeof loadStorageConfig>,
): Promise<void> {
  const now = Date.now();
  const workspace = ensureTestDefaultWorkspace(db, accountId, now);
  db.insert(characters)
    .values({
      id: ids.character,
      name: characterSnapshot.name,
      source: "test",
      accountId,
      workspaceId: workspace.workspaceId,
      status: "active",
      revision: 0,
      latestVersionNo: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(characterVersions)
    .values({
      id: ids.characterVersion,
      characterId: ids.character,
      versionNo: 1,
      dataJson: JSON.stringify(characterSnapshot),
      contentHash: "role-workspace-sdk-character-v1",
      createdAt: now,
    })
    .run();
  await new RoleAssetService(db, new RoleFileStore(storage)).import(
    accountId,
    ids.characterVersion,
    {
      character_id: ids.character,
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
        file("view.html", "template", "<p>SDK Role</p>"),
        file("view.css", "template", "p { color: navy; }"),
        file("main.js", "browser_script", "export {};"),
      ],
    },
  );

  db.insert(accountUsers)
    .values({
      id: ids.user,
      accountId,
      workspaceId: workspace.workspaceId,
      name: "SDK Visitor",
      snapshotJson: JSON.stringify({
        name: "SDK Visitor",
        description: "A visitor.",
      }),
      status: "active",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(presets)
    .values({
      id: ids.preset,
      name: "SDK preset",
      source: "test",
      accountId,
      workspaceId: workspace.workspaceId,
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(presetVersions)
    .values({
      id: ids.presetVersion,
      presetId: ids.preset,
      versionNo: 1,
      dataJson: "{}",
      contentHash: "role-workspace-sdk-preset-v1",
      createdAt: now,
    })
    .run();
  db.insert(regexProfiles)
    .values({
      id: ids.regex,
      name: "SDK regex",
      source: "test",
      accountId,
      workspaceId: workspace.workspaceId,
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(regexProfileVersions)
    .values({
      id: ids.regexVersion,
      regexProfileId: ids.regex,
      versionNo: 1,
      dataJson: "{}",
      contentHash: "role-workspace-sdk-regex-v1",
      createdAt: now,
    })
    .run();
  db.insert(llmProfiles)
    .values({
      id: ids.profile,
      presetName: "SDK deterministic profile",
      accountId,
      workspaceId: workspace.workspaceId,
      provider: "openai-compatible",
      modelId: "offline-model",
      apiKeyEncrypted: "unused-by-these-tests",
      apiKeyMasked: "****test",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
