import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, basename, extname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  nativeCardCharacterSchema,
  nativeCardOpeningsSchema,
  nativeCardRegexRuleSchema,
  nativeCardWorldbookEntrySchema,
  nativeCardWorldbookSchema,
} from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { getNativeCardCreationTemplate } from "../../../../packages/shared/src/native-card-package.ts";
import {
  characterFields,
  openings,
  questions,
  arrayMemberTypes,
  sourceMessages,
  taskPaths,
  sourceFieldAliases,
  excludedSourcePaths,
  emptySourceValues,
  emptyDepthPrompt,
  sourceReadPatterns,
  sourceRegexTags,
  sourceTextFeatures,
  pluginVariableReferences,
  markedSourceFields,
  worldbookDefaultTemplate,
  worldbookSourceFields,
  worldbookEntryPath,
  emptyOpeningsTemplate,
} from "./source-config.ts";
import { readPngCard } from "./png-source.ts";
import {
  SourceCardInputError,
  validateSourceCard,
  type ValidatedSourceCard,
} from "./source-format.ts";
import { saveTextParts } from "./output.ts";
import { mapEntries, mapRegex } from "./write-mapping.ts";
import {
  formatTaskOutputPathFailure,
  prepareTaskOutputDirectory,
  readTaskContext,
  taskRepositoryRoot,
} from "./task-context.ts";
import runtime from "./runtime.json" with { type: "json" };

const characterFileName = taskPaths.characterFile;

