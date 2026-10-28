import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ROLE_MODEL_CAPABILITIES_PROVIDER_ID,
  ROLE_MODEL_CAPABILITY_NAMES,
  executeRoleModelCapability,
  RoleModelCapabilitiesToolProvider,
} from "../role-model-capability-executor.js";
import type { ToolExecutionContext } from "../types.js";
import {
  measureRoleModelCapabilityJsonBytes,
  roleModelCapabilityErrorCodes,
  roleModelCapabilitiesGrantJsonSchema,
  roleModelCapabilitiesGrantSchema,
  roleModelCapabilitiesSystemConfigSchema,
  roleModelCapabilityLimitsJsonSchema,
  validateRoleModelCapabilityArguments,
  validateRoleModelCapabilityInvocation,
  validateRoleModelCapabilityJsonSchemaDefinition,
  validateRoleModelCapabilityResult,
  type RoleModelCapabilitiesGrant,
  type RoleModelCapabilitiesSystemConfig,
  type RoleModelCapabilityErrorCode,
  type RoleModelCapabilityLimits,
  type RoleModelCapabilityResult,
} from "@tavern/shared";

interface ContractFixture {
  calls: Array<{
    id: string;
    value: { toolName: string; arguments: unknown };
    schemaValid: boolean;
    semanticExpectation: string;
  }>;
  results: Array<{
    id: string;
    definition: string;
    value: unknown;
    schemaValid: boolean;
  }>;
}

const contractFixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../docs/plans/native-card-converter/model-tool-contract.examples.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as ContractFixture;

const baseLimits: RoleModelCapabilityLimits = {
  maxCallsPerTurn: 16,
  maxStepsPerGeneration: 8,
  maxRandomSamples: 32,
  maxRandomCandidates: 1024,
  maxCalculateNodes: 256,
  maxCalculateDepth: 32,
  maxCandidateDepth: 32,
  maxInputBytes: 65536,
  maxResultBytes: 65536,
};

function makeSystemConfig(
  overrides: Partial<RoleModelCapabilitiesSystemConfig["limits"]> = {},
  configOverrides: Partial<
    Omit<RoleModelCapabilitiesSystemConfig, "limits" | "messages">
  > = {},
  messageOverrides: Partial<Record<RoleModelCapabilityErrorCode, string>> = {},
): RoleModelCapabilitiesSystemConfig {
  const messages = Object.fromEntries(
    roleModelCapabilityErrorCodes.map((code) => [
      code,
      `Configured message for ${code}.`,
    ]),
  ) as Record<RoleModelCapabilityErrorCode, string>;
  Object.assign(messages, messageOverrides);

  return {
    enabled: true,
    allowed: ["random", "calculate"],
    transports: ["native_function_call", "text_protocol"],
    slot: "narrator",
    limits: {
      ...baseLimits,
      minResultBytes: 1024,
      ...overrides,
    },
    messages,
    ...configOverrides,
  };
}

function makeGrant(
  overrides: Partial<RoleModelCapabilitiesGrant> = {},
): RoleModelCapabilitiesGrant {
  return {
    enabled: true,
    allowed: ["random", "calculate"],
    slot: "narrator",
    transport: "native_function_call",
    ...overrides,
  };
}

function execute(
  toolName: string,
  args: unknown,
  options: {
    systemConfig?: RoleModelCapabilitiesSystemConfig;
    grant?: RoleModelCapabilitiesGrant | null;
    limits?: Partial<RoleModelCapabilityLimits>;
    random?: () => number;
    callerSlot?: "narrator" | "director" | "memory";
    capabilityDisabled?: boolean;
    callLimitExceeded?: boolean;
  } = {},
): RoleModelCapabilityResult {
  const systemConfig = options.systemConfig ?? makeSystemConfig();
  const limits = { ...baseLimits, ...options.limits };
  const grant = options.grant === undefined ? makeGrant() : options.grant;
  const configuredGrant =
    grant && options.limits
      ? { ...grant, limits: { ...grant.limits, ...options.limits } }
      : grant;

  return executeRoleModelCapability({
    toolName,
    arguments: args,
    systemConfig,
    grant: configuredGrant,
    callerSlot: options.callerSlot ?? "narrator",
    capabilityDisabled: options.capabilityDisabled,
    callLimitExceeded: options.callLimitExceeded,
    random: options.random,
  });
}

