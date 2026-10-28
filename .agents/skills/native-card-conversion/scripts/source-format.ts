import { z } from "zod";
import {
  sourceFormats,
  legacySourceFormat,
  sourceVersions,
  sourceInputDiagnostics,
} from "./source-config.ts";

type SourceObject = Record<string, unknown>;
export type SourceCardFormat =
  typeof legacySourceFormat.format | keyof typeof sourceVersions;
export type SourceCardInputIssue = {
  pointer: string;
  rule: string;
  expected: string;
  actualType: string;
};
export type ValidatedSourceCard = {
  success: true;
  source: SourceObject;
  data: SourceObject;
  root: "" | "/data";
  format: SourceCardFormat;
};
type InputFailure = {
  success: false;
  code: (typeof sourceInputDiagnostics)[keyof typeof sourceInputDiagnostics]["code"];
  issues: SourceCardInputIssue[];
  cardName?: string;
  declaredVersion: { spec: string | null; specVersion: string | null };
};
export type SourceCardValidationResult = ValidatedSourceCard | InputFailure;

const textFields = Object.fromEntries(
  legacySourceFormat.fields.map((field) => [field, z.string()]),
) as Record<(typeof legacySourceFormat.fields)[number], z.ZodString>;
const v1Schema = z.object(textFields).partial().passthrough();
const extensions = z.record(z.string(), z.unknown());
const finiteNumber = z.number().finite();
const entryFields = {
  keys: z.array(z.string()),
  content: z.string(),
  extensions,
  enabled: z.boolean(),
  insertion_order: finiteNumber,
  case_sensitive: z.boolean().optional(),
  name: z.string().optional(),
  priority: finiteNumber.optional(),
  comment: z.string().optional(),
  selective: z.boolean().optional(),
  secondary_keys: z.array(z.string()).optional(),
  constant: z.boolean().optional(),
  position: z.string().optional(),
};
const v2EntrySchema = z
  .object({ ...entryFields, id: finiteNumber.optional() })
  .partial()
  .passthrough();
const v3EntrySchema = z
  .object({
    ...entryFields,
    id: z.union([finiteNumber, z.string()]).optional(),
    use_regex: z.boolean(),
  })
  .partial()
  .passthrough();
const bookFields = {
  name: z.string().optional(),
  description: z.string().optional(),
  scan_depth: finiteNumber.optional(),
  token_budget: finiteNumber.optional(),
  recursive_scanning: z.boolean().optional(),
  extensions,
};
const v2BookSchema = z
  .object({ ...bookFields, entries: z.array(v2EntrySchema) })
  .partial()
  .passthrough();
const v3BookSchema = z
  .object({ ...bookFields, entries: z.array(v3EntrySchema) })
  .partial()
  .passthrough();
const v2DataSchema = v1Schema
  .extend({
    creator_notes: z.string(),
    system_prompt: z.string(),
    post_history_instructions: z.string(),
    alternate_greetings: z.array(z.string()),
    character_book: v2BookSchema.optional(),
    tags: z.array(z.string()),
    creator: z.string(),
    character_version: z.string(),
    extensions,
  })
  .partial();
const assetSchema = z
  .object({
    type: z.string(),
    uri: z.string(),
    name: z.string(),
    ext: z.string(),
  })
  .partial()
  .passthrough();
const assetsSchema = z.array(assetSchema);
const v3DataSchema = v2DataSchema
  .extend({
    character_book: v3BookSchema.optional(),
    assets: assetsSchema.optional(),
    nickname: z.string().optional(),
    creator_notes_multilingual: z.record(z.string(), z.string()).optional(),
    source: z.array(z.string()).optional(),
    group_only_greetings: z.array(z.string()),
    creation_date: finiteNumber.optional(),
    modification_date: finiteNumber.optional(),
  })
  .partial();
const schemas = {
  [sourceFormats.legacy]: v1Schema,
  [sourceFormats.v2]: z
    .object({
      spec: z.literal(sourceFormats.v2),
      spec_version: z.literal(sourceVersions[sourceFormats.v2]),
      data: v2DataSchema,
    })
    .passthrough(),
  [sourceFormats.v3]: z
    .object({
      spec: z.literal(sourceFormats.v3),
      spec_version: z.literal(sourceVersions[sourceFormats.v3]),
      data: v3DataSchema,
    })
    .passthrough(),
};
const declarationSchema = z
  .object({ spec: z.string().min(1), spec_version: z.string().min(1) })
  .passthrough();

