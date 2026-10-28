import { createBrowserUuid } from "@tavern/shared";
import { serializePresetEditorDocument } from "../stores/workspace/preset-editor.js";
import resourceFields from "../config/role-resource-fields.json";
import type {
  TavernClient,
  PresetEditorDocument,
  RegexProfileRuleInput,
  LlmProvider,
} from "@tavern/sdk";
import {
  parseRegexScripts,
  parseWorldBook,
  toPresetEditorDocument,
} from "@tavern/adapters-sillytavern/browser-import";
import type {
  RoleResourceKind,
  RoleResourceDocument,
  RoleResourceRow,
} from "./role-resource.schema.js";

type ResourceImportError = Error & { code: "ROLE_RESOURCE_IMPORT_INVALID" };

function assertSupportedRoleResourceKind(kind: RoleResourceKind): void {
  if (!Object.prototype.hasOwnProperty.call(resourceFields.fields, kind)) {
    throw new Error();
  }
}

function invalidResourceImport(cause?: unknown): ResourceImportError {
  return Object.assign(new Error("Role resource import payload is invalid"), {
    code: "ROLE_RESOURCE_IMPORT_INVALID" as const,
    ...(cause === undefined ? {} : { cause }),
  });
}

function requireImportRecord(
  value: unknown,
  resource: RoleResourceKind,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResourceImport(new Error(`${resource} JSON must be an object`));
  }
  return value as Record<string, unknown>;
}

function toWebPresetEditorDocument(raw: unknown): {
  value: Record<string, unknown>;
  entries: Record<string, unknown>[];
} {
  const editor = toPresetEditorDocument(raw);
  return {
    value: {
      format: editor.format,
      defaultCharacterId: editor.default_character_id,
      topLevel: editor.top_level,
      orderContexts: editor.order_contexts.map((context) => ({
        characterId: context.character_id,
        order: context.order,
        extra: context.extra,
      })),
    },
    entries: editor.entries.map((entry) => ({
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      content: entry.content,
      systemPrompt: entry.system_prompt,
      marker: entry.marker,
      injectionPosition: entry.injection_position,
      injectionDepth: entry.injection_depth,
      injectionOrder: entry.injection_order,
      forbidOverrides: entry.forbid_overrides,
      injectionTrigger: entry.injection_trigger,
      enabled: entry.enabled,
      isOriginal: entry.is_original,
      sourceRole: entry.source_role,
      extra: entry.extra,
    })),
  };
}

function toPresetImportPayload(document: RoleResourceDocument): Record<string, unknown> {
  return serializePresetEditorDocument({
    ...document.value,
    entries: document.entries ?? [],
  } as unknown as PresetEditorDocument);
}

function mapWorldbookEntryForEditor(
  raw: Record<string, unknown>,
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...raw,
    ...normalized,
    key: normalized.key,
    keysecondary: normalized.keysecondary,
    order: normalized.order,
    disable: normalized.disable,
    selectiveLogic: normalized.selectiveLogic,
    scanDepth: normalized.scanDepth,
    caseSensitive: normalized.caseSensitive,
    matchWholeWords: normalized.matchWholeWords,
    excludeRecursion: normalized.excludeRecursion,
    preventRecursion: normalized.preventRecursion,
    delayUntilRecursion: normalized.delayUntilRecursion,
    outletName: normalized.outletName,
  };
}

