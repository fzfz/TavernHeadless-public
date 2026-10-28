import type { NativeCardWorldbook } from "@tavern/shared";

type JsonObject = Record<string, unknown>;

export interface WorldbookEntryFileContent {
  encoding: string;
  content: string;
}

export interface WorldbookEntryBindingMove {
  configuration: JsonObject;
  controllerBindings: number;
  updaterBindings: number;
  stateRuleBindings: number;
}

export interface WorldbookUidRequest {
  cardId: string;
  expectedRevision: number;
  bookId: string;
  reservedUids: number[];
  draftBook?: NativeCardWorldbook;
}

export async function allocateWorldbookEntryUidFromServer(
  allocate: (request: WorldbookUidRequest) => Promise<{ uid: number }>,
  request: Omit<WorldbookUidRequest, "reservedUids">,
  entryPaths: readonly string[],
  files: Readonly<Record<string, WorldbookEntryFileContent | undefined>>,
  invalidUidMessage: string,
): Promise<number> {
  const reservedUids = worldbookEntryUids(entryPaths, files);
  const result = await allocate({ ...request, reservedUids });
  if (!Number.isInteger(result.uid) || result.uid < 0 || reservedUids.includes(result.uid)) {
    throw new Error(invalidUidMessage);
  }
  return result.uid;
}

export function worldbookEntryUids(
  entryPaths: readonly string[],
  files: Readonly<Record<string, WorldbookEntryFileContent | undefined>>,
): number[] {
  const used = new Set<number>();
  for (const path of entryPaths) {
    const file = files[path];
    if (!file || file.encoding !== "utf8") continue;
    try {
      const entry: unknown = JSON.parse(file.content);
      if (isRecord(entry) && Number.isInteger(entry.uid) && typeof entry.uid === "number" && entry.uid >= 0) used.add(entry.uid);
    } catch {
      // The package validator reports malformed entry JSON; invalid files do not reserve a UID.
    }
  }
  return [...used].sort((left, right) => left - right);
}

export function moveWorldbookEntryBindings(
  value: unknown,
  sourceBookId: string,
  sourceEntryId: number,
  targetBookId: string,
  targetEntryId: number,
): WorldbookEntryBindingMove | undefined {
  if (!isRecord(value)) return undefined;
  const configuration: JsonObject = { ...value };
  let controllerBindings = 0;
  let updaterBindings = 0;
  let stateRuleBindings = 0;

  for (const key of ["controllerEntries", "updaterEntries"] as const) {
    const bindings = Array.isArray(value[key]) ? value[key] as unknown[] : undefined;
    if (!bindings) continue;
    const next = bindings.map((binding) => {
      if (!isRecord(binding) || binding.bookId !== sourceBookId || binding.entryId !== sourceEntryId) return binding;
      if (key === "controllerEntries") controllerBindings += 1;
      else updaterBindings += 1;
      return { ...binding, bookId: targetBookId, entryId: targetEntryId };
    });
    configuration[key] = next;
  }

  if (Array.isArray(value.rules)) {
    configuration.rules = value.rules.map((rule) => {
      if (!isRecord(rule) || !Array.isArray(rule.sourceEntries)) return rule;
      const sourceEntries = rule.sourceEntries.map((entry) => {
        if (!isRecord(entry) || entry.bookId !== sourceBookId || entry.entryId !== sourceEntryId) return entry;
        stateRuleBindings += 1;
        return { ...entry, bookId: targetBookId, entryId: targetEntryId };
      });
      return { ...rule, sourceEntries };
    });
  }

  return { configuration, controllerBindings, updaterBindings, stateRuleBindings };
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
