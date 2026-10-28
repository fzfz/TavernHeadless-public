import {
  apiErrorMessages,
  getNativeCardCreationTemplate,
  type NativeCardIssue,
  type NativeCardPackage,
} from "@tavern/shared";

import {
  createNativeCardStateSchemaCompiler,
  type NativeCardStateDiagnostic,
  type NativeCardStateSchemaCompilation,
} from "./state-schema-validator.js";

function stateDiagnosticIssue(
  diagnostic: NativeCardStateDiagnostic,
  code:
    | "NATIVE_CARD_STATE_SCHEMA_INVALID"
    | "NATIVE_CARD_INITIAL_STATE_INVALID",
  pointerPrefix = "",
): NativeCardIssue {
  const message = apiErrorMessages[code];
  return {
    code,
    path: diagnostic.file,
    pointer: `${pointerPrefix}${diagnostic.pointer}` || "/",
    message,
    action: message,
    expected: ["schema", "$ref"].includes(diagnostic.keyword)
      ? diagnostic.message
      : `${diagnostic.keyword}: ${diagnostic.message}`,
  };
}

function tryParsePackageJson(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown,
    };
  } catch (error) {
    return { ok: false, error };
  }
}

export function validateNativeCardStatePackage(
  nativePackage: NativeCardPackage,
): NativeCardIssue[] {
  const issues: NativeCardIssue[] = [];
  const fileMap = nativePackage.files;
  const profile = nativePackage.stateUpdateProfile;
  let stateValidator:
    | Extract<NativeCardStateSchemaCompilation, { ok: true }>
    | undefined;
  const compile = createNativeCardStateSchemaCompiler();
  const compileStateSchema = (
    schema: unknown,
    path: string,
    pointerPrefix = "",
  ): Extract<NativeCardStateSchemaCompilation, { ok: true }> | undefined => {
    const result = compile(schema, path);
    if (result.ok) return result;
    issues.push(
      ...result.issues.map((diagnostic) =>
        stateDiagnosticIssue(
          diagnostic,
          "NATIVE_CARD_STATE_SCHEMA_INVALID",
          pointerPrefix,
        ),
      ),
    );
    return undefined;
  };
  const fixedStateSchemaPath =
    getNativeCardCreationTemplate("stateSchema")!.pathTemplate;
  const stateSchemaPath = fileMap.has(fixedStateSchemaPath)
    ? fixedStateSchemaPath
    : profile?.stateSchemaFile;
  const stateSchemaBytes = stateSchemaPath
    ? fileMap.get(stateSchemaPath)
    : undefined;
  if (stateSchemaBytes && stateSchemaPath) {
    const parsed = tryParsePackageJson(stateSchemaBytes);
    if (!parsed.ok) {
      issues.push({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: stateSchemaPath,
        message: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        action: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        expected: String(parsed.error),
      });
    } else {
      stateValidator = compileStateSchema(parsed.value, stateSchemaPath);
    }
  }
  if (profile?.factsSchema) {
    compileStateSchema(
      profile.factsSchema,
      getNativeCardCreationTemplate("stateUpdateProfile")!.pathTemplate,
      "/factsSchema",
    );
  }

  for (const opening of nativePackage.openings.items) {
    if (!opening.initialStateFile) continue;
    const bytes = fileMap.get(opening.initialStateFile);
    if (!bytes) continue;
    const parsed = tryParsePackageJson(bytes);
    if (!parsed.ok) {
      issues.push({
        code: "NATIVE_CARD_INITIAL_STATE_INVALID",
        path: opening.initialStateFile,
        message: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        action: apiErrorMessages.NATIVE_CARD_INITIAL_STATE_INVALID,
        expected: String(parsed.error),
      });
      continue;
    }
    if (!stateValidator) {
      issues.push({
        code: "NATIVE_CARD_STATE_SCHEMA_INVALID",
        path: opening.initialStateFile,
        message: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        action: apiErrorMessages.NATIVE_CARD_STATE_SCHEMA_INVALID,
        expected: `The package must declare ${fixedStateSchemaPath} before it can provide opening initial state.`,
      });
      continue;
    }
    issues.push(
      ...stateValidator
        .validate(parsed.value, opening.initialStateFile)
        .map((diagnostic) =>
          stateDiagnosticIssue(diagnostic, "NATIVE_CARD_INITIAL_STATE_INVALID"),
        ),
    );
  }
  return issues;
}
