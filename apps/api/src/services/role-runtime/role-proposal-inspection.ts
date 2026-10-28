import { apiErrorMessages } from "@tavern/shared";
import type {
  RoleState,
  RoleStateOutput,
  RoleStateProposalProfile,
  RoleStateDerivationContext,
  RoleStateSourceMessage,
  RoleToolEvidence,
  RoleStateValidator,
} from "@tavern/shared";

export type RoleProposalInspectionIssue = {
  code: keyof typeof apiErrorMessages;
  details?: unknown;
  cause?: unknown;
};

export type RoleProposalEvaluation = {
  candidate: RoleState | null;
  derived: RoleState | null;
  issues: RoleProposalInspectionIssue[];
  valid: boolean;
};

type Validator = RoleStateValidator;
type ProposalValidationCode = Extract<
  keyof typeof apiErrorMessages,
  `STATE_${string}`
>;
export type RuntimeRoleStateProposalProfile = Omit<
  RoleStateProposalProfile,
  "derive" | "validate"
> & {
  derive?: (context: RoleStateDerivationContext) => RoleState | Promise<RoleState>;
  validate?: (
    context: RoleStateDerivationContext,
  ) => { issues: unknown[] } | Promise<{ issues: unknown[] }>;
};

/** Run the deterministic formal proposal checks without writing a snapshot. */
export async function evaluateRoleProposal(
  before: RoleState,
  output: RoleStateOutput,
  profile: RuntimeRoleStateProposalProfile,
  validateOutput: Validator,
  validateState: Validator,
  evidenceIds: string[],
  sourceMessages: RoleStateSourceMessage[] = [],
  priorFacts: unknown[] = [],
  floorBefore: RoleState = before,
  toolEvidence: RoleToolEvidence[] = [],
): Promise<RoleProposalEvaluation> {
  const invalid = (
    code: ProposalValidationCode,
    details?: unknown,
    candidate: RoleState | null = null,
    derived: RoleState | null = null,
  ): RoleProposalEvaluation => ({
    candidate,
    derived,
    issues: [{ code, ...(details === undefined ? {} : { details }) }],
    valid: false,
  });

  if (!validateOutput(output))
    return invalid("STATE_OUTPUT_INVALID", structuredClone(validateOutput.errors || []));
  if (profile.factsSchema && !profile.validateFacts?.(output.facts))
    return invalid(
      "STATE_FACTS_INVALID",
      structuredClone(profile.validateFacts?.errors || []),
    );
  if (!profile.factsSchema && output.facts !== undefined)
    return invalid("STATE_FACTS_UNDECLARED", { facts: output.facts });
  if (
    (output.changes.length || profile.factsSchema) &&
    !output.evidenceMessageIds.length
  )
    return invalid("STATE_EVIDENCE_REQUIRED");
  if (output.evidenceMessageIds.some((id) => !evidenceIds.includes(id)))
    return invalid("STATE_EVIDENCE_INVALID", { evidenceMessageIds: output.evidenceMessageIds });

  const executionIds = output.evidenceExecutionIds ?? [];
  if (new Set(executionIds).size !== executionIds.length ||
      executionIds.some((id) => !toolEvidence.some((item) => item.executionId === id))) {
    return invalid("STATE_EVIDENCE_INVALID", { evidenceExecutionIds: executionIds });
  }

  const paths = output.changes.map((change) => change.path);
  for (let i = 0; i < paths.length; i += 1) {
    if (
      paths.slice(i + 1).some(
        (other) =>
          other === paths[i] ||
          other.startsWith(`${paths[i]}/`) ||
          paths[i]!.startsWith(`${other}/`),
      )
    )
      return invalid("STATE_PATH_OVERLAP", { paths });
    const derivedPath = profile.derivedPaths?.find(
      (derived) =>
        derived === paths[i] ||
        derived.startsWith(`${paths[i]}/`) ||
        paths[i]!.startsWith(`${derived}/`),
    );
    if (derivedPath)
      return invalid("STATE_DERIVED_WRITE", { path: paths[i], derivedPath });
  }

  const candidate = structuredClone(before);
  for (const change of output.changes) {
    if (!profile.writablePaths.includes(change.path))
      return invalid("STATE_PATH_FORBIDDEN", { path: change.path });
    const parts = change.path
      .slice(1)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent: unknown = candidate;
    for (const part of parts.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part))
        return invalid("STATE_PATH_MISSING", { path: change.path });
      parent = (parent as RoleState)[part];
    }
    const key = parts.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      return invalid("STATE_PATH_MISSING", { path: change.path });
    if (change.op === "remove") delete (parent as RoleState)[key];
    else (parent as RoleState)[key] = structuredClone(change.value);
  }

  const context = {
    before: structuredClone(before),
    candidate,
    sourceMessages: structuredClone(sourceMessages),
    toolEvidence: structuredClone(toolEvidence),
    priorFacts: structuredClone(priorFacts),
    floorBefore: structuredClone(floorBefore),
    facts: output.facts || {},
  };
  const freeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };

  let derived: unknown = candidate;
  if (profile.derive) {
    try {
      derived = await profile.derive(freeze(structuredClone(context)));
    } catch (cause) {
      return {
        candidate,
        derived: null,
        issues: [{ code: "ROLE_STATE_UPDATE_FAILED", details: errorDetails(cause), cause }],
        valid: false,
      };
    }
  }
  const visibleDerived = isRoleState(derived) ? derived : null;
  if (!validateState(derived))
    return invalid(
      "STATE_SCHEMA_INVALID",
      structuredClone(validateState.errors || []),
      candidate,
      visibleDerived,
    );
  if (!isRoleState(derived))
    return invalid("STATE_SCHEMA_INVALID", [], candidate, null);

  if (profile.validate) {
    let result: unknown;
    try {
      result = await profile.validate(
        freeze({ ...context, candidate: structuredClone(derived) }),
      );
    } catch (cause) {
      return {
        candidate,
        derived,
        issues: [{ code: "ROLE_STATE_UPDATE_FAILED", details: errorDetails(cause), cause }],
        valid: false,
      };
    }
    if (!result || typeof result !== "object" || !Array.isArray((result as { issues?: unknown }).issues))
      return invalid("STATE_VALIDATOR_INVALID", result, candidate, derived);
    const validationIssues = (result as { issues: unknown[] }).issues;
    if (validationIssues.length)
      return invalid("STATE_RULE_INVALID", structuredClone(validationIssues), candidate, derived);
  }

  return { candidate, derived, issues: [], valid: true };
}

function isRoleState(value: unknown): value is RoleState {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorDetails(error: unknown): Record<string, unknown> {
  return { reason: error instanceof Error ? error.message : String(error) };
}
