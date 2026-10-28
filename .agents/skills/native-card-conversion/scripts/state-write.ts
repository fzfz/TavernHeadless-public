import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { getNativeCardCreationTemplate } from "../../../../packages/shared/src/native-card-package.ts";
import {
  nativeCardCharacterSchema,
  nativeCardOpeningsSchema,
  nativeCardStateUpdateProfileSchema,
} from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import {
  createNativeCardStateSchemaCompiler,
  type NativeCardStateDiagnostic,
} from "../../../../apps/api/src/services/native-card/state-schema-validator.ts";
import { buildRestrictedOutputSchema } from "../../../../apps/api/src/services/role-runtime/state-contract.ts";
import { replaceFileContents } from "./atomic-write.ts";
import { withDerivedTask } from "./task-derivation.ts";
type FileReplacement = {
  file: string;
  contents: string;
  packageDirectory?: string;
};
import { prepareTarget } from "./package-target.ts";
import { isPathContained, readTaskContext } from "./task-context.ts";
import { readSource } from "./source.ts";
import { taskPaths } from "./source-config.ts";
import config from "./state-write-config.json" with { type: "json" };
import requestSchema from "./state-request.schema.json" with { type: "json" };
import sourceConfig from "./state-source-config.json" with { type: "json" };
type Obj = Record<string, unknown>;
type Permission = { field: string; write: boolean };
type Coverage = {
  sourcePointer: string;
  symbol: string;
  mappings: Array<{ source: string; target?: string; reason?: string }>;
  decisions: Array<{ id: string; reason: string }>;
};
type Request = {
  schema?: Obj;
  coverage?: Coverage;
  initialStates?: Array<{ openingId: string; value: unknown }>;
  permissions?: Permission[];
  profile?: Obj;
  value?: unknown;
  sourcePointer?: string;
  symbol?: string;
};
type Inventory = {
  sourcePointer: string;
  symbol: string;
  fields: Array<{ pointer: string }>;
  unresolved: Array<{ id: string }>;
};
export type StateField = {
  field: string;
  types: string[];
  parent: string;
  schemaPath: string;
  leaf: boolean;
};
const schemaTemplate = getNativeCardCreationTemplate("stateSchema")!;
const initialTemplate = getNativeCardCreationTemplate("openingInitialState")!;
const profileTemplate = getNativeCardCreationTemplate("stateUpdateProfile")!;
const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const initialPattern = new RegExp(
  "^" +
    initialTemplate.pathTemplate
      .split("{openingId}")
      .map(escapePattern)
      .join("([^/]+)") +
    "$",
);
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const escapePointer = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const initialPath = (id: string) =>
  initialTemplate.pathTemplate.replace("{openingId}", id);