function resultError(result: RoleModelCapabilityResult): string | undefined {
  return result.ok ? undefined : result.error.code;
}

function randomChoicesArgs(
  values: unknown[],
  count: number,
  replacement: boolean,
  distribution: unknown = { kind: "uniform" },
) {
  return {
    domain: { kind: "choices", values },
    distribution,
    count,
    replacement,
  };
}

function calculate(expression: unknown): RoleModelCapabilityResult {
  return execute("calculate", { expression });
}

describe("role model capability contract", () => {
  it("matches every documented call and result fixture against the canonical Draft-07 validators", () => {
    for (const fixture of contractFixture.calls) {
      const schemaResult = validateRoleModelCapabilityInvocation(fixture.value);
      expect(schemaResult.valid, fixture.id).toBe(fixture.schemaValid);

      if (!fixture.schemaValid) continue;
      const semanticResult = validateRoleModelCapabilityArguments(
        fixture.value.toolName,
        fixture.value.arguments,
        baseLimits,
      );
      if (fixture.semanticExpectation === "valid") {
        expect(semanticResult.valid, fixture.id).toBe(true);
      } else {
        const actualCode = semanticResult.valid
          ? resultError(
              executeRoleModelCapability({
                toolName: fixture.value.toolName,
                arguments: fixture.value.arguments,
                systemConfig: makeSystemConfig(),
                grant: makeGrant(),
                callerSlot: "narrator",
                random: () => 0,
              }),
            )
          : semanticResult.code;
        expect(actualCode, fixture.id).toBe(fixture.semanticExpectation);
      }
    }

    for (const fixture of contractFixture.results) {
      const result = validateRoleModelCapabilityJsonSchemaDefinition(
        fixture.value,
        fixture.definition,
      );
      expect(result.valid, fixture.id).toBe(fixture.schemaValid);
      expect(
        validateRoleModelCapabilityResult(fixture.value).valid,
        fixture.id,
      ).toBe(fixture.schemaValid);
    }
  });

  it("exports self-contained Draft-07 grant and limit schemas from the canonical definitions", () => {
    expect(roleModelCapabilitiesGrantJsonSchema.$schema).toBe(
      "http://json-schema.org/draft-07/schema#",
    );
    expect(roleModelCapabilityLimitsJsonSchema.$schema).toBe(
      "http://json-schema.org/draft-07/schema#",
    );
    expect(roleModelCapabilitiesGrantJsonSchema).not.toHaveProperty("$ref");
    expect(roleModelCapabilityLimitsJsonSchema).not.toHaveProperty("$ref");
    expect(
      roleModelCapabilitiesGrantSchema.safeParse(makeGrant()).success,
    ).toBe(true);
    expect(
      roleModelCapabilitiesGrantSchema.safeParse({
        ...makeGrant(),
        limits: { minResultBytes: 1024 },
      }).success,
    ).toBe(false);
    expect(
      roleModelCapabilitiesSystemConfigSchema.safeParse(makeSystemConfig())
        .success,
    ).toBe(true);
    expect(
      roleModelCapabilitiesSystemConfigSchema.safeParse(
        makeSystemConfig({ maxResultBytes: 1023 }),
      ).success,
    ).toBe(false);
    expect(ROLE_MODEL_CAPABILITIES_PROVIDER_ID).toBe(
      "system:role-model-capabilities",
    );
    expect(ROLE_MODEL_CAPABILITY_NAMES).toEqual(["random", "calculate"]);
  });
});

