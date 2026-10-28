import { expect, it, vi } from "vitest";
import {
  apiErrorMessages,
  roleStatePolicy,
  type RoleDisplaySnapshot,
  type RoleRuntimeSession,
  type RoleRuntimeTransport,
} from "@tavern/shared";
import { createSessionHost } from "../session-controller.js";
const current: RoleDisplaySnapshot = {
  sessionId: "s",
  branchId: "main",
  floorId: "f",
  attemptId: "a",
  versionId: "v",
  snapshotId: "before",
  parentSnapshotId: "initial",
  variables: { score: 1 },
  source: { kind: "floor", runId: "r", jobId: null },
};
const after: RoleDisplaySnapshot = {
  ...current,
  snapshotId: "after",
  parentSnapshotId: "before",
  variables: { score: 2 },
};
function fixture() {
  let notify!: (snapshot: RoleDisplaySnapshot) => void;
  const unsubscribe = vi.fn();
  const restoreMissing = vi.fn(async (input: { operationId: string }) => ({
    operationId: input.operationId,
    before: current,
    after,
  }));
  const transport = {
    restoreMissing,
    getCurrentSnapshot: vi.fn(async () => after),
    recalculateLatest: restoreMissing,
    subscribeState: vi.fn((options: { onCurrent: typeof notify }) => {
      notify = options.onCurrent;
      return unsubscribe;
    }),
    getSnapshot: vi.fn(async () => ({ ...current, snapshotId: "history" })),
    dispose: vi.fn(),
  } as unknown as RoleRuntimeTransport;
  const host = createSessionHost({
    session: {
      sessionId: "s",
      branchId: "main",
      versionId: "v",
      current,
      processing: { pendingMain: null },
    } as RoleRuntimeSession,
    transport,
    errors: apiErrorMessages,
    policy: {
      overscanFloors: 1,
      historyCache: { maxEntries: 4, maxBytes: 4096 },
      settledStreamCache: { maxEntries: 4, maxBytes: 4096 },
      diagnosticsCache: { maxEntries: 4, maxBytes: 4096 },
    },
  });
  return {
    host,
    transport,
    restoreMissing,
    unsubscribe,
    notify: (value: RoleDisplaySnapshot) => notify(value),
  };
}
it.each(["restoreMissing", "recalculateLatest"] as const)(
  "repairs state with %s over HTTP without crypto.randomUUID",
  async (method) => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });
    const f = fixture();
    try {
      const result =
        method === "restoreMissing"
          ? await f.host.restoreMissing({
              branchId: "main",
              expectedSnapshotId: "before",
            })
          : await f.host.recalculateLatest({
              branchId: "main",
              floorId: "f",
              expectedSnapshotId: "before",
            });
      expect(result).toMatchObject({
        operationId: "00000000-0000-4000-8000-000000000000",
        after,
      });
      expect(f.host.get("current")).toEqual(after);
    } finally {
      f.host.dispose();
      vi.unstubAllGlobals();
    }
  },
);

