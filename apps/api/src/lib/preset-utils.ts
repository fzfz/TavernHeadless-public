/**
 * Preset Utilities
 *
 * 预设数据处理工具函数：格式转换、editor model 投影、raw JSON 操作。
 * 从 imports.ts 提取，供 imports.ts 和 preset-entries.ts 共用。
 */

import { DEFAULT_PROMPT_ORDER_CHARACTER_ID } from "@tavern/adapters-sillytavern";
import {
  asRecord,
  normalizeEditorOrderContexts,
  normalizeOrderItems,
  normalizeStoredPreset,
  omitRecordKeys,
  readConfiguredDefaultCharacterId,
  readRawOrderContexts,
  readRawPromptList,
  resolveDefaultCharacterId,
  toEditorEntry,
  toInteger,
  toOptionalInteger,
  type JsonRecord,
  type PresetEditorEntry,
  type PresetEditorOrderContext,
  type PresetEditorDocumentInput,
} from "@tavern/adapters-sillytavern";

export {
  LEGACY_PRESET_FIELD_MAP,
  PRESET_ORDER_CONTEXT_KNOWN_KEYS,
  PRESET_PROMPT_KNOWN_KEYS,
  PRESET_RESERVED_TOP_LEVEL_KEYS,
  normalizeEditorOrderContexts,
  normalizeOrderItems,
  normalizeStoredPreset,
  readConfiguredDefaultCharacterId,
  readRawOrderContexts,
  readRawPromptList,
  resolveDefaultCharacterId,
  toEditorEntry,
  toInteger,
  toOptionalInteger,
  toPresetEditorDocument,
  toRawPresetFromEditor,
  toRawPresetFromLegacy,
  asRecord,
  omitRecordKeys,
} from "@tavern/adapters-sillytavern";
export type {
  JsonRecord,
  PresetEditorDocument,
  PresetEditorDocumentInput,
  PresetEditorEntry,
  PresetEditorOrderContext,
  PresetEditorOrderItem,
} from "@tavern/adapters-sillytavern";

// ── Raw JSON Mutation Helpers ─────────────────────────
// These operate directly on the raw preset JSON object (in-place),
// without going through the full editor model round-trip.
// Extra fields on prompts and order contexts are preserved.

/**
 * Find a prompt in raw.prompts[] by identifier.
 */
export function findPromptInRaw(raw: JsonRecord, identifier: string): { prompt: JsonRecord; index: number } | null {
  const prompts = Array.isArray(raw.prompts) ? raw.prompts : [];
  for (let i = 0; i < prompts.length; i++) {
    const prompt = asRecord(prompts[i]);
    if (prompt && String(prompt.identifier) === identifier) {
      return { prompt, index: i };
    }
  }
  return null;
}

/**
 * Add a new prompt to raw.prompts[] and append to default prompt_order context.
 */
export function addPromptToRaw(raw: JsonRecord, promptData: JsonRecord, enabled: boolean): void {
  if (!Array.isArray(raw.prompts)) {
    raw.prompts = [];
  }
  (raw.prompts as unknown[]).push(promptData);

  const contexts = ensurePromptOrderArray(raw);
  const defaultCtx = findOrCreateDefaultContext(raw, contexts);
  const order = Array.isArray(defaultCtx.order) ? defaultCtx.order as unknown[] : [];
  order.push({ identifier: String(promptData.identifier), enabled });
  defaultCtx.order = order;
}

/**
 * Remove a prompt from raw.prompts[] and all prompt_order contexts.
 * Returns true if the prompt was found and removed.
 */
export function removePromptFromRaw(raw: JsonRecord, identifier: string): boolean {
  const prompts = Array.isArray(raw.prompts) ? raw.prompts as unknown[] : [];
  const initialLength = prompts.length;
  raw.prompts = prompts.filter((item) => {
    const rec = asRecord(item);
    return rec ? String(rec.identifier) !== identifier : true;
  });
  const removed = (raw.prompts as unknown[]).length < initialLength;

  if (removed) {
    removeIdentifierFromAllContexts(raw, identifier);
  }
  return removed;
}

