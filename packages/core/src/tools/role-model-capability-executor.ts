import {
  ROLE_MODEL_CAPABILITY_NAMES as SHARED_ROLE_MODEL_CAPABILITY_NAMES,
  ROLE_MODEL_CAPABILITIES_PROVIDER_ID as SHARED_ROLE_MODEL_CAPABILITIES_PROVIDER_ID,
  getRoleModelCapabilityToolArgumentsJsonSchema,
  measureRoleModelCapabilityJsonBytes,
  validateRoleModelCapabilityArguments,
  type RoleModelCapabilitiesGrant,
  type RoleModelCapabilitiesSystemConfig,
  type RoleModelCapabilityErrorCode,
  type RoleModelCapabilityJsonValue,
  type RoleModelCapabilityLimits,
  type RoleModelCapabilityName,
  type RoleModelCapabilityRandomData,
  type RoleModelCapabilityResult,
  type RoleModelRandomArguments,
} from "@tavern/shared";
import type {
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolParameterSchema,
  ToolProvider,
} from "./types.js";
import type { InstanceSlot } from "../llm/types.js";

export const ROLE_MODEL_CAPABILITIES_PROVIDER_ID =
  SHARED_ROLE_MODEL_CAPABILITIES_PROVIDER_ID;
export const ROLE_MODEL_CAPABILITY_NAMES = SHARED_ROLE_MODEL_CAPABILITY_NAMES;

export interface ExecuteRoleModelCapabilityInput {
  toolName: string;
  arguments: unknown;
  systemConfig: RoleModelCapabilitiesSystemConfig;
  grant: RoleModelCapabilitiesGrant | null;
  callerSlot: InstanceSlot;
  capabilityDisabled?: boolean;
  callLimitExceeded?: boolean;
  random?: () => number;
}

export interface RoleModelCapabilitiesToolProviderOptions {
  systemConfig: RoleModelCapabilitiesSystemConfig;
  grant: RoleModelCapabilitiesGrant;
  resolveGrant: (
    context: ToolExecutionContext,
  ) =>
    | RoleModelCapabilitiesGrant
    | null
    | Promise<RoleModelCapabilitiesGrant | null>;
  /** A deterministic source may be supplied by tests; production defaults to Math.random. */
  random?: () => number;
}

type RandomSource = () => number;

function isCapabilityName(value: string): value is RoleModelCapabilityName {
  return (ROLE_MODEL_CAPABILITY_NAMES as readonly string[]).includes(value);
}

function effectiveLimits(
  systemConfig: RoleModelCapabilitiesSystemConfig,
  grant: RoleModelCapabilitiesGrant,
): RoleModelCapabilityLimits {
  const overrides = grant.limits ?? {};
  const pick = (key: keyof RoleModelCapabilityLimits) =>
    Math.min(
      systemConfig.limits[key],
      overrides[key] ?? systemConfig.limits[key],
    );

  return {
    maxCallsPerTurn: pick("maxCallsPerTurn"),
    maxStepsPerGeneration: pick("maxStepsPerGeneration"),
    maxRandomSamples: pick("maxRandomSamples"),
    maxRandomCandidates: pick("maxRandomCandidates"),
    maxCalculateNodes: pick("maxCalculateNodes"),
    maxCalculateDepth: pick("maxCalculateDepth"),
    maxCandidateDepth: pick("maxCandidateDepth"),
    maxInputBytes: pick("maxInputBytes"),
    maxResultBytes: Math.max(
      systemConfig.limits.minResultBytes,
      pick("maxResultBytes"),
    ),
  };
}

function isAuthorized(
  toolName: string,
  callerSlot: InstanceSlot,
  systemConfig: RoleModelCapabilitiesSystemConfig,
  grant: RoleModelCapabilitiesGrant | null,
): grant is RoleModelCapabilitiesGrant {
  return (
    isCapabilityName(toolName) &&
    systemConfig.enabled &&
    systemConfig.slot === "narrator" &&
    systemConfig.allowed.includes(toolName) &&
    grant !== null &&
    grant.enabled &&
    grant.slot === "narrator" &&
    callerSlot === "narrator" &&
    grant.allowed.includes(toolName) &&
    systemConfig.transports.includes(grant.transport)
  );
}

