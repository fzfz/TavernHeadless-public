import { z } from "zod";
import roleModelCapabilitiesSchemaJson from "./role-model-capabilities.schema.json" with { type: "json" };
import {
  roleModelCalculateArguments,
  roleModelCapabilityGrant,
  roleModelCapabilityLimits,
  roleModelInvocation,
  roleModelRandomArguments,
  roleModelRandomResult,
  roleModelResult,
  roleModelCalculateResult,
  roleModelErrorResult,
  roleModelRoleLimits,
  roleModelSystemCapabilityConfig,
} from "../generated/role-runtime-validators.js";

export const roleModelCapabilitiesJsonSchema = roleModelCapabilitiesSchemaJson;

type JsonSchemaNode = Record<string, unknown>;
type JsonSchemaRoot = JsonSchemaNode & {
  definitions?: Record<string, JsonSchemaNode>;
};
type AjvIssue = { instancePath?: string; keyword?: string; message?: string };
type GeneratedValidator = ((value: unknown) => boolean) & {
  errors?: AjvIssue[] | null;
};

const roleModelSchemaRoot =
  roleModelCapabilitiesJsonSchema as unknown as JsonSchemaRoot;
const definitionEnum = (definition: string): readonly string[] => {
  const schema = roleModelSchemaRoot.definitions?.[definition];
  return Array.isArray(schema?.enum)
    ? schema.enum.filter((item): item is string => typeof item === "string")
    : [];
};

export type RoleModelCapabilityName = "random" | "calculate";
export const roleModelCapabilityNames = definitionEnum(
  "capabilityName",
) as readonly RoleModelCapabilityName[];
export const ROLE_MODEL_CAPABILITY_NAMES = roleModelCapabilityNames;

export type RoleModelCapabilityErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_RANGE"
  | "INVALID_WEIGHTS"
  | "INSUFFICIENT_POPULATION"
  | "LIMIT_EXCEEDED"
  | "DIVISION_BY_ZERO"
  | "NUMERIC_OVERFLOW"
  | "CAPABILITY_DENIED"
  | "EXECUTION_FAILED";
export const roleModelCapabilityErrorCodes = definitionEnum(
  "capabilityErrorCode",
) as readonly RoleModelCapabilityErrorCode[];

export type RoleModelCapabilityTransport =
  | "native_function_call"
  | "text_protocol";
export const roleModelCapabilityTransports = definitionEnum(
  "transport",
) as readonly RoleModelCapabilityTransport[];

export type RoleModelCapabilitiesProviderId = "system:role-model-capabilities";
const providerIdSchema = roleModelSchemaRoot.definitions?.capabilityProviderId;
export const ROLE_MODEL_CAPABILITIES_PROVIDER_ID = String(
  providerIdSchema?.const,
) as RoleModelCapabilitiesProviderId;

export interface RoleModelCapabilityLimits {
  maxCallsPerTurn: number;
  maxStepsPerGeneration: number;
  maxRandomSamples: number;
  maxRandomCandidates: number;
  maxCalculateNodes: number;
  maxCalculateDepth: number;
  maxCandidateDepth: number;
  maxInputBytes: number;
  maxResultBytes: number;
}

export interface RoleModelCapabilitySystemLimits extends RoleModelCapabilityLimits {
  minResultBytes: number;
}

const capabilityLimitKeys = roleModelSchemaRoot.definitions?.capabilityLimits;
const capabilityLimitNames =
  isPlainObject(capabilityLimitKeys?.propertyNames) &&
  Array.isArray(capabilityLimitKeys.propertyNames.enum)
    ? capabilityLimitKeys.propertyNames.enum.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
/** Canonical role-overridable limit keys, derived from the shared Draft-07 contract. */
export const roleModelCapabilityLimitKeys = capabilityLimitNames
  .filter(
    (name): name is keyof RoleModelCapabilityLimits =>
      name !== "minResultBytes",
  )
  .sort();

export interface RoleModelCapabilitiesGrant {
  enabled: boolean;
  allowed: RoleModelCapabilityName[];
  slot: "narrator";
  transport: RoleModelCapabilityTransport;
  limits?: Partial<RoleModelCapabilityLimits>;
}

export interface RoleModelCapabilitiesSystemConfig {
  enabled: boolean;
  allowed: RoleModelCapabilityName[];
  transports: RoleModelCapabilityTransport[];
  slot: "narrator";
  limits: RoleModelCapabilitySystemLimits;
  messages: Record<RoleModelCapabilityErrorCode, string>;
}

export type RoleModelCapabilityJsonValue =
  | null
  | boolean
  | number
  | string
  | RoleModelCapabilityJsonValue[]
  | { [key: string]: RoleModelCapabilityJsonValue };

