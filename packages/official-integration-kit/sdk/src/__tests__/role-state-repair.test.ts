import { expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
import { readRoleStateStream } from "../stream/role-state-stream.js";
const before = {
  sessionId: "s",
  branchId: "main",
  floorId: "f",
  attemptId: "a",
  versionId: "v",
  snapshotId: "before",
  parentSnapshotId: "initial",
  variables: { count: 1 },
  source: { kind: "floor", runId: "r", jobId: null },
};
const after = {
  ...before,
  snapshotId: "after",
  parentSnapshotId: "before",
  variables: { count: 2 },
};
const result = { operationId: "operation", before, after };
it.each(["recalculateLatest", "restoreMissing"] as const)(
  "%s sends the authorized session request and validates its result",
  async (method) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: result }), {
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer t" }),
    });
    const input = {
      sessionId: "s/a",
      branchId: "main",
      floorId: "f",
      expectedSnapshotId: "before",
      operationId: "operation",
    };
    expect(await client.roleRuntime[method](input)).toEqual(result);
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.test/sessions/s%2Fa/role-state/${method === "recalculateLatest" ? "recalculate" : "restore-missing"}`,
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      branch_id: "main",
      expected_snapshot_id: "before",
      operation_id: "operation",
      ...(method === "recalculateLatest" ? { floor_id: "f" } : {}),
    });
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer t");
    await expect(
      client.roleRuntime[method]({ ...input, operationId: "" }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  },
);
it("consumes split UTF-8 SSE chunks, comments and both state events", async () => {
  const bytes = new TextEncoder().encode(
    `: heartbeat\r\nevent: state_current\r\ndata: ${JSON.stringify({ ...before, variables: { place: "花园" } })}\r\n\r\nevent: state_repair\ndata: ${JSON.stringify({ operationId: "operation", after })}\n\n`,
  );
  const onCurrent = vi.fn(),
    onRepair = vi.fn();
  await readRoleStateStream(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
    ),
    { onCurrent, onRepair },
  );
  expect(onCurrent).toHaveBeenCalledWith({
    ...before,
    variables: { place: "花园" },
  });
  expect(onRepair).toHaveBeenCalledWith({ operationId: "operation", after });
});
it("rejects invalid state events before notifying the page", async () => {
  const callbacks = { onCurrent: vi.fn(), onRepair: vi.fn() };
  await expect(
    readRoleStateStream(
      new Response(
        'event: state_repair\ndata: {"operationId":"o","after":{}}\n\n',
      ),
      callbacks,
    ),
  ).rejects.toThrow();
  expect(callbacks.onRepair).not.toHaveBeenCalled();
});
it("passes session, branch, authorization and abort signal to the event connection", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(`event: state_current\ndata: ${JSON.stringify(before)}\n\n`),
    );
  const client = createTavernClient({
    baseUrl: "https://api.test",
    fetchImpl,
    getHeaders: () => ({ authorization: "Bearer t" }),
  });
  const signal = new AbortController().signal,
    onCurrent = vi.fn();
  await client.roleRuntime.streamState({
    sessionId: "s/a",
    branchId: "a b",
    signal,
    onCurrent,
    onRepair: vi.fn(),
  });
  const [url, request] = fetchImpl.mock.calls[0]!;
  expect(String(url)).toBe(
    "https://api.test/sessions/s%2Fa/role-state/events?branch_id=a%20b",
  );
  expect(request?.signal).toBe(signal);
  expect(new Headers(request?.headers).get("authorization")).toBe("Bearer t");
  expect(onCurrent).toHaveBeenCalledWith(before);
});

it("reads an operation by its encoded identity and validates the saved result", async () => {
  const operation = { operationId: "op/a", sessionId: "s/a", branchId: "main", kind: "restore_missing", floorId: "f", beforeSnapshotId: "before", sourceSnapshotId: "initial", afterSnapshotId: "after", status: "succeeded", error: null };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({data: operation}), {headers: {"content-type":"application/json"}})).mockResolvedValueOnce(new Response(JSON.stringify({data: {status: "unknown"}}), {headers: {"content-type":"application/json"}}));
  const client = createTavernClient({baseUrl: "https://api.test", fetchImpl});
  expect(await client.roleRuntime.getStateOperation({sessionId: "s/a", operationId: "op/a"})).toEqual(operation);
  expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api.test/sessions/s%2Fa/role-state/operations/op%2Fa");
  await expect(client.roleRuntime.getStateOperation({sessionId: "s/a", operationId: "op/a"})).rejects.toThrow();
});
