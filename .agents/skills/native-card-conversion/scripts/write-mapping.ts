import {
  nativeCardRegexRuleSchema,
  nativeCardWorldbookEntrySchema,
} from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { SUBSTITUTE_REGEX } from "../../../../packages/adapters-sillytavern/src/types/regex.ts";
import { worldbookTriggerExtensionsSchema } from "../../../../packages/adapters-sillytavern/src/worldbook/trigger-runtime.schema.ts";
import type { SourceIssue } from "./source.ts";
import {
  entryDuplicateFields,
  entryEditorFields,
  entryExtensionFields,
  entryFields,
  entryInactiveExtensions,
  entryRuntimeFlags,
  entryUnusedExtensions,
  entryUnusedFields,
  entryWrite,
  regexFields,
  regexWrite,
  writeMessages,
} from "./write-config.ts";

type ObjectValue = Record<string, unknown>;

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointer(parent: string, key: string | number) {
  return parent + "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

function message(template: string, values: Record<string, unknown> = {}) {
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name]),
  );
}

function issue(path: string, value: unknown, text: string): SourceIssue {
  return {
    pointer: path,
    valueType:
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    message: text,
  };
}

function inactiveConfiguration(
  rules: Record<string, readonly unknown[]>,
  name: string,
  value: unknown,
) {
  return Object.hasOwn(rules, name) && rules[name]!.includes(value);
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  for (const name of path) {
    if (!object(value)) return undefined;
    value = value[name];
  }
  return value;
}

function selectedIndices(indices: number[], length: number) {
  if (
    indices.some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= length,
    ) ||
    new Set(indices).size !== indices.length
  )
    throw new Error(message(writeMessages.regexIndices));
  return [...indices].sort((a, b) => a - b);
}

type EntryUidMap = {
  uids: Array<number | undefined>;
  issues: SourceIssue[][];
};

/** Calculate every source entry UID once so begin and follow-up writes agree. */
export function mapEntryUids(
  entries: unknown[],
  entriesPointer: string,
): EntryUidMap {
  const occupied = new Map<number | string, number>();
  const reserved = new Set<number>();
  const uids: Array<number | undefined> = [];
  const issues = entries.map(() => [] as SourceIssue[]);

  entries.forEach((member, index) => {
    if (!object(member)) {
      issues[index]!.push(
        issue(
          pointer(entriesPointer, index),
          member,
          message(writeMessages.entry),
        ),
      );
      return;
    }
    const id = member.id === undefined ? index : member.id;
    if (
      typeof id !== "string" &&
      !(typeof id === "number" && Number.isInteger(id) && id >= 0)
    ) {
      issues[index]!.push(
        issue(
          pointer(pointer(entriesPointer, index), "id"),
          id,
          message(writeMessages.id),
        ),
      );
      return;
    }
    if (occupied.has(id)) {
      issues[index]!.push(
        issue(
          pointer(pointer(entriesPointer, index), "id"),
          id,
          message(writeMessages.duplicate, {
            id,
            other: pointer(pointer(entriesPointer, occupied.get(id)!), "id"),
          }),
        ),
      );
    } else occupied.set(id, index);
    if (typeof id === "number") {
      reserved.add(id);
      uids[index] = id;
    }
  });

  let nextUid = 0;
  entries.forEach((member, index) => {
    if (!object(member) || typeof member.id !== "string") return;
    while (reserved.has(nextUid)) nextUid++;
    uids[index] = nextUid;
    reserved.add(nextUid++);
  });
  return { uids, issues };
}

type MappedEntry = {
  index: number;
  entry?: ObjectValue;
  issues: SourceIssue[];
  remaining: string[];
};