function makeError(
  code: RoleModelCapabilityErrorCode,
  systemConfig: RoleModelCapabilitiesSystemConfig,
): RoleModelCapabilityResult {
  return {
    ok: false,
    error: {
      code,
      message: systemConfig.messages[code],
    },
  };
}

function normalizeNumericResult(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function readRandomUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Invalid random source value");
  }
  return value;
}

function randomIndex(upperExclusive: number, random: RandomSource): number {
  return Math.floor(readRandomUnit(random) * upperExclusive);
}

function sampleRangeWithoutReplacement(
  min: number,
  populationSize: number,
  count: number,
  random: RandomSource,
): number[] {
  const remapped = new Map<number, number>();
  const samples: number[] = [];
  let remaining = populationSize;

  for (let index = 0; index < count; index += 1) {
    const slot = randomIndex(remaining, random);
    const selected = remapped.get(slot) ?? slot;
    const lastSlot = remaining - 1;
    const lastValue = remapped.get(lastSlot) ?? lastSlot;

    if (slot !== lastSlot) remapped.set(slot, lastValue);
    remapped.delete(lastSlot);
    remaining -= 1;
    samples.push(min + selected);
  }

  return samples;
}

function sampleUniformChoicesWithReplacement(
  values: RoleModelCapabilityJsonValue[],
  count: number,
  random: RandomSource,
): { samples: RoleModelCapabilityRandomData["samples"]; indices: number[] } {
  const indices = Array.from({ length: count }, () =>
    randomIndex(values.length, random),
  );
  return { samples: indices.map((index) => values[index]!), indices };
}

function sampleUniformChoicesWithoutReplacement(
  values: RoleModelCapabilityRandomData["samples"],
  count: number,
  random: RandomSource,
): { samples: RoleModelCapabilityRandomData["samples"]; indices: number[] } {
  const remaining = values.map((_value, index) => index);
  const indices: number[] = [];
  for (let draw = 0; draw < count; draw += 1) {
    const selectedAt = randomIndex(remaining.length, random);
    indices.push(remaining.splice(selectedAt, 1)[0]!);
  }
  return { samples: indices.map((index) => values[index]!), indices };
}

function selectWeightedIndex(
  indices: number[],
  weights: number[],
  random: RandomSource,
): number {
  const totalWeight = indices.reduce(
    (total, index) => total + weights[index]!,
    0,
  );
  const target = readRandomUnit(random) * totalWeight;
  let cumulative = 0;
  let lastPositiveIndex = indices[0]!;

  for (const index of indices) {
    const weight = weights[index]!;
    if (weight <= 0) continue;
    lastPositiveIndex = index;
    cumulative += weight;
    if (target < cumulative) return index;
  }

  return lastPositiveIndex;
}

function sampleWeightedChoices(
  values: RoleModelCapabilityRandomData["samples"],
  weights: number[],
  count: number,
  replacement: boolean,
  random: RandomSource,
): RoleModelCapabilityRandomData {
  const indices: number[] = [];
  const available = weights
    .map((_weight, index) => index)
    .filter((index) => weights[index]! > 0);
  let remaining = [...available];

  for (let draw = 0; draw < count; draw += 1) {
    const selected = selectWeightedIndex(
      replacement ? available : remaining,
      weights,
      random,
    );
    indices.push(selected);
    if (!replacement)
      remaining = remaining.filter((index) => index !== selected);
  }

  return { samples: indices.map((index) => values[index]!), indices };
}

