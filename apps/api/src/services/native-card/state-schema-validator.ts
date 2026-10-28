import { Ajv2020, MissingRefError } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject } from "ajv";

export type NativeCardStateDiagnostic = {
  file: string;
  pointer: string;
  schemaPath: string;
  keyword: string;
  expected: Record<string, unknown>;
  message: string;
};

export type NativeCardStateSchemaCompilation =
  | {
      ok: true;
      validate(value: unknown, file: string): NativeCardStateDiagnostic[];
    }
  | { ok: false; issues: NativeCardStateDiagnostic[] };

function diagnosticFromAjvError(
  error: ErrorObject,
  file: string,
): NativeCardStateDiagnostic {
  return {
    file,
    pointer: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    expected: error.params,
    message: error.message ?? error.keyword,
  };
}

function unresolvedReferenceDiagnostic(
  schema: unknown,
  file: string,
  cause: MissingRefError,
  ajv: Ajv2020,
): NativeCardStateDiagnostic {
  const candidates: { pointer: string; ref: string; baseId: string }[] = [];
  const resolver = ajv.opts.uriResolver;
  const visit = (value: unknown, pointer: string, parentId: string): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const baseId =
      typeof record.$id === "string"
        ? resolver.resolve(parentId, record.$id)
        : parentId;
    if (
      typeof record.$ref === "string" &&
      resolver.resolve(baseId, record.$ref) === cause.missingRef
    ) {
      candidates.push({ pointer: `${pointer}/$ref`, ref: record.$ref, baseId });
    }
    for (const [key, child] of Object.entries(record)) {
      const escapedKey = key.replace(/~/g, "~0").replace(/\//g, "~1");
      visit(child, `${pointer}/${escapedKey}`, baseId);
    }
  };
  visit(schema, "", "");
  const pointer = candidates.length === 1 ? candidates[0]!.pointer : "";
  return {
    file,
    pointer,
    schemaPath: `#${pointer}`,
    keyword: "$ref",
    expected: {
      missingRef: cause.missingRef,
      missingSchema: cause.missingSchema,
      ...(candidates.length !== 1 ? { candidateReferences: candidates } : {}),
    },
    message: cause.message,
  };
}

export type NativeCardStateSchemaCompiler = (
  schema: unknown,
  file: string,
) => NativeCardStateSchemaCompilation;

export function createNativeCardStateSchemaCompiler(): NativeCardStateSchemaCompiler {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return (schema, file) => {
    if (
      schema &&
      typeof schema === "object" &&
      "$async" in schema &&
      schema.$async
    ) {
      return {
        ok: false,
        issues: [
          {
            file,
            pointer: "/$async",
            schemaPath: "#/$async",
            keyword: "$async",
            expected: { $async: false },
            message:
              "状态校验接口只支持同步执行，请将 $async 设为 false 或移除该字段。",
          },
        ],
      };
    }
    ajv.errors = null;
    try {
      const validate = ajv.compile(schema as AnySchema);
      return {
        ok: true,
        validate(value, valueFile) {
          if (validate(value)) return [];
          return (validate.errors ?? []).map((error) =>
            diagnosticFromAjvError(error, valueFile),
          );
        },
      };
    } catch (cause) {
      if (cause instanceof MissingRefError) {
        return {
          ok: false,
          issues: [unresolvedReferenceDiagnostic(schema, file, cause, ajv)],
        };
      }
      const schemaErrors = ajv.errors as ErrorObject[] | null | undefined;
      if (schemaErrors?.length) {
        return {
          ok: false,
          issues: schemaErrors.map((error) =>
            diagnosticFromAjvError(error, file),
          ),
        };
      }
      return {
        ok: false,
        issues: [
          {
            file,
            pointer: "",
            schemaPath: "",
            keyword: "schema",
            expected: { validSchema: true },
            message: cause instanceof Error ? cause.message : String(cause),
          },
        ],
      };
    }
  };
}

export function compileNativeCardStateSchema(
  schema: unknown,
  file: string,
): NativeCardStateSchemaCompilation {
  return createNativeCardStateSchemaCompiler()(schema, file);
}
