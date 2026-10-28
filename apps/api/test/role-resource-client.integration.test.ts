import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTavernClient, isTavernApiError } from "@tavern/sdk";
import { PROMPT_ASSET_REQUEST_LIMITS } from "@tavern/shared";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import type { RoleResourceKind } from "../../web/src/lib/role-resource.schema.js";
import {
  createRoleResource,
  exportRoleResource,
  importRoleResource,
  listRoleResources,
  previewRoleResourceImport,
  readRoleResource,
  removeRoleResource,
  saveRoleResource,
  updatePresetOrder,
} from "../../web/src/lib/role-resources.js";

const PRESET_FIXTURE = new URL(
  "../../../fixtures/role-apps/presets/tianqin-beta-3.9.json",
  import.meta.url,
);

type PresetJson = Record<string, unknown> & {
  prompts: Array<Record<string, unknown>>;
  prompt_order: Array<Record<string, unknown>>;
};

let app: FastifyInstance | undefined;
let root: string | undefined;
let client: ReturnType<typeof createTavernClient>;
let originalMasterKey: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "role-resource-client-"));
  originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;
  process.env.APP_SECRETS_MASTER_KEY = "role-resource-client-test-master-key";
  const storage = loadStorageConfig({ DATA_DIR: root });
  ({ app } = await buildTestApp({
    databasePath: storage.databasePath,
    storage,
    auth: { mode: "off" },
    logger: false,
  }));

  const fetchImpl: typeof fetch = async (input, init) => {
    if (!app) throw new Error("Test API is not running");
    const url = new URL(String(input));
    const requestBody = init?.body;
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers)),
      ...(requestBody === undefined
        ? {}
        : { payload: String(requestBody) }),
    });
    return new Response(
      response.statusCode === 204 ? null : response.body,
      {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      },
    );
  };
  client = createTavernClient({ baseUrl: "http://tavern.test", fetchImpl });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  if (originalMasterKey === undefined)
    delete process.env.APP_SECRETS_MASTER_KEY;
  else process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
});

function resourcePayloads(): Array<{
  kind: RoleResourceKind;
  name: string;
  payload: Record<string, unknown> | unknown[];
}> {
  return [
    {
      kind: "preset",
      name: "Integration Preset",
      payload: {
        temperature: 0.7,
        custom_preset_field: { retained: true },
        prompts: [
          {
            identifier: "main",
            name: "Main",
            role: "system",
            content: "Original prompt",
            system_prompt: true,
            injection_position: 0,
            injection_depth: 3,
            enabled: true,
            custom_prompt_field: { retained: true },
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [{ identifier: "main", enabled: true }],
            custom_track_field: { retained: true },
          },
        ],
      },
    },
    {
      kind: "worldbook",
      name: "Integration Worldbook",
      payload: {
        scanDepth: 4,
        custom_worldbook_field: { retained: true },
        entries: {
          "42": {
            uid: 42,
            key: ["lighthouse"],
            keysecondary: [],
            content: "Original entry",
            comment: "First entry",
            extensions: { outlet_name: "Retained outlet", custom: true },
          },
        },
      },
    },
    {
      kind: "regex",
      name: "Integration Regex",
      payload: [
        {
          id: "rule-1",
          scriptName: "Replace greeting",
          findRegex: "hello",
          replaceString: "hi",
          trimStrings: [],
          placement: [2],
          disabled: false,
          markdownOnly: false,
          promptOnly: true,
          runOnEdit: false,
          substituteRegex: 0,
          minDepth: -1,
          maxDepth: -1,
        },
      ],
    },
    {
      kind: "persona",
      name: "Integration Persona",
      payload: { description: "Original persona", status: "active" },
    },
    {
      kind: "model",
      name: "Integration Model",
      payload: {
        provider: "openai",
        model_id: "integration-model",
        api_key: "test-only-api-key",
        base_url: "",
        api_key_name: "integration-key",
        status: "active",
      },
    },
  ];
}