const requests = new Map(
  Object.keys(requestSchema.$defs)
    .filter((key) => key.startsWith("state-"))
    .map((key) => [
      key,
      new Ajv2020({ allErrors: true, strict: false }).compile({
        ...requestSchema,
        $ref: "#/$defs/" + key,
      }),
    ]),
);
export class StateWriteError extends Error {
  readonly diagnostic;
  constructor(issues: NativeCardStateDiagnostic[], requestFile?: string) {
    super(config.messages.invalid);
    this.name = "StateWriteError";
    this.diagnostic = {
      issues,
      action: config.messages.invalid,
      ...(requestFile ? { requestFile } : {}),
    };
  }
}
function issue(
  file: string,
  keyword: string,
  message: string,
  pointer = "",
  expected: Obj = {},
  schemaPath = "",
): NativeCardStateDiagnostic {
  return { file, pointer, schemaPath, keyword, expected, message };
}
function reject(
  file: string,
  key: keyof typeof config.messages,
  pointer = "",
  expected: Obj = {},
  schemaPath = "",
): never {
  throw new StateWriteError([
    issue(file, key, config.messages[key], pointer, expected, schemaPath),
  ]);
}
function checkRequest(command: string, value: unknown, file: string): Request {
  const validate = requests.get(command)!;
  if (!validate(value))
    throw new StateWriteError(
      (validate.errors ?? []).map((error) =>
        issue(
          file,
          error.keyword,
          config.messages.request,
          error.instancePath,
          error.params,
          error.schemaPath,
        ),
      ),
    );
  return value as Request;
}
async function readJson(file: string): Promise<unknown> {
  if (!(await lstat(file)).isFile()) reject(file, "link");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) reject(file, "json");
    throw error;
  } finally {
    await handle.close();
  }
}
async function optionalJson(file: string) {
  try {
    return await readJson(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function serialize(value: unknown, file: string) {
  const text = JSON.stringify(
    value,
    function (key, member: unknown) {
      const original: unknown = (this as Obj)[key];
      if (typeof original === "number" && !Number.isFinite(original))
        reject(file, "json");
      if (
        original !== null &&
        typeof original === "object" &&
        !Array.isArray(original) &&
        Object.getPrototypeOf(original) !== Object.prototype &&
        Object.getPrototypeOf(original) !== null
      )
        reject(file, "json");
      return member;
    },
    2,
  );
  if (text === undefined) reject(file, "json");
  return text + "\n";
}
function candidate(value: unknown, file: string): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      reject(file, "json");
    }
  }
  return JSON.parse(serialize(value, file));
}
function checkNative<T>(
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: {
            issues: Array<{
              path: PropertyKey[];
              code: string;
              message: string;
            }>;
          };
        };
  },
  value: unknown,
  file: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new StateWriteError(
      parsed.error.issues.map((error) =>
        issue(
          file,
          error.code,
          config.messages.profile,
          error.path.length
            ? "/" + error.path.map(String).map(escapePointer).join("/")
            : "",
          { detail: error.message },
        ),
      ),
    );
  return parsed.data;
}
export function isStateFile(path: string) {
  return (
    path === schemaTemplate.pathTemplate ||
    path === profileTemplate.pathTemplate ||
    initialPattern.test(path)
  );
}
export function enumerateStateFields(
  schema: unknown,
  file: string,
): StateField[] {
  const fields: StateField[] = [];
  const structural = (member: unknown): boolean =>
    object(member) &&
    (Object.hasOwn(member, "properties") ||
      Object.hasOwn(member, "patternProperties") ||
      Object.hasOwn(member, "$ref") ||
      Object.values(member).some((value) =>
        Array.isArray(value)
          ? value.some(structural)
          : object(value) && structural(value),
      ));
  const walk = (
    node: unknown,
    field: string,
    parent: string,
    schemaPath: string,
  ) => {
    if (!object(node)) reject(file, "field", field, {}, schemaPath);
    const types =
      typeof node.type === "string"
        ? [node.type]
        : Array.isArray(node.type)
          ? (node.type as string[])
          : object(node.properties)
            ? ["object"]
            : undefined;
    if (!types || node.$ref || node.$dynamicRef)
      reject(file, "field", field, {}, schemaPath);
    const isObject = types.includes("object");
    if (isObject && types.some((type) => type !== "object" && type !== "null"))
      reject(file, "field", field, {}, schemaPath);
    if (isObject) {
      if (
        !object(node.properties) ||
        node.patternProperties ||
        (node.additionalProperties !== undefined &&
          node.additionalProperties !== false)
      )
        reject(file, "field", field, {}, schemaPath);
      for (const key of [
        "allOf",
        "anyOf",
        "oneOf",
        "if",
        "then",
        "else",
        "dependentSchemas",
      ])
        if (
          Array.isArray(node[key])
            ? (node[key] as unknown[]).some(structural)
            : structural(node[key])
        )
          reject(file, "field", field, {}, schemaPath + "/" + key);
    }
    const children = isObject ? Object.entries(node.properties as Obj) : [];
    if (field)
      fields.push({
        field,
        types,
        parent,
        schemaPath,
        leaf: children.length === 0,
      });
    for (const [key, child] of children)
      walk(
        child,
        field + "/" + escapePointer(key),
        field,
        schemaPath + "/properties/" + escapePointer(key),
      );
  };
  walk(schema, "", "", "#");
  return fields;
}
function normalizePermissions(input: Permission[], schema: Obj, file: string) {
  if (!input.length) return { permissions: [], writablePaths: [] as string[] };
  const fields = enumerateStateFields(schema, file),
    references = new Set(fields.map((field) => field.field)),
    selected = new Map<string, boolean>();
  for (const choice of input) {
    if (!references.has(choice.field)) reject(file, "permission", choice.field);
    if (
      selected.has(choice.field) &&
      selected.get(choice.field) !== choice.write
    )
      reject(file, "duplicate", choice.field);
    selected.set(choice.field, choice.write);
  }
  const permissions = [...selected]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, write]) => ({ field, write }));
  const writablePaths = fields
    .filter((field) => field.leaf)
    .filter((field) => {
      let chosen: Permission | undefined;
      for (const choice of permissions)
        if (
          (field.field === choice.field ||
            field.field.startsWith(choice.field + "/")) &&
          (!chosen || choice.field.length > chosen.field.length)
        )
          chosen = choice;
      return chosen?.write;
    })
    .map((field) => field.field)
    .sort();
  return { permissions, writablePaths: [...new Set(writablePaths)] };
}
async function sourceInventory(
  taskFile: string,
  sourcePointer: string,
  symbol: string,
): Promise<Inventory> {
  const source = (await readSource(taskFile, sourcePointer)).value;
  if (typeof source !== "string") reject(taskFile, "sourceText", sourcePointer);
  const { extractSourceStateFields } = await import("./state-source.ts");
  const inventory = extractSourceStateFields(source, symbol);
  if (
    inventory.unresolved.some((item) =>
      [
        sourceConfig.diagnostics.missingSymbol,
        sourceConfig.diagnostics.ambiguousSymbol,
        sourceConfig.diagnostics.uninitializedSymbol,
      ].includes(item.kind),
    )
  )
    reject(taskFile, "symbol", "", {
      sourcePointer,
      symbol,
      unresolved: inventory.unresolved,
    });
  return { sourcePointer, symbol, ...inventory };
}
function validateCoverage(
  coverage: Coverage | undefined,
  inventory: Inventory,
  schema: Obj,
  file: string,
) {
  if (!coverage)
    reject(file, "coverage", "", {
      sourcePointer: inventory.sourcePointer,
      symbol: inventory.symbol,
    });
  if (
    coverage.sourcePointer !== inventory.sourcePointer ||
    coverage.symbol !== inventory.symbol
  )
    reject(file, "source");
  const mappings = new Map<string, Coverage["mappings"][number]>(),
    targets = new Set(
      enumerateStateFields(schema, file).map((field) => field.field),
    ),
    sources = new Set(inventory.fields.map((field) => field.pointer));
  for (const mapping of coverage.mappings) {
    if (!sources.has(mapping.source) || mappings.has(mapping.source))
      reject(file, "coverage", mapping.source);
    if (mapping.target && !targets.has(mapping.target))
      reject(file, "coverage", mapping.target, { source: mapping.source });
    mappings.set(mapping.source, mapping);
  }
  const missing = inventory.fields
      .filter((field) => !mappings.has(field.pointer))
      .map((field) => field.pointer),
    decisions = new Map<string, string>(),
    unresolved = new Set(inventory.unresolved.map((item) => item.id));
  for (const decision of coverage.decisions) {
    if (!unresolved.has(decision.id) || decisions.has(decision.id))
      reject(file, "coverage", "", { id: decision.id });
    decisions.set(decision.id, decision.reason);
  }
  const undecided = inventory.unresolved
    .filter((item) => !decisions.has(item.id))
    .map((item) => item.id);
  if (missing.length || undecided.length)
    reject(file, "coverage", "", { missing, undecided });
}
async function commit(entries: FileReplacement[]) {
  for (const entry of entries)
    await replaceFileContents(
      entry.file,
      entry.contents,
      config.messages.link,
      entry.packageDirectory,
    );
}

