import assert from "node:assert/strict";
import { runFollowups } from "./live-followups.mjs";
const profile = { sourceAgentBindingIds: ["one", "two"] };
const initial = {
  sessionId: "session",
  branchId: "branch",
  floorId: "floor",
  attemptId: "attempt",
  snapshotId: "main",
  variables: { count: 0 },
};
function setup() {
  return {
    sessionId: "session",
    branchId: "branch",
    current: structuredClone(initial),
    messages: [
      {
        id: "main-message",
        role: "assistant",
        text: "主回复",
        floorId: "floor",
      },
    ],
    snapshots: new Map([["main", structuredClone(initial)]]),
    liveEvidence: [],
    pendingChain: {
      floorId: "floor",
      attemptId: "attempt",
      runId: "run",
      index: 0,
      floorBefore: { count: 0 },
      facts: [],
      agents: [
        { id: "one", prompt: "one" },
        { id: "two", prompt: "two" },
      ],
      jobs: {},
    },
  };
}
let calls = 0,
  fail = false;
async function* stream() {
  calls++;
  yield { text: "后续正文", model: "test:free" };
}
async function update({ before, sources, consumedSources, priorFacts }) {
  assert.equal(sources.length, 1);
  assert.ok(!consumedSources.some((s) => s.id === sources[0].messageId));
  assert.equal(priorFacts.length, before.count);
  if (fail) throw Error("EXPECTED_FAILURE");
  return {
    variables: { count: before.count + 1 },
    output: {
      changes: [],
      facts: { done: true },
      evidenceMessageIds: [sources[0].messageId],
    },
    updaterModel: "test:free",
  };
}
const events = [];
const args = (state) => ({
  state,
  profile,
  config: {},
  write: (e) => events.push(e),
  textEvent: (base, extra) => ({ type: "text", data: { ...base, ...extra } }),
  stream,
  update,
});
const state = setup();
await runFollowups(args(state));
assert.equal(state.current.variables.count, 2);
assert.equal(state.liveEvidence.length, 2);
assert.equal(state.messages.length, 3);
assert.equal(
  state.liveEvidence[1].beforeSnapshotId,
  state.liveEvidence[0].afterSnapshotId,
);
assert.equal(state.snapshots.get("main").variables.count, 0);
const oldCalls = calls;
await runFollowups(args(state));
assert.equal(calls, oldCalls);
const retry = setup();
fail = true;
await assert.rejects(runFollowups(args(retry)), /EXPECTED_FAILURE/);
assert.equal(retry.current.snapshotId, "main");
const failedCalls = calls;
fail = false;
await runFollowups(args(retry));
assert.equal(calls, failedCalls + 1);
assert.equal(retry.messages.length, 3);
const stale = setup();
fail = true;
await assert.rejects(runFollowups(args(stale)));
fail = false;
stale.current.snapshotId = "other";
await assert.rejects(runFollowups(args(stale)), /STATE_BASE_STALE/);
const inactive = setup();
inactive.current.attemptId = "new-attempt";
await assert.rejects(runFollowups(args(inactive)), /STATE_ATTEMPT_INACTIVE/);
const unbound = setup();
await assert.rejects(
  runFollowups({ ...args(unbound), profile: { sourceAgentBindingIds: [] } }),
  /STATE_AGENT_UNBOUND/,
);
assert.equal(events.filter((e) => e.type === "current").length, 4);
const lostDelivery = setup();
const writeArgs = args(lostDelivery);
let lose = true;
writeArgs.write = (e) => {
  if (e.type === "current" && lose) {
    lose = false;
    throw Error("CONNECTION_LOST");
  }
};
await assert.rejects(runFollowups(writeArgs), /CONNECTION_LOST/);
assert.equal(lostDelivery.pendingChain.jobs.one.status, "committed");
const committedCalls = calls;
await runFollowups(writeArgs);
assert.equal(calls, committedCalls + 1);
assert.equal(lostDelivery.liveEvidence.length, 2);
console.log(
  "Followup chain passed sequential updates, isolated history, duplicate no-op, retry reuse, stale/inactive/unbound rejection",
);
