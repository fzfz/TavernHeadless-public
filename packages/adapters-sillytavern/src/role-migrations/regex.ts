import { RoleImportError } from "./error.js";
import type { RoleRegexSource, RegexMigration } from "@tavern/shared";
export function compileRegexMigration(
  sources: RoleRegexSource[],
  plan: RegexMigration,
) {
  const scripts: Array<
      RoleRegexSource["scripts"][number] & { source: Record<string, unknown> }
    > = [],
    audit: Array<Record<string, unknown>> = [];
  for (const source of sources) {
    const decisions = plan.sources[source.key]?.rules;
    if (!decisions)
      throw new RoleImportError("ROLE_IMPORT_REGEX_REVIEW_MISSING", {
        source: source.key,
      });
    const ids = new Set();
    source.scripts.forEach((original, index) => {
      if (ids.has(original.id))
        throw new RoleImportError("ROLE_IMPORT_REGEX_DUPLICATE", {
          source: source.key,
          ruleId: original.id,
        });
      ids.add(original.id);
      const decision = decisions.find((r) => r.id === original.id);
      if (!decision)
        throw new RoleImportError("ROLE_IMPORT_REGEX_REVIEW_MISSING", {
          source: source.key,
          ruleId: original.id,
        });
      const provenance = {
        kind: source.kind,
        name: source.name,
        ruleId: original.id,
        index,
        ...(source.resourceId ? { resourceId: source.resourceId } : {}),
        ...(source.versionId ? { versionId: source.versionId } : {}),
      };
      audit.push({ ...decision, source: provenance });
      if (decision.decision === "remove") return;
      scripts.push({
        ...structuredClone(original),
        source: provenance,
        minDepth: original.minDepth ?? -1,
        maxDepth: original.maxDepth ?? -1,
      });
    });
  }
  return { scripts, audit };
}
