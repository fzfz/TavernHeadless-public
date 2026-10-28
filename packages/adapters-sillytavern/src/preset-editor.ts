import { DEFAULT_PROMPT_ORDER_CHARACTER_ID } from "./types/preset.js";
import { parsePreset, resolvePromptOrderCharacterId } from "./parsers/preset-parser.js";
import type { PresetEditorSourceRole } from "@tavern/shared";

// ── Types ─────────────────────────────────────────────

export type JsonRecord = Record<string, unknown>;

export interface PresetEditorOrderItem {
  identifier: string;
  enabled: boolean;
}

export interface PresetEditorOrderContext {
  character_id: number;
  order: PresetEditorOrderItem[];
  extra: JsonRecord;
}

export interface PresetEditorEntry {
  identifier: string;
  name: string;
  role: "assistant" | "system" | "user";
  content: string;
  system_prompt: boolean;
  marker: boolean;
  injection_position: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
  injection_trigger?: unknown[];
  enabled: boolean;
  extra: JsonRecord;
  is_original: boolean;
  source_role?: PresetEditorSourceRole;
}

export interface PresetEditorDocument {
  format: "legacy-compact" | "st-raw";
  default_character_id: number;
  entries: PresetEditorEntry[];
  order_contexts: PresetEditorOrderContext[];
  top_level: JsonRecord;
}

export interface PresetEditorDocumentInput {
  default_character_id: number;
  entries: Array<{
    identifier: string;
    name: string;
    role: string;
    content: string;
    system_prompt: boolean;
    marker: boolean;
    injection_position: number;
    injection_depth?: number;
    injection_order?: number;
    forbid_overrides?: boolean;
    injection_trigger?: unknown[];
    enabled: boolean;
    extra: JsonRecord;
    is_original?: boolean;
    source_role?: PresetEditorSourceRole;
  }>;
  order_contexts: Array<{
    character_id: number;
    order: Array<{ identifier: string; enabled: boolean }>;
    extra: JsonRecord;
  }>;
  top_level: JsonRecord;
}

// ── Constants ─────────────────────────────────────────

export const PRESET_RESERVED_TOP_LEVEL_KEYS = new Set(["prompts", "prompt_order", "default_character_id"]);

export const PRESET_PROMPT_KNOWN_KEYS = new Set([
  "identifier",
  "name",
  "role",
  "content",
  "system_prompt",
  "marker",
  "injection_position",
  "injection_depth",
  "injection_order",
  "forbid_overrides",
  "injection_trigger",
  "enabled"
]);

export const PRESET_ORDER_CONTEXT_KNOWN_KEYS = new Set(["character_id", "order"]);

export const LEGACY_PRESET_FIELD_MAP: Record<string, string> = {
  assistantPrefill: "assistant_prefill",
  continueNudgePrompt: "continue_nudge_prompt",
  frequencyPenalty: "frequency_penalty",
  maxContext: "openai_max_context",
  maxTokens: "openai_max_tokens",
  minP: "min_p",
  namesBehavior: "names_behavior",
  newChatPrompt: "new_chat_prompt",
  newExampleChatPrompt: "new_example_chat_prompt",
  presencePenalty: "presence_penalty",
  repetitionPenalty: "repetition_penalty",
  stream: "stream_openai",
  topK: "top_k",
  topP: "top_p",
  wiFormat: "wi_format"
};

// ── Editor Model Conversion ───────────────────────────