/** Convert a parsed JSON file into the existing editor document shape without writing it. */
export function previewRoleResourceImport(
  kind: RoleResourceKind,
  name: string,
  payload: Record<string, unknown> | unknown[],
): RoleResourceDocument {
  try {
    assertSupportedRoleResourceKind(kind);

    if (kind === "preset") {
      const editor = toWebPresetEditorDocument(payload);
      return {
        id: "",
        name,
        value: editor.value,
        entries: editor.entries,
        rawImport: structuredClone(payload as Record<string, unknown>),
      };
    }

    if (kind === "worldbook") {
      const raw = requireImportRecord(payload, kind);
      const parsed = parseWorldBook(raw, name);
      const rawEntries = raw.entries ?? {};
      const pairs: Array<[string, Record<string, unknown>]> = Array.isArray(rawEntries)
        ? rawEntries.map((entry, index) => [String(index), requireImportRecord(entry, kind)])
        : Object.entries(requireImportRecord(rawEntries, kind)).map(
            ([key, entry]) => [key, requireImportRecord(entry, kind)],
          );
      const entries = pairs.map(([key, entry], index) => {
        const normalized = parsed.entries[index];
        if (!normalized) throw invalidResourceImport();
        return mapWorldbookEntryForEditor(entry, normalized as unknown as Record<string, unknown>);
      });
      const mappedEntries = Array.isArray(rawEntries)
        ? entries
        : Object.fromEntries(pairs.map(([key], index) => [key, entries[index]]));
      return {
        id: "",
        name,
        value: { ...structuredClone(raw), entries: mappedEntries },
        entryKeys: pairs.map(([key]) => key),
        entries,
      };
    }

    if (kind === "regex") {
      if (!Array.isArray(payload)) throw invalidResourceImport();
      parseRegexScripts(payload);
      return {
        id: "",
        name,
        value: {},
        entries: structuredClone(payload) as Record<string, unknown>[],
      };
    }

    if (kind === "persona") {
      const raw = requireImportRecord(payload, kind);
      const snapshot = raw.snapshot && typeof raw.snapshot === "object" && !Array.isArray(raw.snapshot)
        ? (raw.snapshot as Record<string, unknown>)
        : raw;
      return {
        id: "",
        name: typeof snapshot.name === "string" ? snapshot.name : name,
        value: structuredClone(snapshot),
      };
    }

    const raw = requireImportRecord(payload, kind);
    const providers = new Set(resourceFields.enums.provider.map(([provider]) => String(provider)));
    if (
      typeof raw.provider !== "string" ||
      !providers.has(raw.provider) ||
      typeof raw.model_id !== "string" ||
      raw.model_id.trim().length === 0
    ) {
      throw invalidResourceImport();
    }
    return {
      id: "",
      name:
        typeof raw.preset_name === "string"
          ? raw.preset_name
          : typeof raw.name === "string"
            ? raw.name
            : name,
      value: {
        ...structuredClone(raw),
        api_key: typeof raw.api_key === "string" ? raw.api_key : "",
        api_key_name: typeof raw.api_key_name === "string" ? raw.api_key_name : null,
        base_url: typeof raw.base_url === "string" ? raw.base_url : null,
        status: raw.status === "disabled" ? "disabled" : "active",
      },
    };
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ROLE_RESOURCE_IMPORT_INVALID")
      throw error;
    throw invalidResourceImport(error);
  }
}
export async function listRoleResources(
  client: TavernClient,
  kind: RoleResourceKind,
): Promise<RoleResourceRow[]> {
  assertSupportedRoleResourceKind(kind);
  switch (kind) {
    case "preset":
      return client.presets.list();
    case "worldbook":
      return client.worldbooks.list();
    case "regex":
      return client.regexProfiles.list();
    case "persona":
      return client.users.list();
    case "model":
      return (await client.llmProfiles.list()).map((item) => ({
        ...item,
        name: item.presetName,
      }));
  }
}
export async function readRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  id: string,
): Promise<RoleResourceDocument> {
  assertSupportedRoleResourceKind(kind);
  switch (kind) {
    case "persona": {
      const detail = await client.users.getDetail({ userId: id });
      return {
        id,
        name: detail.name,
        revision: detail.revision,
        value: { ...detail.snapshot, status: detail.status },
      };
    }
    case "preset": {
      const detail = await client.presets.getEditor({ presetId: id });
      return {
        id,
        name: detail.name,
        version: detail.version,
        value: { ...detail.editor },
        entries: detail.editor.entries.map((item) => ({ ...item })),
      };
    }
    case "regex": {
      const detail = await client.regexProfiles.getDetail({ profileId: id });
      return {
        id,
        name: detail.name,
        version: detail.version,
        value: {},
        entries: structuredClone(detail.data) as Record<string, unknown>[],
      };
    }
    case "worldbook": {
      const detail = await client.worldbooks.getDetail({ worldbookId: id });
      const value = structuredClone(detail.data) as Record<string, unknown>;
      return {
        id,
        name: detail.name,
        version: detail.version,
        value,
        entryKeys: Object.keys(value.entries as object),
        entries: structuredClone(
          Object.values(
            value.entries as Record<string, Record<string, unknown>>,
          ),
        ),
      };
    }
    case "model": {
      const detail = (await client.llmProfiles.list()).find(
        (item) => item.id === id,
      );
      if (!detail) throw Object.assign(new Error(), { code: "NOT_FOUND" });
      return {
        id,
        name: detail.presetName,
        value: {
          provider: detail.provider,
          base_url: detail.baseUrl,
          model_id: detail.modelId,
          api_key_name: detail.apiKeyName,
          status: detail.status,
        },
      };
    }
  }
}
export async function saveRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  document: RoleResourceDocument,
) {
  const { id, name, value, entries, revision, version } = document;
  assertSupportedRoleResourceKind(kind);
  switch (kind) {
    case "persona": {
      const { status, ...snapshot } = value;
      return client.users.update({
        userId: id,
        expectedRevision: revision,
        snapshot: { ...snapshot, name },
        status: status as "active" | "disabled",
      });
    }
    case "preset": {
      const preset = value as unknown as PresetEditorDocument;
      return client.presets.update({
        presetId: id,
        expectedVersion: version,
        name,
        editor: {
          default_character_id: preset.defaultCharacterId,
          top_level: preset.topLevel,
          order_contexts: preset.orderContexts.map(
            ({ characterId, ...rest }) => ({
              ...rest,
              character_id: characterId,
            }),
          ),
          entries: (entries ?? []).map((entry) => {
            const {
              systemPrompt,
              injectionPosition,
              injectionDepth,
              injectionOrder,
              forbidOverrides,
              injectionTrigger,
              sourceRole,
              isOriginal: _isOriginal,
              ...rest
            } = entry;
            return {
              ...rest,
              system_prompt: systemPrompt,
              injection_position: injectionPosition,
              injection_depth: injectionDepth,
              injection_order: injectionOrder,
              forbid_overrides: forbidOverrides,
              injection_trigger: injectionTrigger,
              source_role: sourceRole,
            };
          }),
        },
      });
    }
    case "worldbook":
      return client.worldbooks.update({
        worldbookId: id,
        expectedVersion: version,
        name,
        data: { ...value, entries: serializeWorldbookEntries(document) },
      });
    case "regex":
      return client.regexProfiles.update({
        profileId: id,
        expectedVersion: version,
        name,
        data: entries as RegexProfileRuleInput[],
      });
    case "model":
      return client.llmProfiles.update({
        profileId: id,
        presetName: name,
        provider: value.provider as LlmProvider,
        modelId: String(value.model_id),
        baseUrl: value.base_url as string | null,
        apiKeyName: value.api_key_name as string | null,
        status: value.status as "active" | "disabled",
        ...(value.api_key ? { apiKey: String(value.api_key) } : {}),
      });
  }
}

