import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import type { z } from "zod";
import {
  nativeCardCharacterSchema,
  nativeCardRegexProfileSchema,
  nativeCardWorldbookEntrySchema,
  nativeCardWorldbookSchema,
} from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { precheckCard, readSource } from "./source.ts";
import { SourceCardInputError, validateSourceCard } from "./source-format.ts";
import type { SourceIssue } from "./source.ts";
import { readTaskContext } from "./task-context.ts";
import {
  entryWrite,
  regexWrite,
  writeSelection,
  writeMessages,
} from "./write-config.ts";
import runtime from "./runtime.json" with { type: "json" };
import {
  sourceReadPatterns,
  taskPaths,
  worldbookEntryFile,
  worldbookEntryIndex,
} from "./source-config.ts";
import { replaceFileContents } from "./atomic-write.ts";
import { normalizeTarget, prepareTarget } from "./package-target.ts";
import { isStateFile, writeStateCandidate } from "./state-write.ts";
import { withDerivedTask } from "./task-derivation.ts";
import { mapEntries, mapRegex } from "./write-mapping.ts";
import { formatToolMessage, replacementMessages } from "./tool-config.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pointer(parent: string, key: string | number) {
  return parent + "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}
function message(
  key: keyof typeof writeMessages,
  values: Record<string, unknown> = {},
) {
  return writeMessages[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name]),
  );
}
function replacementMessage(
  key: keyof typeof replacementMessages,
  values: Record<string, string | number> = {},
) {
  return formatToolMessage(replacementMessages[key], values);
}
function selectedIndices(indices: number[], length: number) {
  if (
    indices.some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= length,
    ) ||
    new Set(indices).size !== indices.length
  )
    throw new Error(message("regexIndices"));
  return [...indices].sort((a, b) => a - b);
}
export {
  mapEntry,
  mapEntries,
  mapEntryUids,
  mapRegex,
  mapRegexIds,
} from "./write-mapping.ts";

export type EntryWriteResult = {
  sourcePointer: string;
  file: string;
  issues: SourceIssue[];
  remaining: string[];
  passed: boolean;
  error?: string;
};

async function readExistingJson(file: string): Promise<unknown> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new Error(message("targetLink"));
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function mapEntryFile(
  taskFile: string,
  sourcePointer: string,
  targetFile: string,
  copyContent: boolean,
) {
  const match = entryWrite.sourcePointer.exec(sourcePointer);
  if (!match) throw new Error(message("pointer"));
  const entriesPointer = match[1]!;
  const entries = (await readSource(taskFile, entriesPointer)).value;
  if (!Array.isArray(entries)) throw new Error(message("entries"));
  const index = Number(match[2]);
  const [result] = mapEntries(entries, [index], entriesPointer, copyContent);
  const normalized = await normalizeTarget(
    taskFile,
    targetFile,
    entryWrite.schema,
  );
  const expectedTarget = `${taskPaths.worldbookEntriesDirectory}/${worldbookEntryFile(index)}`;
  if (normalized.packageRelative.split(sep).join("/") !== expectedTarget)
    throw new Error(message("targetPath"));
  const target = await prepareTarget(taskFile, targetFile, entryWrite.schema);
  const outcome = await writeMappedEntries(target.root, [
    { ...result!, sourcePointer, target },
  ]);
  return outcome[0]!;
}

export async function mapEntryBatchFile(
  taskFile: string,
  entriesPointer: string,
  targetDirectory: string,
  indices: number[],
  copyContent: boolean,
) {
  if (!entryWrite.entriesPointer.test(entriesPointer))
    throw new Error(message("entriesPointer"));
  const entries = (await readSource(taskFile, entriesPointer)).value;
  if (!Array.isArray(entries)) throw new Error(message("entries"));
  const selected = selectedIndices(indices, entries.length);
  const targetPath = (name: string) =>
    targetDirectory.endsWith(sep)
      ? targetDirectory + name
      : targetDirectory + sep + name;
  const normalizedTarget = await prepareTarget(
    taskFile,
    targetPath(worldbookEntryFile(0)),
    entryWrite.schema,
  );
  if (
    normalizedTarget.packageRelative.split(sep).join("/") !==
    `${taskPaths.worldbookEntriesDirectory}/${worldbookEntryFile(0)}`
  )
    throw new Error(message("targetPath"));
  const targetDirectoryPath = relative(
    normalizedTarget.root,
    dirname(normalizedTarget.targetFile),
  );
  const mapped = mapEntries(entries, selected, entriesPointer, copyContent);
  const targets = mapped.map((result) => {
    const sourcePointer = pointer(entriesPointer, result.index);
    const targetFile = resolve(
      normalizedTarget.root,
      targetDirectoryPath,
      worldbookEntryFile(result.index),
    );
    return {
      ...result,
      sourcePointer,
      targetFile,
    };
  });
  const results = await writeMappedEntries(
    normalizedTarget.root,
    targets.map((target) => ({
      ...target,
      target: {
        root: normalizedTarget.root,
        targetFile: target.targetFile,
        packageRelative: relative(normalizedTarget.root, target.targetFile),
        rule: normalizedTarget.rule,
      },
    })),
  );
  return {
    passed: results.every((result) => result.passed === true),
    results,
  };
}