describe("random capability", () => {
  it("samples integer ranges with replacement and returns null indices", () => {
    const result = execute(
      "random",
      {
        domain: { kind: "integer_range", min: -2, max: 2 },
        distribution: { kind: "uniform" },
        count: 2,
        replacement: true,
      },
      { random: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999999) },
    );

    expect(result).toEqual({
      ok: true,
      data: { samples: [-2, 2], indices: null },
    });
  });

  it("samples integer ranges without replacement using a sparse shuffle", () => {
    const result = execute(
      "random",
      {
        domain: { kind: "integer_range", min: 7, max: 10 },
        distribution: { kind: "uniform" },
        count: 4,
        replacement: false,
      },
      { random: () => 0 },
    );

    expect(result.ok).toBe(true);
    if (result.ok && "samples" in result.data) {
      expect(result.data).toEqual({ samples: [7, 10, 9, 8], indices: null });
      expect(new Set(result.data.samples).size).toBe(4);
    }
  });

  it("preserves duplicate candidate positions during uniform sampling without replacement", () => {
    const result = execute(
      "random",
      randomChoicesArgs(["same", "same"], 2, false),
      { random: () => 0 },
    );
    expect(result).toEqual({
      ok: true,
      data: { samples: ["same", "same"], indices: [0, 1] },
    });
  });

  it("uses positive weights only and recalculates survivors for weighted draws without replacement", () => {
    const result = execute(
      "random",
      randomChoicesArgs(["zero", "two", "four"], 2, false, {
        kind: "weighted",
        weights: [0, 2, 4],
      }),
      { random: vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.3) },
    );

    expect(result).toEqual({
      ok: true,
      data: { samples: ["four", "two"], indices: [2, 1] },
    });
  });

  it("allows repeated weighted picks only with replacement and never selects a zero-weight candidate", () => {
    const result = execute(
      "random",
      randomChoicesArgs(["zero", "only"], 3, true, {
        kind: "weighted",
        weights: [0, 5],
      }),
      { random: () => 0.99 },
    );

    expect(result).toEqual({
      ok: true,
      data: { samples: ["only", "only", "only"], indices: [1, 1, 1] },
    });
  });

  it.each([
    [
      "reversed range",
      {
        domain: { kind: "integer_range", min: 4, max: 1 },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      "INVALID_RANGE",
    ],
    [
      "unsafe range size",
      {
        domain: {
          kind: "integer_range",
          min: -9007199254740991,
          max: 9007199254740991,
        },
        distribution: { kind: "uniform" },
        count: 1,
        replacement: true,
      },
      "INVALID_RANGE",
    ],
    [
      "weight mismatch",
      randomChoicesArgs(["a", "b"], 1, true, {
        kind: "weighted",
        weights: [1],
      }),
      "INVALID_WEIGHTS",
    ],
    [
      "zero weight total",
      randomChoicesArgs(["a", "b"], 1, true, {
        kind: "weighted",
        weights: [0, 0],
      }),
      "INVALID_WEIGHTS",
    ],
    [
      "insufficient positive weighted population",
      randomChoicesArgs(["a", "b"], 2, false, {
        kind: "weighted",
        weights: [1, 0],
      }),
      "INSUFFICIENT_POPULATION",
    ],
    [
      "insufficient candidate population",
      randomChoicesArgs(["a"], 2, false),
      "INSUFFICIENT_POPULATION",
    ],
    [
      "sample quota",
      {
        domain: { kind: "integer_range", min: 1, max: 6 },
        distribution: { kind: "uniform" },
        count: 33,
        replacement: true,
      },
      "LIMIT_EXCEEDED",
    ],
    [
      "candidate quota",
      randomChoicesArgs(
        Array.from({ length: 3 }, (_, index) => index),
        1,
        true,
      ),
      "LIMIT_EXCEEDED",
      { maxRandomCandidates: 2 },
    ],
  ] as Array<[string, unknown, string, Partial<RoleModelCapabilityLimits>?]>)(
    "rejects %s with the configured contract error",
    (_name, args, code, limits) => {
      expect(resultError(execute("random", args, { limits }))).toBe(code);
    },
  );
});