export function toPresetEditorDocument(value: unknown): PresetEditorDocument {
  const normalized = normalizeStoredPreset(value);

  try {
    parsePreset(normalized.raw);
  } catch (error) {
    throw new Error(`Preset validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const promptList = readRawPromptList(normalized.raw);
  const orderContexts = readRawOrderContexts(normalized.raw, promptList.map((prompt) => prompt.identifier));
  const defaultCharacterId = resolveDefaultCharacterId(orderContexts, readConfiguredDefaultCharacterId(normalized.raw));
  const defaultContext = orderContexts.find((context) => context.character_id === defaultCharacterId) ?? orderContexts[0];
  const enabledMap = new Map(defaultContext?.order.map((item) => [item.identifier, item.enabled]) ?? []);
  const orderedIdentifiers = new Map<string, number>();
  defaultContext?.order.forEach((item, index) => {
    if (!orderedIdentifiers.has(item.identifier)) {
      orderedIdentifiers.set(item.identifier, index);
    }
  });

  const entries = promptList
    .slice()
    .sort((left, right) => {
      const leftIndex = orderedIdentifiers.get(left.identifier);
      const rightIndex = orderedIdentifiers.get(right.identifier);
      if (leftIndex === undefined && rightIndex === undefined) {
        return 0;
      }
      if (leftIndex === undefined) {
        return 1;
      }
      if (rightIndex === undefined) {
        return -1;
      }
      return leftIndex - rightIndex;
    })
    .map((prompt) => toEditorEntry(prompt.payload, enabledMap.get(prompt.identifier)));

  return {
    format: normalized.format,
    default_character_id: defaultCharacterId,
    entries,
    order_contexts: orderContexts,
    top_level: omitRecordKeys(normalized.raw, PRESET_RESERVED_TOP_LEVEL_KEYS)
  };
}

export function toRawPresetFromEditor(editor: PresetEditorDocumentInput): JsonRecord {
  const seenIdentifiers = new Set<string>();
  const prompts = editor.entries.map((entry) => {
    if (seenIdentifiers.has(entry.identifier)) {
      throw new Error(`Duplicate prompt identifier: ${entry.identifier}`);
    }
    seenIdentifiers.add(entry.identifier);

    const nextPrompt: JsonRecord = {
      ...entry.extra,
      identifier: entry.identifier,
      name: entry.name,
      role:
        entry.role === "assistant" && entry.source_role === "model"
          ? "model"
          : entry.role,
      content: entry.content,
      system_prompt: entry.system_prompt,
      marker: entry.marker,
      injection_position: entry.injection_position,
      enabled: entry.enabled
    };

    if (entry.injection_depth !== undefined) {
      nextPrompt.injection_depth = entry.injection_depth;
    }
    if (entry.injection_order !== undefined) {
      nextPrompt.injection_order = entry.injection_order;
    }
    if (entry.forbid_overrides !== undefined) {
      nextPrompt.forbid_overrides = entry.forbid_overrides;
    }
    if (entry.injection_trigger !== undefined) {
      nextPrompt.injection_trigger = entry.injection_trigger;
    }
    return nextPrompt;
  });

  const promptIdentifiers = prompts.map((prompt) => String(prompt.identifier));
  const orderContexts = normalizeEditorOrderContexts(editor.order_contexts, promptIdentifiers);
  let defaultContext = orderContexts.find((context) => context.character_id === editor.default_character_id);
  let createdDefaultContext = false;
  if (!defaultContext) {
    defaultContext = {
      character_id: editor.default_character_id,
      order: [],
      extra: {}
    };
    orderContexts.push(defaultContext);
    createdDefaultContext = true;
  }

  const selectedIdentifiers = new Set(defaultContext.order.map((item) => item.identifier));
  defaultContext.order = editor.entries
    .filter((entry) =>
      createdDefaultContext ||
      selectedIdentifiers.has(entry.identifier) ||
      entry.is_original === false
    )
    .map((entry) => ({
      identifier: entry.identifier,
      enabled: entry.enabled
    }));


  const topLevel = omitRecordKeys(editor.top_level, PRESET_RESERVED_TOP_LEVEL_KEYS);
  const rawPreset: JsonRecord = {
    ...topLevel,
    default_character_id: editor.default_character_id,
    prompts,
    prompt_order: orderContexts.map((context) => ({
      ...context.extra,
      character_id: context.character_id,
      order: context.order
    }))
  };

  try {
    parsePreset(rawPreset);
  } catch (error) {
    throw new Error(`Preset validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return rawPreset;
}

// ── Format Normalization ──────────────────────────────

export function normalizeStoredPreset(value: unknown): { format: "legacy-compact" | "st-raw"; raw: JsonRecord } {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Preset payload must be an object");
  }

  const hasRawOrder = Array.isArray(record.prompt_order);
  const hasLegacyOrder = Array.isArray(record.promptOrder);

  if (hasRawOrder) {
    return {
      format: "st-raw",
      raw: { ...record }
    };
  }

  if (hasLegacyOrder) {
    return {
      format: "legacy-compact",
      raw: toRawPresetFromLegacy(record)
    };
  }

  if (Array.isArray(record.prompts)) {
    return {
      format: "st-raw",
      raw: {
        ...record,
        prompt_order: []
      }
    };
  }

  throw new Error("Preset payload missing prompts/prompt_order fields");
}

export function toRawPresetFromLegacy(record: JsonRecord): JsonRecord {
  const mapped: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "promptOrder" || key === "prompts") {
      continue;
    }
    mapped[LEGACY_PRESET_FIELD_MAP[key] ?? key] = value;
  }

  const promptEntries = Array.isArray(record.prompts) ? record.prompts : [];
  const prompts: JsonRecord[] = [];
  for (const item of promptEntries) {
    const prompt = asRecord(item);
    const identifier = prompt?.identifier;
    if (!prompt || typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    prompts.push({ ...prompt, identifier: identifier.trim() });
  }

  const legacyOrder = Array.isArray(record.promptOrder) ? record.promptOrder : [];
  const orderItems: PresetEditorOrderItem[] = [];
  const seen = new Set<string>();

  for (const item of legacyOrder) {
    if (typeof item !== "string" || !item.trim() || seen.has(item)) {
      continue;
    }
    seen.add(item);
    orderItems.push({ identifier: item, enabled: true });
  }

  for (const prompt of prompts) {
    const identifier = String(prompt.identifier);
    if (seen.has(identifier)) {
      continue;
    }
    seen.add(identifier);
    orderItems.push({
      identifier,
      enabled: typeof prompt.enabled === "boolean" ? prompt.enabled : true
    });
  }

  return {
    ...mapped,
    prompts,
    prompt_order: [
      {
        character_id: DEFAULT_PROMPT_ORDER_CHARACTER_ID,
        order: orderItems
      }
    ]
  };
}