export interface RoleModelCapabilityRandomData {
  samples: RoleModelCapabilityJsonValue[];
  indices: number[] | null;
}

export type RoleModelCapabilityCalculateData =
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

export type RoleModelCapabilitySuccessData =
  | RoleModelCapabilityRandomData
  | RoleModelCapabilityCalculateData;

export type RoleModelCapabilityResult =
  | { ok: true; data: RoleModelCapabilitySuccessData }
  | {
      ok: false;
      error: { code: RoleModelCapabilityErrorCode; message: string };
    };

export interface RoleModelCapabilitySchemaIssue {
  path: string;
  keyword: string;
  message: string;
}

export type RoleModelCapabilityValidation =
  | { valid: true }
  | { valid: false; issues: RoleModelCapabilitySchemaIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function decodePointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalRef(
  root: JsonSchemaRoot,
  ref: string,
): JsonSchemaNode | undefined {
  if (!ref.startsWith("#/")) return undefined;

  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = decodePointerSegment(rawSegment);
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return isPlainObject(current) ? current : undefined;
}

function inlineSchemaNode(
  schema: JsonSchemaNode,
  stack: Set<string>,
): JsonSchemaNode {
  if (typeof schema.$ref === "string") {
    const refPrefix = "#/definitions/";
    if (!schema.$ref.startsWith(refPrefix)) {
      throw new Error(
        `Unsupported role model capability schema reference '${schema.$ref}'.`,
      );
    }
    const name = schema.$ref.slice(refPrefix.length);
    if (stack.has(name)) return { $ref: schema.$ref };
    const nextStack = new Set(stack);
    nextStack.add(name);
    const target = resolveLocalRef(roleModelSchemaRoot, schema.$ref);
    if (!target)
      throw new Error(
        `Unknown role model capability schema reference '${schema.$ref}'.`,
      );
    return inlineSchemaNode(target, nextStack);
  }

  const result: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "definitions" || key === "$id" || key === "$schema") continue;
    if (isPlainObject(value)) {
      result[key] = inlineSchemaNode(value, stack);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) ? inlineSchemaNode(item, stack) : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function inlineDefinitionSchema(definition: string): JsonSchemaNode {
  const schema = resolveLocalRef(
    roleModelSchemaRoot,
    `#/definitions/${definition}`,
  );
  if (!schema)
    throw new Error(
      `Unknown role model capability schema definition '${definition}'.`,
    );
  return {
    $schema: roleModelSchemaRoot.$schema,
    ...inlineSchemaNode(schema, new Set([definition])),
  };
}

/** Draft-07 schema that can be embedded directly as `model_capabilities`. */
export const roleModelCapabilitiesGrantJsonSchema =
  inlineDefinitionSchema("capabilityGrant");

/** Draft-07 schema for the API-owned system capability configuration file. */
export const roleModelCapabilitiesSystemConfigJsonSchema =
  inlineDefinitionSchema("systemCapabilityConfig");

/** Draft-07 schema for the optional role-level limit overrides. */
export const roleModelCapabilityLimitsJsonSchema =
  inlineDefinitionSchema("roleLimits");

/** Return a standalone Draft-07 parameter schema for one fixed system tool. */
export function getRoleModelCapabilityToolArgumentsJsonSchema(
  toolName: RoleModelCapabilityName,
): JsonSchemaNode {
  const definition =
    toolName === "random" ? "randomArguments" : "calculateArguments";
  const definitions = roleModelSchemaRoot.definitions;
  if (!definitions)
    throw new Error("Role model capability schema definitions are missing.");
  const schema = resolveLocalRef(
    roleModelSchemaRoot,
    `#/definitions/${definition}`,
  );
  if (!schema)
    throw new Error(
      `Role model capability schema definition '${definition}' is missing.`,
    );

  return {
    $schema: roleModelSchemaRoot.$schema,
    ...inlineSchemaNode(schema, new Set([definition])),
    type: "object",
    definitions,
  };
}

function runGeneratedValidator(
  validator: unknown,
  value: unknown,
): RoleModelCapabilityValidation {
  const validate = validator as GeneratedValidator;
  if (validate(value)) return { valid: true };
  return {
    valid: false,
    issues: (validate.errors ?? []).map((issue) => ({
      path: issue.instancePath ?? "",
      keyword: issue.keyword ?? "schema",
      message: issue.message ?? "The value does not match the schema.",
    })),
  };
}

const generatedValidators: Record<string, unknown> = {
  invocation: roleModelInvocation,
  randomArguments: roleModelRandomArguments,
  calculateArguments: roleModelCalculateArguments,
  randomResult: roleModelRandomResult,
  calculateResult: roleModelCalculateResult,
  errorResult: roleModelErrorResult,
  result: roleModelResult,
  capabilityGrant: roleModelCapabilityGrant,
  capabilityLimits: roleModelCapabilityLimits,
  roleLimits: roleModelRoleLimits,
  systemCapabilityConfig: roleModelSystemCapabilityConfig,
};

function createSchemaBackedZodSchema<T>(
  validator: unknown,
): z.ZodType<T, unknown> {
  return z
    .unknown()
    .superRefine((value, context) => {
      const result = runGeneratedValidator(validator, value);
      if (result.valid) return;
      for (const issue of result.issues) {
        const path = issue.path
          ? issue.path
              .slice(1)
              .split("/")
              .map((part) => {
                const segment = decodePointerSegment(part);
                return /^\d+$/.test(segment) ? Number(segment) : segment;
              })
          : [];
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `${issue.keyword}: ${issue.message}`,
        });
      }
    })
    .transform((value) => value as T);
}