type ObjectValue = Record<string, unknown>;
export type Pending = {
  pointer: string;
  category: string;
  question: string;
  message?: string;
  matches?: SourceTextMatch[];
  contextPointers?: string[];
};
export type SourceTextMatch = { pointer: string; feature: string };
export type SourceIssue = {
  pointer: string;
  message: string;
  valueType: string;
};
export type Written = {
  sourcePointer: string;
  targetFile: string;
  targetPointer: string;
};
type MappedWorldbook = {
  path: string;
  value: ObjectValue;
  entries: Array<{ index: number; value: ObjectValue }>;
};
type PrecheckResult = {
  character: ObjectValue;
  written: Omit<Written, "targetFile">[];
  pending: Pending[];
  issues: SourceIssue[];
  worldbook?: MappedWorldbook;
  regexRules?: ObjectValue[];
  regexSourceIndices?: number[];
  regexSourcePointer?: string;
  writeEmptyOpenings?: boolean;
};
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pointer(parent: string, key: string | number) {
  return parent + "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

type SourceTextReferences = {
  regexTags: Map<string, string[]>;
  pluginVariables: Map<string, string[]>;
};
type SourceTextScan = {
  matches: SourceTextMatch[];
  contextPointers: string[];
};

function addReference(
  references: Map<string, string[]>,
  name: string,
  path: string,
) {
  const paths = references.get(name) ?? [];
  if (!paths.includes(path)) paths.push(path);
  references.set(name, paths);
}

function collectVariableReferences(
  value: unknown,
  path: string,
  references: Map<string, string[]>,
  prefix = "",
) {
  if (object(value)) {
    for (const [key, member] of Object.entries(value)) {
      const name = prefix ? `${prefix}.${key}` : key;
      const memberPath = pointer(path, key);
      addReference(references, name, memberPath);
      collectVariableReferences(member, memberPath, references, name);
    }
  } else if (Array.isArray(value)) {
    value.forEach((member, index) => {
      const memberPath = pointer(path, index);
      if (
        Array.isArray(member) &&
        member.length === 2 &&
        typeof member[0] === "string"
      ) {
        const name = prefix ? `${prefix}.${member[0]}` : member[0];
        addReference(references, name, memberPath);
        collectVariableReferences(
          member[1],
          pointer(memberPath, 1),
          references,
          name,
        );
      } else collectVariableReferences(member, memberPath, references, prefix);
    });
  }
}

function collectSourceTextReferences(
  source: ObjectValue,
  data: ObjectValue,
  root: string,
): SourceTextReferences {
  const regexTags = new Map<string, string[]>();
  const pluginVariables = new Map<string, string[]>();
  const extensionSources = [
    {
      value: data.extensions,
      path: pointer(root, "extensions"),
    },
    ...(root
      ? [{ value: source.extensions, path: pointer("", "extensions") }]
      : []),
  ];
  for (const extensionSource of extensionSources) {
    if (!object(extensionSource.value)) continue;
    const scripts = extensionSource.value.regex_scripts;
    const scriptsPath = pointer(extensionSource.path, "regex_scripts");
    if (Array.isArray(scripts))
      scripts.forEach((rule, index) => {
        if (!object(rule) || typeof rule.findRegex !== "string") return;
        const sourcePointer = pointer(pointer(scriptsPath, index), "findRegex");
        for (const match of rule.findRegex.matchAll(
          new RegExp(
            sourceRegexTags.pattern.source,
            sourceRegexTags.pattern.flags,
          ),
        ))
          addReference(regexTags, match[1]!.toLowerCase(), sourcePointer);
      });

    const helper = extensionSource.value.tavern_helper;
    const helperPath = pointer(extensionSource.path, "tavern_helper");
    if (object(helper) && Object.hasOwn(helper, "variables")) {
      collectVariableReferences(
        helper.variables,
        pointer(helperPath, "variables"),
        pluginVariables,
      );
    } else if (Array.isArray(helper)) {
      helper.forEach((pair, index) => {
        if (Array.isArray(pair) && pair.length === 2 && pair[0] === "variables")
          collectVariableReferences(
            pair[1],
            pointer(pointer(helperPath, index), 1),
            pluginVariables,
          );
      });
    }
  }
  return { regexTags, pluginVariables };
}

function scanSourceText(
  value: unknown,
  path: string,
  references: SourceTextReferences,
  includeRegexReferences = true,
): SourceTextScan {
  const matches: SourceTextMatch[] = [];
  const contextPointers = new Set<string>();
  const visited = new Set<string>();
  const addMatch = (sourcePointer: string, feature: string) => {
    const key = `${sourcePointer}\u0000${feature}`;
    if (visited.has(key)) return;
    visited.add(key);
    matches.push({ pointer: sourcePointer, feature });
  };
  const scan = (member: unknown, sourcePointer: string) => {
    if (typeof member === "string") {
      for (const feature of sourceTextFeatures)
        if (feature.pattern.test(member))
          addMatch(sourcePointer, feature.feature);
      if (includeRegexReferences)
        for (const match of member.matchAll(
          new RegExp(
            sourceRegexTags.pattern.source,
            sourceRegexTags.pattern.flags,
          ),
        )) {
          const referencesForTag = references.regexTags.get(
            match[1]!.toLowerCase(),
          );
          if (!referencesForTag?.length) continue;
          addMatch(sourcePointer, sourceRegexTags.feature);
          for (const related of referencesForTag) contextPointers.add(related);
        }
      for (const pattern of [
        pluginVariableReferences.pattern,
        pluginVariableReferences.apiPattern,
      ])
        for (const match of member.matchAll(
          new RegExp(pattern.source, pattern.flags),
        )) {
          const related = references.pluginVariables.get(match[1]!.trim());
          for (const relatedPointer of related ?? [])
            contextPointers.add(relatedPointer);
        }
      return;
    }
    if (Array.isArray(member)) {
      member.forEach((child, index) =>
        scan(child, pointer(sourcePointer, index)),
      );
    } else if (object(member)) {
      for (const [key, child] of Object.entries(member))
        scan(child, pointer(sourcePointer, key));
    }
  };
  scan(value, path);
  return { matches, contextPointers: [...contextPointers] };
}

function sourceValue(source: unknown, path: string): unknown {
  if (path === "") return source;
  return path
    .slice(1)
    .split("/")
    .reduce<unknown>((value, key) => {
      if (value === null || typeof value !== "object") return undefined;
      const decoded = key.replaceAll("~1", "/").replaceAll("~0", "~");
      return Object.hasOwn(value, decoded)
        ? (value as ObjectValue)[decoded]
        : undefined;
    }, source);
}
function valueType(value: unknown) {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

function message(
  key: keyof typeof sourceMessages,
  values: Record<string, unknown> = {},
) {
  return sourceMessages[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name]),
  );
}