export async function removeRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  row: RoleResourceRow,
) {
  assertSupportedRoleResourceKind(kind);
  switch (kind) {
    case "preset":
      return client.presets.remove({
        presetId: row.id,
        expectedVersion: row.version,
      });
    case "worldbook":
      return client.worldbooks.remove({
        worldbookId: row.id,
        expectedVersion: row.version,
      });
    case "regex":
      return client.regexProfiles.remove({
        profileId: row.id,
        expectedVersion: row.version,
      });
    case "persona":
      return client.users.remove({
        userId: row.id,
        expectedRevision: row.revision,
      });
    case "model":
      return client.llmProfiles.delete({ profileId: row.id });
  }
}
export async function exportRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  id: string,
): Promise<Response> {
  assertSupportedRoleResourceKind(kind);
  switch (kind) {
    case "preset":
      return client.exports.preset({ presetId: id });
    case "worldbook":
      return client.exports.worldbook({ worldbookId: id });
    case "regex":
      return client.exports.regex({ profileId: id });
    default:
      throw new Error("Resource has no export contract");
  }
}
export async function importRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  name: string,
  payload: Record<string, unknown> | unknown[],
) {
  assertSupportedRoleResourceKind(kind);
  previewRoleResourceImport(kind, name, payload);
  switch (kind) {
    case "preset":
      return client.imports.preset({
        name,
        data: payload as Record<string, unknown>,
      });
    case "worldbook":
      return client.imports.worldbook({
        name,
        data: payload as Record<string, unknown>,
      });
    case "regex":
      return client.imports.regex({ name, data: JSON.stringify(payload) });
    case "persona":
      return client.users.create({ snapshot: { ...payload, name } });
    case "model":
      return client.llmProfiles.create({
        presetName: name,
        provider: (payload as Record<string, unknown>).provider as LlmProvider,
        modelId: String((payload as Record<string, unknown>).model_id),
        apiKey: String((payload as Record<string, unknown>).api_key ?? ""),
        baseUrl: String((payload as Record<string, unknown>).base_url ?? ""),
      });
  }
}