// ── Raw JSON Reading ──────────────────────────────────

export function readRawPromptList(rawPreset: JsonRecord): Array<{ identifier: string; payload: JsonRecord }> {
  const items = Array.isArray(rawPreset.prompts) ? rawPreset.prompts : [];
  const prompts: Array<{ identifier: string; payload: JsonRecord }> = [];
  for (const item of items) {
    const prompt = asRecord(item);
    const identifier = prompt?.identifier;
    if (!prompt || typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    prompts.push({ identifier: identifier.trim(), payload: { ...prompt, identifier: identifier.trim() } });
  }
  return prompts;
}

export function readRawOrderContexts(rawPreset: JsonRecord, promptIdentifiers: string[]): PresetEditorOrderContext[] {
  const contexts = Array.isArray(rawPreset.prompt_order) ? rawPreset.prompt_order : [];
  const normalized: PresetEditorOrderContext[] = [];
  for (const contextItem of contexts) {
    const context = asRecord(contextItem);
    if (!context) {
      continue;
    }
    const characterId = typeof context.character_id === "number" ? Math.trunc(context.character_id) : null;
    if (characterId === null || Number.isNaN(characterId)) {
      continue;
    }
    const order = normalizeOrderItems(context.order, promptIdentifiers);
    normalized.push({
      character_id: characterId,
      order,
      extra: omitRecordKeys(context, PRESET_ORDER_CONTEXT_KNOWN_KEYS)
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      character_id: DEFAULT_PROMPT_ORDER_CHARACTER_ID,
      order: promptIdentifiers.map((identifier) => ({ identifier, enabled: true })),
      extra: {}
    });
  }

  return normalized;
}

export function toEditorEntry(prompt: JsonRecord, enabledFromOrder: boolean | undefined): PresetEditorEntry {
  const role = prompt.role === "model"
    ? "assistant"
    : prompt.role === "assistant" || prompt.role === "user" || prompt.role === "system"
    ? prompt.role
    : "system";

  return {
    identifier: String(prompt.identifier),
    name: typeof prompt.name === "string" ? prompt.name : "",
    role,
    content: typeof prompt.content === "string" ? prompt.content : "",
    system_prompt: Boolean(prompt.system_prompt),
    marker: Boolean(prompt.marker),
    injection_position: toInteger(prompt.injection_position, 0),
    injection_depth: toOptionalInteger(prompt.injection_depth),
    injection_order: toOptionalInteger(prompt.injection_order),
    forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
    injection_trigger: Array.isArray(prompt.injection_trigger) ? prompt.injection_trigger : undefined,
    enabled: typeof enabledFromOrder === "boolean"
      ? enabledFromOrder
      : (typeof prompt.enabled === "boolean" ? prompt.enabled : true),
    extra: omitRecordKeys(prompt, PRESET_PROMPT_KNOWN_KEYS),
    is_original: true,
    ...(prompt.role === "model" ? { source_role: "model" as const } : {})
  };
}

// ── Order Context Normalization ───────────────────────

export function normalizeEditorOrderContexts(contexts: PresetEditorDocumentInput["order_contexts"], promptIdentifiers: string[]): PresetEditorOrderContext[] {
  const normalized: PresetEditorOrderContext[] = [];
  for (const context of contexts) {
    normalized.push({
      character_id: context.character_id,
      order: normalizeOrderItems(context.order, promptIdentifiers),
      extra: context.extra
    });
  }

  if (normalized.length === 0) {
    normalized.push({
      character_id: DEFAULT_PROMPT_ORDER_CHARACTER_ID,
      order: promptIdentifiers.map((identifier) => ({ identifier, enabled: true })),
      extra: {}
    });
  }

  return normalized;
}

export function normalizeOrderItems(value: unknown, promptIdentifiers: string[]): PresetEditorOrderItem[] {
  const promptIdentifierSet = new Set(promptIdentifiers);
  const items = Array.isArray(value) ? value : [];
  const order: PresetEditorOrderItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const orderItem = asRecord(item);
    if (!orderItem) {
      continue;
    }
    const identifier = orderItem?.identifier;
    if (typeof identifier !== "string" || !identifier.trim()) {
      continue;
    }
    const normalizedIdentifier = identifier.trim();
    if (seen.has(normalizedIdentifier) || !promptIdentifierSet.has(normalizedIdentifier)) {
      continue;
    }
    seen.add(normalizedIdentifier);
    order.push({
      identifier: normalizedIdentifier,
      enabled: typeof orderItem.enabled === "boolean" ? orderItem.enabled : true
    });
  }

  return order;
}

export function resolveDefaultCharacterId(contexts: PresetEditorOrderContext[], configuredCharacterId?: number): number {
  return resolvePromptOrderCharacterId(
    contexts.map((context) => ({ characterId: context.character_id, orderLength: context.order.length })),
    configuredCharacterId
  ) ?? DEFAULT_PROMPT_ORDER_CHARACTER_ID;
}

export function readConfiguredDefaultCharacterId(raw: JsonRecord): number | undefined {
  const value = raw.default_character_id;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

// ── Generic Helpers ───────────────────────────────────

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function omitRecordKeys(record: JsonRecord, keys: Set<string>): JsonRecord {
  const next: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function toInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.trunc(value);
}

export function toOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.trunc(value);
}