function editResource(
  kind: RoleResourceKind,
  document: Awaited<ReturnType<typeof readRoleResource>>,
) {
  document.name = `${document.name} Saved`;
  if (kind === "persona") {
    document.value.description = "Saved description";
  } else if (kind === "model") {
    document.value.model_id = "integration-model-saved";
  } else if (kind === "preset") {
    document.entries![0]!.content = "Saved prompt";
  } else if (kind === "worldbook") {
    document.entries![0]!.content = "Saved entry";
  } else {
    document.entries![0]!.replaceString = "saved";
  }
}

function expectEditedValue(
  kind: RoleResourceKind,
  document: Awaited<ReturnType<typeof readRoleResource>>,
) {
  if (kind === "persona") {
    expect(document.value.description).toBe("Saved description");
  } else if (kind === "model") {
    expect(document.value.model_id).toBe("integration-model-saved");
  } else if (kind === "preset") {
    expect(document.entries?.[0]?.content).toBe("Saved prompt");
  } else if (kind === "worldbook") {
    expect(document.entries?.[0]?.content).toBe("Saved entry");
  } else {
    expect(document.entries?.[0]?.replaceString).toBe("saved");
  }
}

describe("role resource library over the official SDK and isolated API", () => {
  it("creates, lists, reads, saves, copies, and deletes each of the five system resource kinds", async () => {
    for (const { kind, name, payload } of resourcePayloads()) {
      const document = previewRoleResourceImport(kind, name, payload);
      const id = await createRoleResource(client, kind, document);
      const listed = await listRoleResources(client, kind);
      expect(listed.map((row) => row.id)).toContain(id);

      const loaded = await readRoleResource(client, kind, id);
      editResource(kind, loaded);
      await saveRoleResource(client, kind, loaded);
      const saved = await readRoleResource(client, kind, id);
      expect(saved.name).toBe(`${name} Saved`);
      expectEditedValue(kind, saved);

      const copy = structuredClone(saved);
      copy.id = "";
      copy.name = `${name} Copy`;
      copy.revision = undefined;
      copy.version = undefined;
      const copyId = await createRoleResource(client, kind, copy);
      const copied = await readRoleResource(client, kind, copyId);
      expect(copied.name).toBe(`${name} Copy`);
      expectEditedValue(kind, copied);

      const copyRow = (await listRoleResources(client, kind)).find(
        (row) => row.id === copyId,
      );
      expect(copyRow).toBeDefined();
      await removeRoleResource(client, kind, copyRow!);
      const afterRemove = (await listRoleResources(client, kind)).find(
        (row) => row.id === copyId,
      );
      expect(afterRemove).toBeUndefined();

      if (kind === "worldbook" || kind === "regex") {
        const exported = await exportRoleResource(client, kind, id);
        expect(exported.ok).toBe(true);
        const exportedJson = (await exported.json()) as
          | Record<string, unknown>
          | unknown[];
        const importedRoundTrip = await importRoleResource(
          client,
          kind,
          saved.name,
          exportedJson,
        );
        const roundTripId = importedRoundTrip.id;
        const reexported = await exportRoleResource(client, kind, roundTripId);
        expect(reexported.ok).toBe(true);
        expect(await reexported.json()).toEqual(exportedJson);
      }
    }
  });

  it("previews the official ST preset fixture, preserves extensions, and round-trips its export through import", async () => {
    const fixture = JSON.parse(
      await readFile(PRESET_FIXTURE, "utf8"),
    ) as PresetJson;
    fixture.custom_import_extension = { owner: "fixture", nested: [1, 2] };
    fixture.prompts[0]!.custom_import_extension = { prompt: "kept" };
    fixture.prompt_order[0]!.custom_import_extension = { track: "kept" };

    const preview = previewRoleResourceImport(
      "preset",
      "Official ST preset",
      fixture,
    );
    expect(
      preview.entries?.find(
        (entry) =>
          entry.identifier ===
          fixture.prompts.find((prompt) => prompt.role === "model")?.identifier,
      )?.role,
    ).toBe("assistant");
    expect(preview.rawImport?.prompts).toEqual(fixture.prompts);
    expect(preview.entries?.length).toBe(fixture.prompts.length);
    expect(preview.value.topLevel).toMatchObject({
      custom_import_extension: fixture.custom_import_extension,
      extensions: fixture.extensions,
    });

    const importedId = await createRoleResource(client, "preset", preview);
    const detail = await readRoleResource(client, "preset", importedId);
    expect(detail.entries?.some((entry) => entry.role === "assistant")).toBe(
      true,
    );
    expect(
      detail.entries?.find((entry) => entry.identifier === "main")?.extra,
    ).toMatchObject({ custom_import_extension: { prompt: "kept" } });
    expect(detail.value.orderContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extra: { custom_import_extension: { track: "kept" } },
        }),
      ]),
    );
    const savedExport = await exportRoleResource(client, "preset", importedId);
    expect(savedExport.ok).toBe(true);
    const exportedPreset = (await savedExport.json()) as PresetJson;
    expect(
      exportedPreset.prompts.some((prompt) => prompt.role === "model"),
    ).toBe(true);
    expect(exportedPreset.custom_import_extension).toEqual(
      fixture.custom_import_extension,
    );
    expect(
      exportedPreset.prompts.find((prompt) => prompt.identifier === "main")
        ?.custom_import_extension,
    ).toEqual({ prompt: "kept" });
    expect(exportedPreset.prompt_order[0]?.custom_import_extension).toEqual({
      track: "kept",
    });

    const directImport = await importRoleResource(
      client,
      "preset",
      "Official ST preset export copy",
      exportedPreset,
    );
    const secondExport = await exportRoleResource(
      client,
      "preset",
      directImport.id,
    );
    expect(secondExport.ok).toBe(true);
    expect(await secondExport.json()).toEqual(exportedPreset);
  });

  it("preserves both source prompt tracks and model roles after editing a stored preset", async () => {
    const fixture = JSON.parse(
      await readFile(PRESET_FIXTURE, "utf8"),
    ) as PresetJson;
    const imported = await client.imports.preset({
      name: "Editable official preset",
      data: fixture,
    });
    const beforeResponse = await exportRoleResource(
      client,
      "preset",
      imported.id,
    );
    const before = (await beforeResponse.json()) as PresetJson;
    expect(before.prompt_order).toEqual(fixture.prompt_order);

    const document = await readRoleResource(client, "preset", imported.id);
    document.name = "Edited official preset";
    document.entries![0]!.content += " edited";
    updatePresetOrder(document);
    await saveRoleResource(client, "preset", document);

    const afterResponse = await exportRoleResource(
      client,
      "preset",
      imported.id,
    );
    const after = (await afterResponse.json()) as PresetJson;
    expect(after.prompt_order).toEqual(before.prompt_order);
    expect(
      after.prompts
        .filter((prompt) => prompt.role === "model")
        .map((prompt) => prompt.identifier),
    ).toEqual(
      before.prompts
        .filter((prompt) => prompt.role === "model")
        .map((prompt) => prompt.identifier),
    );
    expect(after.prompts[0]?.content).toContain("edited");

    const changedRole = await readRoleResource(client, "preset", imported.id);
    const modelEntry = changedRole.entries!.find(
      (entry) => entry.sourceRole === "model",
    );
    expect(modelEntry?.role).toBe("assistant");
    modelEntry!.role = "user";
    await saveRoleResource(client, "preset", changedRole);
    const roleChangedExport = await exportRoleResource(
      client,
      "preset",
      imported.id,
    );
    const roleChanged = (await roleChangedExport.json()) as PresetJson;
    expect(
      roleChanged.prompts.find(
        (prompt) => prompt.identifier === modelEntry!.identifier,
      )?.role,
    ).toBe("user");
  });

  it("adds an explicitly new SDK prompt to only the selected default track", async () => {
    const imported = await client.imports.preset({
      name: "SDK preset prompt addition",
      data: {
        default_character_id: 23,
        prompts: [
          {
            identifier: "existing",
            name: "Existing",
            role: "system",
            content: "Existing content",
            system_prompt: true,
            marker: false,
            injection_position: 0,
            enabled: true,
          },
        ],
        prompt_order: [
          {
            character_id: 17,
            order: [{ identifier: "existing", enabled: false }],
          },
          { character_id: 23, order: [] },
        ],
      },
    });
    const detail = await client.presets.getEditor({ presetId: imported.id });
    const newEntry = {
      identifier: "added",
      name: "Added",
      role: "system" as const,
      content: "Added content",
      systemPrompt: false,
      marker: false,
      injectionPosition: 0,
      enabled: true,
      extra: {},
      isOriginal: false,
    };

    await client.presets.update({
      presetId: imported.id,
      expectedVersion: detail.version,
      expectedUpdatedAt: detail.updatedAt,
      name: detail.name,
      editor: {
        default_character_id: detail.editor.defaultCharacterId,
        entries: [...detail.editor.entries, newEntry].map((entry) => ({
          identifier: entry.identifier,
          name: entry.name,
          role: entry.role,
          content: entry.content,
          system_prompt: entry.systemPrompt,
          marker: entry.marker,
          injection_position: entry.injectionPosition,
          enabled: entry.enabled,
          is_original: entry.isOriginal,
          source_role: "sourceRole" in entry ? entry.sourceRole : undefined,
          extra: entry.extra,
        })),
        order_contexts: detail.editor.orderContexts.map((context) => ({
          ...context.extra,
          character_id: context.characterId,
          order: context.order,
        })),
        top_level: detail.editor.topLevel,
      },
    });

    const exported = await exportRoleResource(client, "preset", imported.id);
    const saved = (await exported.json()) as PresetJson;
    expect(saved.default_character_id).toBe(23);
    expect(saved.prompt_order).toEqual([
      {
        character_id: 17,
        order: [{ identifier: "existing", enabled: false }],
      },
      {
        character_id: 23,
        order: [{ identifier: "added", enabled: true }],
      },
    ]);
  });

  it("rejects invalid preset structures before import and leaves no resource behind", async () => {
    const before = await client.presets.list();
    const invalidInputs: Array<{
      kind: RoleResourceKind;
      payload: Record<string, unknown> | unknown[];
    }> = [
      { kind: "preset", payload: { prompts: "bad" } },
      { kind: "worldbook", payload: { entries: "bad" } },
      { kind: "regex", payload: { scripts: [] } },
      { kind: "persona", payload: [] },
      { kind: "model", payload: { provider: "unknown", model_id: "x" } },
    ];
    const beforeByKind = new Map(
      await Promise.all(
        invalidInputs.map(
          async ({ kind }) =>
            [kind, await listRoleResources(client, kind)] as const,
        ),
      ),
    );
    for (const { kind, payload } of invalidInputs) {
      expect(() =>
        previewRoleResourceImport(kind, "Invalid resource", payload),
      ).toThrow(
        expect.objectContaining({ code: "ROLE_RESOURCE_IMPORT_INVALID" }),
      );
      await expect(
        importRoleResource(client, kind, "Invalid resource", payload),
      ).rejects.toMatchObject({
        code: "ROLE_RESOURCE_IMPORT_INVALID",
      });
    }
    for (const { kind } of invalidInputs) {
      expect(await listRoleResources(client, kind)).toEqual(
        beforeByKind.get(kind),
      );
    }
    await expect(
      importRoleResource(client, "preset", "Invalid preset", {
        prompts: "bad",
      }),
    ).rejects.toMatchObject({ code: "ROLE_RESOURCE_IMPORT_INVALID" });
    await expect(
      client.imports.preset({
        name: "Invalid preset",
        data: { prompts: "bad" } as Record<string, unknown>,
      }),
    ).rejects.toMatchObject({ code: "import_parse_error" });
    expect(await client.presets.list()).toEqual(before);

    const malformedJson = await app!.inject({
      method: "POST",
      url: "/import/preset",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(await client.presets.list()).toEqual(before);
  });

  it("accepts a 1.33 MB preset through SDK import and editor save", async () => {
    const namedFixture = { prompts: [], prompt_order: [], padding: "" };
    const requestBody = { name: "1.33 MB preset", data: namedFixture };
    const baseBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
    namedFixture.padding = "x".repeat(1_329_446 - baseBytes);
    expect(Buffer.byteLength(JSON.stringify(requestBody), "utf8")).toBe(
      1_329_446,
    );

    const imported = await client.imports.preset({
      name: "1.33 MB preset",
      data: namedFixture,
    });
    expect(imported.id).toBeTruthy();

    const editor = await client.presets.getEditor({ presetId: imported.id });
    await client.presets.update({
      presetId: imported.id,
      name: editor.name,
      expectedVersion: editor.version,
      expectedUpdatedAt: editor.updatedAt,
      editor: {
        default_character_id: editor.editor.defaultCharacterId,
        entries: editor.editor.entries.map((entry) => ({
          identifier: entry.identifier,
          name: entry.name,
          role: entry.role,
          content: entry.content,
          system_prompt: entry.systemPrompt,
          marker: entry.marker,
          injection_position: entry.injectionPosition,
          enabled: entry.enabled,
          extra: entry.extra,
        })),
        order_contexts: editor.editor.orderContexts.map((context) => ({
          ...context.extra,
          character_id: context.characterId,
          order: context.order,
        })),
        top_level: editor.editor.topLevel,
      },
    });
    const saved = await client.presets.getDetail({ presetId: imported.id });
    expect((saved.data.padding as string).length).toBeGreaterThan(1_000_000);

    const oversized = "x".repeat(PROMPT_ASSET_REQUEST_LIMITS.bodyLimitBytes);
    const oversizedRequests = [
      {
        method: "POST",
        url: "/import/preset",
        body: {
          name: "Oversized preset",
          data: { prompts: [], prompt_order: [], size_probe: oversized },
        },
      },
      {
        method: "POST",
        url: "/import/worldbook",
        body: {
          name: "Oversized worldbook",
          data: { entries: {}, size_probe: oversized },
        },
      },
      {
        method: "POST",
        url: "/import/regex",
        body: {
          name: "Oversized regex",
          data: [
            {
              id: "size-probe",
              scriptName: "Size probe",
              findRegex: "x",
              size_probe: oversized,
            },
          ],
        },
      },
      {
        method: "PUT",
        url: "/presets/nonexistent",
        body: {
          name: "Oversized preset",
          editor: {
            default_character_id: 0,
            entries: [],
            order_contexts: [],
            top_level: { size_probe: oversized },
          },
        },
      },
      {
        method: "PUT",
        url: "/worldbooks/nonexistent",
        body: {
          name: "Oversized worldbook",
          data: { entries: {}, size_probe: oversized },
        },
      },
      {
        method: "PUT",
        url: "/regex-profiles/nonexistent",
        body: {
          name: "Oversized regex",
          data: [
            {
              id: "size-probe",
              scriptName: "Size probe",
              findRegex: "x",
              size_probe: oversized,
            },
          ],
        },
      },
    ] as const;

    for (const request of oversizedRequests) {
      const payload = JSON.stringify(request.body);
      expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(
        PROMPT_ASSET_REQUEST_LIMITS.bodyLimitBytes,
      );
      const response = await app!.inject({
        method: request.method,
        url: request.url,
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({
        error: { code: "payload_too_large" },
      });
    }

    const characterSizeProbe = "x".repeat(1_048_576);
    const character = await client.imports.character({
      createSession: false,
      payload: {
        spec: "chara_card_v2",
        data: {
          name: "Large character",
          extensions: { size_probe: characterSizeProbe },
        },
      },
    });
    expect(character.characterId).toBeTruthy();
  });

  it("protects a referenced model profile until its binding is removed", async () => {
    const modelSource = resourcePayloads().find(
      (item) => item.kind === "model",
    )!;
    const modelId = await createRoleResource(
      client,
      "model",
      previewRoleResourceImport("model", modelSource.name, modelSource.payload),
    );
    await client.llmProfiles.activate({
      profileId: modelId,
      scope: "global",
      slot: "narrator",
    });

    await expect(
      client.llmProfiles.delete({ profileId: modelId }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isTavernApiError(error) && error.code === "profile_in_use",
    );

    await client.llmProfiles.unbind({ scope: "global", slot: "narrator" });
    expect(await client.llmProfiles.delete({ profileId: modelId })).toBe(true);
  });
});