function mapEntryWithUids(
  entries: unknown[],
  index: number,
  entriesPointer: string,
  copyContent: boolean,
  uidMap: EntryUidMap,
): MappedEntry {
  const source = entries[index];
  const base = pointer(entriesPointer, index);
  const issues = [...(uidMap.issues[index] ?? [])];
  const remaining: string[] = [];
  if (!object(source)) return { index, issues, remaining };

  const target: ObjectValue = {};
  if (uidMap.uids[index] !== undefined) target.uid = uidMap.uids[index];
  const assign = (
    field: keyof typeof nativeCardWorldbookEntrySchema.shape,
    value: unknown,
    path: string,
    original = value,
  ) => {
    const result = nativeCardWorldbookEntrySchema.shape[field].safeParse(value);
    if (result.success) target[field] = result.data;
    else
      issues.push(
        issue(path, original, message(writeMessages.field, { target: field })),
      );
  };
  for (const field of entryFields) {
    const raw = source[field.source];
    let value: unknown =
      raw === undefined && "default" in field ? field.default : raw;
    if (
      "transform" in field &&
      field.transform === "invert" &&
      typeof value === "boolean"
    )
      value = !value;
    assign(field.target, value, pointer(base, field.source), raw);
  }

  const extensionsValue = source.extensions;
  const extensions = object(extensionsValue) ? extensionsValue : {};
  if (extensionsValue !== undefined && !object(extensionsValue))
    issues.push(
      issue(
        pointer(base, "extensions"),
        extensionsValue,
        message(writeMessages.extensions),
      ),
    );
  const position = extensions.position ?? source.position;
  const positionPath =
    extensions.position == null
      ? pointer(base, "position")
      : pointer(pointer(base, "extensions"), "position");
  const translated =
    extensions.position != null
      ? position
      : position === undefined
        ? entryWrite.positionNames.after_char
        : typeof position === "string" &&
            Object.hasOwn(entryWrite.positionNames, position)
          ? entryWrite.positionNames[
              position as keyof typeof entryWrite.positionNames
            ]
          : undefined;
  assign("position", translated, positionPath, position);

  for (const field of entryExtensionFields) {
    const raw = extensions[field.source];
    let value: unknown = raw === undefined ? field.default : raw;
    if ("transform" in field && typeof value === "boolean")
      value = Number(value);
    assign(
      field.target,
      value,
      pointer(pointer(base, "extensions"), field.source),
      raw,
    );
  }

  const runtimeShape = {
    ...worldbookTriggerExtensionsSchema.shape,
    ...Object.fromEntries(
      entryRuntimeFlags.map((name) => [
        name,
        nativeCardWorldbookEntrySchema.shape.constant,
      ]),
    ),
  };
  const runtimeValues: ObjectValue = {};
  for (const [name, value] of Object.entries(extensions)) {
    if (Object.hasOwn(runtimeShape, name)) {
      const result =
        runtimeShape[name as keyof typeof runtimeShape].safeParse(value);
      if (result.success) runtimeValues[name] = result.data;
      else
        issues.push(
          issue(
            pointer(pointer(base, "extensions"), name),
            value,
            message(writeMessages.field, {
              target: "extra.extensions." + name,
            }),
          ),
        );
    } else if (
      name !== "position" &&
      !entryExtensionFields.some((field) => field.source === name) &&
      !(entryEditorFields as readonly string[]).includes(name) &&
      !(entryUnusedExtensions as readonly string[]).includes(name) &&
      !inactiveConfiguration(entryInactiveExtensions, name, value)
    )
      remaining.push(pointer(pointer(base, "extensions"), name));
  }
  if (Object.keys(runtimeValues).length)
    target.extra = { extensions: runtimeValues };
  if (copyContent) assign("content", source.content, pointer(base, "content"));
  for (const name of Object.keys(source)) {
    if (
      !entryFields.some((field) => field.source === name) &&
      !(entryWrite.ignoredSourceFields as readonly string[]).includes(name) &&
      !(entryEditorFields as readonly string[]).includes(name) &&
      !inactiveConfiguration(entryUnusedFields, name, source[name])
    )
      remaining.push(pointer(base, name));
  }
  const duplicates = entryDuplicateFields
    .filter((field) => {
      const value = valueAt(source, field.source);
      return (
        value !== undefined &&
        value === valueAt(source, field.canonical) &&
        valueAt(target, field.target) !== undefined
      );
    })
    .map((field) => field.source.reduce(pointer, base));
  return {
    index,
    entry: target,
    issues,
    remaining: remaining.filter((path) => !duplicates.includes(path)),
  };
}

/** Map selected entries after a single UID pass over the complete source array. */
export function mapEntries(
  entries: unknown[],
  indices: number[],
  entriesPointer: string,
  copyContent: boolean,
): MappedEntry[] {
  const selected = selectedIndices(indices, entries.length);
  const uidMap = mapEntryUids(entries, entriesPointer);
  return selected.map((index) =>
    mapEntryWithUids(entries, index, entriesPointer, copyContent, uidMap),
  );
}

