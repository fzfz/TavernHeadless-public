import { describe, expect, it, vi } from "vitest";
import {
  roleModelCapabilityErrorCodes,
  type RoleModelCapabilitiesGrant,
  type RoleModelCapabilitiesSystemConfig,
  type RoleModelCapabilityErrorCode,
  type RoleModelCapabilityLimits,
} from "@tavern/shared";
import { TurnError, TurnOrchestrator } from "../turn-orchestrator.js";
import type { TurnOrchestratorDeps } from "../turn-orchestrator.js";
import type { TurnInput } from "../types.js";
import type { GenerationOutput } from "../../generation/types.js";
import { RoleModelCapabilitiesToolProvider } from "../../tools/role-model-capability-executor.js";
import { ToolRegistry } from "../../tools/tool-registry.js";

const limits: RoleModelCapabilityLimits = {
  maxCallsPerTurn: 8,
  maxStepsPerGeneration: 5,
  maxRandomSamples: 16,
  maxRandomCandidates: 128,
  maxCalculateNodes: 64,
  maxCalculateDepth: 16,
  maxCandidateDepth: 16,
  maxInputBytes: 8192,
  maxResultBytes: 8192,
};

const systemConfig: RoleModelCapabilitiesSystemConfig = {
  enabled: true,
  allowed: ["random", "calculate"],
  transports: ["native_function_call", "text_protocol"],
  slot: "narrator",
  limits: { ...limits, minResultBytes: 512 },
  messages: Object.fromEntries(
    roleModelCapabilityErrorCodes.map((code) => [code, `Configured ${code}.`]),
  ) as Record<RoleModelCapabilityErrorCode, string>,
};

function grant(
  transport: "native_function_call" | "text_protocol",
  override: Partial<RoleModelCapabilitiesGrant> = {},
): RoleModelCapabilitiesGrant {
  return {
    enabled: true,
    allowed: ["random"],
    slot: "narrator",
    transport,
    limits,
    ...override,
  };
}

const randomArgs = {
  domain: { kind: "integer_range", min: 1, max: 6 },
  distribution: { kind: "uniform" },
  count: 1,
  replacement: true,
};

function output(text: string, overrides: Partial<GenerationOutput> = {}): GenerationOutput {
  return {
    text,
    rawText: text,
    summaries: [],
    usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    finishReason: "stop",
    ...overrides,
  };
}

