import { z } from "zod";
import {
  nativeCardPackageSchemas,
  nativeCardPackageManifestSchema,
  nativeCardCharacterSchema,
  nativeCardOpeningsSchema,
  nativeCardWorldbookSchema,
  nativeCardWorldbookEntrySchema,
  nativeCardStateUpdateProfileSchema,
  nativeCardStateUpdateRulesSchema,
  nativeCardControllerConfigSchema,
  nativeCardFrontendManifestSchema,
  nativeCardFileRules,
  type NativeCardPackageFileRecord,
  type NativeCardCharacter,
  type NativeCardOpening,
  type NativeCardOpenings,
  type NativeCardWorldbook,
  type NativeCardWorldbookEntry,
  type NativeCardStateUpdateProfile,
  type NativeCardControllerConfig,
  type NativeCardFrontendManifest,
  type NativeCardCreationTemplate,
  type NativeCardFileRule,
  type NativeCardPackageFile,
  type NativeCardPackageIssue,
  type NativeCardPackage,
  type NativeCardPackageValidation,
  type RuleCondition,
  type PackageFileRule,
  nativeCardPackagePathSchema,
} from "./schemas/native-card-package/schema.js";
export * from "./schemas/native-card-package/schema.js";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseJsonFile(
  files: ReadonlyMap<string, Uint8Array>,
  path: string,
): unknown {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`File ${path} is missing.`);
  return JSON.parse(decodeUtf8(bytes)) as unknown;
}

function matchesPattern(path: string, pattern: string): boolean {
  const escaped = pattern
    .split("/")
    .map((part) =>
      part === "**"
        ? ".+"
        : part
            .split(/(\*|\{[^/{}]+\})/)
            .map((token) =>
              token === "*" || /^\{[^/{}]+\}$/.test(token)
                ? "[^/]+"
                : token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join(""),
    )
    .join("/");
  return new RegExp(`^${escaped}$`).test(path);
}

export function getNativeCardPackageFileRule(
  path: string,
  formatVersion = "1.0.0",
): NativeCardFileRule | undefined {
  if (!nativeCardPackagePathSchema.safeParse(path).success) return undefined;
  const version = nativeCardFileRules.versions[formatVersion];
  if (!version) return undefined;
  return [...version.fixedFiles, ...version.directoryRules].find((rule) =>
    matchesPattern(path, rule.pathPattern),
  );
}

export function getNativeCardCreationTemplate(
  id: string,
): NativeCardCreationTemplate | undefined {
  return nativeCardFileRules.creationTemplates.find(
    (template) => template.id === id,
  );
}

function enabledConditions(
  character: NativeCardCharacter,
  openings: NativeCardOpenings,
  frontend?: string,
): Set<RuleCondition> {
  const enabled = new Set<RuleCondition>(["always"]);
  if (character.worldbooks?.length) enabled.add("worldbooks");
  if (character.stateUpdate) enabled.add("stateUpdate");
  if (character.promptController) enabled.add("promptController");
  if (character.worldbooks?.some((book) => book.enabled))
    enabled.add("worldbooks");
  if (
    character.stateUpdate ||
    openings.items.some((item) => item.initialStateFile)
  )
    enabled.add("state");
  if (frontend) enabled.add("frontend");
  return enabled;
}

function addIssue(
  issues: NativeCardPackageIssue[],
  code: string,
  path: string,
  message: string,
  action: string,
  pointer?: string,
) {
  const text = nativeCardFileRules.issueMessages[code]!;
  issues.push({
    code, path, message: text.message, action: text.action,
    expected: `${message} ${action}`,
    ...(pointer ? { pointer } : {}),
  });
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  parsed: unknown,
  path: string,
  issues: NativeCardPackageIssue[],
): T | undefined {
  const result = schema.safeParse(parsed);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const pointer = `/${issue.path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
    addIssue(
      issues,
      "NATIVE_CARD_FILE_SCHEMA_INVALID",
      path,
      issue.message,
      "Correct this field to match the package schema.",
      pointer,
    );
  }
  return undefined;
}

function schemaForFile(schema: string): z.ZodType<unknown> | undefined {
  if (schema === "json") return z.unknown();
  return nativeCardPackageSchemas[schema.replace(/^native-card-package\//, "")];
}

function acceptsMediaType(rule: PackageFileRule, mediaType: string): boolean {
  return rule.mediaTypes.some(
    (candidate) => candidate === "*/*" || candidate === mediaType,
  );
}

function referenceValues(
  value: unknown,
  segments: string[],
  pointer = "",
): Array<{ value: string; pointer: string }> {
  if (segments.length === 0)
    return typeof value === "string" ? [{ value, pointer }] : [];
  if (!value || typeof value !== "object") return [];
  const [segment, ...rest] = segments;
  const entries =
    segment === "*"
      ? Object.entries(value)
      : ([[segment!, (value as Record<string, unknown>)[segment!]]] as const);
  return entries.flatMap(([key, child]) =>
    referenceValues(
      child,
      rest,
      `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    ),
  );
}