async function submit(
  taskFile: string,
  request: Request,
  requestFile: string,
  directInitial?: { path: string; value: unknown },
  replaceProfile = false,
) {
  const parent = await readTaskContext(taskFile);
  return withDerivedTask(
    taskFile,
    async ({ taskFile: derivedTaskFile, task }) => {
      try {
        return await submitToTask(
          derivedTaskFile,
          request,
          requestFile,
          directInitial,
          replaceProfile,
        );
      } catch (error) {
        if (!(error instanceof StateWriteError)) throw error;
        throw new StateWriteError(
          error.diagnostic.issues.map((item) => ({
            ...item,
            file: isPathContained(task.outputDirectory, item.file)
              ? join(
                  parent.outputDirectory,
                  relative(task.outputDirectory, item.file),
                )
              : item.file,
          })),
          requestFile,
        );
      }
    },
  );
}
async function submitToTask(
  taskFile: string,
  request: Request,
  requestFile: string,
  directInitial?: { path: string; value: unknown },
  replaceProfile = false,
) {
  const task = await readTaskContext(taskFile),
    root = task.packageDirectory,
    schemaFile = join(root, schemaTemplate.pathTemplate),
    profileFile = join(root, profileTemplate.pathTemplate);
  await prepareTarget(taskFile, schemaTemplate.pathTemplate);
  await prepareTarget(taskFile, profileTemplate.pathTemplate);
  const schema = request.schema
    ? {
        ...(schemaTemplate.content as Obj),
        ...request.schema,
        type: "object",
        $schema: (schemaTemplate.content as Obj).$schema,
      }
    : await optionalJson(schemaFile);
  if (!schema) reject(schemaFile, "missingSchema");
  if (!object(schema) || schema.type !== "object") reject(schemaFile, "root");
  const compile = createNativeCardStateSchemaCompiler(),
    compiled = compile(schema, schemaFile);
  if (!compiled.ok) throw new StateWriteError(compiled.issues);
  const permissionsFile = join(task.outputDirectory, config.files.permissions),
    coverageFile = join(task.outputDirectory, config.files.coverage),
    inventoryFile = join(task.outputDirectory, config.files.source);
  const savedPermissionValue =
    request.permissions === undefined
      ? await optionalJson(permissionsFile)
      : undefined;
  const savedPermissions =
    savedPermissionValue === undefined
      ? undefined
      : checkRequest(
          "state-permissions",
          savedPermissionValue,
          permissionsFile,
        );
  const { permissions, writablePaths } = normalizePermissions(
    request.permissions ?? savedPermissions?.permissions ?? [],
    schema,
    schemaFile,
  );
  let inventory = (await optionalJson(inventoryFile)) as Inventory | undefined;
  const coverage =
    request.coverage ??
    ((await optionalJson(coverageFile)) as Coverage | undefined);
  if (coverage && !inventory) {
    checkRequest("state-schema", { schema, coverage }, coverageFile);
    inventory = await sourceInventory(
      taskFile,
      coverage.sourcePointer,
      coverage.symbol,
    );
  }
  if (inventory) {
    checkRequest(
      "state-source",
      { sourcePointer: inventory.sourcePointer, symbol: inventory.symbol },
      inventoryFile,
    );
    inventory = await sourceInventory(
      taskFile,
      inventory.sourcePointer,
      inventory.symbol,
    );
    if (coverage)
      checkRequest("state-schema", { schema, coverage }, coverageFile);
    validateCoverage(coverage, inventory, schema, schemaFile);
  }
  const existingProfile = replaceProfile
    ? undefined
    : await optionalJson(profileFile);
  const profile = checkNative(
    nativeCardStateUpdateProfileSchema,
    {
      ...(profileTemplate.content as Obj),
      ...(object(existingProfile) ? existingProfile : {}),
      ...request.profile,
      writablePaths,
      stateSchemaFile: schemaTemplate.pathTemplate,
    },
    profileFile,
  );
  if (profile.factsSchema) {
    const facts = compile(profile.factsSchema, profileFile);
    if (!facts.ok) throw new StateWriteError(facts.issues);
  }
  const output = compile(
    buildRestrictedOutputSchema({ ...profile, stateSchema: schema }),
    profileFile,
  );
  if (!output.ok) throw new StateWriteError(output.issues);
  const openingsFile = join(root, taskPaths.openingsFile),
    characterFile = join(root, taskPaths.characterFile);
  const openings = checkNative(
      nativeCardOpeningsSchema,
      await readJson(openingsFile),
      openingsFile,
    ),
    character = checkNative(
      nativeCardCharacterSchema,
      {
        ...((await readJson(characterFile)) as Obj),
        stateUpdate: profileTemplate.pathTemplate,
      },
      characterFile,
    );
  const candidates = new Map<string, unknown>(),
    initialByOpening = new Map<string, unknown>();
  for (const member of request.initialStates ?? []) {
    if (initialByOpening.has(member.openingId))
      reject(requestFile, "duplicate", "", { openingId: member.openingId });
    if (!openings.items.some((opening) => opening.id === member.openingId))
      reject(openingsFile, "opening", "", { openingId: member.openingId });
    const value = JSON.parse(serialize(member.value, requestFile));
    initialByOpening.set(member.openingId, value);
    candidates.set(initialPath(member.openingId), value);
  }
  if (directInitial) candidates.set(directInitial.path, directInitial.value);
  const initialDirectory = dirname(join(root, initialTemplate.pathTemplate));
  try {
    if (
      !(await lstat(initialDirectory)).isDirectory() ||
      (await lstat(initialDirectory)).isSymbolicLink()
    )
      reject(initialDirectory, "link");
    for (const name of await readdir(initialDirectory)) {
      const path = initialTemplate.pathTemplate.split("{openingId}")[0] + name;
      if (initialPattern.test(path) && !candidates.has(path))
        candidates.set(path, await readJson(join(root, path)));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const opening of openings.items) {
    if (
      initialByOpening.has(opening.id) ||
      directInitial?.path === initialPath(opening.id)
    )
      opening.initialStateFile = initialPath(opening.id);
    if (opening.initialStateFile && !candidates.has(opening.initialStateFile))
      candidates.set(
        opening.initialStateFile,
        await readJson(
          (await prepareTarget(taskFile, opening.initialStateFile)).targetFile,
        ),
      );
  }
  const issues = [...candidates].flatMap(([path, value]) =>
    compiled.validate(
      JSON.parse(serialize(value, join(root, path))),
      join(root, path),
    ),
  );
  if (issues.length) throw new StateWriteError(issues);
  const outputs = new Map<string, unknown>([
    [schemaTemplate.pathTemplate, schema],
    [profileTemplate.pathTemplate, profile],
    [taskPaths.characterFile, character],
    [taskPaths.openingsFile, openings],
  ]);
  for (const [openingId, value] of initialByOpening)
    outputs.set(initialPath(openingId), value);
  if (directInitial) outputs.set(directInitial.path, directInitial.value);
  const entries: FileReplacement[] = [];
  for (const [path, value] of outputs) {
    const target = await prepareTarget(taskFile, path);
    entries.push({
      file: target.targetFile,
      contents: serialize(value, target.targetFile),
      packageDirectory: target.root,
    });
  }
  entries.push({
    file: permissionsFile,
    contents: serialize({ permissions }, permissionsFile),
  });
  if (coverage)
    entries.push({
      file: coverageFile,
      contents: serialize(coverage, coverageFile),
    });
  if (inventory && coverage)
    entries.push({
      file: inventoryFile,
      contents: serialize(inventory, inventoryFile),
    });
  await commit(entries);
  return {
    schemaFile,
    profileFile,
    permissionsFile,
    writablePaths,
    files: entries.map((entry) => entry.file),
  };
}
export async function writeStateCandidate(
  taskFile: string,
  path: string,
  value: unknown,
) {
  if (!isStateFile(path)) return undefined;
  const target = await prepareTarget(taskFile, path),
    valueCandidate = candidate(value, target.targetFile);
  let result: Awaited<ReturnType<typeof submit>>;
  if (path === schemaTemplate.pathTemplate)
    result = await submit(
      taskFile,
      checkRequest(
        "state-schema",
        { schema: valueCandidate },
        target.targetFile,
      ),
      target.targetFile,
    );
  else if (path === profileTemplate.pathTemplate) {
    if (!object(valueCandidate)) reject(target.targetFile, "profile");
    const request = checkRequest(
      "state-permissions",
      {
        permissions:
          (
            (await optionalJson(
              join(
                (await readTaskContext(taskFile)).outputDirectory,
                config.files.permissions,
              ),
            )) as { permissions: Permission[] } | undefined
          )?.permissions ?? [],
        profile: Object.fromEntries(
          Object.entries(valueCandidate).filter(
            ([key]) => key !== "writablePaths" && key !== "stateSchemaFile",
          ),
        ),
      },
      target.targetFile,
    );
    result = await submit(
      taskFile,
      request,
      target.targetFile,
      undefined,
      true,
    );
  } else
    result = await submit(taskFile, {}, target.targetFile, {
      path,
      value: valueCandidate,
    });
  return { ...result, file: join(result.packageDirectory, path) };
}
export async function runStateCommand(command: string, args: string[]) {
  const taskFile = args[0]!;
  await readTaskContext(taskFile);
  if (command === "state-fields") {
    const schemaFile = (
        await prepareTarget(taskFile, schemaTemplate.pathTemplate)
      ).targetFile,
      schema = await readJson(schemaFile),
      compiled = createNativeCardStateSchemaCompiler()(schema, schemaFile);
    if (!compiled.ok) throw new StateWriteError(compiled.issues);
    return { schemaFile, fields: enumerateStateFields(schema, schemaFile) };
  }
  if (command === "state-paths") return submit(taskFile, {}, taskFile);
  const requestFile = args[command === "state-initial" ? 2 : 1]!,
    request = checkRequest(command, await readJson(requestFile), requestFile);
  if (command === "state-source") {
    const inventory = await sourceInventory(
      taskFile,
      request.sourcePointer!,
      request.symbol!,
    );
    return withDerivedTask(taskFile, async ({ task: derivedTask }) => {
      const file = join(derivedTask.outputDirectory, config.files.source);
      await commit([{ file, contents: serialize(inventory, file) }]);
      return { file, ...inventory };
    });
  }
  if (command === "state-initial")
    return submit(
      taskFile,
      { initialStates: [{ openingId: args[1]!, value: request.value }] },
      requestFile,
    );
  return submit(taskFile, request, requestFile);
}