it("repairs current state while preserving selected history and keeps repair separate from turn commits", async () => {
  const f = fixture();
  await f.host.select("history");
  const commit = vi.fn(),
    watch = vi.fn();
  f.host.onTurnCommitted(commit);
  f.host.watch("current", watch);
  const result = await f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  expect(result.after).toEqual(after);
  expect(f.host.get("current")).toEqual(after);
  expect(f.host.get("view").snapshotId).toBe("history");
  expect(watch).toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(f.restoreMissing.mock.calls[0]![0].operationId).toBeTruthy();
  f.host.dispose();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
});
it("receives another page's state repair without changing the historical view", async () => {
  const f = fixture();
  await f.host.select("history");
  f.notify(after);
  await vi.waitFor(() =>
    expect(f.host.get("current").snapshotId).toBe("after"),
  );
  expect(f.host.get("current").snapshotId).toBe("after");
  expect(f.host.get("view").snapshotId).toBe("history");
  f.host.dispose();
});
it("keeps current state on failure and releases the busy state for retry", async () => {
  const f = fixture();
  f.restoreMissing.mockRejectedValueOnce(new Error("model failed"));
  await expect(
    f.host.recalculateLatest({
      branchId: "main",
      floorId: "f",
      expectedSnapshotId: "before",
    }),
  ).rejects.toThrow("model failed");
  expect(f.host.get("current").snapshotId).toBe("before");
  await f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  expect(f.host.get("current").snapshotId).toBe("after");
  f.host.dispose();
});
it("rejects stale, invalid and concurrent operations before transport execution", async () => {
  const f = fixture();
  await expect(
    f.host.restoreMissing({ branchId: "main", expectedSnapshotId: "old" }),
  ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  await expect(
    f.host.recalculateLatest({
      branchId: "main",
      floorId: "",
      expectedSnapshotId: "before",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  let finish!: (value: {
    operationId: string;
    before: RoleDisplaySnapshot;
    after: RoleDisplaySnapshot;
  }) => void;
  f.restoreMissing.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  await expect(
    f.host.restoreMissing({ branchId: "main", expectedSnapshotId: "before" }),
  ).rejects.toMatchObject({ code: "SEND_BUSY" });
  finish({
    operationId: f.restoreMissing.mock.calls[0]![0].operationId,
    before: current,
    after,
  });
  await pending;
  expect(f.restoreMissing).toHaveBeenCalledOnce();
  f.host.dispose();
});
it("does not overwrite a newer cross-page update with a delayed HTTP response", async () => {
  const f = fixture();
  vi.mocked(f.transport.getCurrentSnapshot).mockResolvedValue({
    ...after,
    snapshotId: "newest",
    parentSnapshotId: "after",
  });
  f.restoreMissing.mockImplementationOnce(async (input) => {
    f.notify({ ...after, snapshotId: "newest", parentSnapshotId: "after" });
    return { operationId: input.operationId, before: current, after };
  });
  await f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  await vi.waitFor(() =>
    expect(f.host.get("current").snapshotId).toBe("newest"),
  );
  f.host.dispose();
});

it("ignores a delayed state refresh after a local repair and rereads the current record", async () => {
  const f = fixture();
  let finish!: (record: RoleDisplaySnapshot) => void;
  vi.mocked(f.transport.getCurrentSnapshot).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.notify(current);
  await f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  finish(current);
  await vi.waitFor(() =>
    expect(f.transport.getCurrentSnapshot).toHaveBeenCalledTimes(2),
  );
  expect(f.host.get("current").snapshotId).toBe("after");
  f.host.dispose();
});
it("defers cross-page refresh while a local repair is running", async () => {
  const f = fixture();
  let finish!: (value: {
    operationId: string;
    before: RoleDisplaySnapshot;
    after: RoleDisplaySnapshot;
  }) => void;
  f.restoreMissing.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.host.restoreMissing({
    branchId: "main",
    expectedSnapshotId: "before",
  });
  f.notify(current);
  expect(f.transport.getCurrentSnapshot).not.toHaveBeenCalled();
  finish({
    operationId: f.restoreMissing.mock.calls[0]![0].operationId,
    before: current,
    after,
  });
  await pending;
  await vi.waitFor(() =>
    expect(f.transport.getCurrentSnapshot).toHaveBeenCalledOnce(),
  );
  f.host.dispose();
});

it.each([false, true])(
  "retries a failed cross-page refresh and cancels it on dispose=%s",
  async (dispose) => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      vi.mocked(f.transport.getCurrentSnapshot).mockRejectedValueOnce(
        new Error("network offline"),
      );
      f.notify(after);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.host.get("current").snapshotId).toBe("before");
      if (dispose) f.host.dispose();
      await vi.advanceTimersByTimeAsync(roleStatePolicy.eventReconnectDelayMs);
      expect(f.transport.getCurrentSnapshot).toHaveBeenCalledTimes(
        dispose ? 1 : 2,
      );
      expect(f.host.get("current").snapshotId).toBe(
        dispose ? "before" : "after",
      );
    } finally {
      f.host.dispose();
      vi.useRealTimers();
    }
  },
);
