import {
  controllerOwnedPathsSchema,
  migratedEntryUsageSchema,
  roleStatePolicy,
  type MigrationIssue,
} from "@tavern/shared";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validateMigratedMvu(
  bundle: unknown,
  worldbook: unknown,
): MigrationIssue[] {
  const sourceEntries = record(worldbook)?.entries;
  const entries: unknown[] = Array.isArray(sourceEntries)
    ? sourceEntries
    : Object.values(record(sourceEntries) ?? {});
  const migrated = entries
    .map(record)
    .filter((entry) => record(entry?.extensions)?.tavern_headlessMigration);
  if (!migrated.length) return [];
  const issues: MigrationIssue[] = [];
  for (const entry of migrated) {
    const result = migratedEntryUsageSchema.safeParse(
      record(entry!.extensions)?.tavern_headlessMigration,
    );
    if (!result.success) {
      issues.push({ reason: "migration_metadata_invalid" });
      continue;
    }
    if (
      !(entry!.enabled !== undefined
        ? entry!.enabled === false
        : entry!.disable === true)
    ) {
      issues.push({
        entryId: result.data.sourceEntryId,
        reason: "source_entry_enabled",
        target: result.data.target,
      });
    }
  }
  const profile = record(record(bundle)?.profile);
  const files = record(record(bundle)?.files);
  const paths = Array.isArray(profile?.controllerOwnedPaths)
    ? (profile.controllerOwnedPaths as string[])
    : [];
  const writable = Array.isArray(profile?.writablePaths)
    ? (profile.writablePaths as string[])
    : [];
  for (const path of paths) {
    if (
      writable.some(
        (other) =>
          other === path ||
          other.startsWith(path + "/") ||
          path.startsWith(other + "/"),
      )
    ) {
      issues.push({ reason: "controller_agent_path_overlap", target: path });
    }
  }
  const seen = new Set<unknown>();
  const ruleFiles = Array.isArray(profile?.ruleFiles)
    ? (profile.ruleFiles as string[])
    : [];
  for (const file of ruleFiles) {
    const text = files?.[file];
    if (typeof text !== "string") {
      issues.push({ file, reason: "rule_file_missing" });
      continue;
    }
    if (/<\/?(?:Analysis|UpdateVariable|JSONPatch)>/.test(text))
      issues.push({ file, reason: "legacy_output_protocol" });
    if (!file.endsWith(".json")) continue;
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = record(JSON.parse(text));
    } catch {
      issues.push({ file, reason: "rule_file_invalid_json" });
      continue;
    }
    if (
      !parsed ||
      (parsed.entries !== undefined && !Array.isArray(parsed.entries))
    ) {
      issues.push({ file, reason: "rule_entries_invalid" });
      continue;
    }
    for (const value of (parsed.entries ?? []) as unknown[]) {
      const entry = record(value);
      if (!entry) {
        issues.push({ file, reason: "rule_entries_invalid" });
        continue;
      }
      const id = entry.sourceEntryId ?? entry.sourceId;
      if (id === undefined) continue;
      if (typeof id !== "number" && typeof id !== "string") {
        issues.push({ file, reason: "rule_entries_invalid" });
        continue;
      }
      if (seen.has(id))
        issues.push({ file, entryId: id, reason: "duplicate_rule" });
      seen.add(id);
    }
  }
  return issues;
}

export function mergeControllerState(
  previous: Record<string, unknown>,
  resolved: Record<string, unknown>,
  paths: unknown,
): Record<string, unknown> {
  const result = structuredClone(previous);
  for (const path of controllerOwnedPathsSchema.parse(paths)) {
    const parts = path
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    const key = parts.pop()!;
    let target: Record<string, unknown> | undefined = result;
    let source: Record<string, unknown> | undefined = resolved;
    for (const part of parts) {
      target = record(target?.[part]);
      source = record(source?.[part]);
    }
    if (
      !target ||
      !source ||
      !Object.hasOwn(source, key) ||
      !Object.hasOwn(target, key)
    ) {
      throw new Error(
        `Controller state path ${path} is missing. Add the path to both the prior state and resolved controller state.`,
      );
    }
    target[key] = structuredClone(source[key]);
  }
  return result;
}

export function buildRestrictedOutputSchema(
  profile: import("@tavern/shared").RoleStateProfile & {
    stateSchema: Record<string, unknown>;
  },
  evidenceMessageIds?: string[],
  evidenceExecutionIds: string[] = [],
) {
  const variants = profile.writablePaths.flatMap((path) => {
    let valueSchema: Record<string, unknown> | undefined = profile.stateSchema;
    for (const part of path
      .slice(1)
      .split("/")
      .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))) {
      valueSchema = record(record(valueSchema?.properties)?.[part]);
    }
    if (!valueSchema)
      throw new Error(
        `Role state schema does not define ${path}. Add its schema or remove it from writablePaths before publishing.`,
      );
    return [
      {
        type: "object",
        required: ["op", "path", "value"],
        properties: {
          op: { const: "set" },
          path: { const: path },
          value: {
            type: valueSchema.type,
            ...(valueSchema.type === "array"
              ? {
                  items: {},
                  minItems: valueSchema.minItems,
                  maxItems: valueSchema.maxItems,
                }
              : {}),
          },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["op", "path"],
        properties: { op: { const: "remove" }, path: { const: path } },
        additionalProperties: false,
      },
    ];
  });
  return {
    type: "object",
    required: [
      "changes",
      "evidenceMessageIds",
      ...(profile.factsSchema ? ["facts"] : []),
    ],
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        description: roleStatePolicy.changesDescription,
        maxItems: profile.writablePaths.length,
        items: variants.length ? { oneOf: variants } : false,
      },
      evidenceMessageIds: {
        type: "array",
        items:
          evidenceMessageIds === undefined
            ? { type: "string", minLength: 1 }
            : { enum: evidenceMessageIds },
        uniqueItems: true,
        ...(profile.factsSchema ? { minItems: 1 } : {}),
      },
      evidenceExecutionIds: {
        type: "array", uniqueItems: true,
        items: evidenceExecutionIds.length ? { enum: evidenceExecutionIds } : false,
      },
      ...(profile.factsSchema ? { facts: profile.factsSchema } : {}),
    },
  };
}