type EntryCandidate = {
  sourcePointer: string;
  targetFile: string;
  issues: Array<{ pointer: string; valueType: string; message: string }>;
  remaining: string[];
  output?: ObjectValue;
  packageRelative: string;
};

async function writeMappedEntries(
  packageDirectory: string,
  mapped: Array<{
    index: number;
    sourcePointer: string;
    entry?: ObjectValue;
    issues: Array<{ pointer: string; valueType: string; message: string }>;
    remaining: string[];
    target: Awaited<ReturnType<typeof normalizeTarget>>;
  }>,
) {
  const candidates: EntryCandidate[] = [];
  const results: EntryWriteResult[] = [];
  for (const item of mapped) {
    const targetFile = item.target.targetFile;
    const result = {
      sourcePointer: item.sourcePointer,
      file: resolve(targetFile),
      issues: item.issues,
      remaining: item.remaining,
      passed: false,
    };
    if (!item.entry || item.issues.length > 0) {
      results.push(result);
      continue;
    }
    try {
      const loaded = await readExistingJson(targetFile);
      if (loaded !== undefined && !object(loaded))
        throw new Error(message("targetObject"));
      const existing: ObjectValue = loaded === undefined ? {} : loaded;
      const output: ObjectValue = { ...existing, ...item.entry };
      if (object(existing.extra) && object(item.entry.extra)) {
        output.extra = { ...existing.extra, ...item.entry.extra };
        if (
          object(existing.extra.extensions) &&
          object(item.entry.extra.extensions)
        )
          (output.extra as ObjectValue).extensions = {
            ...existing.extra.extensions,
            ...item.entry.extra.extensions,
          };
      }
      const parsed = nativeCardWorldbookEntrySchema.safeParse(output);
      if (!parsed.success) throw new Error(message("entry"));
      candidates.push({
        sourcePointer: item.sourcePointer,
        targetFile,
        issues: item.issues,
        remaining: item.remaining,
        output: parsed.data,
        packageRelative: item.target.packageRelative.split(sep).join("/"),
      });
      results.push(result);
    } catch (error) {
      results.push({ ...result, error: String(error) });
    }
  }
  if (candidates.length === 0) return results;

  let references: Awaited<ReturnType<typeof readEntryReferences>>;
  try {
    references = await readEntryReferences(packageDirectory);
  } catch (error) {
    const failed = String(error);
    for (const candidate of candidates) {
      const at = results.findIndex(
        (result) => result.file === candidate.targetFile,
      );
      if (at >= 0) results[at] = { ...results[at]!, error: failed };
    }
    return results;
  }

  const written: EntryCandidate[] = [];
  for (const candidate of candidates) {
    try {
      await writeJson(candidate.targetFile, candidate.output, packageDirectory);
      written.push(candidate);
    } catch (error) {
      const at = results.findIndex(
        (result) => result.file === candidate.targetFile,
      );
      if (at >= 0) results[at] = { ...results[at]!, error: String(error) };
    }
  }
  if (written.length > 0) {
    const updated = updateEntryReferences(
      references,
      written.map((candidate) => candidate.packageRelative),
    );
    try {
      await writeJson(references.bookFile, updated.book, packageDirectory);
      if (updated.characterChanged)
        await writeJson(
          references.characterFile,
          updated.character,
          packageDirectory,
        );
    } catch (error) {
      for (const candidate of written) {
        const at = results.findIndex(
          (result) => result.file === candidate.targetFile,
        );
        if (at >= 0) results[at] = { ...results[at]!, error: String(error) };
      }
      return results;
    }
    for (const candidate of written) {
      const at = results.findIndex(
        (result) => result.file === candidate.targetFile,
      );
      if (at >= 0) results[at] = { ...results[at]!, passed: true };
    }
  }
  return results;
}

type EntryReferences = {
  bookFile: string;
  characterFile: string;
  book: z.infer<typeof nativeCardWorldbookSchema>;
  character: z.infer<typeof nativeCardCharacterSchema>;
};

