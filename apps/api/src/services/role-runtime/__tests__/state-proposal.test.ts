import { describe, expect, it } from "vitest";
import { applyProposal } from "../state-proposal.js";
import {
  mergeControllerState,
  validateMigratedMvu,
} from "../state-contract.js";
import type { RoleStateOutput, RoleStateProposalProfile } from "@tavern/shared";

const profile: RoleStateProposalProfile = {
  writablePaths: ["/value"],
  derivedPaths: ["/computed"],
};
const proposal: RoleStateOutput = {
  changes: [{ op: "set", path: "/value", value: 2 }],
  evidenceMessageIds: ["message"],
};
const valid = () => true;
const before = { value: 1, computed: 0 };

describe("formal role state proposal validation", () => {
  it("applies authorized evidence-backed changes without mutating the prior snapshot", async () => {
    const result = await applyProposal(before, proposal, profile, valid, valid, [
      "message",
    ]);
    expect(result).toEqual({ value: 2, computed: 0 });
    expect(before.value).toBe(1);
  });
  it.each([
    ["STATE_EVIDENCE_REQUIRED", { ...proposal, evidenceMessageIds: [] }],
    ["STATE_EVIDENCE_INVALID", { ...proposal, evidenceMessageIds: ["other"] }],
    [
      "STATE_PATH_OVERLAP",
      { ...proposal, changes: [...proposal.changes, ...proposal.changes] },
    ],
    [
      "STATE_DERIVED_WRITE",
      { ...proposal, changes: [{ op: "set", path: "/computed", value: 4 }] },
    ],
    [
      "STATE_PATH_FORBIDDEN",
      { ...proposal, changes: [{ op: "set", path: "/other", value: 4 }] },
    ],
    ["STATE_FACTS_UNDECLARED", { ...proposal, facts: {} }],
  ])("rejects %s proposals", async (code, output) => {
    await expect(
      applyProposal(before, output as RoleStateOutput, profile, valid, valid, [
        "message",
      ]),
    ).rejects.toThrow(expect.objectContaining({ code }));
  });
  it("checks output, facts, state schema and role-specific validation before acceptance", async () => {
    await expect(
      applyProposal(before, proposal, profile, () => false, valid, ["message"]),
    ).rejects.toThrow(expect.objectContaining({ code: "STATE_OUTPUT_INVALID" }));
    await expect(
      applyProposal(
        before,
        proposal,
        { ...profile, factsSchema: {} },
        valid,
        valid,
        ["message"],
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "STATE_FACTS_INVALID" }));
    await expect(
      applyProposal(before, proposal, profile, valid, () => false, ["message"]),
    ).rejects.toThrow(expect.objectContaining({ code: "STATE_SCHEMA_INVALID" }));
    await expect(
      applyProposal(
        before,
        proposal,
        { ...profile, validate: () => ({ issues: ["rule"] }) },
        valid,
        valid,
        ["message"],
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "STATE_RULE_INVALID" }));
  });
  it("freezes derivation inputs and permits deletion only at an existing authorized path", async () => {
    const derive: RoleStateProposalProfile["derive"] = (context) => {
      expect(Object.isFrozen(context.candidate)).toBe(true);
      return { ...context.candidate, computed: 5 };
    };
    const derived = await applyProposal(
      before,
      proposal,
      { ...profile, derive },
      valid,
      valid,
      ["message"],
    );
    expect(derived.computed).toBe(5);
    expect(
      await applyProposal(
        before,
        {
          changes: [{ op: "remove", path: "/value" }],
          evidenceMessageIds: ["message"],
        },
        profile,
        valid,
        valid,
        ["message"],
      ),
    ).toEqual({ computed: 0 });
    await expect(
      applyProposal({}, proposal, profile, valid, valid, ["message"]),
    ).rejects.toThrow(expect.objectContaining({ code: "STATE_PATH_MISSING" }));
  });
});

describe("formal controller and migration contract", () => {
  it("merges controller-owned paths and rejects missing state fields", () => {
    expect(
      mergeControllerState(
        { scene: { time: 1 }, value: 2 },
        { scene: { time: 3 } },
        ["/scene/time"],
      ),
    ).toEqual({ scene: { time: 3 }, value: 2 });
    expect(() => mergeControllerState({}, {}, ["/missing"])).toThrow();
  });
  it("reports enabled migrated entries, overlapping paths and duplicate rule references", () => {
    const issues = validateMigratedMvu(
      {
        profile: {
          controllerOwnedPaths: ["/scene"],
          writablePaths: ["/scene/time"],
          ruleFiles: ["rules.json"],
        },
        files: {
          "rules.json": JSON.stringify({
            entries: [{ sourceEntryId: 1 }, { sourceEntryId: 1 }],
          }),
        },
      },
      {
        entries: [
          {
            enabled: true,
            extensions: {
              tavern_headlessMigration: {
                sourceEntryId: 1,
                usage: "variable-rule",
                target: "rules.json",
              },
            },
          },
        ],
      },
    );
    expect(issues.map((issue) => issue.reason)).toEqual([
      "source_entry_enabled",
      "controller_agent_path_overlap",
      "duplicate_rule",
    ]);
  });
});