export function precheckCard(input: ValidatedSourceCard): PrecheckResult {
  const { source, data, root } = input;
  const character: ObjectValue = {};
  const written: Omit<Written, "targetFile">[] = [];
  const pending: Pending[] = [];
  const issues: SourceIssue[] = [];
  let worldbook: MappedWorldbook | undefined;
  let regexRules: ObjectValue[] | undefined;
  let regexSourceIndices: number[] | undefined;
  let regexSourcePointer: string | undefined;
  let textReferences: SourceTextReferences = {
    regexTags: new Map(),
    pluginVariables: new Map(),
  };
  const pendingByKey = new Map<string, Pending>();
  const issue = (path: string, value: unknown, message: string) => {
    issues.push({ pointer: path, valueType: valueType(value), message });
  };
  const addPending = (
    path: string,
    category: keyof typeof questions,
    detail?: string,
    scan = scanSourceText(
      object(source) ? sourceValue(source, path) : undefined,
      path,
      textReferences,
    ),
  ) => {
    const key = `${category}\u0000${path}`;
    const existing = pendingByKey.get(key);
    if (existing) {
      if (detail && !existing.message) existing.message = detail;
      if (scan.matches.length) {
        const matches = new Map(
          (existing.matches ?? []).map((match) => [
            `${match.pointer}\u0000${match.feature}`,
            match,
          ]),
        );
        for (const match of scan.matches)
          matches.set(`${match.pointer}\u0000${match.feature}`, match);
        existing.matches = [...matches.values()];
      }
      if (scan.contextPointers.length)
        existing.contextPointers = [
          ...new Set([
            ...(existing.contextPointers ?? []),
            ...scan.contextPointers,
          ]),
        ];
      return;
    }
    const item: Pending = {
      pointer: path,
      category,
      question: questions[category],
      ...(detail ? { message: detail } : {}),
      ...(scan.matches.length ? { matches: scan.matches } : {}),
      ...(scan.contextPointers.length
        ? { contextPointers: scan.contextPointers }
        : {}),
    };
    pendingByKey.set(key, item);
    pending.push(item);
  };
  textReferences = collectSourceTextReferences(source, data, root);
  const processCharacterField = (
    key: keyof typeof characterFields,
    value: unknown,
    path: string,
  ) => {
    const rule = characterFields[key];
    if ((markedSourceFields.character as readonly string[]).includes(key)) {
      const scan = scanSourceText(value, path, textReferences);
      if (scan.matches.length) {
        addPending(path, "character", undefined, scan);
        return;
      }
    }
    const result =
      nativeCardCharacterSchema.shape[rule.target].safeParse(value);
    if (!result.success || value === null) {
      issue(
        path,
        value,
        message("characterField", {
          field: rule.target,
          file: characterFileName,
        }),
      );
      addPending(path, "character");
      return;
    }
    character[rule.target] = value;
    written.push({
      sourcePointer: path,
      targetPointer: pointer("", rule.target),
    });
  };
  const handledPaths = new Set<string>(
    excludedSourcePaths.flatMap((path) => [path, root + path]),
  );
  const skipSourceField = (path: string, value: unknown) => {
    if (handledPaths.has(path)) return true;
    const relative =
      root && path.startsWith(root + "/") ? path.slice(root.length) : path;
    if (
      Object.hasOwn(emptySourceValues, relative) &&
      isDeepStrictEqual(
        value,
        emptySourceValues[relative as keyof typeof emptySourceValues],
      )
    )
      return true;
    return (
      relative === emptyDepthPrompt.path &&
      object(value) &&
      value.prompt === "" &&
      (!Object.hasOwn(value, "depth") ||
        (typeof value.depth === "number" &&
          Number.isSafeInteger(value.depth) &&
          value.depth >= 0)) &&
      (!Object.hasOwn(value, "role") ||
        emptyDepthPrompt.roles.some((role) => role === value.role)) &&
      Object.keys(value).every((key) =>
        emptyDepthPrompt.fields.some((field) => field === key),
      )
    );
  };
  for (const [alias, canonical] of Object.entries(sourceFieldAliases)) {
    const aliasPaths = [...new Set([pointer(root, alias), pointer("", alias)])];
    if (!aliasPaths.some((path) => sourceValue(source, path) !== undefined))
      continue;
    const paths = [
      pointer(root, canonical),
      ...aliasPaths,
      ...(root ? [pointer("", canonical)] : []),
    ];
    const members = [...new Set(paths)]
      .map((path) => ({ path, value: sourceValue(source, path) }))
      .filter((item) => item.value !== undefined);
    for (const member of members) handledPaths.add(member.path);
    const distinct = members.filter(
      (item, index) =>
        !members
          .slice(0, index)
          .some((previous) => isDeepStrictEqual(previous.value, item.value)),
    );
    if (distinct.length > 1) {
      for (const member of distinct) addPending(member.path, "character");
      for (const member of distinct.slice(1))
        issue(
          member.path,
          member.value,
          message("aliasConflict", { pointer: distinct[0]!.path }),
        );
    } else {
      const member = distinct[0]!;
      processCharacterField(canonical, member.value, member.path);
    }
  }
  if (root === "/data") {
    for (const [key, value] of Object.entries(source)) {
      if (
        ["spec", "spec_version", "data"].includes(key) ||
        skipSourceField(pointer("", key), value)
      )
        continue;
      if (key === "extensions" && object(value)) {
        for (const [extension, body] of Object.entries(value)) {
          const extensionPath = pointer(pointer("", key), extension);
          if (skipSourceField(extensionPath, body)) continue;
          if (
            object(data.extensions) &&
            Object.hasOwn(data.extensions, extension)
          ) {
            if (isDeepStrictEqual(body, data.extensions[extension])) continue;
            issue(
              extensionPath,
              body,
              message("rootConflict", {
                pointer: pointer(pointer(root, key), extension),
              }),
            );
          }
          addPending(extensionPath, "extension");
        }
        continue;
      }
      if (Object.hasOwn(data, key)) {
        if (!isDeepStrictEqual(value, data[key])) {
          issue(
            pointer("", key),
            value,
            message("rootConflict", { pointer: pointer(root, key) }),
          );
          addPending(pointer("", key), "other");
        }
      } else addPending(pointer("", key), "other");
    }
  }
  const processWorldbook = (value: unknown, path: string) => {
    if (value === null) return;
    if (!object(value)) {
      issue(path, value, message("bookObject"));
      addPending(path, "worldbook");
      return;
    }
    const template = getNativeCardCreationTemplate(worldbookDefaultTemplate);
    if (!template || !object(template.content))
      throw new Error(`缺少原生包创建模板：${worldbookDefaultTemplate}`);
    const target = structuredClone(template.content) as ObjectValue;
    const knownSourcePaths = new Set(
      worldbookSourceFields.flatMap((field) =>
        field.sources.map((tokens) => tokens.reduce(pointer, path)),
      ),
    );
    for (const field of worldbookSourceFields) {
      const members = field.sources
        .map((tokens) => ({
          path: tokens.reduce(pointer, path),
          value: tokens.reduce<unknown>((current, token) => {
            if (current === null || typeof current !== "object")
              return undefined;
            return Object.hasOwn(current, token)
              ? (current as ObjectValue)[token]
              : undefined;
          }, value),
        }))
        .filter((member) => member.value !== undefined);
      const distinct = members.filter(
        (member, index) =>
          !members
            .slice(0, index)
            .some((previous) =>
              isDeepStrictEqual(previous.value, member.value),
            ),
      );
      if (distinct.length > 1) {
        for (const member of distinct)
          addPending(member.path, "worldbookSettings");
        for (const member of distinct.slice(1)) {
          const detail = message("worldbookAliasConflict", {
            pointer: distinct[0]!.path,
          });
          issue(member.path, member.value, detail);
          addPending(member.path, "worldbookSettings", detail);
        }
        continue;
      }
      if (distinct.length === 0) continue;
      const member = distinct[0]!;
      if (
        (markedSourceFields.worldbook as readonly string[]).includes(
          field.target,
        )
      ) {
        const scan = scanSourceText(member.value, member.path, textReferences);
        if (scan.matches.length) {
          addPending(member.path, "worldbookSettings", undefined, scan);
          continue;
        }
      }
      const result = nativeCardWorldbookSchema.shape[
        field.target as keyof typeof nativeCardWorldbookSchema.shape
      ].safeParse(member.value);
      if (!result.success) {
        const detail = message("worldbookField", { field: field.target });
        issue(member.path, member.value, detail);
        addPending(member.path, "worldbookSettings", detail);
      } else target[field.target] = member.value;
    }

    for (const [key, member] of Object.entries(value)) {
      const memberPath = pointer(path, key);
      if (
        key === "entries" ||
        worldbookSourceFields.some((field) =>
          field.sources.some(
            (tokens) => tokens.length === 1 && tokens[0] === key,
          ),
        )
      )
        continue;
      if (key === "extensions" && object(member)) {
        for (const [extension, body] of Object.entries(member)) {
          const extensionPath = pointer(memberPath, extension);
          if (
            knownSourcePaths.has(extensionPath) ||
            skipSourceField(extensionPath, body)
          )
            continue;
          addPending(extensionPath, "worldbookSettings");
        }
        continue;
      }
      if (key === "extensions") {
        issue(memberPath, member, message("extensionsObject"));
        addPending(memberPath, "worldbookSettings");
        continue;
      }
      addPending(memberPath, "worldbookSettings");
    }

    const entriesPath = pointer(path, "entries");
    const entries = value.entries;
    if (!Object.hasOwn(value, "entries")) {
      issue(entriesPath, undefined, message("entriesMissing"));
      addPending(path, "worldbook");
    } else if (!Array.isArray(entries)) {
      issue(entriesPath, entries, message("array"));
      addPending(entriesPath, "worldbook");
    } else {
      const indices: number[] = [];
      entries.forEach((entry, index) => {
        if (object(entry)) indices.push(index);
        else {
          const entryPath = pointer(entriesPath, index);
          const detail = message("arrayObject");
          issue(entryPath, entry, detail);
          addPending(entryPath, "worldbook", detail);
        }
      });
      const mappedEntries = mapEntries(entries, indices, entriesPath, true);
      issues.push(...mappedEntries.flatMap((mapped) => mapped.issues));
      const entryFiles: string[] = [];
      const keptEntries: Array<{ index: number; value: ObjectValue }> = [];
      for (const mapped of mappedEntries) {
        const sourcePath = pointer(entriesPath, mapped.index);
        const sourceEntry = entries[mapped.index];
        const entryMatches: SourceTextMatch[] = [];
        const entryContexts = new Set<string>([sourcePath]);
        if (object(sourceEntry)) {
          for (const field of markedSourceFields.worldbookEntry) {
            if (!Object.hasOwn(sourceEntry, field)) continue;
            const fieldPath = pointer(sourcePath, field);
            const scan = scanSourceText(
              sourceEntry[field],
              fieldPath,
              textReferences,
            );
            entryMatches.push(...scan.matches);
            for (const related of scan.contextPointers)
              entryContexts.add(related);
          }
          if (Object.hasOwn(sourceEntry, "extensions")) {
            const scan = scanSourceText(
              sourceEntry.extensions,
              pointer(sourcePath, "extensions"),
              textReferences,
            );
            entryMatches.push(...scan.matches);
            for (const related of scan.contextPointers)
              entryContexts.add(related);
          }
        }
        const uniqueMatches = new Map(
          entryMatches.map((match) => [
            `${match.pointer}\u0000${match.feature}`,
            match,
          ]),
        );
        const hasMarkedContent = uniqueMatches.size > 0;
        for (const match of uniqueMatches.values())
          addPending(match.pointer, "worldbook", undefined, {
            matches: [match],
            contextPointers: [...entryContexts],
          });
        const ownIssues = mapped.issues.filter(
          (entryIssue) =>
            entryIssue.pointer === sourcePath ||
            entryIssue.pointer.startsWith(sourcePath + "/"),
        );
        for (const entryIssue of ownIssues)
          addPending(entryIssue.pointer, "worldbook", entryIssue.message);
        for (const remaining of mapped.remaining)
          addPending(remaining, "worldbook");
        if (ownIssues.length > 0 || hasMarkedContent) continue;
        if (!mapped.entry) {
          const detail = message("entryTarget", {
            file: worldbookEntryPath(mapped.index),
          });
          issue(sourcePath, sourceValue(source, sourcePath), detail);
          addPending(sourcePath, "worldbook", detail);
          continue;
        }
        const parsed = nativeCardWorldbookEntrySchema.safeParse(mapped.entry);
        if (!parsed.success) {
          const detail = message("entryTarget", {
            file: worldbookEntryPath(mapped.index),
          });
          issue(sourcePath, sourceValue(source, sourcePath), detail);
          addPending(sourcePath, "worldbook", detail);
          continue;
        }
        const entryFile = worldbookEntryPath(mapped.index);
        entryFiles.push(entryFile);
        keptEntries.push({ index: mapped.index, value: mapped.entry });
      }
      target.entryFiles = entryFiles;
      const parsed = nativeCardWorldbookSchema.safeParse(target);
      if (parsed.success) {
        worldbook = {
          path: taskPaths.worldbookFile,
          value: target,
          entries: keptEntries,
        };
        character.worldbooks = [
          {
            id: taskPaths.worldbookId,
            file: taskPaths.worldbookFile,
            enabled: true,
          },
        ];
      } else {
        const detail = message("worldbookTarget", {
          file: taskPaths.worldbookFile,
        });
        issue(path, value, detail);
        addPending(path, "worldbook", detail);
      }
    }
  };
  const processRegexScripts = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      const detail = message("array");
      issue(path, value, detail);
      addPending(path, "regex", detail);
      return;
    }
    const indices: number[] = [];
    value.forEach((rule, index) => {
      if (object(rule)) indices.push(index);
      else {
        const rulePath = pointer(path, index);
        const detail = message("arrayObject");
        issue(rulePath, rule, detail);
        addPending(rulePath, "regex", detail);
      }
    });
    if (indices.length === 0) return;
    const mapped = mapRegex(value, indices, path);
    issues.push(...mapped.issues);
    for (const remaining of mapped.remaining) addPending(remaining, "regex");
    const output: ObjectValue[] = [];
    const outputIndices: number[] = [];
    mapped.rules.forEach((rule, offset) => {
      const index = indices[offset]!;
      const rulePath = pointer(path, index);
      const sourceRule = value[index];
      const matches: SourceTextMatch[] = [];
      const contexts = new Set<string>([rulePath]);
      if (object(sourceRule))
        for (const field of markedSourceFields.regex) {
          if (!Object.hasOwn(sourceRule, field)) continue;
          const fieldPath = pointer(rulePath, field);
          const scan = scanSourceText(
            sourceRule[field],
            fieldPath,
            textReferences,
            false,
          );
          matches.push(...scan.matches);
          for (const related of scan.contextPointers) contexts.add(related);
        }
      const uniqueMatches = new Map(
        matches.map((match) => [
          `${match.pointer}\u0000${match.feature}`,
          match,
        ]),
      );
      const hasMarkedContent = uniqueMatches.size > 0;
      for (const match of uniqueMatches.values())
        addPending(match.pointer, "regex", undefined, {
          matches: [match],
          contextPointers: [...contexts],
        });
      const ownIssues = mapped.issues.filter(
        (entryIssue) =>
          entryIssue.pointer === rulePath ||
          entryIssue.pointer.startsWith(rulePath + "/"),
      );
      for (const entryIssue of ownIssues)
        addPending(entryIssue.pointer, "regex", entryIssue.message);
      if (ownIssues.length > 0 || hasMarkedContent) return;
      const parsed = nativeCardRegexRuleSchema.safeParse(rule);
      if (!parsed.success) {
        const detail = message("regexTarget", { file: taskPaths.regexFile });
        issue(rulePath, value[index], detail);
        addPending(rulePath, "regex", detail);
        return;
      }
      output.push(rule);
      outputIndices.push(index);
    });
    if (output.length > 0) {
      regexRules = output;
      regexSourceIndices = outputIndices;
      regexSourcePointer = path;
      character.regexProfiles = [taskPaths.regexFile];
    }
  };
  const arrayItems = (
    value: unknown,
    path: string,
    category: keyof typeof questions,
  ) => {
    if (Array.isArray(value))
      value.forEach((item, index) => {
        const itemPath = pointer(path, index);
        const kind = arrayMemberTypes[category];
        if (kind === "string" && typeof item !== "string")
          issue(itemPath, item, message("arrayString"));
        else if (kind === "object" && !object(item))
          issue(itemPath, item, message("arrayObject"));
        addPending(itemPath, category);
      });
    else {
      issue(path, value, message("array"));
      addPending(path, category);
    }
  };
  for (const [key, value] of Object.entries(data)) {
    const path = pointer(root, key);
    if (handledPaths.has(path)) continue;
    if (skipSourceField(path, value)) continue;
    if (Object.hasOwn(characterFields, key)) {
      processCharacterField(key as keyof typeof characterFields, value, path);
    } else if (openings.includes(key)) {
      if (key === "first_mes") {
        if (value === "") continue;
        addPending(path, "opening");
      } else arrayItems(value, path, "opening");
    } else if (key === "character_book") {
      processWorldbook(value, path);
    } else if (key === "extensions" && object(value)) {
      for (const [extension, body] of Object.entries(value)) {
        const extensionPath = pointer(path, extension);
        if (skipSourceField(extensionPath, body)) continue;
        if (extension === "regex_scripts")
          processRegexScripts(body, extensionPath);
        else if (extension === "tavern_helper") {
          const helperPart = (
            part: string,
            content: unknown,
            partPath: string,
          ) => {
            if (part === "scripts")
              arrayItems(content, partPath, "helperScript");
            else if (part === "variables") {
              if (!object(content))
                issue(partPath, content, message("helperVariables"));
              else if (Object.keys(content).length === 0) return;
              addPending(partPath, "helperVariables");
            } else addPending(partPath, "extension");
          };
          if (object(body))
            for (const [part, content] of Object.entries(body))
              helperPart(part, content, pointer(extensionPath, part));
          else if (Array.isArray(body)) {
            const seen = new Set<string>();
            body.forEach((pair, index) => {
              const pairPath = pointer(extensionPath, index);
              if (
                !Array.isArray(pair) ||
                pair.length !== 2 ||
                typeof pair[0] !== "string"
              ) {
                issue(pairPath, pair, message("helperTuple"));
                addPending(pairPath, "extension");
                return;
              }
              if (seen.has(pair[0]))
                issue(
                  pairPath,
                  pair,
                  message("helperKeyDuplicate", { key: pair[0] }),
                );
              seen.add(pair[0]);
              helperPart(pair[0], pair[1], pointer(pairPath, 1));
            });
          } else {
            issue(extensionPath, body, message("helperObject"));
            addPending(extensionPath, "extension");
          }
        } else addPending(extensionPath, "extension");
      }
    } else {
      if (key === "extensions") issue(path, value, message("extensionsObject"));
      addPending(path, "other");
    }
  }
  for (const [field, rule] of Object.entries(characterFields)) {
    if (
      Object.hasOwn(data, field) ||
      nativeCardCharacterSchema.shape[rule.target].safeParse(undefined).success
    )
      continue;
    addPending(
      pointer(root, field),
      "character",
      message("characterRequired", {
        field: rule.target,
        file: characterFileName,
      }),
    );
  }
  return {
    character,
    written,
    pending,
    issues,
    writeEmptyOpenings: openings.every(
      (field) =>
        !Object.hasOwn(data, field) ||
        data[field] === "" ||
        (Array.isArray(data[field]) && data[field].length === 0),
    ),
    ...(worldbook ? { worldbook } : {}),
    ...(regexRules ? { regexRules } : {}),
    ...(regexSourceIndices ? { regexSourceIndices } : {}),
    ...(regexSourcePointer ? { regexSourcePointer } : {}),
  } satisfies PrecheckResult;
}