/** Map one entry using the same full-array UID assignment as begin. */
export function mapEntry(
  entries: unknown[],
  index: number,
  entriesPointer: string,
  copyContent: boolean,
) {
  const uidMap = mapEntryUids(entries, entriesPointer);
  const selected = selectedIndices([index], entries.length)[0]!;
  const mapped = mapEntryWithUids(
    entries,
    selected,
    entriesPointer,
    copyContent,
    uidMap,
  );
  if (!mapped.entry) throw new Error(message(writeMessages.entry));
  return {
    entry: mapped.entry,
    issues: [
      ...mapped.issues,
      ...uidMap.issues.flatMap((issues, issueIndex) =>
        issueIndex === selected ? [] : issues,
      ),
    ],
    remaining: mapped.remaining,
  };
}

/** Assign stable source-order regex IDs while avoiding explicit IDs. */
export function mapRegexIds(scripts: unknown[]): Array<string | undefined> {
  const used = new Set<string>();
  for (const script of scripts) {
    if (!object(script)) continue;
    const parsed = nativeCardRegexRuleSchema.shape.id.safeParse(script.id);
    if (parsed.success) used.add(parsed.data);
  }
  return scripts.map((script, index) => {
    if (!object(script)) return undefined;
    if (script.id !== undefined) {
      const parsed = nativeCardRegexRuleSchema.shape.id.safeParse(script.id);
      return parsed.success ? parsed.data : undefined;
    }
    let number = index;
    while (used.has(regexWrite.idPrefix + number)) number++;
    const id = regexWrite.idPrefix + number;
    used.add(id);
    return id;
  });
}

/** Map selected regex rules in source order without performing file I/O. */
export function mapRegex(
  scripts: unknown[],
  indices: number[],
  sourcePointer: string,
) {
  if (!Array.isArray(scripts))
    throw new Error(message(writeMessages.regexArray));
  const selected = selectedIndices(indices, scripts.length);
  const ids = mapRegexIds(scripts);
  const existing = new Map<string, number>();
  const rules: ObjectValue[] = [];
  const issues: SourceIssue[] = [];
  const remaining: string[] = [];
  for (const index of selected) {
    const script = scripts[index];
    if (!object(script))
      throw new Error(message(writeMessages.regexRule, { index }));
    const base = pointer(sourcePointer, index);
    const target: ObjectValue = {};
    const id = script.id === undefined ? ids[index] : script.id;
    const idResult = nativeCardRegexRuleSchema.shape.id.safeParse(id);
    if (idResult.success) {
      target.id = id;
      if (existing.has(idResult.data))
        issues.push(
          issue(
            pointer(base, "id"),
            script.id,
            message(writeMessages.regexDuplicate, {
              id: idResult.data,
              other: pointer(
                pointer(sourcePointer, existing.get(idResult.data)!),
                "id",
              ),
            }),
          ),
        );
      else existing.set(idResult.data, index);
    } else
      issues.push(
        issue(
          pointer(base, "id"),
          script.id,
          message(writeMessages.field, { target: "id" }),
        ),
      );
    for (const field of regexFields) {
      const raw = script[field.source];
      if (raw === undefined && "optional" in field) continue;
      let value: unknown =
        raw === undefined && "default" in field ? field.default : raw;
      if (field.source === "substituteRegex" && typeof value === "boolean")
        value = value ? SUBSTITUTE_REGEX.RAW : SUBSTITUTE_REGEX.NONE;
      const result =
        nativeCardRegexRuleSchema.shape[field.source].safeParse(value);
      const validMode =
        field.source !== "substituteRegex" ||
        Object.values(SUBSTITUTE_REGEX).includes(value as 0 | 1 | 2);
      if (result.success && validMode) target[field.source] = result.data;
      else
        issues.push(
          issue(
            pointer(base, field.source),
            raw,
            message(writeMessages.field, { target: field.source }),
          ),
        );
    }
    for (const name of Object.keys(script))
      if (name !== "id" && !regexFields.some((field) => field.source === name))
        remaining.push(pointer(base, name));
    rules.push(target);
  }
  return { rules, issues, remaining };
}