/**
 * Remove multiple prompts from raw. Returns array of identifiers that were actually removed.
 */
export function removePromptsFromRaw(raw: JsonRecord, identifiers: string[]): string[] {
  const toRemove = new Set(identifiers);
  const prompts = Array.isArray(raw.prompts) ? raw.prompts as unknown[] : [];
  const removedSet = new Set<string>();

  raw.prompts = prompts.filter((item) => {
    const rec = asRecord(item);
    if (!rec) return true;
    const id = String(rec.identifier);
    if (toRemove.has(id)) {
      removedSet.add(id);
      return false;
    }
    return true;
  });

  for (const id of removedSet) {
    removeIdentifierFromAllContexts(raw, id);
  }

  return Array.from(removedSet);
}

/**
 * Update fields on a prompt in raw.prompts[].
 * If `enabled` is among the fields, also update the default prompt_order context.
 * Returns the updated prompt record, or null if not found.
 */
export function updatePromptFieldsInRaw(raw: JsonRecord, identifier: string, fields: JsonRecord): JsonRecord | null {
  const found = findPromptInRaw(raw, identifier);
  if (!found) return null;

  const prompts = raw.prompts as unknown[];
  const updated = { ...found.prompt, ...fields, identifier };
  prompts[found.index] = updated;

  if ("enabled" in fields && typeof fields.enabled === "boolean") {
    updatePromptEnabledInOrder(raw, identifier, fields.enabled);
  }

  return updated;
}

/**
 * Update the enabled state for a prompt in the default prompt_order context.
 */
export function updatePromptEnabledInOrder(raw: JsonRecord, identifier: string, enabled: boolean): void {
  const contexts = ensurePromptOrderArray(raw);
  const defaultCtx = findOrCreateDefaultContext(raw, contexts);
  const order = Array.isArray(defaultCtx.order) ? defaultCtx.order as unknown[] : [];

  for (const item of order) {
    const rec = asRecord(item);
    if (rec && String(rec.identifier) === identifier) {
      rec.enabled = enabled;
      return;
    }
  }
}

/**
 * Reorder prompts in the default prompt_order context.
 * Also reorders raw.prompts[] to match.
 * Identifiers not in orderedIdentifiers are appended at the end.
 */
export function reorderPromptsInRaw(raw: JsonRecord, orderedIdentifiers: string[]): void {
  const contexts = ensurePromptOrderArray(raw);
  const defaultCtx = findOrCreateDefaultContext(raw, contexts);
  const currentOrder = Array.isArray(defaultCtx.order) ? defaultCtx.order as unknown[] : [];

  // Build a map of identifier -> current order item (to preserve enabled state)
  const orderMap = new Map<string, unknown>();
  for (const item of currentOrder) {
    const rec = asRecord(item);
    if (rec) {
      orderMap.set(String(rec.identifier), item);
    }
  }

  // Build new order: requested identifiers first, then remaining
  const newOrder: unknown[] = [];
  const seen = new Set<string>();

  for (const id of orderedIdentifiers) {
    if (seen.has(id)) continue;
    seen.add(id);
    const existing = orderMap.get(id);
    if (existing) {
      newOrder.push(existing);
    }
  }

  for (const item of currentOrder) {
    const rec = asRecord(item);
    if (rec) {
      const id = String(rec.identifier);
      if (!seen.has(id)) {
        seen.add(id);
        newOrder.push(item);
      }
    }
  }

  defaultCtx.order = newOrder;

  // Also reorder raw.prompts[] to match
  const prompts = Array.isArray(raw.prompts) ? raw.prompts as unknown[] : [];
  const promptMap = new Map<string, unknown>();
  for (const p of prompts) {
    const rec = asRecord(p);
    if (rec) {
      promptMap.set(String(rec.identifier), p);
    }
  }

  const newPrompts: unknown[] = [];
  const seenPrompts = new Set<string>();
  for (const item of newOrder) {
    const rec = asRecord(item);
    if (rec) {
      const id = String(rec.identifier);
      const p = promptMap.get(id);
      if (p && !seenPrompts.has(id)) {
        seenPrompts.add(id);
        newPrompts.push(p);
      }
    }
  }
  // Append any prompts not in the order
  for (const p of prompts) {
    const rec = asRecord(p);
    if (rec) {
      const id = String(rec.identifier);
      if (!seenPrompts.has(id)) {
        seenPrompts.add(id);
        newPrompts.push(p);
      }
    }
  }
  raw.prompts = newPrompts;
}