export async function begin(sourceFile: string) {
  const originalSourceFile = resolve(sourceFile);
  const inputBytes = await readFile(originalSourceFile);
  const format = extname(originalSourceFile).toLowerCase();
  if (format !== ".png" && format !== ".json")
    throw new Error(message("inputFormat"));
  const bytes = format === ".png" ? readPngCard(inputBytes) : inputBytes;
  let source: unknown;
  try {
    source = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new SyntaxError(
        message("jsonSyntax", { path: originalSourceFile }),
      );
    throw error;
  }
  const admitted = validateSourceCard(source);
  if (!admitted.success)
    throw new SourceCardInputError(admitted, originalSourceFile);
  const precheck = precheckCard(admitted);
  const outputBase = await prepareTaskOutputDirectory(
    taskRepositoryRoot,
    runtime.outputDirectory,
    true,
    (path, issue, worktreeRoot, actualPath) => {
      throw new Error(
        formatTaskOutputPathFailure(path, issue, worktreeRoot, actualPath)
          .message,
      );
    },
  );
  const outputDirectory = await mkdtemp(join(outputBase, taskPaths.prefix));
  const packageDirectory = join(outputDirectory, taskPaths.package);
  const taskFile = join(outputDirectory, taskPaths.task);
  const sourceCopy = join(outputDirectory, taskPaths.source);
  const characterFile = join(packageDirectory, characterFileName);
  await mkdir(packageDirectory);
  await writeFile(sourceCopy, bytes);
  const task = {
    id: basename(outputDirectory),
    sourceFile: sourceCopy,
    originalSourceFile,
    repositoryRoot: taskRepositoryRoot,
    outputDirectory,
    packageDirectory,
  };
  await writeFile(taskFile, JSON.stringify(task, null, 2) + "\n");
  const characterResult = nativeCardCharacterSchema.safeParse(
    precheck.character,
  );
  if (characterResult.success) {
    await writeFile(
      characterFile,
      JSON.stringify(precheck.character, null, 2) + "\n",
    );
    if (precheck.writeEmptyOpenings) {
      const openings = nativeCardOpeningsSchema.parse(emptyOpeningsTemplate);
      await writeFile(
        join(packageDirectory, taskPaths.openingsFile),
        JSON.stringify(openings, null, 2) + "\n",
      );
    }
  }
  if (precheck.worldbook) {
    const bookFile = join(packageDirectory, precheck.worldbook.path);
    await mkdir(dirname(bookFile), { recursive: true });
    await writeFile(
      bookFile,
      JSON.stringify(precheck.worldbook.value, null, 2) + "\n",
    );
    for (const entry of precheck.worldbook.entries) {
      const entryPath = worldbookEntryPath(entry.index);
      const entryFile = join(packageDirectory, entryPath);
      await mkdir(dirname(entryFile), { recursive: true });
      await writeFile(entryFile, JSON.stringify(entry.value, null, 2) + "\n");
    }
  }
  if (precheck.regexRules?.length) {
    const regexFile = join(packageDirectory, taskPaths.regexFile);
    await mkdir(dirname(regexFile), { recursive: true });
    await writeFile(
      regexFile,
      JSON.stringify(precheck.regexRules, null, 2) + "\n",
    );
  }

  const workFile = join(outputDirectory, taskPaths.workFile);
  const reviewItemsDirectory = join(
    outputDirectory,
    taskPaths.review,
    taskPaths.reviewItems,
  );
  await mkdir(reviewItemsDirectory, { recursive: true });
  const workItems: Array<
    Pending & {
      valueType: string;
      valuePresent: boolean;
      contentFile: string;
      partsDirectory?: string;
      partCount: number;
      contexts?: Array<{
        pointer: string;
        valueType: string;
        valuePresent: boolean;
        contentFile: string;
        partsDirectory?: string;
        partCount: number;
      }>;
    }
  > = [];
  for (const [index, item] of precheck.pending.entries()) {
    const itemId = `${taskPaths.reviewItemPrefix}${String(index + 1).padStart(6, "0")}`;
    const itemDirectory = join(reviewItemsDirectory, itemId);
    await mkdir(itemDirectory);
    const value = sourceValue(source, item.pointer);
    const text =
      value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2) + "\n";
    const contentName =
      typeof value === "string" || value === undefined
        ? taskPaths.reviewText
        : taskPaths.reviewJson;
    const contentFile = join(itemDirectory, contentName);
    await writeFile(contentFile, text);
    const parts = await saveTextParts(text, itemDirectory);
    const contexts = [];
    for (const [contextIndex, contextPointer] of [
      ...new Set(item.contextPointers ?? []),
    ].entries()) {
      const contextDirectory = join(
        itemDirectory,
        `${taskPaths.contextDirectoryPrefix}${String(contextIndex + 1).padStart(6, "0")}`,
      );
      await mkdir(contextDirectory);
      const contextValue = sourceValue(source, contextPointer);
      const contextText =
        contextValue === undefined
          ? ""
          : typeof contextValue === "string"
            ? contextValue
            : JSON.stringify(contextValue, null, 2) + "\n";
      const contextName =
        typeof contextValue === "string" || contextValue === undefined
          ? taskPaths.reviewText
          : taskPaths.reviewJson;
      const contextContentFile = join(contextDirectory, contextName);
      await writeFile(contextContentFile, contextText);
      const contextParts = await saveTextParts(contextText, contextDirectory);
      contexts.push({
        pointer: contextPointer,
        valueType: valueType(contextValue),
        valuePresent: contextValue !== undefined,
        contentFile: contextContentFile,
        ...contextParts,
      });
    }
    workItems.push({
      ...item,
      valueType: valueType(value),
      valuePresent: value !== undefined,
      contentFile,
      ...parts,
      ...(contexts.length ? { contexts } : {}),
    });
  }
  const workIndex = JSON.stringify({ items: workItems }, null, 2) + "\n";
  if (Buffer.byteLength(workIndex) <= runtime.resultPartBytes) {
    await writeFile(workFile, workIndex);
  } else {
    const itemsFile = join(outputDirectory, taskPaths.workIndexFile);
    await writeFile(itemsFile, workIndex);
    const parts = await saveTextParts(
      workIndex,
      dirname(itemsFile),
      runtime.resultPartBytes,
    );
    await writeFile(
      workFile,
      JSON.stringify(
        {
          itemCount: workItems.length,
          itemsFile,
          partsDirectory: join(dirname(itemsFile), "parts"),
          partCount: parts.partCount,
        },
        null,
        2,
      ) + "\n",
    );
  }
  return {
    taskFile,
    packageDirectory,
    workFile,
    pendingCount: workItems.length,
  };
}

