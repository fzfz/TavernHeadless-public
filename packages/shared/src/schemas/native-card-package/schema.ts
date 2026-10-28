import type { NativeCardIssue } from "../native-card-api.js";
import nativeCardFileRulesConfig from "../../config/native-card-file-rules.json" with { type: "json" };
import { z } from "zod";
import { roleAssetPurposeSchema } from "../role-assets.js";
import { roleStatePresetRefSchema } from "../role-state.js";

const nonEmpty = z.string().trim().min(1);
const packagePath = z
  .string()
  .min(1)
  .regex(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\:\u0000])[^/]+(?:\/[^/]+)*$/);

export const nativeCardPackagePathSchema = packagePath;

export const nativeCardPackageFileRecordSchema = z
  .object({
    path: packagePath,
    mediaType: nonEmpty,
    purpose: roleAssetPurposeSchema,
  })
  .strict();

export const nativeCardPackageManifestSchema = z
  .object({
    format: z.literal("tavern_headless_role_package"),
    formatVersion: z.literal("1.0.0"),
    packageId: nonEmpty,
    character: packagePath,
    openings: packagePath,
    frontend: packagePath.optional(),
    files: z.array(nativeCardPackageFileRecordSchema),
  })
  .strict();

const entryRefSchema = z
  .object({
    bookId: nonEmpty,
    entryId: z.number().int().nonnegative(),
  })
  .strict();

export const nativeCardWorldbookBindingSchema = z
  .object({
    id: nonEmpty,
    file: packagePath,
    enabled: z.boolean(),
  })
  .strict();

