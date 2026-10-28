import { afterAll, afterEach, expect, it, vi } from "vitest";
import {
  parsePreset,
  parseWorldBook,
  parseRegexScripts,
} from "@tavern/adapters-sillytavern";
import { SimpleTokenCounter } from "@tavern/core";
import { createTestDatabase } from "../../../test/helpers/create-test-db.js";
import { RegexInputService } from "../chat/regex-input-service.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import { VariableService } from "../variables/variable-service.js";
import { assemblePrompt } from "../prompt-assembler.js";
import {
  PromptResourceLoader,
  type LoadedNativeCardPromptResources,
} from "../prompt-resource-loader.js";
import { buildPromptAssetManifestForAssembly } from "../prompt-assets/manifest-builder.js";
import acceptance from "../../../test/fixtures/native-card/acceptance-config.json";

const database = createTestDatabase(":memory:");
afterEach(() => vi.restoreAllMocks());
afterAll(() => database.close());
const bindings = {
  cardId: "card",
  packageId: "harbor",
  revision: 1,
  frontendManifestPath: null,
  worldbooks: ["harbor", "people", "disabled"].map((bookId, ordinal) => ({
    bookId,
    ordinal,
    resourceId: bookId,
    versionId: `${bookId}-v1`,
    enabled: bookId !== "disabled",
  })),
  regexProfiles: ["first", "second"].map((path, ordinal) => ({
    path,
    ordinal,
    resourceId: path,
    versionId: `${path}-v1`,
  })),
};
function resources(): LoadedNativeCardPromptResources {
  return {
    package: bindings,
    worldbooks: bindings.worldbooks.map((binding) => ({
      bookId: binding.bookId,
      enabled: binding.enabled,
      resource: {
        id: binding.resourceId,
        versionId: binding.versionId,
        version: 1,
        updatedAt: 1,
        worldbook: parseWorldBook({
          name: binding.bookId,
          entries: {
            "110": {
              uid: 110,
              key: [],
              constant: true,
              content: `${binding.bookId} original`,
              position: 0,
              order: 100,
              disable: false,
            },
          },
        })!,
      },
    })),
    regexProfiles: bindings.regexProfiles.map((binding, index) => ({
      path: binding.path,
      resource: {
        id: binding.resourceId,
        versionId: binding.versionId,
        version: 1,
        updatedAt: 1,
        scripts: parseRegexScripts([
          {
            id: binding.path,
            scriptName: binding.path,
            findRegex: index === 0 ? "蓝色印记" : "蓝色邮政印记",
            replaceString: index === 0 ? "蓝色邮政印记" : "雾港邮政印记",
            placement: [2],
            disabled: false,
          },
        ]),
      },
    })),
  };
}
it("assembles all enabled pinned books with scoped controller refs and ordered output regex", async () => {
  vi.spyOn(
    PromptResourceLoader.prototype,
    "loadPromptResourceBundle",
  ).mockResolvedValue({
    preset: {
      id: "preset",
      version: 1,
      updatedAt: 1,
      preset: parsePreset(acceptance.preset)!,
    },
    worldbook: null,
    regexProfile: null,
  });
  const load = vi
    .spyOn(PromptResourceLoader.prototype, "loadNativeCardRuntimeResources")
    .mockResolvedValue(resources());
  const renderController = vi.fn(async () => ({
    text: "当前地点：深夜邮局。",
  }));
  const result = await assemblePrompt(
    database.db,
    "default-admin",
    {
      presetId: "preset",
      worldbookProfileId: null,
      regexProfileId: null,
      metadataJson: null,
      characterId: "character",
      characterVersionId: "v1",
      promptMode: "compat_plus",
      characterSnapshotJson: JSON.stringify({
        name: "沈知夏",
        description: "雾港向导",
        extensions: {
          tavern_headless: {
            nativePackage: bindings,
            promptController: {
              modulePath: "modules/controllers/main.js",
              controllerEntries: [{ bookId: "harbor", entryId: 110 }],
              updaterEntries: [],
              variableRoot: "stat_data",
              variableMacros: [],
            },
          },
        },
      }),
      userSnapshotJson: JSON.stringify(acceptance.persona),
    },
    [],
    acceptance.userMessage,
    new SimpleTokenCounter(),
    undefined,
    { rolePromptModuleLoader: async () => ({ renderController }) },
  );
  expect(load).toHaveBeenCalledWith("default-admin", bindings);
  const content = result.messages.map((message) => message.content).join("\n");
  expect(content).toContain("当前地点：深夜邮局。");
  expect(content).toContain("people original");
  expect(content).not.toContain("disabled original");
  expect(content).toContain(acceptance.persona.description);
  expect(renderController).toHaveBeenCalledTimes(1);
  expect(
    result.promptSnapshot.worldbookActivatedEntries.map(
      (entry) => entry.source.worldbookId,
    ),
  ).toEqual(["harbor", "people"]);
  expect(result.postProcess?.("蓝色印记")).toBe("雾港邮政印记");
});
it("declares every pinned native resource in the assembly manifest", () => {
  const result = buildPromptAssetManifestForAssembly({
    generatedAt: 1,
    preset: null,
    worldbook: null,
    regexProfile: null,
    nativeResources: resources(),
  });
  expect(result.manifest.assets.map((asset) => asset.assetId).sort()).toEqual([
    "disabled",
    "first",
    "harbor",
    "people",
    "second",
  ]);
  expect(
    result.manifest.declarations.find((item) => item.ref.assetId === "disabled")
      ?.runtimeActive,
  ).toBe(false);
});

it("persists user input through all pinned regex profiles in package order", async () => {
  const native = resources();
  for (const profile of native.regexProfiles)
    for (const script of profile.resource.scripts) script.placement = [1];
  vi.spyOn(
    PromptResourceLoader.prototype,
    "loadRegexScripts",
  ).mockResolvedValue(null);
  vi.spyOn(
    PromptResourceLoader.prototype,
    "loadNativeCardRuntimeResources",
  ).mockResolvedValue(native);
  vi.spyOn(VariableService.prototype, "resolveSnapshot").mockResolvedValue({
    resolved: [],
  } as never);
  const update = vi
    .spyOn(ChatMessagePersistence.prototype, "updateMessageContent")
    .mockResolvedValue(undefined);
  const characterSnapshotJson = JSON.stringify({
    name: "沈知夏",
    extensions: { tavern_headless: { nativePackage: bindings } },
  });
  const result = await new RegexInputService(
    database.db,
    new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
  ).applyPersistedUserInputRegex({
    accountId: "default-admin",
    sessionId: "session",
    session: {
      characterSnapshotJson,
      userSnapshotJson: null,
      metadataJson: null,
    },
    sessionInfo: {
      characterSnapshotJson,
      metadataJson: null,
      presetId: null,
      worldbookProfileId: null,
      regexProfileId: null,
    },
    rawUserMessage: "蓝色印记",
    regexChannel: "persist",
    persistedMessageId: "message",
  });
  expect(result.text).toBe("雾港邮政印记");
  expect(update).toHaveBeenCalledWith("message", "雾港邮政印记");
});
