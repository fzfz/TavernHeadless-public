export function applyProposal(
  before,
  output,
  profile,
  validateOutput,
  validateState,
  evidenceIds,
  sourceMessages = [],
  priorFacts = [],
  floorBefore = before,
) {
  if (!validateOutput(output))
    throw Object.assign(new Error("STATE_OUTPUT_INVALID"), {
      issues: structuredClone(validateOutput.errors || []),
    });
  if (profile.factsSchema) {
    if (!profile.validateFacts?.(output.facts))
      throw Object.assign(new Error("STATE_FACTS_INVALID"), {
        issues: structuredClone(profile.validateFacts?.errors || []),
      });
  } else if (output.facts !== undefined)
    throw new Error("STATE_FACTS_UNDECLARED");
  if (
    (output.changes.length || profile.factsSchema) &&
    !output.evidenceMessageIds.length
  )
    throw new Error("STATE_EVIDENCE_REQUIRED");
  if (output.evidenceMessageIds.some((id) => !evidenceIds.includes(id)))
    throw new Error("STATE_EVIDENCE_INVALID");
  let candidate = structuredClone(before);
  const paths = output.changes.map((change) => change.path);
  for (let i = 0; i < paths.length; i++) {
    if (
      paths
        .slice(i + 1)
        .some(
          (other) =>
            other === paths[i] ||
            other.startsWith(paths[i] + "/") ||
            paths[i].startsWith(other + "/"),
        )
    )
      throw new Error("STATE_PATH_OVERLAP");
    if (
      (profile.derivedPaths || []).some(
        (derived) =>
          derived === paths[i] ||
          derived.startsWith(paths[i] + "/") ||
          paths[i].startsWith(derived + "/"),
      )
    )
      throw new Error("STATE_DERIVED_WRITE");
  }
  for (const change of output.changes) {
    if (!profile.writablePaths.includes(change.path))
      throw new Error("STATE_PATH_FORBIDDEN");
    const parts = change.path
      .slice(1)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent = candidate;
    for (const part of parts.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, part))
        throw new Error("STATE_PATH_MISSING");
      parent = parent[part];
    }
    const key = parts.at(-1);
    if (!parent || !Object.hasOwn(parent, key))
      throw new Error("STATE_PATH_MISSING");
    if (change.op === "remove") delete parent[key];
    else parent[key] = structuredClone(change.value);
  }
  const context = {
    before: structuredClone(before),
    candidate,
    sourceMessages: structuredClone(sourceMessages),
    priorFacts: structuredClone(priorFacts),
    floorBefore: structuredClone(floorBefore),
    facts: output.facts || {},
  };
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  if (profile.derive)
    candidate = profile.derive(freeze(structuredClone(context)));
  if (!validateState(candidate)) throw new Error("STATE_SCHEMA_INVALID");
  if (profile.validate) {
    const result = profile.validate(freeze({ ...context, candidate }));
    if (!result || !Array.isArray(result.issues))
      throw new Error("STATE_VALIDATOR_INVALID");
    if (result.issues.length)
      throw Object.assign(new Error("STATE_RULE_INVALID"), {
        issues: result.issues,
      });
  }
  return candidate;
}