function pointerValue(source: unknown, sourcePointer: string) {
  if (
    (sourcePointer !== "" && !sourcePointer.startsWith("/")) ||
    sourceReadPatterns.invalidEscape.test(sourcePointer)
  )
    throw new Error(message("sourcePointer"));
  let value = source;
  if (sourcePointer !== "") {
    for (const token of sourcePointer.slice(1).split("/")) {
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
      if (
        value === null ||
        typeof value !== "object" ||
        (Array.isArray(value) && !sourceReadPatterns.arrayIndex.test(key)) ||
        !Object.hasOwn(value, key)
      )
        throw new Error(message("sourceMissing", { pointer: sourcePointer }));
      value = (value as ObjectValue)[key];
    }
  }
  return value;
}

export async function readSource(taskFile: string, sourcePointer: string) {
  const task = await readTaskContext(taskFile);
  const source: unknown = JSON.parse(await readFile(task.sourceFile, "utf8"));
  const value = pointerValue(source, sourcePointer);
  if (typeof value !== "string") return { pointer: sourcePointer, value };
  const lines: { start: number; end: number }[] = [];
  let start = 0;
  for (const match of value.matchAll(sourceReadPatterns.lineBreak)) {
    const end = match.index! + match[0].length;
    lines.push({ start, end });
    start = end;
  }
  lines.push({ start, end: value.length });
  return { pointer: sourcePointer, value, lines };
}

