import { roleStateProposalInspectionInputSchema, type RoleStateProposalInspectionInput } from "@tavern/shared";

export type ProposalInspectionInputParse =
  | { valid: true; input: RoleStateProposalInspectionInput }
  | { valid: false; reason: "invalid_json" | "invalid_shape" };

export function parseProposalInspectionInput(sourceMessagesText: string, proposalText: string): ProposalInspectionInputParse {
  let sourceMessages: unknown;
  let proposal: unknown;
  try {
    sourceMessages = JSON.parse(sourceMessagesText) as unknown;
    proposal = JSON.parse(proposalText) as unknown;
  } catch {
    return { valid: false, reason: "invalid_json" };
  }
  const result = roleStateProposalInspectionInputSchema.safeParse({ sourceMessages, proposal });
  return result.success ? { valid: true, input: result.data } : { valid: false, reason: "invalid_shape" };
}