function executeRandom(
  args: RoleModelRandomArguments,
  random: RandomSource,
): RoleModelCapabilityRandomData {
  if (args.domain.kind === "integer_range") {
    // Preserve discriminant narrowing inside Array.from's callback.
    const min = args.domain.min;
    const populationSize = args.domain.max - min + 1;
    const samples = args.replacement
      ? Array.from(
          { length: args.count },
          () => min + randomIndex(populationSize, random),
        )
      : sampleRangeWithoutReplacement(min, populationSize, args.count, random);
    return { samples, indices: null };
  }

  if (args.distribution.kind === "weighted") {
    return sampleWeightedChoices(
      args.domain.values,
      args.distribution.weights,
      args.count,
      args.replacement,
      random,
    );
  }

  const selected = args.replacement
    ? sampleUniformChoicesWithReplacement(
        args.domain.values,
        args.count,
        random,
      )
    : sampleUniformChoicesWithoutReplacement(
        args.domain.values,
        args.count,
        random,
      );
  return selected;
}

type NumericExpression = number | { op: string; args: NumericExpression[] };
type ComparisonExpression = {
  op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
  args: [NumericExpression, NumericExpression];
};

function evaluateNumericExpression(expression: NumericExpression): number {
  if (typeof expression === "number") return expression;

  const values: number[] = [];
  for (const argument of expression.args) {
    const value = evaluateNumericExpression(argument);
    if (!Number.isFinite(value)) throw new NumericOverflowError();
    values.push(value);
  }

  let result: number;
  switch (expression.op) {
    case "add": {
      result = values[0]!;
      for (let index = 1; index < values.length; index += 1) {
        result += values[index]!;
        if (!Number.isFinite(result)) throw new NumericOverflowError();
      }
      break;
    }
    case "mul": {
      result = values[0]!;
      for (let index = 1; index < values.length; index += 1) {
        result *= values[index]!;
        if (!Number.isFinite(result)) throw new NumericOverflowError();
      }
      break;
    }
    case "min":
      result = Math.min(...values);
      break;
    case "max":
      result = Math.max(...values);
      break;
    case "sub":
      result = values[0]! - values[1]!;
      break;
    case "div":
      if (values[1] === 0) throw new DivisionByZeroError();
      result = values[0]! / values[1]!;
      break;
    case "floor":
      result = Math.floor(values[0]!);
      break;
    case "ceil":
      result = Math.ceil(values[0]!);
      break;
    case "trunc":
      result = Math.trunc(values[0]!);
      break;
    default:
      throw new Error(`Unsupported numeric operation '${expression.op}'`);
  }

  if (!Number.isFinite(result)) throw new NumericOverflowError();
  return result;
}

function evaluateCalculate(
  expression: number | Record<string, unknown>,
): { type: "number"; value: number } | { type: "boolean"; value: boolean } {
  if (typeof expression === "number") {
    return { type: "number", value: normalizeNumericResult(expression) };
  }

  const operation = expression.op as string;
  const args = expression.args as NumericExpression[];
  if (["eq", "ne", "lt", "lte", "gt", "gte"].includes(operation)) {
    const left = evaluateNumericExpression(args[0]!);
    const right = evaluateNumericExpression(args[1]!);
    let value = false;
    switch (operation as ComparisonExpression["op"]) {
      case "eq":
        value = left === right;
        break;
      case "ne":
        value = left !== right;
        break;
      case "lt":
        value = left < right;
        break;
      case "lte":
        value = left <= right;
        break;
      case "gt":
        value = left > right;
        break;
      case "gte":
        value = left >= right;
        break;
    }
    return { type: "boolean", value };
  }

  const value = evaluateNumericExpression(expression as NumericExpression);
  return { type: "number", value: normalizeNumericResult(value) };
}

class DivisionByZeroError extends Error {}
class NumericOverflowError extends Error {}