export async function runBegin(sourceFile?: string) {
  if (!sourceFile) throw new Error(message("inputMissing"));
  return begin(sourceFile);
}

export async function extract(taskFile: string, pointers: string[]) {
  if (pointers.length === 0) throw new Error(message("extractArguments"));
  const task = await readTaskContext(taskFile);
  const source: unknown = JSON.parse(await readFile(task.sourceFile, "utf8"));
  const directory = await mkdtemp(
    join(task.outputDirectory, taskPaths.extractPrefix),
  );
  const items: Array<{
    pointer: string;
    valueType: string;
    contentFile: string;
    partsDirectory?: string;
    partCount: number;
  }> = [];
  const issues: Array<{ pointer: string; message: string }> = [];
  for (const [index, sourcePointer] of pointers.entries()) {
    let value: unknown;
    try {
      value = pointerValue(source, sourcePointer);
    } catch (error) {
      issues.push({
        pointer: sourcePointer,
        message: message("extractItemFailure", {
          pointer: sourcePointer,
          detail: String(error),
        }),
      });
      continue;
    }
    const itemDirectory = join(
      directory,
      `${taskPaths.extractItemPrefix}${String(index + 1).padStart(6, "0")}`,
    );
    await mkdir(itemDirectory);
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const contentFile = join(
      itemDirectory,
      typeof value === "string" ? taskPaths.extractText : taskPaths.extractJson,
    );
    await writeFile(contentFile, text);
    const parts = await saveTextParts(text, itemDirectory);
    items.push({
      pointer: sourcePointer,
      valueType: valueType(value),
      contentFile,
      ...parts,
    });
  }
  return { passed: issues.length === 0, directory, items, issues };
}

export async function runExtract(commandArguments: string[]) {
  if (commandArguments.length < 2) throw new Error(message("extractArguments"));
  return extract(commandArguments[0]!, commandArguments.slice(1));
}
