import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/package.json",
);
const Ajv = require("./dist/ajv.js");
const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/character-authoring/state-update.schema.json",
      import.meta.url,
    ),
  ),
);
const ajv = new Ajv({ strict: true });
ajv.addSchema(schema);
const validators = Object.fromEntries(
  Object.keys(schema.definitions).map((name) => [
    name,
    ajv.compile({ $ref: schema.$id + "#/definitions/" + name }),
  ]),
);
const valid = {
  changes: [{ op: "set", path: "/世界/分钟", value: 27 }],
  evidenceMessageIds: ["m1"],
};
assert(validators.agentOutput(valid));
assert(validators.agentOutput({ changes: [], evidenceMessageIds: [] }));
assert(
  !validators.agentOutput({
    ...valid,
    changes: [{ op: "delta", path: "/x", value: 1 }],
  }),
);
assert(
  !validators.agentOutput({
    ...valid,
    changes: [{ op: "set", path: "x", value: 1 }],
  }),
);
assert(
  !validators.agentOutput({
    ...valid,
    changes: [{ op: "remove", path: "/x", value: 1 }],
  }),
);
assert(!validators.agentOutput({ ...valid, evidenceMessageIds: ["m1", "m1"] }));
const identity = {
  updateId: "u1",
  profileId: "p1",
  sessionId: "s1",
  branchId: "b1",
  floorId: "f1",
  attemptId: "a1",
  characterVersionId: "v1",
  baseSnapshotId: "s0",
  sources: [{ messageId: "m1", revision: 1 }],
};
assert(validators.proposal({ ...identity, output: valid }));
const status = {
  ...identity,
  revision: 1,
  status: "running",
  committedSnapshotId: null,
  error: null,
};
assert(validators.updateStatus(status));
assert(!validators.updateStatus({ ...status, status: "committed" }));
assert(
  validators.updateStatus({
    ...status,
    status: "committed",
    committedSnapshotId: "s2",
  }),
);
assert(!validators.updateStatus({ ...status, committedSnapshotId: "s2" }));
assert(
  validators.updateStatus({
    ...status,
    status: "failed",
    error: { code: "STATE_SCHEMA_INVALID", paths: ["/世界/分钟"] },
  }),
);
const compute = {
  before: { value: 1 },
  candidate: { value: 2 },
  sourceMessages: [
    { messageId: "m1", revision: 0, role: "assistant", text: "继续" },
  ],
  facts: {},
  priorFacts: [],
  floorBefore: { value: 1 },
};
assert(validators.computeContext(compute));
assert(validators.computeContext({ ...compute, priorFacts: [{ elapsed: 1 }] }));
for (const field of ["priorFacts", "floorBefore"]) {
  const incomplete = { ...compute };
  delete incomplete[field];
  assert(!validators.computeContext(incomplete));
}
assert(!validators.computeContext({ ...compute, priorFacts: {} }));
assert(!validators.computeContext({ ...compute, floorBefore: null }));
for (const failureStatus of ["failed", "stale"]) {
  assert(!validators.updateStatus({ ...status, status: failureStatus }));
  assert(
    validators.updateStatus({
      ...status,
      status: failureStatus,
      error: { code: "STATE_UPDATE_STALE", paths: [] },
    }),
  );
}
console.log(
  "Proposed state-update schema: all definitions compile; output, proposal and lifecycle cases pass. Runtime execution is not implemented by this check.",
);