/** Execute the fixed system capability after authorization and contract/limit checks. */
export function executeRoleModelCapability(
  input: ExecuteRoleModelCapabilityInput,
): RoleModelCapabilityResult {
  const {
    toolName,
    arguments: argumentsValue,
    systemConfig,
    grant,
    callerSlot,
  } = input;
  if (!isAuthorized(toolName, callerSlot, systemConfig, grant)) {
    return makeError("CAPABILITY_DENIED", systemConfig);
  }
  if (input.capabilityDisabled)
    return makeError("CAPABILITY_DENIED", systemConfig);
  if (input.callLimitExceeded) return makeError("LIMIT_EXCEEDED", systemConfig);

  const limits = effectiveLimits(systemConfig, grant);
  const validation = validateRoleModelCapabilityArguments(
    toolName,
    argumentsValue,
    limits,
  );
  if (!validation.valid) return makeError(validation.code, systemConfig);

  let result: RoleModelCapabilityResult;
  try {
    if (toolName === "random") {
      result = {
        ok: true,
        data: executeRandom(
          validation.value as RoleModelRandomArguments,
          input.random ?? Math.random,
        ),
      };
    } else {
      result = {
        ok: true,
        data: evaluateCalculate(
          (validation.value as { expression: number | Record<string, unknown> })
            .expression,
        ),
      };
    }
  } catch (error) {
    if (error instanceof DivisionByZeroError) {
      result = makeError("DIVISION_BY_ZERO", systemConfig);
    } else if (error instanceof NumericOverflowError) {
      result = makeError("NUMERIC_OVERFLOW", systemConfig);
    } else {
      result = makeError("EXECUTION_FAILED", systemConfig);
    }
  }

  if (measureRoleModelCapabilityJsonBytes(result) > limits.maxResultBytes) {
    result = makeError("LIMIT_EXCEEDED", systemConfig);
  }
  return result;
}

function toolDefinition(name: RoleModelCapabilityName): ToolDefinition {
  const parameters = getRoleModelCapabilityToolArgumentsJsonSchema(
    name,
  ) as unknown as ToolParameterSchema;
  const description = String(parameters.description ?? "");
  return {
    name,
    description,
    parameters,
    sideEffectLevel: "none",
    allowedSlots: ["narrator"],
    source: "builtin",
  };
}

/** Fixed provider for role-scoped random and calculate; this provider owns both reserved names. */
export class RoleModelCapabilitiesToolProvider implements ToolProvider {
  readonly id = ROLE_MODEL_CAPABILITIES_PROVIDER_ID;
  readonly type = "builtin" as const;
  private readonly random: RandomSource;

  constructor(
    private readonly options: RoleModelCapabilitiesToolProviderOptions,
  ) {
    this.random = options.random ?? Math.random;
  }

  async listTools(): Promise<ToolDefinition[]> {
    return ROLE_MODEL_CAPABILITY_NAMES.filter((name) =>
      isAuthorized(
        name,
        "narrator",
        this.options.systemConfig,
        this.options.grant,
      ),
    ).map(toolDefinition);
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    let grant: RoleModelCapabilitiesGrant | null = null;
    try {
      grant = await this.options.resolveGrant(context);
    } catch {
      return this.toToolCallResult(
        makeError("CAPABILITY_DENIED", this.options.systemConfig),
      );
    }

    const result = executeRoleModelCapability({
      toolName: name,
      arguments: args,
      systemConfig: this.options.systemConfig,
      grant,
      callerSlot: context.callerSlot,
      capabilityDisabled: context.roleModelCapabilityDisabled,
      callLimitExceeded: context.roleModelCapabilityCallLimitExceeded,
      random: this.random,
    });
    return this.toToolCallResult(result);
  }

  private toToolCallResult(result: RoleModelCapabilityResult): ToolCallResult {
    if (result.ok) {
      return {
        data: result,
        executionStatus: "success",
      };
    }

    return {
      data: result,
      error: result.error.message,
      executionStatus:
        result.error.code === "CAPABILITY_DENIED" ? "denied" : "error",
      executionReasonCode: result.error.code,
      providerMessage: result.error.message,
    };
  }
}
