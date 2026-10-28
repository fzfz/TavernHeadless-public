import {
  apiErrorMessages,
  type RoleState,
  type RoleStateOutput,
  type RoleStateValidator,
  type RoleStateSourceMessage,
  type RoleToolEvidence,
} from "@tavern/shared";
import {
  evaluateRoleProposal,
  type RuntimeRoleStateProposalProfile,
} from "./role-proposal-inspection.js";

class StateProposalError extends Error {
  constructor(
    readonly code: Extract<keyof typeof apiErrorMessages, `STATE_${string}`>,
  ) {
    super(apiErrorMessages[code]);
  }
}

export async function applyProposal(
  before: RoleState,
  output: RoleStateOutput,
  profile: RuntimeRoleStateProposalProfile,
  validateOutput: RoleStateValidator,
  validateState: RoleStateValidator,
  evidenceIds: string[],
  sourceMessages: RoleStateSourceMessage[] = [],
  priorFacts: unknown[] = [],
  floorBefore = before,
  toolEvidence: RoleToolEvidence[] = [],
): Promise<RoleState> {
  const result = await evaluateRoleProposal(
    before,
    output,
    profile,
    validateOutput,
    validateState,
    evidenceIds,
    sourceMessages,
    priorFacts,
    floorBefore,
    toolEvidence,
  );
  if (!result.valid) {
    const issue = result.issues[0]!;
    if (issue.cause !== undefined) throw issue.cause;
    if (!issue.code.startsWith("STATE_"))
      throw new Error(String(apiErrorMessages[issue.code]));
    const error = new StateProposalError(
      issue.code as Extract<keyof typeof apiErrorMessages, `STATE_${string}`>,
    );
    if (issue.details !== undefined)
      Object.assign(error, { issues: issue.details });
    throw error;
  }
  return result.derived!;
}
