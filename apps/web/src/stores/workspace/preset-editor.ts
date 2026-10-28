import type {
  WorkspacePresetEditorDocument,
  WorkspacePresetEditorOrderContext
} from "../../lib/workspace-api";

export function clonePresetEditorDocument(editor: WorkspacePresetEditorDocument): WorkspacePresetEditorDocument {
  return {
    defaultCharacterId: editor.defaultCharacterId,
    entries: editor.entries.map((entry) => ({
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      content: entry.content,
      systemPrompt: entry.systemPrompt,
      marker: entry.marker,
      injectionPosition: entry.injectionPosition,
      injectionDepth: entry.injectionDepth,
      injectionOrder: entry.injectionOrder,
      forbidOverrides: entry.forbidOverrides,
      injectionTrigger: entry.injectionTrigger ? [...entry.injectionTrigger] : undefined,
      enabled: entry.enabled,
      extra: { ...entry.extra },
      isOriginal: entry.isOriginal,
      sourceRole: entry.sourceRole
    })),
    format: editor.format,
    orderContexts: editor.orderContexts.map((context) => ({
      characterId: context.characterId,
      order: context.order.map((item) => ({
        identifier: item.identifier,
        enabled: item.enabled
      })),
      extra: { ...context.extra }
    })),
    topLevel: { ...editor.topLevel }
  };
}

export function serializePresetEditorDocument(editor: WorkspacePresetEditorDocument): Record<string, unknown> {
  const promptIdentifiers = editor.entries.map((entry) => entry.identifier);

  const prompts = editor.entries.map((entry) => {
    const payload: Record<string, unknown> = {
      ...entry.extra,
      content: entry.content,
      enabled: entry.enabled,
      identifier: entry.identifier,
      injection_position: entry.injectionPosition,
      marker: entry.marker,
      name: entry.name,
      role: entry.role === "assistant" && entry.sourceRole === "model"
        ? "model"
        : entry.role,
      system_prompt: entry.systemPrompt
    };
    if (entry.injectionDepth !== undefined) {
      payload.injection_depth = entry.injectionDepth;
    }
    if (entry.injectionOrder !== undefined) {
      payload.injection_order = entry.injectionOrder;
    }
    if (entry.forbidOverrides !== undefined) {
      payload.forbid_overrides = entry.forbidOverrides;
    }
    if (entry.injectionTrigger !== undefined) {
      payload.injection_trigger = [...entry.injectionTrigger];
    }
    return payload;
  });

  const contexts = normalizeOrderContexts(
    editor.orderContexts,
    promptIdentifiers,
    editor.defaultCharacterId,
    editor.entries.filter((entry) => entry.isOriginal !== true),
  );

  const topLevel: Record<string, unknown> = { ...editor.topLevel };
  delete topLevel.prompts;
  delete topLevel.prompt_order;
  delete topLevel.default_character_id;

  return {
    ...topLevel,
    default_character_id: editor.defaultCharacterId,
    prompts,
    prompt_order: contexts
  };
}

export function toApiPresetEditorDocument(editor: WorkspacePresetEditorDocument): {
  default_character_id: number;
  entries: Array<Record<string, unknown>>;
  order_contexts: Array<Record<string, unknown>>;
  top_level: Record<string, unknown>;
} {
  return {
    default_character_id: editor.defaultCharacterId,
    entries: editor.entries.map((entry) => ({
      identifier: entry.identifier,
      name: entry.name,
      role: entry.role,
      content: entry.content,
      system_prompt: entry.systemPrompt,
      marker: entry.marker,
      injection_position: entry.injectionPosition,
      injection_depth: entry.injectionDepth,
      injection_order: entry.injectionOrder,
      forbid_overrides: entry.forbidOverrides,
      injection_trigger: entry.injectionTrigger,
      enabled: entry.enabled,
      source_role: entry.role === "assistant" && entry.sourceRole === "model"
        ? "model"
        : undefined,
      extra: { ...entry.extra }
    })),
    order_contexts: normalizeOrderContexts(
      editor.orderContexts,
      editor.entries.map((entry) => entry.identifier),
      editor.defaultCharacterId,
      editor.entries.filter((entry) => entry.isOriginal !== true),
    ),
    top_level: { ...editor.topLevel }
  };
}

function normalizeOrderContexts(
  contexts: WorkspacePresetEditorOrderContext[],
  identifiers: string[],
  defaultCharacterId: number,
  newEntries: WorkspacePresetEditorDocument["entries"]
): Array<Record<string, unknown>> {
  const normalized = contexts.map((context) => {
    const seen = new Set<string>();
    const order = context.order
      .filter((item) => {
        if (!identifiers.includes(item.identifier) || seen.has(item.identifier)) {
          return false;
        }
        seen.add(item.identifier);
        return true;
      })
      .map((item) => ({ identifier: item.identifier, enabled: item.enabled }));

    if (context.characterId === defaultCharacterId) {
      newEntries.forEach((entry) => {
        if (!seen.has(entry.identifier) && identifiers.includes(entry.identifier)) {
          order.push({ identifier: entry.identifier, enabled: entry.enabled });
        }
      });
    }

    return {
      ...context.extra,
      character_id: context.characterId,
      order
    };
  });

  if (!normalized.some((context) => context.character_id === defaultCharacterId)) {
    normalized.push({
      character_id: defaultCharacterId,
      order: identifiers.map((identifier) => ({ identifier, enabled: true }))
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      character_id: defaultCharacterId,
      order: identifiers.map((identifier) => ({ identifier, enabled: true }))
    });
  }

  return normalized;
}