export const roleModelCapabilitiesGrantSchema =
  createSchemaBackedZodSchema<RoleModelCapabilitiesGrant>(
    roleModelCapabilityGrant,
  );
export const roleModelCapabilityLimitsSchema =
  createSchemaBackedZodSchema<Partial<RoleModelCapabilityLimits>>(
    roleModelRoleLimits,
  );
export const roleModelCapabilitiesSystemConfigSchema =
  createSchemaBackedZodSchema<RoleModelCapabilitiesSystemConfig>(
    roleModelSystemCapabilityConfig,
  ).superRefine((config, context) => {
    if (config.limits.maxResultBytes < config.limits.minResultBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limits", "maxResultBytes"],
        message: "maxResultBytes must be at least minResultBytes.",
      });
    }
  });

export function validateRoleModelCapabilityInvocation(
  value: unknown,
): RoleModelCapabilityValidation {
  return runGeneratedValidator(roleModelInvocation, value);
}

export function validateRoleModelCapabilityResult(
  value: unknown,
): RoleModelCapabilityValidation {
  return runGeneratedValidator(roleModelResult, value);
}

export function validateRoleModelCapabilityJsonSchemaDefinition(
  value: unknown,
  definition: string,
): RoleModelCapabilityValidation {
  const validator = generatedValidators[definition];
  if (!validator) {
    return {
      valid: false,
      issues: [
        {
          path: "",
          keyword: "$ref",
          message: `Unknown schema definition '${definition}'.`,
        },
      ],
    };
  }
  return runGeneratedValidator(validator, value);
}

export function measureRoleModelCapabilityJsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(serialized).byteLength;
}

export interface RoleModelRandomArguments {
  domain:
    | { kind: "integer_range"; min: number; max: number }
    | { kind: "choices"; values: RoleModelCapabilityJsonValue[] };
  distribution: { kind: "uniform" } | { kind: "weighted"; weights: number[] };
  count: number;
  replacement: boolean;
}

export interface RoleModelCalculateArguments {
  expression: number | Record<string, unknown>;
}

export type RoleModelCapabilityArguments =
  | RoleModelRandomArguments
  | RoleModelCalculateArguments;

export type RoleModelCapabilityArgumentsValidation =
  | { valid: true; value: RoleModelCapabilityArguments }
  | {
      valid: false;
      code: RoleModelCapabilityErrorCode;
      issues?: RoleModelCapabilitySchemaIssue[];
    };

function measureContainerDepth(value: unknown, maxDepth: number): number {
  if (value === null || typeof value !== "object") return 0;
  let maximum = 0;
  const stack: Array<{
    value: unknown;
    depth: number;
    ancestors: Set<object>;
  }> = [{ value, depth: 1, ancestors: new Set() }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.ancestors.has(current.value)) return Number.POSITIVE_INFINITY;
    maximum = Math.max(maximum, current.depth);
    if (maximum > maxDepth) return maximum;
    const nextAncestors = new Set(current.ancestors);
    nextAncestors.add(current.value);
    const children = Array.isArray(current.value)
      ? current.value
      : isPlainObject(current.value)
        ? Object.values(current.value)
        : [];
    for (const child of children) {
      if (child !== null && typeof child === "object") {
        stack.push({
          value: child,
          depth: current.depth + 1,
          ancestors: nextAncestors,
        });
      }
    }
  }

  return maximum;
}