describe("calculate capability", () => {
  it.each([
    ["add", { op: "add", args: [6, 2] }, { type: "number", value: 8 }],
    ["multiply", { op: "mul", args: [6, 2] }, { type: "number", value: 12 }],
    ["minimum", { op: "min", args: [6, 2] }, { type: "number", value: 2 }],
    ["maximum", { op: "max", args: [6, 2] }, { type: "number", value: 6 }],
    ["subtract", { op: "sub", args: [6, 2] }, { type: "number", value: 4 }],
    ["divide", { op: "div", args: [6, 2] }, { type: "number", value: 3 }],
    ["equal", { op: "eq", args: [6, 2] }, { type: "boolean", value: false }],
    ["not equal", { op: "ne", args: [6, 2] }, { type: "boolean", value: true }],
    [
      "less than",
      { op: "lt", args: [6, 2] },
      { type: "boolean", value: false },
    ],
    [
      "less than or equal",
      { op: "lte", args: [6, 2] },
      { type: "boolean", value: false },
    ],
    [
      "greater than",
      { op: "gt", args: [6, 2] },
      { type: "boolean", value: true },
    ],
    [
      "greater than or equal",
      { op: "gte", args: [6, 2] },
      { type: "boolean", value: true },
    ],
    [
      "floor negative",
      { op: "floor", args: [-2.8] },
      { type: "number", value: -3 },
    ],
    [
      "ceil negative",
      { op: "ceil", args: [-2.8] },
      { type: "number", value: -2 },
    ],
    [
      "truncate negative",
      { op: "trunc", args: [-2.8] },
      { type: "number", value: -2 },
    ],
    [
      "nested left-to-right arithmetic",
      { op: "add", args: [1e16, -1e16, 1] },
      { type: "number", value: 1 },
    ],
    [
      "normalize negative zero",
      { op: "div", args: [-0, 1] },
      { type: "number", value: 0 },
    ],
  ] as const)("evaluates %s", (_name, expression, expected) => {
    expect(calculate(expression)).toEqual({ ok: true, data: expected });
  });

  it.each([
    ["positive zero", { op: "div", args: [1, 0] }],
    ["negative zero", { op: "div", args: [1, -0] }],
  ])("rejects division by %s", (_name, expression) => {
    expect(resultError(calculate(expression))).toBe("DIVISION_BY_ZERO");
  });

  it("reports non-finite intermediate results before later operations can mask them", () => {
    expect(
      resultError(calculate({ op: "add", args: [1e308, 1e308, -1e308] })),
    ).toBe("NUMERIC_OVERFLOW");
    expect(resultError(calculate({ op: "mul", args: [1e308, 1e308] }))).toBe(
      "NUMERIC_OVERFLOW",
    );
  });
});