async function readEntryReferences(
  packageDirectory: string,
): Promise<EntryReferences> {
  const bookFile = join(packageDirectory, taskPaths.worldbookFile);
  const characterFile = join(packageDirectory, taskPaths.characterFile);
  const bookValue = await readExistingJson(bookFile);
  const characterValue = await readExistingJson(characterFile);
  if (!object(bookValue) || !object(characterValue))
    throw new Error(message("targetObject"));
  const book = nativeCardWorldbookSchema.safeParse(bookValue);
  const character = nativeCardCharacterSchema.safeParse(characterValue);
  if (!book.success || !character.success)
    throw new Error(message("targetObject"));
  return {
    bookFile,
    characterFile,
    book: book.data,
    character: character.data,
  };
}

function updateEntryReferences(references: EntryReferences, paths: string[]) {
  const entryFiles = [...new Set([...references.book.entryFiles, ...paths])];
  entryFiles.sort((left, right) => {
    const leftIndex = worldbookEntryIndex(left);
    const rightIndex = worldbookEntryIndex(right);
    if (leftIndex !== undefined && rightIndex !== undefined)
      return Number(leftIndex) - Number(rightIndex);
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const book = { ...references.book, entryFiles };
  const worldbooks = [...(references.character.worldbooks ?? [])];
  const binding = worldbooks.find(
    (candidate) => candidate.id === taskPaths.worldbookId,
  );
  let characterChanged = false;
  if (!binding) {
    worldbooks.push({
      id: taskPaths.worldbookId,
      file: taskPaths.worldbookFile,
      enabled: true,
    });
    characterChanged = true;
  } else if (binding.file !== taskPaths.worldbookFile) {
    throw new Error(message("targetObject"));
  }
  const character = characterChanged
    ? { ...references.character, worldbooks }
    : references.character;
  if (
    !nativeCardWorldbookSchema.safeParse(book).success ||
    !nativeCardCharacterSchema.safeParse(character).success
  )
    throw new Error(message("targetObject"));
  return { book, character, characterChanged };
}

/** 原文复制参数；片段范围采用 JavaScript UTF-16 索引。 */
export type CopyOptions = {
  targetPointer?: string;
  start?: number;
  end?: number;
};

function sourceFragment(value: unknown, options: CopyOptions) {
  if (options.start === undefined && options.end === undefined) return value;
  if (typeof value !== "string") throw new Error(message("fragmentString"));
  const start = options.start ?? 0;
  const end = options.end ?? value.length;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start! < 0 ||
    end! < start! ||
    end! > value.length
  )
    throw new Error(message("fragmentRange"));
  for (const offset of [start!, end!]) {
    const before = value.charCodeAt(offset - 1),
      after = value.charCodeAt(offset);
    if (
      before >= 0xd800 &&
      before <= 0xdbff &&
      after >= 0xdc00 &&
      after <= 0xdfff
    )
      throw new Error(message("fragmentCharacter"));
  }
  return value.slice(start, end);
}

function setJsonValue(root: unknown, targetPointer: string, value: unknown) {
  if (targetPointer === "") return value;
  if (
    !targetPointer.startsWith("/") ||
    sourceReadPatterns.invalidEscape.test(targetPointer)
  )
    throw new Error(message("targetPointer"));
  const keys = targetPointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (root === undefined)
    root = sourceReadPatterns.arrayIndex.test(keys[0]!) ? [] : {};
  let parent: unknown = root;
  for (const [index, key] of keys.entries()) {
    if (parent === null || typeof parent !== "object")
      throw new Error(message("targetContainer"));
    if (
      Array.isArray(parent) &&
      (!sourceReadPatterns.arrayIndex.test(key) ||
        !Number.isSafeInteger(Number(key)) ||
        Number(key) > parent.length)
    )
      throw new Error(message("targetArray"));
    const last = index === keys.length - 1;
    if (last || !Object.hasOwn(parent, key)) {
      const child = last
        ? value
        : sourceReadPatterns.arrayIndex.test(keys[index + 1]!)
          ? []
          : {};
      Object.defineProperty(parent, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    parent = (parent as ObjectValue)[key];
  }
  return root;
}

export type FieldMapping = {
  sourcePointer: string;
  targetPointer: string;
};

function pointerTokens(value: string) {
  if (
    (value !== "" && !value.startsWith("/")) ||
    sourceReadPatterns.invalidEscape.test(value)
  )
    throw new Error(message("targetPointer"));
  return value === ""
    ? []
    : value
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function valueAtPointer(root: unknown, sourcePointer: string) {
  let value = root;
  let tokens: string[];
  try {
    tokens = pointerTokens(sourcePointer);
  } catch (error) {
    throw new Error(message("fieldSourcePointer", { pointer: sourcePointer }), {
      cause: error,
    });
  }
  for (const key of tokens) {
    if (
      value === null ||
      typeof value !== "object" ||
      (Array.isArray(value) && !sourceReadPatterns.arrayIndex.test(key)) ||
      !Object.hasOwn(value, key)
    )
      throw new Error(
        message("fieldSourcePointer", { pointer: sourcePointer }),
      );
    value = (value as ObjectValue)[key];
  }
  return value;
}

function validateFieldTargets(fields: FieldMapping[]) {
  const parsed = fields.map((field) => ({
    field,
    tokens: pointerTokens(field.targetPointer),
  }));
  for (let index = 0; index < parsed.length; index++) {
    const current = parsed[index]!;
    for (const earlier of parsed.slice(0, index)) {
      const sharedLength = Math.min(
        current.tokens.length,
        earlier.tokens.length,
      );
      const parentChild = current.tokens
        .slice(0, sharedLength)
        .every((token, tokenIndex) => token === earlier.tokens[tokenIndex]);
      if (parentChild)
        throw new Error(
          message("fieldConflict", {
            first: earlier.field.targetPointer,
            second: current.field.targetPointer,
          }),
        );
    }
  }
  return parsed;
}

async function writeJsonCandidate(
  taskFile: string,
  target: Awaited<ReturnType<typeof prepareTarget>>,
  candidate: unknown,
) {
  const state = await writeStateCandidate(
    taskFile,
    target.packageRelative.split(sep).join("/"),
    candidate,
  );
  if (state) return state;
  await writeJson(target.targetFile, candidate, target.root);
  return { file: target.targetFile };
}

/** Read a source card and target JSON once, then atomically apply all fields. */
export async function mapCopyFieldsFile(
  taskFile: string,
  targetFile: string,
  fields: FieldMapping[],
) {
  if (fields.length === 0) throw new Error(message("fieldArguments"));
  const parsedFields = validateFieldTargets(fields);
  const sourceRoot = (await readSource(taskFile, "")).value;
  const target = await prepareTarget(taskFile, targetFile, undefined);
  if (!target.rule.mediaTypes.includes("application/json"))
    throw new Error(message("targetJson"));
  let output = await readExistingJson(target.targetFile);
  for (const { field } of parsedFields) {
    const value = valueAtPointer(sourceRoot, field.sourcePointer);
    try {
      output = setJsonValue(output, field.targetPointer, value);
    } catch (error) {
      throw new Error(
        message("fieldTargetPointer", { pointer: field.targetPointer }),
        { cause: error },
      );
    }
  }
  const result = await writeJsonCandidate(taskFile, target, output);
  return { ...result, fields: fields.length };
}

async function writeCopiedValue(
  taskFile: string,
  targetFile: string,
  value: unknown,
  targetPointer?: string,
  asJson = false,
) {
  if (
    targetPointer !== undefined &&
    !(
      await normalizeTarget(taskFile, targetFile, undefined)
    ).rule.mediaTypes.includes("application/json")
  )
    throw new Error(message("targetJson"));
  const target = await prepareTarget(taskFile, targetFile, undefined);
  const file = target.targetFile;
  if (targetPointer === undefined) {
    const state = await writeStateCandidate(
      taskFile,
      target.packageRelative.split(sep).join("/"),
      value,
    );
    if (state) return state;
  }
  if (targetPointer !== undefined) {
    const existing = await readExistingJson(file);
    const candidate = setJsonValue(existing, targetPointer, value);
    const result = await writeJsonCandidate(taskFile, target, candidate);
    return { ...result, targetPointer };
  }
  if (asJson || typeof value !== "string")
    await writeJson(file, value, target.root);
  else
    await replaceFileContents(file, value, message("targetLink"), target.root);
  return { file };
}

/**
 * 本函数将选定源值或字符串片段原样写入包文件。
 * @param taskFile begin 返回的任务文件。
 * @param sourcePointer 源值的 JSON Pointer。
 * @param targetFile 相对于包目录的目标文件路径。
 * @param options 目标字段和可选字符串范围。
 * @returns 目标文件绝对路径及适用的目标字段位置。
 * @throws 源位置、片段、目标字段或文件操作错误时抛出异常。
 */
export async function mapCopyFile(
  taskFile: string,
  sourcePointer: string,
  targetFile: string,
  options: CopyOptions = {},
) {
  const source = await readSource(taskFile, sourcePointer);
  return writeCopiedValue(
    taskFile,
    targetFile,
    sourceFragment(source.value, options),
    options.targetPointer,
  );
}

function copyArguments(args: string[]) {
  if (args.length < 3) throw new Error(message("copyArguments"));
  const options: CopyOptions = {};
  for (let i = 3; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    const key =
      flag === "--target-pointer"
        ? "targetPointer"
        : flag === "--start"
          ? "start"
          : flag === "--end"
            ? "end"
            : undefined;
    if (!key || value === undefined || Object.hasOwn(options, key))
      throw new Error(message("copyArguments"));
    if (key === "targetPointer") options[key] = value;
    else {
      if (!sourceReadPatterns.arrayIndex.test(value))
        throw new Error(message("fragmentRange"));
      options[key] = Number(value);
    }
  }
  return options;
}

function fieldArguments(args: string[], start: number): FieldMapping[] {
  const fields: FieldMapping[] = [];
  for (let index = start; index < args.length; ) {
    if (args[index] !== "--field") throw new Error(message("fieldArguments"));
    const sourcePointer = args[index + 1];
    const targetPointer = args[index + 2];
    if (sourcePointer === undefined || targetPointer === undefined)
      throw new Error(message("fieldArguments"));
    fields.push({ sourcePointer, targetPointer });
    index += 3;
  }
  if (fields.length === 0) throw new Error(message("fieldArguments"));
  return fields;
}

/**
 * 本函数执行 copy 并返回文件路径或抛出错误。
 * @param args 任务文件、源位置、目标文件及可选字段或片段参数。
 * @returns 文件路径及本次映射数量。
 */
export async function runCopy(args: string[]) {
  if (args.length < 3) throw new Error(message("copyArguments"));
  if (args.length >= 3 && args[2] === "--field")
    return mapCopyFieldsFile(args[0]!, args[1]!, fieldArguments(args, 2));
  return mapCopyFile(args[0]!, args[1]!, args[2]!, copyArguments(args));
}

/**
 * 本函数解析选定的 JSON 或 YAML 原文，将结果写入包内 JSON 文件。
 * @param taskFile begin 返回的任务文件。
 * @param sourcePointer 源字符串的 JSON Pointer。
 * @param targetFile 相对于包目录的目标 JSON 文件。
 * @param options 数据格式、目标字段及可选片段范围。
 * @returns 目标文件绝对路径及适用的目标字段位置。
 * @throws 源类型、语法、片段或目标文件操作错误时抛出异常。
 */
export async function mapParseFile(
  taskFile: string,
  sourcePointer: string,
  targetFile: string,
  options: CopyOptions & { format: "json" | "yaml" },
) {
  if (options.format !== "json" && options.format !== "yaml")
    throw new Error(message("parseFormat"));
  if (
    !(
      await normalizeTarget(taskFile, targetFile, undefined)
    ).rule.mediaTypes.includes("application/json")
  )
    throw new Error(message("targetJson"));
  const text = sourceFragment(
    (await readSource(taskFile, sourcePointer)).value,
    options,
  );
  if (typeof text !== "string") throw new Error(message("parseString"));
  const value = parseSourceText(text, options.format);
  return writeCopiedValue(
    taskFile,
    targetFile,
    value,
    options.targetPointer,
    true,
  );
}

function parseSourceText(text: string, format: "json" | "yaml") {
  if (format === "json") return JSON.parse(text) as unknown;
  const yaml = createRequire(
    new URL("../../../../apps/api/package.json", import.meta.url),
  )("yaml") as {
    parseDocument(
      text: string,
      options: { stringKeys: boolean },
    ): {
      errors: Error[];
      warnings: Error[];
      toJS(): unknown;
    };
  };
  const document = yaml.parseDocument(text, { stringKeys: true });
  const errors = [...document.errors, ...document.warnings];
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join("\n"));
  return JSON.parse(serializeJson(document.toJS())) as unknown;
}

function replacementPointerTokens(path: string, index: number) {
  if (!path.startsWith("/") || sourceReadPatterns.invalidEscape.test(path))
    throw new Error(replacementMessage("pathInvalid", { index }));
  return path
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function replaceExistingJsonPointer(
  root: unknown,
  tokens: string[],
  value: unknown,
  index: number,
  path: string,
) {
  let parent = root;
  for (const [offset, key] of tokens.entries()) {
    if (parent === null || typeof parent !== "object")
      throw new Error(replacementMessage("pathMissing", { index, path }));
    const exists = Array.isArray(parent)
      ? sourceReadPatterns.arrayIndex.test(key) &&
        Number.isSafeInteger(Number(key)) &&
        Number(key) < parent.length
      : Object.hasOwn(parent, key);
    if (!exists)
      throw new Error(replacementMessage("pathMissing", { index, path }));
    if (offset < tokens.length - 1) parent = (parent as ObjectValue)[key];
  }
  const key = tokens.at(-1)!;
  Object.defineProperty(parent, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Apply a JSON replace array to existing values in an initialized JSON file. */
export async function mapParseReplacementsFile(
  taskFile: string,
  sourcePointer: string,
  targetFile: string,
  options: CopyOptions & { format: "json" },
) {
  if (!options.format || options.format !== "json")
    throw new Error(replacementMessage("format"));
  const sourceValue = (await readSource(taskFile, sourcePointer)).value;
  const text = sourceFragment(sourceValue, options);
  if (typeof text !== "string")
    throw new Error(replacementMessage("sourceString"));
  let operations: unknown;
  try {
    operations = parseSourceText(text, "json");
  } catch (error) {
    throw new Error(replacementMessage("sourceJson"), { cause: error });
  }
  if (!Array.isArray(operations))
    throw new Error(replacementMessage("sourceArray"));

  const target = await prepareTarget(taskFile, targetFile, undefined);
  if (!target.rule.mediaTypes.includes("application/json"))
    throw new Error(
      replacementMessage("targetJson", { file: target.targetFile }),
    );
  let output: unknown;
  try {
    output = await readExistingJson(target.targetFile);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        replacementMessage("targetJson", { file: target.targetFile }),
        { cause: error },
      );
    throw error;
  }
  if (output === undefined)
    throw new Error(
      replacementMessage("targetMissing", { file: target.targetFile }),
    );

  for (const [offset, operation] of operations.entries()) {
    const index = offset + 1;
    if (!object(operation))
      throw new Error(replacementMessage("member", { index }));
    if (operation.op !== "replace")
      throw new Error(replacementMessage("operation", { index }));
    if (typeof operation.path !== "string")
      throw new Error(replacementMessage("pathString", { index }));
    if (!Object.hasOwn(operation, "value"))
      throw new Error(replacementMessage("valueMissing", { index }));
    const tokens = replacementPointerTokens(operation.path, index);
    replaceExistingJsonPointer(
      output,
      tokens,
      structuredClone(operation.value),
      index,
      operation.path,
    );
  }
  const retryOutput = structuredClone(output);
  for (const [offset, operation] of operations.entries()) {
    const member = operation as ObjectValue;
    const path = member.path as string;
    try {
      replaceExistingJsonPointer(
        retryOutput,
        replacementPointerTokens(path, offset + 1),
        structuredClone(member.value),
        offset + 1,
        path,
      );
    } catch (error) {
      throw new Error(
        replacementMessage("retryPathMissing", {
          index: offset + 1,
          path,
        }),
        { cause: error },
      );
    }
  }
  if (
    operations.length === 0 &&
    isStateFile(target.packageRelative.split(sep).join("/"))
  )
    return withDerivedTask(taskFile, async ({ task }) => ({
      file: join(task.packageDirectory, target.packageRelative),
      replacements: 0,
    }));
  const result =
    operations.length > 0
      ? await writeJsonCandidate(taskFile, target, output)
      : { file: target.targetFile };
  return { ...result, replacements: operations.length };
}

/** Read a source card and target JSON once, then parse and apply all fields. */
export async function mapParseFieldsFile(
  taskFile: string,
  targetFile: string,
  fields: FieldMapping[],
  format: "json" | "yaml",
) {
  if (fields.length === 0) throw new Error(message("fieldArguments"));
  if (format !== "json" && format !== "yaml")
    throw new Error(message("parseFormat"));
  const parsedFields = validateFieldTargets(fields);
  const sourceRoot = (await readSource(taskFile, "")).value;
  const target = await prepareTarget(taskFile, targetFile, undefined);
  if (!target.rule.mediaTypes.includes("application/json"))
    throw new Error(message("targetJson"));
  let output = await readExistingJson(target.targetFile);
  for (const { field } of parsedFields) {
    const text = valueAtPointer(sourceRoot, field.sourcePointer);
    if (typeof text !== "string") throw new Error(message("parseString"));
    const value = parseSourceText(text, format);
    try {
      output = setJsonValue(output, field.targetPointer, value);
    } catch (error) {
      throw new Error(
        message("fieldTargetPointer", { pointer: field.targetPointer }),
        { cause: error },
      );
    }
  }
  const result = await writeJsonCandidate(taskFile, target, output);
  return { ...result, fields: fields.length };
}

/**
 * 本函数执行 parse 并返回目标文件路径或抛出解析错误。
 * @param args 任务文件、源位置、目标文件、格式及可选字段或片段参数。
 * @returns 目标文件路径及目标字段位置。
 */
export async function runParse(args: string[]) {
  if (args.includes("--apply-replacements")) {
    if (args.includes("--target-pointer") || args.includes("--field"))
      throw new Error(replacementMessage("conflict"));
    if (args.length < 3 || args[2]!.startsWith("--"))
      throw new Error(replacementMessage("arguments"));

    const copyArgs = args.slice(0, 3);
    let format: string | undefined;
    let applyFlag = false;
    for (let index = 3; index < args.length; ) {
      const flag = args[index];
      if (flag === "--apply-replacements") {
        if (applyFlag) throw new Error(replacementMessage("arguments"));
        applyFlag = true;
        index++;
      } else if (flag === "--format") {
        if (format !== undefined || args[index + 1] === undefined)
          throw new Error(replacementMessage("format"));
        format = args[index + 1];
        index += 2;
      } else if (flag === "--start" || flag === "--end") {
        if (args[index + 1] === undefined)
          throw new Error(replacementMessage("arguments"));
        copyArgs.push(flag, args[index + 1]!);
        index += 2;
      } else throw new Error(replacementMessage("arguments"));
    }
    if (format !== "json") throw new Error(replacementMessage("format"));
    return mapParseReplacementsFile(args[0]!, args[1]!, args[2]!, {
      ...copyArguments(copyArgs),
      format: "json",
    });
  }
  if (args.length < 3) throw new Error(message("parseFormat"));
  if (args.length >= 3 && (args[2] === "--field" || args[2] === "--format")) {
    const fields: FieldMapping[] = [];
    let format: string | undefined;
    for (let index = 2; index < args.length; ) {
      if (args[index] === "--format") {
        if (format !== undefined || args[index + 1] === undefined)
          throw new Error(message("parseFormat"));
        format = args[index + 1];
        index += 2;
      } else if (args[index] === "--field") {
        const sourcePointer = args[index + 1];
        const targetPointer = args[index + 2];
        if (sourcePointer === undefined || targetPointer === undefined)
          throw new Error(message("fieldArguments"));
        fields.push({ sourcePointer, targetPointer });
        index += 3;
      } else throw new Error(message("fieldArguments"));
    }
    if (format !== "json" && format !== "yaml")
      throw new Error(message("parseFormat"));
    return mapParseFieldsFile(args[0]!, args[1]!, fields, format);
  }
  const remaining = args.slice(0, 3);
  let format: string | undefined;
  for (let index = 3; index < args.length; index += 2) {
    if (args[index] === "--format") {
      if (format !== undefined || args[index + 1] === undefined)
        throw new Error(message("parseFormat"));
      format = args[index + 1];
    } else remaining.push(...args.slice(index, index + 2));
  }
  if (format !== "json" && format !== "yaml")
    throw new Error(message("parseFormat"));
  return mapParseFile(args[0]!, args[1]!, args[2]!, {
    ...copyArguments(remaining),
    format,
  });
}

function serializeJson(output: unknown) {
  const serialized = JSON.stringify(
    output,
    function (key, member: unknown) {
      const original: unknown = (this as Record<string, unknown>)[key];
      if (
        (typeof original === "number" && !Number.isFinite(original)) ||
        (original !== null &&
          typeof original === "object" &&
          !Array.isArray(original) &&
          Object.getPrototypeOf(original) !== Object.prototype &&
          Object.getPrototypeOf(original) !== null)
      )
        throw new Error(message("parseJsonValue"));
      return member;
    },
    2,
  );
  if (serialized === undefined) throw new Error(message("parseJsonValue"));
  return serialized + "\n";
}

/** 本函数序列化 JSON，在写入成功后替换目标文件。 */
export async function writeJson(
  targetFile: string,
  output: unknown,
  packageDirectory?: string,
) {
  await replaceFileContents(
    targetFile,
    serializeJson(output),
    message("targetLink"),
    packageDirectory,
  );
}

/**
 * 本函数用选定的源规则覆盖包内正则配置文件。
 * @param taskFile begin 返回的任务文件。
 * @param sourcePointer 源正则数组的 JSON Pointer。
 * @param targetFile 相对于包目录的正则配置文件路径。
 * @param indices 转换 Agent 选择的源序号，从零开始。
 * @returns 目标文件绝对路径、字段问题及未映射字段的源位置。
 * @throws 源结构、任务文件或目标路径错误，或文件操作失败时抛出异常。
 */
export async function mapRegexFile(
  taskFile: string,
  sourcePointer: string,
  targetFile: string,
  indices: number[],
) {
  const source = (await readSource(taskFile, "")).value;
  const scripts = sourceValueAtPointer(source, sourcePointer);
  if (!Array.isArray(scripts)) throw new Error(message("regexArray"));
  const target = await prepareTarget(taskFile, targetFile, regexWrite.schema);
  if (target.packageRelative.split(sep).join("/") !== taskPaths.regexFile)
    throw new Error(message("targetPath"));
  const existingValue = await readExistingJson(target.targetFile);
  if (
    existingValue !== undefined &&
    (!Array.isArray(existingValue) ||
      !nativeCardRegexProfileSchema.safeParse(existingValue).success)
  )
    throw new Error(message("targetObject"));
  const admitted = validateSourceCard(source);
  if (!admitted.success)
    throw new SourceCardInputError(
      admitted,
      (await readTaskContext(taskFile)).sourceFile,
    );
  const precheck = precheckCard(admitted);
  const retained =
    precheck.regexSourcePointer === sourcePointer
      ? (precheck.regexSourceIndices ?? [])
      : [];
  const selected = selectedIndices(indices, scripts.length);
  const mergedIndices = [...new Set([...retained, ...selected])].sort(
    (left, right) => left - right,
  );
  const result = mapRegex(scripts, mergedIndices, sourcePointer);
  if (
    result.issues.length > 0 ||
    !nativeCardRegexProfileSchema.safeParse(result.rules).success
  )
    return {
      file: target.targetFile,
      issues: result.issues,
      remaining: result.remaining,
      passed: false,
    };

  const characterFile = join(target.root, taskPaths.characterFile);
  const characterValue = await readExistingJson(characterFile);
  const character = nativeCardCharacterSchema.safeParse(characterValue);
  if (!character.success) throw new Error(message("targetObject"));
  const regexProfiles = [...(character.data.regexProfiles ?? [])];
  if (!regexProfiles.includes(taskPaths.regexFile))
    regexProfiles.push(taskPaths.regexFile);
  const updatedCharacter = {
    ...character.data,
    regexProfiles,
  };
  if (!nativeCardCharacterSchema.safeParse(updatedCharacter).success)
    throw new Error(message("targetObject"));
  await writeJson(target.targetFile, result.rules, target.root);
  if (regexProfiles.length !== (character.data.regexProfiles ?? []).length)
    await writeJson(characterFile, updatedCharacter, target.root);
  return {
    file: target.targetFile,
    issues: result.issues,
    remaining: result.remaining,
    passed: true,
  };
}

function sourceValueAtPointer(source: unknown, sourcePointer: string) {
  if (
    (sourcePointer !== "" && !sourcePointer.startsWith("/")) ||
    sourceReadPatterns.invalidEscape.test(sourcePointer)
  )
    throw new Error(message("regexArray"));
  let value = source;
  if (sourcePointer === "") return value;
  for (const rawToken of sourcePointer.slice(1).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      value === null ||
      typeof value !== "object" ||
      (Array.isArray(value) && !sourceReadPatterns.arrayIndex.test(token)) ||
      !Object.hasOwn(value, token)
    )
      throw new Error(message("regexArray"));
    value = (value as ObjectValue)[token];
  }
  return value;
}

/**
 * 本函数执行 map-regex 并返回映射结果。
 * @param commandArguments 依次为任务文件、源位置、目标路径、--indices 和选择序号。
 * @returns 目标路径、字段问题、未映射字段位置及写入状态。
 */
export async function runMapRegex(commandArguments: string[]) {
  if (
    commandArguments.length !== 5 ||
    commandArguments[3] !== writeSelection.indicesFlag
  )
    throw new Error(message("regexArguments"));
  const list = commandArguments[4]!;
  if (list !== "" && !writeSelection.indicesPattern.test(list))
    throw new Error(message("regexIndices"));
  return mapRegexFile(
    commandArguments[0]!,
    commandArguments[1]!,
    commandArguments[2]!,
    list === "" ? [] : list.split(",").map(Number),
  );
}

export async function runMapEntry(commandArguments: string[]) {
  const [taskFile, sourcePointer, targetPath] = commandArguments;
  const isBatch = commandArguments[3] === writeSelection.indicesFlag;
  if (isBatch) {
    const copyContent =
      commandArguments.length === 6 &&
      commandArguments[5] === entryWrite.copyFlag;
    if (
      (commandArguments.length !== 5 && commandArguments.length !== 6) ||
      (commandArguments.length === 6 && !copyContent)
    )
      throw new Error(message("arguments"));
    const list = commandArguments[4]!;
    if (list !== "" && !writeSelection.indicesPattern.test(list))
      throw new Error(message("regexIndices"));
    return mapEntryBatchFile(
      taskFile!,
      sourcePointer!,
      targetPath!,
      list === "" ? [] : list.split(",").map(Number),
      copyContent,
    );
  }
  if (
    !(
      commandArguments.length === 3 ||
      (commandArguments.length === 4 &&
        commandArguments[3] === entryWrite.copyFlag)
    )
  )
    throw new Error(message("arguments"));
  return mapEntryFile(
    taskFile!,
    sourcePointer!,
    targetPath!,
    commandArguments.length === 4,
  );
}

export async function runBindPageMacros(args: string[]) {
  if (args.length !== 2)
    throw new Error(
      "bind-page-macros 需要 taskFile 和 requestFile；请执行 node scripts/convert.mjs bind-page-macros --help 核对绑定格式。",
    );
  return (await import("./page-macro-bindings.ts")).bindPageMacros(
    args[0]!,
    args[1]!,
  );
}