// Keep the imported entry keys and synchronize the fields used by the existing assembler.
export function serializeWorldbookEntries(document: RoleResourceDocument) {
  const originals = document.value.entries as Record<
    string,
    Record<string, unknown>
  >;
  const pairs = (document.entries ?? []).map((entry, index) => {
    const key = document.entryKeys?.[index] ?? String(index);
    const original = originals[key] ?? {};
    const next = { ...entry };
    const extensions = { ...(entry.extensions as Record<string, unknown>) };
    const aliases = resourceFields.worldbookAliases;
    for (const [field, alias] of Object.entries(aliases)) {
      if (JSON.stringify(entry[field]) !== JSON.stringify(original[field]))
        next[alias] = entry[field];
    }
    if (entry.disable !== original.disable) next.enabled = !entry.disable;
    const extensionFields = resourceFields.worldbookExtensionFields;
    for (const [field, alias] of Object.entries(extensionFields)) {
      if (entry[field] !== original[field]) extensions[alias] = entry[field];
    }
    if (Object.keys(extensions).length) next.extensions = extensions;
    return [key, next] as const;
  });
  return Array.isArray(document.value.entries)
    ? pairs.map(([, entry]) => entry)
    : Object.fromEntries(pairs);
}

export function newRoleEntry(kind: RoleResourceKind): Record<string, unknown> {
  assertSupportedRoleResourceKind(kind);
  const fields = resourceFields.fields[kind];
  return {
    ...Object.fromEntries(
      fields.map(([key, , type]) => [
        key,
        type === "check"
          ? key === "enabled"
          : type === "json" || type === "nullableNumber" || type === "tri"
            ? null
            : type === "number"
              ? 0
              : "",
      ]),
    ),
    ...structuredClone(resourceFields.defaults[kind]),
    ...(kind === "preset" ? { identifier: createBrowserUuid() } : {}),
    ...(kind === "worldbook" ? { uid: Date.now() } : {}),
  };
}
export function updatePresetOrder(document: RoleResourceDocument) {
  const editor = document.value as unknown as PresetEditorDocument;
  const context = editor.orderContexts.find(
    (item) => item.characterId === editor.defaultCharacterId,
  );
  if (context) {
    const existingMembers = new Set(
      context.order.map((item) => item.identifier),
    );
    context.order = (document.entries ?? [])
      .filter((entry) =>
        existingMembers.has(String(entry.identifier)) || entry.isOriginal !== true,
      )
      .map((entry) => ({
        identifier: String(entry.identifier),
        enabled: Boolean(entry.enabled),
      }));
  }
}

export function newRoleDocument(kind: RoleResourceKind): RoleResourceDocument {
  assertSupportedRoleResourceKind(kind);
  const value = newRoleEntry(kind);
  if (kind === "preset")
    return {
      id: "",
      name: "",
      value: {
        format: "st-raw",
        defaultCharacterId: resourceFields.presetDefaults.defaultCharacterId,
        topLevel: {},
        orderContexts: [
          {
            characterId: resourceFields.presetDefaults.defaultCharacterId,
            order: [],
            extra: {},
          },
        ],
      },
      entries: [value],
    };
  if (kind === "worldbook")
    return {
      id: "",
      name: "",
      value: {
        ...structuredClone(resourceFields.worldbookDefaults),
        entries: {},
      },
      entryKeys: ["0"],
      entries: [value],
    };
  if (kind === "regex")
    return { id: "", name: "", value: {}, entries: [value] };
  return { id: "", name: "", value };
}
export async function createRoleResource(
  client: TavernClient,
  kind: RoleResourceKind,
  document: RoleResourceDocument,
): Promise<string> {
  assertSupportedRoleResourceKind(kind);
  const { name, value, entries } = document;
  if (kind === "preset") {
    const result = await client.imports.preset({
      name,
      data: toPresetImportPayload(document),
    });
    return result.id;
  }
  if (kind === "worldbook")
    return (
      await client.imports.worldbook({
        name,
        data: { ...value, entries: serializeWorldbookEntries(document) },
      })
    ).id;
  if (kind === "regex")
    return (await client.imports.regex({ name, data: JSON.stringify(entries) }))
      .id;
  if (kind === "persona") {
    const snapshot = { ...value, name };
    delete (snapshot as Record<string, unknown>).status;
    return (await client.users.create({ snapshot })).id;
  }
  return (
    await client.llmProfiles.create({
      presetName: name,
      provider: value.provider as LlmProvider,
      modelId: String(value.model_id),
      apiKey: String(value.api_key),
      ...(value.api_key_name ? { apiKeyName: String(value.api_key_name) } : {}),
      ...(value.base_url ? { baseUrl: String(value.base_url) } : {}),
    })
  ).id;
}
