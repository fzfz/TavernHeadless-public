import { describe, expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import type { RoleDisplaySnapshot } from "@tavern/shared";
import { createRoleTransport } from "../transport.js";

const current: RoleDisplaySnapshot = {
  sessionId: "s",
  branchId: "main",
  versionId: "v",
  snapshotId: "snapshot",
  parentSnapshotId: null,
  floorId: "f",
  attemptId: "r:1",
  variables: {},
  source: { kind: "floor", runId: "r", jobId: null },
};
function setup(state = "committed") {
  const getDetail = vi.fn().mockResolvedValue({
    id: "f",
    sessionId: "s",
    branchId: "main",
    state,
    supersededAt: null,
  });
  const pages = [
    { id: "input", floorId: "f", pageKind: "input", pageNo: 0, isActive: true },
    { id: "p1", floorId: "f", pageKind: "output", pageNo: 1, isActive: true },
    { id: "p2", floorId: "f", pageKind: "output", pageNo: 2, isActive: false },
  ];
  const activate = vi.fn().mockResolvedValue({ activeFloorId: "old", current });
  const update = vi.fn();
  const remove = vi.fn();
  const createManualRevision = vi.fn(
    async ({ operationId, expectedLatestRevisionNo }) => ({
      operationId,
      appliedRevisionNo: expectedLatestRevisionNo + 1,
    }),
  );
  const getManualRevisions = vi.fn().mockResolvedValue({ latestRevisionNo: 4 });
  const getCurrent = vi.fn().mockResolvedValue({ current });
  const client = {
    floors: { getDetail },
    replyCandidates: {
      list: vi.fn().mockResolvedValue({
        activeFloorId: "f",
        canActivate: true,
        items: [
          { floorId: "f", pageId: "p1" },
          { floorId: "old", pageId: "p2" },
        ],
      }),
      activate,
    },
    pages: { list: vi.fn().mockResolvedValue(pages), activate },
    messages: {
      list: vi.fn(async ({ pageId }) => [
        { id: pageId === "input" ? "u" : "a", pageId },
      ]),
      update,
      remove,
      getManualRevisions,
      createManualRevision,
    },
    roleRuntime: {
      getView: getCurrent,
      listFloors: vi.fn().mockResolvedValue({ items: [{ floorId: "f" }] }),
    },
    sessions: { getActiveRun: vi.fn().mockResolvedValue({ activeRun: null }) },
  } as unknown as TavernClient;
  return {
    client,
    transport: createRoleTransport(client, "s"),
    activate,
    update,
    remove,
    createManualRevision,
    getCurrent,
  };
}

describe("conversation SDK actions", () => {
  it("requires the revision captured when editing and preserves it when the server reports a conflict", async () => {
    const { transport, createManualRevision } = setup();
    await expect(
      transport.performAction(
        { kind: "edit", floorId: "f", messageId: "a", text: "本页草稿" },
        current,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(createManualRevision).not.toHaveBeenCalled();
    createManualRevision.mockRejectedValueOnce(
      Object.assign(new Error("消息已变化"), {
        status: 409,
        code: "manual_revision_conflict",
      }),
    );
    await expect(
      transport.performAction(
        {
          kind: "edit",
          floorId: "f",
          messageId: "a",
          text: "本页草稿",
          expectedRevisionNo: 2,
        },
        current,
      ),
    ).rejects.toMatchObject({ code: "manual_revision_conflict" });
    expect(createManualRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLatestRevisionNo: 2,
        content: "本页草稿",
      }),
    );
  });
  it("uses a numbered manual revision for saved messages and refreshes role state", async () => {
    const { transport, update, createManualRevision, getCurrent } = setup();
    await transport.performAction(
      {
        kind: "edit",
        floorId: "f",
        messageId: "a",
        text: "修改后的正文",
        expectedRevisionNo: 4,
      },
      current,
    );
    expect(createManualRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "a",
        action: "edit",
        content: "修改后的正文",
        expectedLatestRevisionNo: 4,
        operationId: expect.any(String),
      }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(getCurrent).toHaveBeenCalled();
  });

  it("records a saved message deletion as a revision without destroying committed evidence", async () => {
    const { transport, remove, createManualRevision } = setup();
    await transport.performAction(
      { kind: "delete", floorId: "f", messageId: "a", expectedRevisionNo: 4 },
      current,
    );
    expect(remove).not.toHaveBeenCalled();
    expect(createManualRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "a",
        action: "delete",
        expectedLatestRevisionNo: 4,
        operationId: expect.any(String),
      }),
    );
  });

  it("activates only a listed candidate with the current role snapshot as its expected state", async () => {
    const { transport, activate } = setup();
    await expect(
      transport.performAction(
        { kind: "candidate", floorId: "f", candidateFloorId: "unrelated" },
        current,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(activate).not.toHaveBeenCalled();
    await transport.performAction(
      { kind: "candidate", floorId: "f", candidateFloorId: "old" },
      current,
    );
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s",
        branchId: "main",
        floorId: "old",
        expectedSnapshotId: "snapshot",
        operationId: expect.any(String),
      }),
    );
  });

  it.each([undefined, 408, 503])(
    "replays the same saved edit receipt after an uncertain response (%s) and browser reload",
    async (status) => {
      const storage = new Map<string, string>();
      vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      });
      try {
        const { client, createManualRevision } = setup();
        createManualRevision.mockRejectedValueOnce(
          Object.assign(
            new TypeError("response lost"),
            status === undefined ? {} : { status },
          ),
        );
        const first = createRoleTransport(client, "s", {
          operationStorageKey: "account:s:main",
        });
        await expect(
          first.performAction(
            {
              kind: "edit",
              expectedRevisionNo: 4,
              floorId: "f",
              messageId: "a",
              text: "保存后的内容",
            },
            current,
          ),
        ).rejects.toThrow("response lost");
        const second = createRoleTransport(client, "s", {
          operationStorageKey: "account:s:main",
        });
        await second.reconcile();
        expect(createManualRevision.mock.calls[1]?.[0]).toEqual(
          createManualRevision.mock.calls[0]?.[0],
        );
        expect(storage.size).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("does not treat an unrelated revision timeline as confirmation", async () => {
    const { transport, createManualRevision } = setup();
    createManualRevision.mockResolvedValueOnce({
      operationId: "other",
      appliedRevisionNo: 5,
    });
    await expect(
      transport.performAction(
        { kind: "delete", floorId: "f", messageId: "a", expectedRevisionNo: 4 },
        current,
      ),
    ).rejects.toMatchObject({ code: "RESULT_UNKNOWN" });
  });
});