function makeDeps(
  generationRun: ReturnType<typeof vi.fn>,
  verifier?: ReturnType<typeof vi.fn>,
  toolExecutionRepository?: any,
): TurnOrchestratorDeps {
  const state = {
    id: "floor-1",
    sessionId: "session-1",
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "generating",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return {
    floorStateMachine: {
      canTransition: vi.fn().mockReturnValue(true),
      transition: vi.fn().mockResolvedValue(state),
      ensureGenerating: vi.fn().mockResolvedValue(state),
      fail: vi.fn().mockResolvedValue({ ...state, state: "failed" }),
    } as any,
    generationPipeline: { run: generationRun } as any,
    memoryStore: {
      prepareInjection: vi.fn().mockResolvedValue({ items: [], formattedText: "", tokenCount: 0 }),
      ingestSummaries: vi.fn().mockResolvedValue([]),
      applyConsolidation: vi.fn().mockResolvedValue(undefined),
    } as any,
    memoryConsolidator: { consolidate: vi.fn() } as any,
    director: { direct: vi.fn() } as any,
    verifier: {
      verify: verifier ?? vi.fn().mockResolvedValue({
        output: { passed: true, issues: [] },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    } as any,
    eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
    tokenCounter: { name: "test", count: vi.fn((text: string) => text.length) },
    ...(toolExecutionRepository ? { toolExecutionRepository } : {}),
  } as TurnOrchestratorDeps;
}

function makeInput(
  transport: "native_function_call" | "text_protocol",
  overrides: Partial<TurnInput> = {},
): TurnInput {
  const capabilityGrant = overrides.roleModelCapabilities ?? grant(transport);
  const provider = new RoleModelCapabilitiesToolProvider({
    systemConfig,
    grant: capabilityGrant,
    resolveGrant: vi.fn().mockResolvedValue(capabilityGrant),
    random: () => 0.5,
  });
  const registry = new ToolRegistry();
  registry.register(provider);
  return {
    sessionId: "session-1",
    floorId: "floor-1",
    toolExecutionRunId: "run-1",
    pageId: "input-page-1",
    messages: [
      { role: "system", content: "Use only the configured system capability." },
      { role: "user", content: "Please continue." },
    ],
    generationParams: { temperature: 0, maxOutputTokens: 128 },
    config: { enableTools: true, toolMode: "inline" },
    roleModelCapabilities: capabilityGrant,
    toolRegistry: registry,
    toolPermissions: {
      enabled: true,
      maxCallsPerTurn: 8,
      maxStepsPerGeneration: 5,
    },
    toolTransport: {
      selection: {
        transport,
        reasonCode: "explicit_override",
      },
      ...(transport === "text_protocol"
        ? {
            toolList: {
              injected: true,
              contributorId: "builtin:tool_list",
              toolCount: 1,
            },
          }
        : { toolChoiceApplied: true }),
    },
    graphAssistantAgentLoop: { decideConfirmation: () => "auto" as const },
    ...overrides,
  } as TurnInput;
}

function makeTextCall(callId: string, args: unknown, toolName = "random"): GenerationOutput {
  const text = `<tool_call id="${callId}" name="${toolName}">${JSON.stringify({ args })}</tool_call>`;
  return output(text);
}

function makeNativeCall(callId: string, args: Record<string, unknown>): GenerationOutput {
  return output("Checking one value.", {
    finishReason: "tool_calls",
    toolCalls: [{ callId, toolName: "random", args }],
  });
}

describe("role model capability generation loops", () => {
  it.each(["text_protocol", "native_function_call"] as const)(
    "%s never accepts prose from a step containing an unknown tool call",
    async (transport) => {
      let calls = 0;
      const generationRun = vi.fn(async () => {
        calls += 1;
        if (transport === "text_protocol") {
          return calls === 1
            ? output(`Do this first.\n${makeTextCall("call-unknown", {}, "unavailable_tool").text}`)
            : output("Only this later body is final.");
        }
        return output("This prose is tied to an unavailable tool.", {
          finishReason: "tool_calls",
          toolCalls: [{ callId: "call-unknown", toolName: "unavailable_tool", args: {} }],
        });
      });
      const input = makeInput(transport);
      const provider = input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider;
      const executeSpy = vi.spyOn(provider, "executeTool");
      const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

      if (transport === "text_protocol") {
        const result = await orchestrator.executeTurn(input);
        expect(result.generatedText).toBe("Only this later body is final.");
      } else {
        await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
        expect(generationRun).toHaveBeenCalledTimes(1);
      }
      expect(executeSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["text_protocol", "native_function_call"] as const)(
    "%s rejects a mixed valid and unknown tool-call batch atomically",
    async (transport) => {
      let calls = 0;
      const generationRun = vi.fn(async () => {
        calls += 1;
        if (calls > 1) return output("The corrected final body.");
        if (transport === "text_protocol") {
          const valid = makeTextCall("call-valid", randomArgs).text;
          const invalid = makeTextCall("call-unknown", {}, "unavailable_tool").text;
          return output(`Do not accept this step.\n${valid}\n${invalid}`);
        }
        return output("Prose with a mixed batch.", {
          finishReason: "tool_calls",
          toolCalls: [
            { callId: "call-valid", toolName: "random", args: randomArgs },
            { callId: "call-unknown", toolName: "unavailable_tool", args: {} },
          ],
        });
      });
      const input = makeInput(transport);
      const provider = input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider;
      const executeSpy = vi.spyOn(provider, "executeTool");
      const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

      if (transport === "text_protocol") {
        const result = await orchestrator.executeTurn(input);
        expect(result.generatedText).toBe("The corrected final body.");
      } else {
        await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
        expect(generationRun).toHaveBeenCalledTimes(1);
      }
      expect(executeSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["text_protocol", "native_function_call"] as const)(
    "%s does not accept a length-truncated final body",
    async (transport) => {
      const generationRun = vi.fn(async () => output("A truncated body.", { finishReason: "length" }));
      const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

      await expect(orchestrator.executeTurn(makeInput(transport))).rejects.toMatchObject({
        phase: "generation",
      });
      expect(generationRun).toHaveBeenCalledTimes(1);
    },
  );

  it("does not accept native prose when finishReason still reports tool calls but no calls are available", async () => {
    const generationRun = vi.fn(async () => output("An unfinished tool-call body.", {
      finishReason: "tool_calls",
      toolCalls: [],
    }));
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    await expect(orchestrator.executeTurn(makeInput("native_function_call"))).rejects.toMatchObject({
      phase: "generation",
    });
  });

  it.each([
    '<tool_call id="call-text" name="random">{"args":{}}</tool_call>',
    '<tool_result name="random">{"ok":true}</tool_result>',
    '<tool_response>result</tool_response>',
  ])("native rejects textual protocol blocks before stripping them: %s", async (block) => {
    const generationRun = vi.fn(async () => output(`A plausible body.\n${block}`));
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    await expect(orchestrator.executeTurn(makeInput("native_function_call"))).rejects.toMatchObject({
      phase: "generation",
    });
    expect(generationRun).toHaveBeenCalledTimes(1);
  });

  it("rejects a native tool-call batch with an empty call id before execution", async () => {
    const generationRun = vi.fn(async () => output("An unfinished call.", {
      finishReason: "tool_calls",
      toolCalls: [{ callId: "", toolName: "random", args: randomArgs }],
    }));
    const input = makeInput("native_function_call");
    const provider = input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider;
    const executeSpy = vi.spyOn(provider, "executeTool");
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
    expect(generationRun).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("rejects a native tool-call batch with duplicate call ids before executing any call", async () => {
    const generationRun = vi.fn(async () => output("An unfinished call batch.", {
      finishReason: "tool_calls",
      toolCalls: [
        { callId: "same-id", toolName: "random", args: randomArgs },
        { callId: "same-id", toolName: "random", args: randomArgs },
      ],
    }));
    const input = makeInput("native_function_call");
    const provider = input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider;
    const executeSpy = vi.spyOn(provider, "executeTool");
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
    expect(generationRun).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("rejects structured native calls returned on the text protocol path", async () => {
    const generationRun = vi.fn(async () => output("A plausible body.", {
      toolCalls: [{ callId: "wrong-protocol", toolName: "random", args: randomArgs }],
    }));
    const input = makeInput("text_protocol");
    const provider = input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider;
    const executeSpy = vi.spyOn(provider, "executeTool");
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
    expect(generationRun).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it.each(["text_protocol", "native_function_call"] as const)(
    "%s returns only the final body and associates the returned execution",
    async (transport) => {
      let calls = 0;
      const generationRun = vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return transport === "text_protocol"
            ? makeTextCall("call-1", randomArgs)
            : makeNativeCall("call-1", randomArgs);
        }
        return output("The final answer.");
      });
      const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

      const result = await orchestrator.executeTurn(makeInput(transport));

      expect(result.generatedText).toBe("The final answer.");
      expect(result.rawText).toBe("The final answer.");
      expect(result.toolResultWritebackText).toBeUndefined();
      expect(result.generationAttemptNo).toBe(1);
      expect(result.toolExecutionRecords).toHaveLength(1);
      const record = result.toolExecutionRecords![0]!;
      expect(record.callId).toBe("call-1");
      expect(record.generationAttemptNo).toBe(1);
      expect(record.generationStepNo).toBe(1);
      expect(result.acceptedToolExecutionIds).toEqual([record.id]);
      expect(JSON.parse(record.resultJson!)).toMatchObject({ ok: true, data: { samples: [4] } });
      expect(generationRun).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["text_protocol", "native_function_call"] as const)(
    "%s returns a structured provider error to the next model request",
    async (transport) => {
      let calls = 0;
      const generationRun = vi.fn(async (request: any) => {
        calls += 1;
        if (calls === 1) {
          const invalidArgs = { ...randomArgs, count: "1" };
          return transport === "text_protocol"
            ? makeTextCall("call-error", invalidArgs)
            : makeNativeCall("call-error", invalidArgs);
        }
        expect(JSON.stringify(request.messages)).toContain("INVALID_ARGUMENT");
        return output("The fallback answer.");
      });
      const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

      const result = await orchestrator.executeTurn(makeInput(transport));

      expect(result.generatedText).toBe("The fallback answer.");
      expect(result.acceptedToolExecutionIds).toEqual([result.toolExecutionRecords![0]!.id]);
      expect(result.toolExecutionRecords![0]!.status).toBe("error");
      expect(JSON.parse(result.toolExecutionRecords![0]!.resultJson!)).toMatchObject({
        ok: false,
        error: { code: "INVALID_ARGUMENT", message: expect.any(String) },
      });
      expect(generationRun).toHaveBeenCalledTimes(2);
    },
  );

  it("returns a terminal CAPABILITY_DENIED envelope for a reserved call after its grant is disabled", async () => {
    const disabledGrant = grant("text_protocol", { enabled: false, allowed: [] });
    let calls = 0;
    const generationRun = vi.fn(async (request: any) => {
      calls += 1;
      if (calls === 1) return makeTextCall("call-disabled", randomArgs);
      expect(JSON.stringify(request.messages)).toContain("CAPABILITY_DENIED");
      return output("I cannot use that capability.");
    });
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun));

    const result = await orchestrator.executeTurn(makeInput("text_protocol", {
      roleModelCapabilities: disabledGrant,
    }));

    expect(result.generatedText).toBe("I cannot use that capability.");
    expect(result.toolExecutionRecords?.[0]).toMatchObject({ status: "denied", callId: "call-disabled" });
    expect(JSON.parse(result.toolExecutionRecords![0]!.resultJson!)).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED", message: expect.any(String) },
    });
    expect(result.acceptedToolExecutionIds).toEqual([result.toolExecutionRecords![0]!.id]);
  });

  it("terminates when the call quota is exhausted and returns the configured error envelope", async () => {
    let generated = 0;
    const generationRun = vi.fn(async () => {
      generated += 1;
      return makeTextCall(`call-${generated}`, randomArgs);
    });
    const input = makeInput("text_protocol", {
      roleModelCapabilities: grant("text_protocol", {
        limits: { ...limits, maxCallsPerTurn: 1 },
      }),
      toolPermissions: {
        enabled: true,
        maxCallsPerTurn: 1,
        maxStepsPerGeneration: 5,
      },
    });
    const executionRepository = {
      insertMany: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
      markRunCommitOutcome: vi.fn().mockResolvedValue(0),
      findByFloorId: vi.fn().mockResolvedValue([]),
      findByRunId: vi.fn().mockResolvedValue([]),
    };
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun, undefined, executionRepository));

    await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({
      phase: "generation",
    } satisfies Partial<TurnError>);

    expect(generationRun).toHaveBeenCalledTimes(2);
    expect((input.toolRegistry!.getAllProviders()[0] as RoleModelCapabilitiesToolProvider).id)
      .toBe("system:role-model-capabilities");
    expect(executionRepository.finish).toHaveBeenCalledTimes(2);
    const quotaFailure = executionRepository.finish.mock.calls[1]![1];
    expect(quotaFailure.status).toBe("error");
    expect(JSON.parse(quotaFailure.resultJson)).toMatchObject({
      ok: false,
      error: { code: "LIMIT_EXCEEDED", message: expect.any(String) },
    });
  });

  it("drops tool associations from a failed verifier attempt and accepts only the passing retry", async () => {
    let generationCalls = 0;
    const generationRun = vi.fn(async () => {
      generationCalls += 1;
      if (generationCalls % 2 === 1) return makeTextCall(`call-${generationCalls}`, randomArgs);
      return output(`Candidate ${Math.ceil(generationCalls / 2)}.`);
    });
    let verifierCalls = 0;
    const verifier = vi.fn().mockImplementation(async () => {
      verifierCalls += 1;
      return {
        output: { passed: verifierCalls === 2, issues: verifierCalls === 1 ? [{ description: "retry", severity: "error" }] : [] },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun, verifier));
    const input = makeInput("text_protocol", {
      config: {
        enableTools: true,
        toolMode: "inline",
        enableVerifier: true,
        verifierFailStrategy: "retry",
        maxRetries: 1,
      },
      verifierInput: { characterRules: "A role must keep its identity.", activeFacts: [] },
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.generatedText).toBe("Candidate 2.");
    expect(result.generationAttemptNo).toBe(2);
    expect(result.toolExecutionRecords?.map((record) => record.generationAttemptNo)).toEqual([1, 2]);
    expect(result.acceptedToolExecutionIds).toEqual([result.toolExecutionRecords![1]!.id]);
    expect(result.acceptedToolExecutionIds).not.toContain(result.toolExecutionRecords![0]!.id);
  });

  it("treats a tool call on the final allowed step as incomplete, never as accepted body", async () => {
    const generationRun = vi.fn(async () => makeTextCall("call-incomplete", randomArgs));
    const input = makeInput("text_protocol", {
      roleModelCapabilities: grant("text_protocol", {
        limits: { ...limits, maxStepsPerGeneration: 1 },
      }),
      toolPermissions: { enabled: true, maxCallsPerTurn: 8, maxStepsPerGeneration: 1 },
    });
    const executionRepository = {
      insertMany: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
      markRunCommitOutcome: vi.fn().mockResolvedValue(0),
      findByFloorId: vi.fn().mockResolvedValue([]),
      findByRunId: vi.fn().mockResolvedValue([]),
    };
    const orchestrator = new TurnOrchestrator(makeDeps(generationRun, undefined, executionRepository));

    await expect(orchestrator.executeTurn(input)).rejects.toMatchObject({ phase: "generation" });
    expect(generationRun).toHaveBeenCalledTimes(1);
    expect(executionRepository.finish).toHaveBeenCalledTimes(1);
    expect(executionRepository.finish.mock.calls[0]![1].status).toBe("success");
  });
});