describe("capability size and structural limits", () => {
  it("measures UTF-8 JSON bytes consistently with Buffer.byteLength", () => {
    const value = { message: "塔🙂" };
    expect(measureRoleModelCapabilityJsonBytes(value)).toBe(
      Buffer.byteLength(JSON.stringify(value), "utf8"),
    );
  });

  function inputArgsAtByteLength(target: number) {
    const makeArgs = (value: string) => randomChoicesArgs([value], 1, true);
    const baseBytes = Buffer.byteLength(JSON.stringify(makeArgs("")), "utf8");
    return makeArgs("x".repeat(target - baseBytes));
  }

  function resultArgsAtByteLength(target: number) {
    const makeArgs = (value: string) => randomChoicesArgs([value], 1, false);
    const envelope = { ok: true, data: { samples: [""], indices: [0] } };
    const baseBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
    return makeArgs("x".repeat(target - baseBytes));
  }

  it("accepts 65,536 argument bytes and rejects 65,537", () => {
    const exact = inputArgsAtByteLength(65536);
    const over = inputArgsAtByteLength(65537);
    expect(Buffer.byteLength(JSON.stringify(exact), "utf8")).toBe(65536);
    expect(Buffer.byteLength(JSON.stringify(over), "utf8")).toBe(65537);
    expect(
      validateRoleModelCapabilityArguments("random", exact, baseLimits).valid,
    ).toBe(true);
    expect(
      validateRoleModelCapabilityArguments("random", over, baseLimits),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  it("accepts a 65,536-byte result envelope and replaces a 65,537-byte result with LIMIT_EXCEEDED", () => {
    const exactArgs = resultArgsAtByteLength(65536);
    const overArgs = resultArgsAtByteLength(65537);
    const systemConfig = makeSystemConfig({ maxInputBytes: 100000 });
    const exact = execute("random", exactArgs, { systemConfig });
    const over = execute("random", overArgs, { systemConfig });
    expect(exact.ok).toBe(true);
    if (exact.ok)
      expect(Buffer.byteLength(JSON.stringify(exact), "utf8")).toBe(65536);
    expect(resultError(over)).toBe("LIMIT_EXCEEDED");
  });

  function nestedCandidate(depth: number): unknown {
    let value: unknown = 0;
    for (let index = 0; index < depth; index += 1) value = { child: value };
    return value;
  }

  it("checks candidate container depth at 32 and 33", () => {
    const argsFor = (depth: number) =>
      randomChoicesArgs([nestedCandidate(depth)], 1, true);
    const limits = { ...baseLimits, maxCandidateDepth: 32 };
    expect(
      validateRoleModelCapabilityArguments("random", argsFor(32), limits).valid,
    ).toBe(true);
    expect(
      validateRoleModelCapabilityArguments("random", argsFor(33), limits),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  function unaryChain(depth: number): unknown {
    let expression: unknown = 1;
    for (let index = 1; index < depth; index += 1)
      expression = { op: "floor", args: [expression] };
    return expression;
  }

  it("checks expression depth at 32 and 33", () => {
    const argsFor = (depth: number) => ({ expression: unaryChain(depth) });
    const limits = { ...baseLimits, maxCalculateDepth: 32 };
    expect(
      validateRoleModelCapabilityArguments("calculate", argsFor(32), limits)
        .valid,
    ).toBe(true);
    expect(
      validateRoleModelCapabilityArguments("calculate", argsFor(33), limits),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  it("rejects deeply nested candidate JSON before recursive schema validation", () => {
    expect(
      validateRoleModelCapabilityArguments(
        "random",
        randomChoicesArgs([nestedCandidate(5000)], 1, true),
        baseLimits,
      ),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  it("rejects deeply nested expressions before recursive schema validation", () => {
    expect(
      validateRoleModelCapabilityArguments(
        "calculate",
        { expression: unaryChain(5000) },
        baseLimits,
      ),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  function unaryNodeChain(nodes: number): unknown {
    let expression: unknown = 1;
    for (let index = 1; index < nodes; index += 1)
      expression = { op: "floor", args: [expression] };
    return expression;
  }

  it("checks calculate node quota at 256 and 257", () => {
    const argsFor = (nodes: number) => ({ expression: unaryNodeChain(nodes) });
    const limits = {
      ...baseLimits,
      maxCalculateDepth: 300,
      maxCalculateNodes: 256,
    };
    expect(
      validateRoleModelCapabilityArguments("calculate", argsFor(256), limits)
        .valid,
    ).toBe(true);
    expect(
      validateRoleModelCapabilityArguments("calculate", argsFor(257), limits),
    ).toMatchObject({ valid: false, code: "LIMIT_EXCEEDED" });
  });

  it("keeps configured error envelopes below the 1,024-byte result floor", () => {
    const systemConfig = makeSystemConfig(
      { maxResultBytes: 1024 },
      {},
      { CAPABILITY_DENIED: "界".repeat(128) },
    );
    const result = execute("random", randomChoicesArgs(["x"], 1, true), {
      systemConfig,
      grant: makeGrant({ enabled: false }),
    });
    expect(resultError(result)).toBe("CAPABILITY_DENIED");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      1024,
    );
  });
});

describe("fixed capability provider authorization", () => {
  const context = { callerSlot: "narrator" } as ToolExecutionContext;
  const validRandomArgs = {
    domain: { kind: "integer_range", min: 1, max: 6 },
    distribution: { kind: "uniform" },
    count: 1,
    replacement: true,
  };

  it("lists only capabilities allowed by the system and grant", async () => {
    const provider = new RoleModelCapabilitiesToolProvider({
      systemConfig: makeSystemConfig(),
      grant: makeGrant({ allowed: ["calculate"] }),
      resolveGrant: async () => makeGrant({ allowed: ["calculate"] }),
    });
    expect(provider.id).toBe(ROLE_MODEL_CAPABILITIES_PROVIDER_ID);
    expect((await provider.listTools()).map((tool) => tool.name)).toEqual([
      "calculate",
    ]);
  });

  it("checks the dynamic grant again for every reserved call", async () => {
    const resolveGrant = vi.fn(async () => makeGrant({ enabled: false }));
    const provider = new RoleModelCapabilitiesToolProvider({
      systemConfig: makeSystemConfig(),
      grant: makeGrant(),
      resolveGrant,
    });
    const result = await provider.executeTool(
      "random",
      validRandomArgs,
      context,
    );
    expect(resolveGrant).toHaveBeenCalledOnce();
    expect(result.data).toEqual({
      ok: false,
      error: {
        code: "CAPABILITY_DENIED",
        message: makeSystemConfig().messages.CAPABILITY_DENIED,
      },
    });
    expect(result.executionStatus).toBe("denied");
    expect(result.executionReasonCode).toBe("CAPABILITY_DENIED");
  });

  it("returns configured denial and quota envelopes for explicit orchestration markers", async () => {
    const provider = new RoleModelCapabilitiesToolProvider({
      systemConfig: makeSystemConfig(),
      grant: makeGrant(),
      resolveGrant: async () => makeGrant(),
    });
    const disabled = await provider.executeTool("random", validRandomArgs, {
      ...context,
      roleModelCapabilityDisabled: true,
    });
    const overQuota = await provider.executeTool("random", validRandomArgs, {
      ...context,
      roleModelCapabilityCallLimitExceeded: true,
    });
    expect(disabled.data as RoleModelCapabilityResult).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });
    expect(overQuota.data as RoleModelCapabilityResult).toMatchObject({
      ok: false,
      error: { code: "LIMIT_EXCEEDED" },
    });
  });

  it("checks authorization before reporting a quota marker and denies other caller slots", () => {
    const result = executeRoleModelCapability({
      toolName: "random",
      arguments: validRandomArgs,
      systemConfig: makeSystemConfig(),
      grant: makeGrant({ allowed: ["calculate"] }),
      callerSlot: "director",
      callLimitExceeded: true,
    });
    expect(resultError(result)).toBe("CAPABILITY_DENIED");
  });

  it("denies calls when dynamic authorization cannot be resolved", async () => {
    const provider = new RoleModelCapabilitiesToolProvider({
      systemConfig: makeSystemConfig(),
      grant: makeGrant(),
      resolveGrant: async () => {
        throw new Error("revocation lookup failed");
      },
    });
    const result = await provider.executeTool(
      "random",
      validRandomArgs,
      context,
    );
    expect(result.data as RoleModelCapabilityResult).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });
  });
});