function inferFileRule(
  path: string,
  version: { fixedFiles: PackageFileRule[]; directoryRules: PackageFileRule[] },
): PackageFileRule | undefined {
  return [...version.fixedFiles, ...version.directoryRules].find((rule) =>
    matchesPattern(path, rule.pathPattern),
  );
}

/** Validate one complete package file set. ZIP decoding and CRC checking happen in the API service. */
export function validateNativeCardPackage(
  inputFiles: readonly NativeCardPackageFile[],
): NativeCardPackageValidation {
  const issues: NativeCardPackageIssue[] = [];
  const files = new Map<string, Uint8Array>();
  for (const file of inputFiles) {
    if (!nativeCardPackagePathSchema.safeParse(file.path).success) {
      addIssue(
        issues,
        "NATIVE_CARD_PATH_INVALID",
        file.path,
        "The path is not a safe package-relative path.",
        "Use a relative path with named segments.",
      );
      continue;
    }
    if (files.has(file.path)) {
      addIssue(
        issues,
        "NATIVE_CARD_PATH_DUPLICATE",
        file.path,
        "The package contains this file path more than once.",
        "Keep one file for each exact path.",
      );
      continue;
    }
    files.set(file.path, file.content);
  }

  const manifestValue = (() => {
    try {
      return parseJsonFile(files, "manifest.json");
    } catch (error) {
      addIssue(
        issues,
        "NATIVE_CARD_MANIFEST_INVALID",
        "manifest.json",
        error instanceof Error
          ? error.message
          : "The manifest cannot be read as UTF-8 JSON.",
        "Add a valid manifest.json at the package root.",
      );
      return undefined;
    }
  })();
  const manifest =
    manifestValue === undefined
      ? undefined
      : parseWithSchema(
          nativeCardPackageManifestSchema,
          manifestValue,
          "manifest.json",
          issues,
        );
  if (!manifest) return { valid: false, issues };

  const version = nativeCardFileRules.versions[manifest.formatVersion];
  if (!version) {
    addIssue(
      issues,
      "NATIVE_CARD_FORMAT_VERSION_UNSUPPORTED",
      "manifest.json",
      `Package format version ${manifest.formatVersion} is not supported.`,
      "Export the package using format version 1.0.0.",
      "/formatVersion",
    );
    return { valid: false, issues };
  }
  if (manifest.character !== "character.json")
    addIssue(
      issues,
      "NATIVE_CARD_FIXED_PATH_INVALID",
      "manifest.json",
      "The character entry must be character.json.",
      "Set character to character.json.",
      "/character",
    );
  if (manifest.openings !== "openings.json")
    addIssue(
      issues,
      "NATIVE_CARD_FIXED_PATH_INVALID",
      "manifest.json",
      "The openings entry must be openings.json.",
      "Set openings to openings.json.",
      "/openings",
    );
  if (manifest.frontend && manifest.frontend !== "frontend/manifest.json")
    addIssue(
      issues,
      "NATIVE_CARD_FIXED_PATH_INVALID",
      "manifest.json",
      "The frontend entry must be frontend/manifest.json.",
      "Set frontend to frontend/manifest.json.",
      "/frontend",
    );

  let character: NativeCardCharacter | undefined;
  let openings: NativeCardOpenings | undefined;
  try {
    character = parseWithSchema(
      nativeCardCharacterSchema,
      parseJsonFile(files, manifest.character),
      manifest.character,
      issues,
    );
  } catch (error) {
    addIssue(
      issues,
      "NATIVE_CARD_CHARACTER_INVALID",
      manifest.character,
      error instanceof Error
        ? error.message
        : "The character file cannot be read.",
      "Add a valid character.json.",
    );
  }
  try {
    openings = parseWithSchema(
      nativeCardOpeningsSchema,
      parseJsonFile(files, manifest.openings),
      manifest.openings,
      issues,
    );
  } catch (error) {
    addIssue(
      issues,
      "NATIVE_CARD_OPENINGS_INVALID",
      manifest.openings,
      error instanceof Error
        ? error.message
        : "The openings file cannot be read.",
      "Add a valid openings.json.",
    );
  }
  if (!character || !openings) return { valid: false, issues };

  const enabled = enabledConditions(character, openings, manifest.frontend);
  const parsedJson = new Map<string, unknown>();
  for (const rule of version.fixedFiles) {
    if (enabled.has(rule.condition) && !files.has(rule.pathPattern)) {
      addIssue(
        issues,
        "NATIVE_CARD_FILE_MISSING",
        rule.pathPattern,
        "This enabled package feature requires its fixed configuration file.",
        "Add the required file or remove the feature reference.",
      );
    }
  }
  for (const [path, bytes] of files) {
    const rule = inferFileRule(path, version);
    if (!rule) {
      addIssue(
        issues,
        "NATIVE_CARD_FILE_PATH_UNSUPPORTED",
        path,
        "No package file rule allows this path.",
        "Move the file under a supported package directory or remove it.",
      );
      continue;
    }
    if (!enabled.has(rule.condition))
      addIssue(
        issues,
        "NATIVE_CARD_FILE_FEATURE_DISABLED",
        path,
        `This file requires the ${rule.condition} feature.`,
        rule.condition === "frontend"
          ? "Declare frontend/manifest.json in the root manifest or remove the file."
          : "Enable the feature in character.json or remove the file.",
      );
    const extension = path.slice(path.lastIndexOf("."));
    if (rule.extensions.length && !rule.extensions.includes(extension))
      addIssue(
        issues,
        "NATIVE_CARD_FILE_EXTENSION_INVALID",
        path,
        `The ${rule.pathPattern} rule does not allow ${extension}.`,
        "Use an allowed file extension.",
      );
    if (
      path !== "manifest.json" &&
      !manifest.files.some((record) => record.path === path)
    )
      addIssue(
        issues,
        "NATIVE_CARD_FILE_NOT_REGISTERED",
        path,
        "The file is missing from manifest.files.",
        "Add this file to the package manifest.",
      );
    const record = manifest.files.find((item) => item.path === path);
    if (path !== "manifest.json" && record) {
      if (record.purpose !== rule.purpose)
        addIssue(
          issues,
          "NATIVE_CARD_FILE_PURPOSE_MISMATCH",
          path,
          `The file purpose must be ${rule.purpose}.`,
          "Set manifest.files purpose to match its directory.",
        );
      if (!acceptsMediaType(rule, record.mediaType))
        addIssue(
          issues,
          "NATIVE_CARD_FILE_MEDIA_TYPE_MISMATCH",
          path,
          `The media type ${record.mediaType} does not match this file format.`,
          `Use ${rule.mediaTypes.join(" or ")}.`,
        );
    }
    if (
      rule.schema === "utf8-text" ||
      rule.schema === "javascript-module" ||
      rule.schema === "html" ||
      rule.schema === "css"
    ) {
      try {
        decodeUtf8(bytes);
      } catch {
        addIssue(
          issues,
          "NATIVE_CARD_FILE_ENCODING_INVALID",
          path,
          "The file is not valid UTF-8.",
          "Save the file as UTF-8 text.",
        );
      }
    } else if (rule.schema === "binary") {
      // Binary assets are validated by the file format and size rules.
    } else {
      try {
        const value = JSON.parse(decodeUtf8(bytes)) as unknown;
        parsedJson.set(path, value);
        const schema = schemaForFile(rule.schema);
        if (!schema)
          addIssue(
            issues,
            "NATIVE_CARD_FILE_RULE_SCHEMA_UNKNOWN",
            path,
            `No validator is registered for schema ${rule.schema}.`,
            "Use a supported file rule or register its validator.",
          );
        else {
          parseWithSchema(schema, value, path, issues);
          for (const reference of version.referenceRules.filter(
            (item) => item.schema === rule.schema,
          )) {
            for (const target of referenceValues(value, reference.field)) {
              if (
                !reference.targets.some((pattern) =>
                  matchesPattern(target.value, pattern),
                )
              ) {
                addIssue(
                  issues,
                  "NATIVE_CARD_REFERENCE_SCOPE_INVALID",
                  path,
                  `Referenced file ${target.value} has the wrong directory or file type.`,
                  `Choose a file matching ${reference.targets.join(" or ")}.`,
                  target.pointer,
                );
              } else if (!files.has(target.value)) {
                addIssue(
                  issues,
                  "NATIVE_CARD_REFERENCE_MISSING",
                  path,
                  `Referenced file ${target.value} does not exist.`,
                  "Add the file or update this reference.",
                  target.pointer,
                );
              }
            }
          }
        }
      } catch (error) {
        addIssue(
          issues,
          "NATIVE_CARD_FILE_JSON_INVALID",
          path,
          error instanceof Error
            ? error.message
            : "The JSON file cannot be decoded.",
          "Correct the JSON syntax and save it as UTF-8.",
        );
      }
    }
  }

  const listed = new Map<string, NativeCardPackageFileRecord>();
  for (const record of manifest.files) {
    if (listed.has(record.path))
      addIssue(
        issues,
        "NATIVE_CARD_MANIFEST_PATH_DUPLICATE",
        "manifest.json",
        `manifest.files repeats ${record.path}.`,
        "List each package file once.",
        "/files",
      );
    listed.set(record.path, record);
    if (!files.has(record.path))
      addIssue(
        issues,
        "NATIVE_CARD_FILE_MISSING",
        record.path,
        "manifest.files refers to a file that is not in the package.",
        "Add the referenced file or remove its manifest entry.",
      );
    if (record.path === "manifest.json")
      addIssue(
        issues,
        "NATIVE_CARD_MANIFEST_SELF_REFERENCE",
        "manifest.json",
        "manifest.json must not list itself in files.",
        "Remove this entry from manifest.files.",
      );
  }

  const jsonFile = (path: string): unknown | undefined => {
    try {
      const value = parseJsonFile(files, path);
      parsedJson.set(path, value);
      return value;
    } catch {
      return undefined;
    }
  };
  const worldbooks = new Map<string, NativeCardWorldbook>();
  const worldbookEntryIds = new Map<string, Set<number>>();
  const worldbookIds = new Set<string>();
  const worldbookPaths = new Set<string>();
  for (const [index, binding] of (character.worldbooks ?? []).entries()) {
    if (worldbookIds.has(binding.id))
      addIssue(
        issues,
        "NATIVE_CARD_WORLDBOOK_ID_DUPLICATE",
        manifest.character,
        `Worldbook id ${binding.id} is repeated.`,
        "Give each worldbook a unique id.",
        `/worldbooks/${index}/id`,
      );
    worldbookIds.add(binding.id);
    if (binding.file !== `worldbooks/${binding.id}/book.json`)
      addIssue(
        issues,
        "NATIVE_CARD_WORLDBOOK_PATH_INVALID",
        manifest.character,
        "The worldbook file must use its id directory.",
        `Set file to worldbooks/${binding.id}/book.json.`,
        `/worldbooks/${index}/file`,
      );
    if (worldbookPaths.has(binding.file))
      addIssue(
        issues,
        "NATIVE_CARD_WORLDBOOK_FILE_DUPLICATE",
        manifest.character,
        `Worldbook file ${binding.file} is repeated.`,
        "Give each worldbook a separate file.",
        `/worldbooks/${index}/file`,
      );
    worldbookPaths.add(binding.file);
    const parsedBook = parseWithSchema(
      nativeCardWorldbookSchema,
      jsonFile(binding.file),
      binding.file,
      issues,
    );
    if (!parsedBook) continue;
    worldbooks.set(binding.id, parsedBook);
    const entryIds = new Set<number>();
    worldbookEntryIds.set(binding.id, entryIds);
    for (const [entryIndex, entryPath] of parsedBook.entryFiles.entries()) {
      if (!entryPath.startsWith(`worldbooks/${binding.id}/entries/`))
        addIssue(
          issues,
          "NATIVE_CARD_WORLDBOOK_ENTRY_SCOPE_INVALID",
          binding.file,
          "Every entry file must remain inside its worldbook directory.",
          "Use this book's worldbooks/<bookId>/entries directory.",
          `/entryFiles/${entryIndex}`,
        );
      const entry = parseWithSchema(
        nativeCardWorldbookEntrySchema,
        jsonFile(entryPath),
        entryPath,
        issues,
      );
      if (!entry) continue;
      if (entryIds.has(entry.uid))
        addIssue(
          issues,
          "NATIVE_CARD_WORLDBOOK_UID_DUPLICATE",
          entryPath,
          `Entry uid ${entry.uid} is repeated in this worldbook.`,
          "Give each entry in a worldbook a unique uid.",
          "/uid",
        );
      entryIds.add(entry.uid);
    }
    const referencedEntries = new Set(parsedBook.entryFiles);
    for (const path of files.keys()) {
      if (
        path.startsWith(`worldbooks/${binding.id}/entries/`) &&
        !referencedEntries.has(path)
      )
        addIssue(
          issues,
          "NATIVE_CARD_WORLDBOOK_ENTRY_UNREFERENCED",
          path,
          "This entry file is not listed in its book's entryFiles.",
          "Add the file to entryFiles or remove it.",
        );
    }
  }

  const checkEntryReference = (
    ref: { bookId: string; entryId: number },
    path: string,
    pointer: string,
  ) => {
    const entries = worldbookEntryIds.get(ref.bookId);
    if (!entries)
      addIssue(
        issues,
        "NATIVE_CARD_REFERENCE_WORLDBOOK_MISSING",
        path,
        `Worldbook ${ref.bookId} is not declared.`,
        "Choose a declared worldbook.",
        `${pointer}/bookId`,
      );
    else if (!entries.has(ref.entryId))
      addIssue(
        issues,
        "NATIVE_CARD_REFERENCE_ENTRY_MISSING",
        path,
        `Entry ${ref.entryId} is not in worldbook ${ref.bookId}.`,
        "Choose an entry from the referenced worldbook.",
        `${pointer}/entryId`,
      );
  };

  const openingIds = new Map<string, NativeCardOpening>();
  for (const [index, opening] of openings.items.entries()) {
    if (openingIds.has(opening.id))
      addIssue(
        issues,
        "NATIVE_CARD_OPENING_ID_DUPLICATE",
        manifest.openings,
        `Opening id ${opening.id} is repeated.`,
        "Give each opening a unique id.",
        `/items/${index}/id`,
      );
    openingIds.set(opening.id, opening);
    if (!files.has(opening.textFile))
      addIssue(
        issues,
        "NATIVE_CARD_OPENING_TEXT_MISSING",
        opening.textFile,
        "The opening text file does not exist.",
        "Add the file or update textFile.",
        `/items/${index}/textFile`,
      );
    if (opening.initialStateFile && !files.has(opening.initialStateFile))
      addIssue(
        issues,
        "NATIVE_CARD_INITIAL_STATE_MISSING",
        opening.initialStateFile,
        "The initial state file does not exist.",
        "Add the file or update initialStateFile.",
        `/items/${index}/initialStateFile`,
      );
  }
  for (const [audience, id] of Object.entries(openings.defaultOpeningIds)) {
    const opening = openingIds.get(id!);
    if (!opening)
      addIssue(
        issues,
        "NATIVE_CARD_DEFAULT_OPENING_MISSING",
        manifest.openings,
        `Default ${audience} opening ${id} does not exist.`,
        "Choose an id from items.",
        `/defaultOpeningIds/${audience}`,
      );
    else if (opening.audience !== "both" && opening.audience !== audience)
      addIssue(
        issues,
        "NATIVE_CARD_DEFAULT_OPENING_AUDIENCE_INVALID",
        manifest.openings,
        `Opening ${id} does not support ${audience} sessions.`,
        "Choose an opening with the matching audience.",
        `/defaultOpeningIds/${audience}`,
      );
  }
  for (const opening of openings.items) {
    if (
      opening.audience === "individual" &&
      !openings.defaultOpeningIds.individual
    )
      addIssue(
        issues,
        "NATIVE_CARD_DEFAULT_OPENING_REQUIRED",
        manifest.openings,
        "An individual opening requires a default id.",
        "Choose one individual opening as the default.",
        "/defaultOpeningIds/individual",
      );
    if (opening.audience === "group" && !openings.defaultOpeningIds.group)
      addIssue(
        issues,
        "NATIVE_CARD_DEFAULT_OPENING_REQUIRED",
        manifest.openings,
        "A group opening requires a default id.",
        "Choose one group opening as the default.",
        "/defaultOpeningIds/group",
      );
    if (
      opening.audience === "both" &&
      !openings.defaultOpeningIds.individual &&
      !openings.defaultOpeningIds.group
    )
      addIssue(
        issues,
        "NATIVE_CARD_DEFAULT_OPENING_REQUIRED",
        manifest.openings,
        "A shared opening requires at least one session-type default id.",
        "Choose a default session type for this opening.",
        "/defaultOpeningIds",
      );
  }

  let stateUpdateProfile: NativeCardStateUpdateProfile | undefined;
  if (character.stateUpdate) {
    if (character.stateUpdate !== "agents/state-update/profile.json")
      addIssue(
        issues,
        "NATIVE_CARD_FIXED_PATH_INVALID",
        manifest.character,
        "stateUpdate must point to agents/state-update/profile.json.",
        "Set stateUpdate to agents/state-update/profile.json.",
        "/stateUpdate",
      );
    stateUpdateProfile = parseWithSchema(
      nativeCardStateUpdateProfileSchema,
      jsonFile(character.stateUpdate),
      character.stateUpdate,
      issues,
    );
    if (stateUpdateProfile?.stateSchemaFile !== "state/schema.json")
      addIssue(
        issues,
        "NATIVE_CARD_FIXED_PATH_INVALID",
        character.stateUpdate,
        "stateSchemaFile must point to state/schema.json.",
        "Set stateSchemaFile to state/schema.json.",
        "/stateSchemaFile",
      );
    if (stateUpdateProfile) {
      const refs = [
        ...(stateUpdateProfile.ruleFiles ?? []),
        ...(stateUpdateProfile.moduleFiles ?? []),
        ...[
          stateUpdateProfile.deriveScript,
          stateUpdateProfile.validateScript,
        ].filter((path): path is string => !!path),
      ];
      for (const path of refs)
        if (!files.has(path))
          addIssue(
            issues,
            "NATIVE_CARD_REFERENCE_MISSING",
            character.stateUpdate,
            `Referenced file ${path} does not exist.`,
            "Add the file or update its reference.",
          );
      for (const rulePath of stateUpdateProfile.ruleFiles ?? []) {
        if (rulePath.endsWith(".json")) {
          const rules = nativeCardStateUpdateRulesSchema.safeParse(
            jsonFile(rulePath),
          );
          if (rules.success)
            for (const [ruleIndex, rule] of rules.data.rules.entries()) {
              for (const [refIndex, ref] of (
                rule.sourceEntries ?? []
              ).entries())
                checkEntryReference(
                  ref,
                  rulePath,
                  `/rules/${ruleIndex}/sourceEntries/${refIndex}`,
                );
            }
        }
        if (!rulePath.startsWith("agents/state-update/"))
          addIssue(
            issues,
            "NATIVE_CARD_REFERENCE_SCOPE_INVALID",
            character.stateUpdate,
            "Rule files must remain under agents/state-update/.",
            "Move the rule file into agents/state-update/.",
          );
      }
    }
  }

  let controllerConfig: NativeCardControllerConfig | undefined;
  if (character.promptController) {
    if (character.promptController !== "backend/controllers/config.json")
      addIssue(
        issues,
        "NATIVE_CARD_FIXED_PATH_INVALID",
        manifest.character,
        "promptController must point to backend/controllers/config.json.",
        "Set promptController to backend/controllers/config.json.",
        "/promptController",
      );
    controllerConfig = parseWithSchema(
      nativeCardControllerConfigSchema,
      jsonFile(character.promptController),
      character.promptController,
      issues,
    );
    if (controllerConfig && !files.has(controllerConfig.modulePath))
      addIssue(
        issues,
        "NATIVE_CARD_REFERENCE_MISSING",
        character.promptController,
        `Controller module ${controllerConfig.modulePath} does not exist.`,
        "Add the module or update modulePath.",
        "/modulePath",
      );
    for (const [key, refs] of Object.entries({
      controllerEntries: controllerConfig?.controllerEntries ?? [],
      updaterEntries: controllerConfig?.updaterEntries ?? [],
    })) {
      for (const [index, ref] of refs.entries()) {
        checkEntryReference(
          ref,
          character.promptController,
          `/${key}/${index}`,
        );
      }
    }
  }

  let frontendManifest: NativeCardFrontendManifest | undefined;
  if (manifest.frontend) {
    frontendManifest = parseWithSchema(
      nativeCardFrontendManifestSchema,
      jsonFile(manifest.frontend),
      manifest.frontend,
      issues,
    );
    if (!frontendManifest) return { valid: issues.length === 0, issues };
    const frontendPaths = [
      frontendManifest.html,
      frontendManifest.css,
      frontendManifest.script,
      ...(frontendManifest.floorHtml ? [frontendManifest.floorHtml] : []),
      ...Object.values(frontendManifest.assets).map((asset) => asset.file),
    ];
    for (const path of frontendPaths)
      if (!files.has(path))
        addIssue(
          issues,
          "NATIVE_CARD_REFERENCE_MISSING",
          manifest.frontend,
          `Frontend file ${path} does not exist.`,
          "Add the file or update its reference.",
        );
    for (const path of frontendPaths)
      if (!path.startsWith("frontend/") && !path.startsWith("assets/"))
        addIssue(
          issues,
          "NATIVE_CARD_REFERENCE_SCOPE_INVALID",
          manifest.frontend,
          `Frontend file ${path} must be under frontend/ or assets/.`,
          "Move the file to a supported frontend or assets directory.",
        );
  }

  for (const path of character.regexProfiles ?? []) {
    if (!path.startsWith("regex/"))
      addIssue(
        issues,
        "NATIVE_CARD_REFERENCE_SCOPE_INVALID",
        manifest.character,
        "Regex profiles must be under regex/.",
        "Move the profile to regex/.",
        "/regexProfiles",
      );
    if (!files.has(path))
      addIssue(
        issues,
        "NATIVE_CARD_REFERENCE_MISSING",
        manifest.character,
        `Regex profile ${path} does not exist.`,
        "Add the file or remove this reference.",
        "/regexProfiles",
      );
  }

  const fileRecords = manifest.files.flatMap((record) => {
    const bytes = files.get(record.path);
    return bytes ? [{ ...record, byteSize: bytes.byteLength }] : [];
  });
  if (issues.length) return { valid: false, issues };
  return {
    valid: true,
    issues,
    package: {
      manifest,
      character,
      openings,
      files,
      parsedJson,
      worldbooks,
      stateUpdateProfile,
      controllerConfig,
      frontendManifest,
      fileRecords,
    },
  };
}

export class NativeCardPackageValidationError extends Error {
  constructor(readonly issues: NativeCardPackageIssue[]) {
    super("The native role package does not satisfy format version 1.0.0.");
    this.name = "NativeCardPackageValidationError";
  }
}

export function parseNativeCardPackage(
  files: readonly NativeCardPackageFile[],
): NativeCardPackage {
  const result = validateNativeCardPackage(files);
  if (!result.valid || !result.package)
    throw new NativeCardPackageValidationError(result.issues);
  return result.package;
}
