import { createPresetOutput } from "../src/services/preset-output.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerChatRoutes } from "../src/routes/chat";
import { ChatServiceError, type ChatService, type RespondResult } from "../src/services/chat/chat-service";
import { WorldbookTriggerError } from "@tavern/adapters-sillytavern";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

interface ChatServiceStub {
  getRoleTextProcessor: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  dryRun: ReturnType<typeof vi.fn>;
  retryFloor: ReturnType<typeof vi.fn>;
  editAndRegenerate: ReturnType<typeof vi.fn>;
}

function createChatService(overrides: Partial<ChatServiceStub> = {}): ChatServiceStub {
  return {
    getRoleTextProcessor: vi.fn(() => createPresetOutput(undefined)),
    respond: vi.fn(),
    regenerate: vi.fn(),
    dryRun: vi.fn(),
    retryFloor: vi.fn(),
    editAndRegenerate: vi.fn(),
    ...overrides,
  };
}

describe("POST /sessions/:id/respond/stream", () => {
  let app: FastifyInstance;

  async function mountChatRoutes(
    chatService: ChatServiceStub,
    options: { enableSseChat?: boolean; enablePromptDryRun?: boolean } = {}
  ) {
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app);
    await registerChatRoutes(
      app,
      chatService as unknown as ChatService,
      { enableSseChat: true, enablePromptDryRun: true, ...options }
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("delivers projected body over HTTP before the model request completes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const processor = createPresetOutput({ version: 1, delivery: "streaming", streaming: {
      startMarkers: ["BODY:"], startMarkerLineBreak: true, hiddenBlocks: [], removedTokens: [],
    }, rules: [{ sourceRuleId: "body", pattern: "^[\\s\\S]*BODY:", flags: "g", replacement: "" }] });
    const chatService = createChatService({
      getRoleTextProcessor: vi.fn(() => processor),
      respond: vi.fn(async (_id, _request, runtime) => {
        runtime.onStart({ floorId: "f", floorNo: 1, branchId: "main" });
        runtime.onChunk('instructions say "BODY:", then write the body.');
        runtime.onChunk("BODY:\nfirst");
        runtime.onChunk(" second");
        await pending;
        return { floorId: "f", floorNo: 1, branchId: "main", generatedText: "BODY:\nfirst second", summaries: [], totalUsage: {promptTokens: 1, completionTokens: 1, totalTokens: 2}, finalState: "committed" };
      }),
    });
    await mountChatRoutes(chatService);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(address + "/sessions/s1/respond/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({message: "hello"}), signal: AbortSignal.timeout(3000) });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let wire = "";
      while (!wire.includes('"text":"\\nfirst second"')) {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        wire += decoder.decode(chunk.value);
      }
      expect(wire).not.toContain("event: done");
      const projected = wire.split("event: role_text\n").slice(1).map(part => JSON.parse(part.split("data: ")[1]!.split("\n")[0]!));
      expect(projected).toEqual([{text: "\nfirst", phase: "streaming"}, {text: "\nfirst second", phase: "streaming"}]);
      finish();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; wire += decoder.decode(chunk.value); }
      expect(wire).toContain("event: done");
    } finally { finish(); }
  });

  it("returns 404 when stream endpoint is disabled", async () => {
    const chatService = createChatService();

    await mountChatRoutes(chatService, { enableSseChat: false });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Stream endpoint is disabled",
      },
    });
  });


  it("streams start/chunk/summary/done events when enabled and maps generation params", async () => {
    const result: RespondResult = {
      floorId: "floor-1",
      floorNo: 3,
      branchId: "main",
      generatedText: "Hello world",
      summaries: ["short summary"],
      totalUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      promptSnapshot: {
        presetId: "preset-1",
        presetUpdatedAt: 1710000000000,
        presetVersion: 3,
        worldbookId: "worldbook-1",
        worldbookUpdatedAt: 1710000001000,
        worldbookVersion: 5,
        regexProfileId: "regex-1",
        regexProfileUpdatedAt: 1710000002000,
        regexProfileVersion: 2,
        worldbookActivatedEntryUids: [7],
        regexPreRuleNames: ["Input Rule"],
        regexPostRuleNames: [],
        promptMode: "compat_strict",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      runtimeTrace: {
        delivery: {
          assistantPrefillRequested: true,
          assistantPrefillApplied: false,
          assistantPrefillStrategy: "assistant_message_fallback",
          allowAssistantPrefill: true,
          requireLastUser: true,
          noAssistant: false,
          lastMessageRole: "user",
          endsWithUser: true,
          degraded: true,
          degradeReasons: ["require_last_user"],
        },
        worldbook: {
          hitCount: 1,
        },
      },
      finalState: "committed",
    };

    const chatService = createChatService({
      respond: vi.fn(async (_sessionId: string, request: unknown, runtimeOptions?: unknown, accountId?: string) => {
        expect(request).toEqual({
          message: "hello",
          config: undefined,
          generationParams: {
            temperature: 0.6,
            maxOutputTokens: 128,
            topP: 0.85,
            topK: 25,
            frequencyPenalty: 0.3,
            presencePenalty: 0.4,
            stopSequences: ["DONE"],
            stream: true,
            reasoningEffort: "medium",
          },
          branchId: "main",
          sourceFloorId: "floor-source",
          promptIntent: undefined,
          delivery: {
            allowAssistantPrefill: false,
            requireLastUser: true,
            noAssistant: false,
          },
          structure: {
            mode: "no_assistant",
            mergeAdjacentSameRole: false,
            assistantRewriteStrategy: "to_system",
            preserveSystemMessages: true,
          },
          debugOptions: {
            includePromptSnapshot: true,
            includeRuntimeTrace: true,
            includeWorldbookMatches: false,
          },
          sessionStateWrites: undefined,
          sessionStateOperationLog: undefined,
          turnOperationLog: {
            requestId: expect.any(String),
            route: "POST /sessions/:id/respond/stream",
          },
        });
        expect(accountId).toBe("default-admin");

        const runtime = runtimeOptions as {
          onStart?: (context: { floorId: string; floorNo: number; branchId: string }) => void;
          onRun?: (payload: Record<string, unknown>) => void;
          onChunk?: (chunk: string) => void;
          abortSignal?: AbortSignal;
        };

        expect(runtime.abortSignal).toBeInstanceOf(AbortSignal);
        runtime.onStart?.({ floorId: result.floorId, floorNo: result.floorNo, branchId: result.branchId });
        runtime.onRun?.({
          floorId: result.floorId,
          runId: "run-1",
          runType: "respond",
          status: "running",
          phase: "page_generating",
          publicPhase: "generating",
          phaseSeq: 2,
          attemptNo: 1,
          startedAt: 100,
          updatedAt: 110,
        });
        runtime.onChunk?.("Hello ");
        runtime.onChunk?.("world");
        return result;
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: {
        message: "hello",
        branch_id: "main",
        source_floor_id: "floor-source",
        delivery: {
          allow_assistant_prefill: false,
          require_last_user: true,
          no_assistant: false,
        },
        structure: {
          mode: "no_assistant",
          merge_adjacent_same_role: false,
          assistant_rewrite_strategy: "to_system",
          preserve_system_messages: true,
        },
        generation_params: {
          temperature: 0.6,
          max_output_tokens: 128,
          top_p: 0.85,
          top_k: 25,
          frequency_penalty: 0.3,
          presence_penalty: 0.4,
          stop_sequences: ["DONE"],
          stream: true,
          reasoning_effort: "medium",
        },
        debug_options: {
          include_prompt_snapshot: true,
          include_runtime_trace: true,
          include_worldbook_matches: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const body = response.body;
    expect(body).toContain("event: start");
    expect(body).toContain('"floor_id":"floor-1"');
    expect(body).toContain('"branch_id":"main"');
    expect(body).toContain("event: run");
    expect(body).toContain('"run_id":"run-1"');
    expect(body).toContain("event: chunk");
    expect(body).toContain('"chunk":"Hello "');
    expect(body).toContain('"chunk":"world"');
    expect(body).toContain("event: summary");
    expect(body).toContain('"summaries":["short summary"]');
    expect(body).toContain("event: done");
    expect(body).toContain('"generated_text":"Hello world"');
    expect(body).toContain('"prompt_snapshot":{');
    expect(body).toContain('"prompt_digest":"digest-1"');
    expect(body).toContain('"runtime_trace":{');
    expect(body).toContain('"assistant_prefill_requested":true');
  });

  it("streams error event when chat service fails", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new ChatServiceError("session_not_found", "Session 's1' not found");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: error");
    expect(response.body).toContain('"code":"not_found"');
    expect(response.body).toContain('"message":"Session');
  });

  it("streams internal_error event for unexpected failures", async () => {
    const chatService = createChatService({
      respond: vi.fn(async () => {
        throw new Error("unexpected stream failure");
      }),
    });

    await mountChatRoutes(chatService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: error");
    expect(response.body).toContain('"code":"internal_error"');
    expect(response.body).toContain('"message":"unexpected stream failure"');
  });

  it("streams the worldbook input error code and field path", async () => {
    await mountChatRoutes(createChatService({
      respond: vi.fn(async () => {
        throw new WorldbookTriggerError("WORLDBOOK_TRIGGER_INPUT_INVALID", "/entries/4/extra/extensions/probability");
      }),
    }));

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/stream",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"code":"WORLDBOOK_TRIGGER_INPUT_INVALID"');
    expect(response.body).toContain('"path":"/entries/4/extra/extensions/probability"');
  });
});