function measureExpression(
  value: unknown,
  limits: Pick<
    RoleModelCapabilityLimits,
    "maxCalculateNodes" | "maxCalculateDepth"
  >,
): { nodes: number; depth: number } {
  let nodes = 0;
  let maximumDepth = 0;
  const stack: Array<{
    value: unknown;
    depth: number;
    ancestors: Set<object>;
  }> = [{ value, depth: 1, ancestors: new Set() }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === "number") {
      nodes += 1;
      maximumDepth = Math.max(maximumDepth, current.depth);
      if (
        nodes > limits.maxCalculateNodes ||
        maximumDepth > limits.maxCalculateDepth
      )
        return { nodes, depth: maximumDepth };
      continue;
    }
    if (!isPlainObject(current.value) || !Array.isArray(current.value.args))
      continue;
    if (current.ancestors.has(current.value))
      return {
        nodes: Number.POSITIVE_INFINITY,
        depth: Number.POSITIVE_INFINITY,
      };
    nodes += 1;
    maximumDepth = Math.max(maximumDepth, current.depth);
    if (
      nodes > limits.maxCalculateNodes ||
      maximumDepth > limits.maxCalculateDepth
    )
      return { nodes, depth: maximumDepth };
    const nextAncestors = new Set(current.ancestors);
    nextAncestors.add(current.value);
    for (const child of current.value.args) {
      stack.push({
        value: child,
        depth: current.depth + 1,
        ancestors: nextAncestors,
      });
    }
  }

  return { nodes, depth: maximumDepth };
}

function getDefinitionIssues(
  value: unknown,
  definition: string,
): RoleModelCapabilitySchemaIssue[] {
  const validation = validateRoleModelCapabilityJsonSchemaDefinition(
    value,
    definition,
  );
  return validation.valid ? [] : validation.issues;
}

export function validateRoleModelCapabilityArguments(
  toolName: unknown,
  value: unknown,
  limits: RoleModelCapabilityLimits,
): RoleModelCapabilityArgumentsValidation {
  if (toolName !== "random" && toolName !== "calculate") {
    return { valid: false, code: "INVALID_ARGUMENT" };
  }

  // Bound recursive JSON inspection before applying the recursive Draft-07 schema.
  if (
    toolName === "random" &&
    isPlainObject(value) &&
    isPlainObject(value.domain) &&
    value.domain.kind === "choices" &&
    Array.isArray(value.domain.values)
  ) {
    if (value.domain.values.length > limits.maxRandomCandidates) {
      return { valid: false, code: "LIMIT_EXCEEDED" };
    }
    for (const candidate of value.domain.values) {
      if (
        measureContainerDepth(candidate, limits.maxCandidateDepth) >
        limits.maxCandidateDepth
      ) {
        return { valid: false, code: "LIMIT_EXCEEDED" };
      }
    }
  }
  if (
    toolName === "calculate" &&
    isPlainObject(value) &&
    Object.hasOwn(value, "expression")
  ) {
    const expressionSize = measureExpression(value.expression, limits);
    if (
      expressionSize.nodes > limits.maxCalculateNodes ||
      expressionSize.depth > limits.maxCalculateDepth
    ) {
      return { valid: false, code: "LIMIT_EXCEEDED" };
    }
  }

  const definition =
    toolName === "random" ? "randomArguments" : "calculateArguments";
  const schemaIssues = getDefinitionIssues(value, definition);
  if (schemaIssues.length > 0) {
    return { valid: false, code: "INVALID_ARGUMENT", issues: schemaIssues };
  }

  if (toolName === "random") {
    const args = value as RoleModelRandomArguments;
    if (args.domain.kind === "integer_range") {
      if (args.domain.min > args.domain.max)
        return { valid: false, code: "INVALID_RANGE" };
      const populationSize = args.domain.max - args.domain.min + 1;
      if (!Number.isSafeInteger(populationSize) || populationSize <= 0) {
        return { valid: false, code: "INVALID_RANGE" };
      }
    } else {
      if (args.distribution.kind === "weighted") {
        if (args.distribution.weights.length !== args.domain.values.length) {
          return { valid: false, code: "INVALID_WEIGHTS" };
        }
        const totalWeight = args.distribution.weights.reduce(
          (total, weight) => total + weight,
          0,
        );
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
          return { valid: false, code: "INVALID_WEIGHTS" };
        }
      }
    }

    if (args.count > limits.maxRandomSamples)
      return { valid: false, code: "LIMIT_EXCEEDED" };
    if (!args.replacement) {
      const populationSize =
        args.domain.kind === "integer_range"
          ? args.domain.max - args.domain.min + 1
          : args.distribution.kind === "weighted"
            ? args.distribution.weights.filter((weight) => weight > 0).length
            : args.domain.values.length;
      if (args.count > populationSize)
        return { valid: false, code: "INSUFFICIENT_POPULATION" };
    }

    if (measureRoleModelCapabilityJsonBytes(value) > limits.maxInputBytes) {
      return { valid: false, code: "LIMIT_EXCEEDED" };
    }
    return { valid: true, value: args };
  }

  const args = value as RoleModelCalculateArguments;
  if (measureRoleModelCapabilityJsonBytes(value) > limits.maxInputBytes) {
    return { valid: false, code: "LIMIT_EXCEEDED" };
  }
  return { valid: true, value: args };
}