export const nativeCardCharacterSchema = z
  .object({
    name: nonEmpty,
    description: z.string().optional(),
    personality: z.string().optional(),
    scenario: z.string().optional(),
    exampleDialogue: z.string().optional(),
    systemPrompt: z.string().optional(),
    postHistoryInstructions: z.string().optional(),
    creatorNotes: z.string().optional(),
    creator: z.string().optional(),
    characterVersion: z.string().optional(),
    tags: z.array(z.string()).optional(),
    nickname: z.string().optional(),
    source: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    worldbooks: z.array(nativeCardWorldbookBindingSchema).optional(),
    stateUpdate: packagePath.optional(),
    promptController: packagePath.optional(),
    regexProfiles: z.array(packagePath).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const nativeCardOpeningSchema = z
  .object({
    id: nonEmpty,
    title: z.string(),
    summary: z.string(),
    kind: z.enum(["story", "introduction"]),
    audience: z.enum(["individual", "group", "both"]),
    textFile: packagePath,
    initialStateFile: packagePath.optional(),
  })
  .strict();

export const nativeCardOpeningsSchema = z
  .object({
    defaultOpeningIds: z
      .object({
        individual: nonEmpty.optional(),
        group: nonEmpty.optional(),
      })
      .strict(),
    items: z.array(nativeCardOpeningSchema),
  })
  .strict();

export const nativeCardWorldbookSchema = z
  .object({
    name: nonEmpty,
    entryFiles: z.array(packagePath),
    scanDepth: z.number().int().nonnegative(),
    caseSensitive: z.boolean(),
    matchWholeWords: z.boolean(),
    recursive: z.boolean(),
    maxRecursionSteps: z.number().int().nonnegative(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const nativeCardWorldbookEntrySchema = z
  .object({
    uid: z.number().int().nonnegative(),
    key: z.array(z.string()),
    keysecondary: z.array(z.string()),
    selective: z.boolean(),
    selectiveLogic: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    constant: z.boolean(),
    content: z.string(),
    comment: z.string(),
    position: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
    order: z.number().int(),
    depth: z.number().int().nonnegative(),
    role: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    disable: z.boolean(),
    scanDepth: z.number().int().nonnegative().nullable(),
    caseSensitive: z.boolean().nullable(),
    matchWholeWords: z.boolean().nullable(),
    excludeRecursion: z.boolean().optional(),
    preventRecursion: z.boolean().optional(),
    delayUntilRecursion: z.number().int().nonnegative().nullable().optional(),
    outletName: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const nativeCardInitialStateSchema = z.record(z.string(), z.unknown());

export const nativeCardStateSchemaDocumentSchema = z
  .object({
    $schema: z
      .literal("https://json-schema.org/draft/2020-12/schema")
      .optional(),
    $id: z.string().optional(),
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z
      .union([z.boolean(), z.record(z.string(), z.unknown())])
      .optional(),
  })
  .passthrough();

export const nativeCardEntryReferenceSchema = entryRefSchema;
export const nativeCardStateUpdateRuleSchema = z
  .object({
    id: nonEmpty,
    instruction: nonEmpty,
    sourceEntries: z.array(entryRefSchema).optional(),
  })
  .strict();
export const nativeCardStateUpdateRulesSchema = z
  .object({
    rules: z.array(nativeCardStateUpdateRuleSchema),
  })
  .strict();

export const nativeCardStateUpdateProfileSchema = z
  .object({
    updaterPrompt: z.string(),
    presetRef: roleStatePresetRefSchema.optional(),
    writablePaths: z.array(z.string().startsWith("/")),
    derivedPaths: z.array(z.string().startsWith("/")).optional(),
    controllerOwnedPaths: z.array(z.string().startsWith("/")).optional(),
    initialDescriptionPaths: z.array(z.string().startsWith("/")).optional(),
    stateSchemaFile: packagePath.optional(),
    ruleFiles: z.array(packagePath).optional(),
    deriveScript: packagePath.optional(),
    validateScript: packagePath.optional(),
    moduleFiles: z.array(packagePath).optional(),
    factsSchema: z.record(z.string(), z.unknown()).optional(),
    maxTokens: z.number().int().positive().optional(),
    updaterReasoning: z
      .object({ effort: z.enum(["none", "low", "medium", "high"]) })
      .passthrough()
      .optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const nativeCardControllerConfigSchema = z
  .object({
    modulePath: packagePath,
    variableRoot: nonEmpty,
    variableMacros: z.array(
      z.object({ source: nonEmpty, target: z.string() }).strict(),
    ),
    controllerEntries: z.array(entryRefSchema),
    updaterEntries: z.array(entryRefSchema),
  })
  .strict();

const frontendAssetSchema = z
  .object({
    kind: z.enum(["image", "audio"]),
    file: packagePath,
    label: z.string(),
    tags: z.array(z.string()),
  })
  .strict();

export const nativeCardFrontendManifestSchema = z
  .object({
    apiVersion: z.literal(1),
    html: packagePath,
    css: packagePath,
    script: packagePath,
    floorHtml: packagePath.optional(),
    assets: z.record(z.string(), frontendAssetSchema),
    data: z.record(z.string(), packagePath),
  })
  .strict();

export const nativeCardRegexRuleSchema = z
  .object({
    id: nonEmpty,
    scriptName: z.string(),
    findRegex: z.string(),
    replaceString: z.string(),
    trimStrings: z.array(z.string()),
    placement: z.array(z.number().int()),
    disabled: z.boolean(),
    markdownOnly: z.boolean(),
    promptOnly: z.boolean(),
    runOnEdit: z.boolean(),
    substituteRegex: z.number().int(),
    minDepth: z.number().int().nullable().optional(),
    maxDepth: z.number().int().nullable().optional(),
  })
  .passthrough();
export const nativeCardRegexProfileSchema = z.array(nativeCardRegexRuleSchema);

const nativeCardRuleConditionSchema = z.enum([
  "always",
  "worldbooks",
  "state",
  "stateUpdate",
  "promptController",
  "frontend",
]);
export const nativeCardFileRuleSchema = z
  .object({
    pathPattern: nonEmpty,
    schema: nonEmpty,
    purpose: roleAssetPurposeSchema,
    extensions: z.array(z.string()),
    mediaTypes: z.array(nonEmpty).min(1),
    condition: nativeCardRuleConditionSchema,
    inManifestFiles: z.boolean().optional(),
    creationTemplateId: nonEmpty.optional(),
  })
  .strict();
export const nativeCardCreationTemplateSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    pathTemplate: nonEmpty,
    mediaType: nonEmpty,
    purpose: roleAssetPurposeSchema,
    content: z.unknown(),
  })
  .strict();
export const nativeCardFileRulesSchema = z
  .object({
    format: z.literal("tavern_headless_role_package"),
    frontendResourceAttributes: z.array(nonEmpty).min(1),
    creationTemplates: z.array(nativeCardCreationTemplateSchema).min(1),
    issueMessages: z.record(z.string(), z.object({ message: nonEmpty, action: nonEmpty }).strict()),
    assetMediaFormats: z.array(z.object({
      id: nonEmpty,
      mediaTypes: z.array(nonEmpty).min(1),
      extensions: z.array(z.object({ extension: z.string().regex(/^\.[a-z0-9]+$/), mediaType: nonEmpty }).strict()).min(1),
      signatures: z.array(z.array(z.object({
        offset: z.number().int().nonnegative(),
        bytes: z.array(z.number().int().min(0).max(255)).min(1),
        mask: z.array(z.number().int().min(0).max(255)).min(1).optional(),
      }).strict()).min(1)).min(1).optional(),
      textPattern: nonEmpty.optional(),
    }).strict()).min(1),
    backendModuleApi: z.object({
      exports: z.array(z.object({ name: nonEmpty, directory: nonEmpty, contextFields: z.array(nonEmpty), async: z.boolean() }).strict()),
      globals: z.array(nonEmpty),
      blockedProperties: z.array(nonEmpty),
      imports: z.object({ relativeOnly: z.literal(true), extensions: z.array(nonEmpty) }).strict(),
    }).strict(),
    frontendModuleApi: z.object({
      entryExport: nonEmpty,
      contextFields: z.array(nonEmpty).min(1),
      methods: z.record(z.string(), z.record(z.string(), z.object({
        minArguments: z.number().int().nonnegative(),
        maxArguments: z.number().int().nonnegative(),
      }).strict())),
      layoutMethods: z.record(z.string(), z.object({
        minArguments: z.number().int().nonnegative(),
        maxArguments: z.number().int().nonnegative(),
      }).strict()),
      imports: z.object({ relativeOnly: z.literal(true), extensions: z.array(nonEmpty) }).strict(),
    }).strict(),
    versions: z.record(z.string(),
      z
        .object({
          fixedFiles: z.array(nativeCardFileRuleSchema).min(1),
          directoryRules: z.array(nativeCardFileRuleSchema).min(1),
          referenceRules: z.array(
            z
              .object({
                schema: nonEmpty,
                field: z.array(nonEmpty).min(1),
                targets: z.array(nonEmpty).min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const nativeCardFileRules = nativeCardFileRulesSchema.parse(
  nativeCardFileRulesConfig,
);

export const nativeCardPackageSchemas: Record<string, z.ZodType<unknown>> = {
  "manifest.schema.json": nativeCardPackageManifestSchema,
  "character.schema.json": nativeCardCharacterSchema,
  "openings.schema.json": nativeCardOpeningsSchema,
  "worldbook.schema.json": nativeCardWorldbookSchema,
  "worldbook-entry.schema.json": nativeCardWorldbookEntrySchema,
  "state-schema.schema.json": nativeCardStateSchemaDocumentSchema,
  "initial-state.schema.json": nativeCardInitialStateSchema,
  "state-update-profile.schema.json": nativeCardStateUpdateProfileSchema,
  "state-update-rules.schema.json": nativeCardStateUpdateRulesSchema,
  "controller-config.schema.json": nativeCardControllerConfigSchema,
  "frontend-manifest.schema.json": nativeCardFrontendManifestSchema,
  "regex-profile.schema.json": nativeCardRegexProfileSchema,
};

export type NativeCardPackageFileRecord = z.infer<
  typeof nativeCardPackageFileRecordSchema
>;
export type NativeCardPackageManifest = z.infer<
  typeof nativeCardPackageManifestSchema
>;
export type NativeCardCharacter = z.infer<typeof nativeCardCharacterSchema>;
export type NativeCardOpening = z.infer<typeof nativeCardOpeningSchema>;
export type NativeCardOpenings = z.infer<typeof nativeCardOpeningsSchema>;
export type NativeCardWorldbookBinding = z.infer<
  typeof nativeCardWorldbookBindingSchema
>;
export type NativeCardWorldbook = z.infer<typeof nativeCardWorldbookSchema>;
export type NativeCardWorldbookEntry = z.infer<
  typeof nativeCardWorldbookEntrySchema
>;
export type NativeCardStateUpdateProfile = z.infer<
  typeof nativeCardStateUpdateProfileSchema
>;
export type NativeCardControllerConfig = z.infer<
  typeof nativeCardControllerConfigSchema
>;
export type NativeCardFrontendManifest = z.infer<
  typeof nativeCardFrontendManifestSchema
>;
export type NativeCardRegexRule = z.infer<typeof nativeCardRegexRuleSchema>;
export type NativeCardCreationTemplate = z.infer<
  typeof nativeCardCreationTemplateSchema
>;
export type NativeCardFileRule = z.infer<typeof nativeCardFileRuleSchema>;
export type NativeCardFileRules = z.infer<typeof nativeCardFileRulesSchema>;
export type NativeCardPackageFile = { path: string; content: Uint8Array };
export type NativeCardPackageIssue = NativeCardIssue;
export type NativeCardPackage = {
  manifest: NativeCardPackageManifest;
  character: NativeCardCharacter;
  openings: NativeCardOpenings;
  files: ReadonlyMap<string, Uint8Array>;
  parsedJson: ReadonlyMap<string, unknown>;
  worldbooks: ReadonlyMap<string, NativeCardWorldbook>;
  stateUpdateProfile?: NativeCardStateUpdateProfile;
  controllerConfig?: NativeCardControllerConfig;
  frontendManifest?: NativeCardFrontendManifest;
  fileRecords: Array<NativeCardPackageFileRecord & { byteSize: number }>;
};
export type NativeCardPackageValidation = {
  valid: boolean;
  issues: NativeCardPackageIssue[];
  package?: NativeCardPackage;
};

export type RuleCondition = z.infer<typeof nativeCardRuleConditionSchema>;
export type PackageFileRule = z.infer<typeof nativeCardFileRuleSchema>;
