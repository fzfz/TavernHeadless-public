import { it } from "vitest";
import assert from "node:assert/strict";

import { createSessionHost } from "../session-controller.ts";
import { createLegacyTestTransport } from "./legacy-transport.fixture.mjs";

it("preserves pending state and recovery ordering", async () => {
  const initial = {
    sessionId: "session-recovery",
    branchId: "branch-recovery",
    floorId: null,
    attemptId: null,
    versionId: "version-recovery",
    snapshotId: "snapshot-initial",
    parentSnapshotId: null,
    variables: { value: 0 },
    source: { kind: "initial", runId: null, jobId: null },
  };

  const committed = {
    sessionId: initial.sessionId,
    branchId: initial.branchId,
    floorId: "floor-2",
    attemptId: "attempt-2",
    versionId: initial.versionId,
    snapshotId: "snapshot-2",
    parentSnapshotId: initial.snapshotId,
    variables: { value: 2 },
    source: { kind: "floor", runId: "run-2", jobId: null },
  };

  const turnCommit = {
    eventId: "event-2",
    sessionId: initial.sessionId,
    branchId: initial.branchId,
    kind: "generated",
    previousCurrentSnapshotId: initial.snapshotId,
    before: initial,
    after: committed,
  };

  const envelope = (type, data) => JSON.stringify({ type, data });
  const stream = (...lines) =>
    new Response(lines.join("\n") + "\n", {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });

  let startRecovery;
  const recoveryStarted = new Promise((resolve) => {
    startRecovery = resolve;
  });
  let finishRecovery;
  const recoveryFinished = new Promise((resolve) => {
    finishRecovery = resolve;
  });
  let resolveRecovery;
  const delayedRecovery = new Promise((resolve) => {
    resolveRecovery = resolve;
  });
  let postCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      postCount += 1;
      if (postCount === 1)
        return stream(
          envelope("completed", { snapshotId: initial.snapshotId }),
          "{broken-json",
        );
      if (postCount === 2)
        return stream(
          envelope("commit", turnCommit),
          envelope("completed", { snapshotId: committed.snapshotId }),
        );
    }
    if (url === `/script-api/sessions/${initial.sessionId}`) {
      startRecovery();
      return delayedRecovery;
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };

  try {
    const reports = [];
    const host = createSessionHost({
      session: {
        sessionId: initial.sessionId,
        branchId: initial.branchId,
        versionId: initial.versionId,
        current: structuredClone(initial),
        delivery: { assets: {}, data: {} },
      },
      transport: createLegacyTestTransport(initial.sessionId),
      policy: {
        historyCache: { maxEntries: 4, maxBytes: 4096 },
        settledStreamCache: { maxEntries: 4, maxBytes: 4096 },
        diagnosticsCache: { maxEntries: 4, maxBytes: 4096 },
      },
      errors: {
        SCRIPT_FAILED: "script failed",
        INVALID_REQUEST: "invalid request",
        IDENTITY_MISMATCH: "identity mismatch",
        NETWORK_ERROR: "network error",
        RESULT_UNKNOWN: "result unknown",
        SEND_BUSY: "send busy",
      },
      onReport(error) {
        reports.push(error.code);
        finishRecovery();
      },
    });

    const currentSnapshots = [];
    const viewSnapshots = [];
    host.watch("current", (record) => currentSnapshots.push(record.snapshotId));
    host.watch("view", (record) => viewSnapshots.push(record.snapshotId));

    const firstResult = await host.send({ text: "first" });
    assert.equal(firstResult.snapshotId, initial.snapshotId);
    await recoveryStarted;

    const secondResult = await host.send({ text: "second" });
    assert.equal(secondResult.snapshotId, committed.snapshotId);
    assert.equal(host.get("current").snapshotId, committed.snapshotId);

    resolveRecovery(
      new Response(JSON.stringify({ current: initial }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await recoveryFinished;

    assert.equal(host.get("current").snapshotId, committed.snapshotId);
    assert.equal(host.get("view").snapshotId, committed.snapshotId);
    assert.deepEqual(currentSnapshots, [
      initial.snapshotId,
      committed.snapshotId,
    ]);
    assert.deepEqual(viewSnapshots, [initial.snapshotId, committed.snapshotId]);
    assert.deepEqual(reports, ["RESULT_UNKNOWN"]);
    assert.equal(postCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(
    "Delayed recovery responses cannot roll current, view, or watchers behind a newer commit",
  );
});