/**
 * Get a single editor entry from raw JSON by identifier.
 */
export function getEditorEntryFromRaw(raw: JsonRecord, identifier: string): PresetEditorEntry | null {
  const found = findPromptInRaw(raw, identifier);
  if (!found) return null;

  const promptList = readRawPromptList(raw);
  const orderContexts = readRawOrderContexts(raw, promptList.map((p) => p.identifier));
  const defaultCharacterId = resolveDefaultCharacterId(orderContexts, readConfiguredDefaultCharacterId(raw));
  const defaultContext = orderContexts.find((c) => c.character_id === defaultCharacterId) ?? orderContexts[0];
  const enabledMap = new Map(defaultContext?.order.map((item) => [item.identifier, item.enabled]) ?? []);

  return toEditorEntry(found.prompt, enabledMap.get(identifier));
}

/**
 * Get all editor entries from raw JSON, sorted by default context order.
 */
export function getAllEditorEntriesFromRaw(raw: JsonRecord): { entries: PresetEditorEntry[]; defaultCharacterId: number } {
  const promptList = readRawPromptList(raw);
  const orderContexts = readRawOrderContexts(raw, promptList.map((p) => p.identifier));
  const defaultCharacterId = resolveDefaultCharacterId(orderContexts, readConfiguredDefaultCharacterId(raw));
  const defaultContext = orderContexts.find((c) => c.character_id === defaultCharacterId) ?? orderContexts[0];
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
      if (leftIndex === undefined && rightIndex === undefined) return 0;
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    })
    .map((prompt) => toEditorEntry(prompt.payload, enabledMap.get(prompt.identifier)));

  return { entries, defaultCharacterId };
}

// ── Internal helpers for raw mutation ─────────────────

function ensurePromptOrderArray(raw: JsonRecord): unknown[] {
  if (!Array.isArray(raw.prompt_order)) {
    raw.prompt_order = [];
  }
  return raw.prompt_order as unknown[];
}

function findOrCreateDefaultContext(raw: JsonRecord, contexts: unknown[]): JsonRecord {
  const normalizedContexts = contexts.flatMap((item) => {
    const context = asRecord(item);
    if (!context || typeof context.character_id !== "number") return [];
    return [{
      character_id: Math.trunc(context.character_id),
      order: Array.isArray(context.order) ? context.order : [],
      extra: {}
    } satisfies PresetEditorOrderContext];
  });
  const defaultCharacterId = resolveDefaultCharacterId(normalizedContexts, readConfiguredDefaultCharacterId(raw));

  for (const item of contexts) {
    const rec = asRecord(item);
    if (rec && rec.character_id === defaultCharacterId) {
      raw.default_character_id = defaultCharacterId;
      return rec;
    }
  }

  const newCtx: JsonRecord = { character_id: defaultCharacterId, order: [] };
  contexts.push(newCtx);
  raw.default_character_id = defaultCharacterId;
  return newCtx;
}

function removeIdentifierFromAllContexts(raw: JsonRecord, identifier: string): void {
  const contexts = Array.isArray(raw.prompt_order) ? raw.prompt_order as unknown[] : [];
  for (const ctxItem of contexts) {
    const ctx = asRecord(ctxItem);
    if (!ctx || !Array.isArray(ctx.order)) continue;
    ctx.order = (ctx.order as unknown[]).filter((item) => {
      const rec = asRecord(item);
      return rec ? String(rec.identifier) !== identifier : true;
    });
  }
}