function object(value: unknown): value is SourceObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function actualType(value: unknown) {
  return value === undefined
    ? "missing"
    : value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : typeof value;
}
function atPath(source: unknown, path: PropertyKey[]) {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object" && Object.hasOwn(value, key)
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    source,
  );
}
function pointer(path: PropertyKey[]) {
  return path
    .map((key) => "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("");
}
function expected(issue: z.ZodIssue, value: unknown): string {
  switch (issue.code) {
    case "invalid_type":
      if (issue.expected === "record") return "object";
      if (
        issue.expected === "number" &&
        typeof value === "number" &&
        !Number.isFinite(value)
      )
        return "有限数值";
      return issue.expected;
    case "invalid_value":
      return issue.values.map((value) => JSON.stringify(value)).join(" | ");
    case "invalid_union":
      return [
        ...new Set(
          issue.errors.flatMap((errors) =>
            errors.map((error) => expected(error, value)),
          ),
        ),
      ].join(" | ");
    case "too_small":
      return `长度至少为 ${issue.minimum} 的 ${issue.origin}`;
    default:
      return issue.message;
  }
}
function issues(source: unknown, errors: z.ZodIssue[]): SourceCardInputIssue[] {
  return errors.map((issue) => {
    const value = atPath(source, issue.path);
    return {
      pointer: pointer(issue.path),
      rule: issue.code,
      expected: expected(issue, value),
      actualType: actualType(value),
    };
  });
}
function failure(
  source: unknown,
  errors: SourceCardInputIssue[],
  kind: keyof typeof sourceInputDiagnostics = "formatInvalid",
): InputFailure {
  const name = object(source)
    ? object(source.data)
      ? source.data.name
      : source.name
    : undefined;
  return {
    success: false,
    code: sourceInputDiagnostics[kind].code,
    issues: errors,
    ...(typeof name === "string" ? { cardName: name } : {}),
    declaredVersion: {
      spec:
        object(source) && typeof source.spec === "string" ? source.spec : null,
      specVersion:
        object(source) && typeof source.spec_version === "string"
          ? source.spec_version
          : null,
    },
  };
}
export function validateSourceCard(
  source: unknown,
): SourceCardValidationResult {
  if (!object(source))
    return failure(source, [
      {
        pointer: "",
        rule: "invalid_type",
        expected: "object",
        actualType: actualType(source),
      },
    ]);
  let format: SourceCardFormat = legacySourceFormat.format;
  if (Object.hasOwn(source, "spec") || Object.hasOwn(source, "spec_version")) {
    const declaration = declarationSchema.safeParse(source);
    if (!declaration.success) {
      const known =
        typeof source.spec === "string" &&
        Object.hasOwn(sourceVersions, source.spec);
      const parsed = known
        ? schemas[source.spec as keyof typeof sourceVersions].safeParse(source)
        : declaration;
      return failure(
        source,
        issues(
          source,
          parsed.success ? declaration.error.issues : parsed.error.issues,
        ),
      );
    }
    const spec = declaration.data.spec,
      version = declaration.data.spec_version;
    if (!Object.hasOwn(sourceVersions, spec))
      return failure(
        source,
        [
          {
            pointer: "/spec",
            rule: "unsupported_format",
            expected: Object.keys(sourceVersions).join(" | "),
            actualType: "string",
          },
        ],
        "versionUnsupported",
      );
    format = spec as keyof typeof sourceVersions;
    if (version !== sourceVersions[format]) {
      const conflict = Object.values(sourceVersions).some(
        (supported) => supported === version,
      );
      if (!conflict)
        return failure(
          source,
          [
            {
              pointer: "/spec_version",
              rule: "unsupported_version",
              expected: sourceVersions[format],
              actualType: "string",
            },
          ],
          "versionUnsupported",
        );
    }
  }
  const result = schemas[format].safeParse(source);
  if (!result.success)
    return failure(source, issues(source, result.error.issues));
  const root = format === legacySourceFormat.format ? "" : "/data";
  return {
    success: true,
    source,
    data: root === "" ? source : (source.data as SourceObject),
    root,
    format,
  };
}
export class SourceCardInputError extends Error {
  readonly diagnostic;
  constructor(failure: InputFailure, sourceFile: string) {
    const definition = Object.values(sourceInputDiagnostics).find(
      (item) => item.code === failure.code,
    )!;
    super(definition.message);
    this.name = "SourceCardInputError";
    this.diagnostic = {
      code: failure.code,
      error: definition.message,
      action: definition.action,
      sourceFile,
      ...(failure.cardName !== undefined ? { cardName: failure.cardName } : {}),
      declaredVersion: failure.declaredVersion,
      issues: failure.issues,
      supportedFormats: [
        {
          format: legacySourceFormat.format,
          version: legacySourceFormat.version,
        },
        ...Object.entries(sourceVersions).map(([format, version]) => ({
          format,
          version,
        })),
      ],
    };
  }
}
