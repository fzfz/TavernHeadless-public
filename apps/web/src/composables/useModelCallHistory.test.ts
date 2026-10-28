import { describe, expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import { apiErrorMessages, type ModelCallDetail } from "@tavern/shared";
import { useModelCallHistory } from "./useModelCallHistory.js";

const item = (callId: string) =>
  ({
    call: { callId },
    completionEvidence: "complete",
    turnCommitStatus: "committed",
  }) as ModelCallDetail;
const setup = () => {
  const list = vi.fn();
  return {
    list,
    history: useModelCallHistory(
      { modelCalls: { list } } as unknown as TavernClient,
      "floor",
    ),
  };
};
describe("model call history view", () => {
  it("loads the selected filters and retains the selection while paging", async () => {
    const { list, history } = setup();
    list
      .mockResolvedValueOnce({ data: [item("one")], nextCursor: "one" })
      .mockResolvedValueOnce({ data: [item("two")], nextCursor: null });
    history.runId.value = " run ";
    history.attempt.value = "2";
    await history.load();
    expect(list).toHaveBeenNthCalledWith(1, {
      floorId: "floor",
      runId: "run",
      attemptNo: 2,
    });
    expect(history.selected.value?.call.callId).toBe("one");
    history.runId.value = "edited but not applied";
    await history.load(true);
    expect(list).toHaveBeenNthCalledWith(2, {
      floorId: "floor",
      runId: "run",
      attemptNo: 2,
      cursor: "one",
    });
    expect(history.calls.value.map((item) => item.call.callId)).toEqual([
      "one",
      "two",
    ]);
    expect(history.selectedId.value).toBe("one");
  });
  it("clears previous details on a new query and accepts an empty result", async () => {
    const { list, history } = setup();
    list
      .mockResolvedValueOnce({ data: [item("one")], nextCursor: "one" })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    await history.load();
    await history.load();
    expect(history.selected.value).toBeUndefined();
    expect(history.calls.value).toEqual([]);
    expect(history.nextCursor.value).toBeNull();
  });
  it("shows the shared backend message and permits a retry", async () => {
    const { list, history } = setup();
    list
      .mockRejectedValueOnce({ code: "MODEL_CALL_ACCESS_DENIED" })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    await history.load();
    expect(history.error.value).toBe(apiErrorMessages.MODEL_CALL_ACCESS_DENIED);
    expect(history.busy.value).toBe(false);
    await history.load();
    expect(history.error.value).toBe("");
  });
  it("reports a transport failure without showing an invented record", async () => {
    const { list, history } = setup();
    list.mockRejectedValue(new TypeError("network"));
    await history.load();
    expect(history.error.value).toBe(apiErrorMessages.MODEL_CALL_LOAD_FAILED);
    expect(history.calls.value).toEqual([]);
  });
  it("ignores a late response after the dialog closes and suppresses duplicate requests", async () => {
    const { list, history } = setup();
    let finish!: (value: unknown) => void;
    list.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const request = history.load();
    await history.load();
    expect(list).toHaveBeenCalledOnce();
    history.dispose();
    finish({ data: [item("late")], nextCursor: null });
    await request;
    expect(history.calls.value).toEqual([]);
  });
});
