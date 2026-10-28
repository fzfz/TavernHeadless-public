import { describe, expect, it, vi } from "vitest";
import type { RespondDryRunResult, TavernClient } from "@tavern/sdk";
import { useGenerationDryRun } from "./useGenerationDryRun.js";
import copy from "../config/generation-dry-run.json";
import { apiErrorMessages } from "@tavern/shared";

const preview = {
  messages: [{ role: "user", content: "Hello" }],
  assembly: { mode: "preset" },
  promptSnapshot: { source: "test" },
  tokenEstimate: 12,
  availableForReply: 100,
  memorySummary: null,
} as unknown as RespondDryRunResult;

function harness(respondDryRun = vi.fn().mockResolvedValue(preview)) {
  const client = { sessions: { respondDryRun } } as unknown as Pick<
    TavernClient,
    "sessions"
  >;
  return { state: useGenerationDryRun(client), respondDryRun };
}

describe("useGenerationDryRun", () => {
  it("submits the trimmed message for the selected main-branch session and exposes the result", async () => {
    const { state, respondDryRun } = harness();
    state.input.value = "  Hello  ";
    await state.run("session-7", "main");
    expect(respondDryRun).toHaveBeenCalledOnce();
    expect(respondDryRun).toHaveBeenCalledWith({
      sessionId: "session-7",
      branchId: "main",
      message: "Hello",
      debugOptions: { includeWorldbookMatches: true },
    });
    expect(state.result.value).toEqual(preview);
    expect(state.busy.value).toBe(false);
    expect(state.error.value).toBe("");
  });

  it("rejects empty input before any request", async () => {
    const { state, respondDryRun } = harness();
    await state.run("session-7", "main");
    expect(state.error.value).toBe(copy.emptyInput);
    expect(respondDryRun).not.toHaveBeenCalled();
  });

  it("submits the selected non-main branch", async () => {
    const { state, respondDryRun } = harness();
    state.input.value = "Continue";
    await state.run("session-7", "alternate");
    expect(respondDryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-7",
        branchId: "alternate",
        message: "Continue",
      }),
    );
  });

  it("reports an API failure and permits a retry", async () => {
    const respondDryRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(preview);
    const { state } = harness(respondDryRun);
    state.input.value = "Hello";
    await state.run("session-7", "main");
    expect(state.error.value).toBe(copy.failed);
    expect(state.busy.value).toBe(false);
    await state.run("session-7", "main");
    expect(state.result.value).toEqual(preview);
    expect(state.error.value).toBe("");
  });

  it("shows the shared message for a known API error code", async () => {
    const respondDryRun = vi
      .fn()
      .mockRejectedValue({ code: "MODEL_CALL_LOAD_FAILED" });
    const { state } = harness(respondDryRun);
    state.input.value = "Continue";
    await state.run("session-7", "missing-branch");
    expect(state.error.value).toBe(apiErrorMessages.MODEL_CALL_LOAD_FAILED);
  });

  it("ignores a response after the session context is cleared", async () => {
    let resolve!: (value: RespondDryRunResult) => void;
    const respondDryRun = vi.fn().mockReturnValue(
      new Promise<RespondDryRunResult>((done) => {
        resolve = done;
      }),
    );
    const { state } = harness(respondDryRun);
    state.input.value = "Hello";
    const pending = state.run("session-7", "main");
    expect(state.busy.value).toBe(true);
    state.clear();
    resolve(preview);
    await pending;
    expect(state.result.value).toBeNull();
    expect(state.busy.value).toBe(false);
  });

  it("keeps the latest request when responses resolve out of order", async () => {
    const resolve: Array<(value: RespondDryRunResult) => void> = [];
    const respondDryRun = vi.fn().mockImplementation(
      () =>
        new Promise<RespondDryRunResult>((done) => {
          resolve.push(done);
        }),
    );
    const { state } = harness(respondDryRun);
    state.input.value = "First";
    const first = state.run("session-7", "main");
    state.input.value = "Second";
    const second = state.run("session-7", "main");
    resolve[1]!({ ...preview, tokenEstimate: 22 });
    await second;
    resolve[0]!(preview);
    await first;
    expect(state.result.value?.tokenEstimate).toBe(22);
  });
});
