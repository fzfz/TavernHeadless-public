import { describe, expect, it } from "vitest";
import type {
  RoleStateOutput,
  RoleStateProposalProfile,
  RoleStateValidator,
} from "@tavern/shared";
import { evaluateRoleProposal } from "../role-proposal-inspection.js";

const before = { hp: 1, derivedHp: 2 };
const proposal: RoleStateOutput = {
  changes: [{ op: "set", path: "/hp", value: 5 }],
  evidenceMessageIds: ["message-1"],
};
const profile: RoleStateProposalProfile = { writablePaths: ["/hp"] };
const valid = () => true;

describe("deterministic role proposal inspection", () => {
  it("returns the applied candidate and derived state when all checks pass", async () => {
    const result = await evaluateRoleProposal(
      before,
      proposal,
      { ...profile, derive: (context) => ({ ...context.candidate, derivedHp: 10 }) },
      valid,
      valid,
      ["message-1"],
    );

    expect(result).toEqual({
      candidate: { hp: 5, derivedHp: 2 },
      derived: { hp: 5, derivedHp: 10 },
      issues: [],
      valid: true,
    });
    expect(before).toEqual({ hp: 1, derivedHp: 2 });
  });

  it("keeps candidate and derived values visible when the final state schema rejects them", async () => {
    const invalidSchema: RoleStateValidator = () => false;
    invalidSchema.errors = [{ instancePath: "/hp", keyword: "minimum" }];

    expect(
      await evaluateRoleProposal(
        before,
        proposal,
        profile,
        valid,
        invalidSchema,
        ["message-1"],
      ),
    ).toMatchObject({
      candidate: { hp: 5, derivedHp: 2 },
      derived: { hp: 5, derivedHp: 2 },
      issues: [{ code: "STATE_SCHEMA_INVALID", details: invalidSchema.errors }],
      valid: false,
    });
  });

  it("returns the candidate when derive throws and reports the shared runtime error", async () => {
    const result = await evaluateRoleProposal(
      before,
      proposal,
      { ...profile, derive: () => { throw new Error("derive failed"); } },
      valid,
      valid,
      ["message-1"],
    );

    expect(result).toMatchObject({
      candidate: { hp: 5, derivedHp: 2 },
      derived: null,
      issues: [{ code: "ROLE_STATE_UPDATE_FAILED", details: { reason: "derive failed" } }],
      valid: false,
    });
  });

  it("does not expose a partial candidate when a writable path or evidence check fails", async () => {
    const forbidden = await evaluateRoleProposal(
      before,
      { ...proposal, changes: [{ op: "set", path: "/unknown", value: 9 }] },
      profile,
      valid,
      valid,
      ["message-1"],
    );
    const missingEvidence = await evaluateRoleProposal(
      before,
      { ...proposal, evidenceMessageIds: ["other-message"] },
      profile,
      valid,
      valid,
      ["message-1"],
    );

    expect(forbidden).toMatchObject({
      candidate: null,
      derived: null,
      issues: [{ code: "STATE_PATH_FORBIDDEN" }],
      valid: false,
    });
    expect(missingEvidence).toMatchObject({
      candidate: null,
      derived: null,
      issues: [{ code: "STATE_EVIDENCE_INVALID" }],
      valid: false,
    });
  });
});
