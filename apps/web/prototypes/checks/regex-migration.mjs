import fs from "node:fs";
import { z } from "zod";

const ruleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    decision: z.enum(["keep", "remove"]),
    reason: z.string().min(1),
  })
  .strict();
export const regexMigrationSchema = z
  .object({
    sources: z.record(z.object({ rules: z.array(ruleSchema) }).strict()),
  })
  .strict();
export const migration = regexMigrationSchema.parse(
  JSON.parse(
    fs.readFileSync(new URL("./regex-migration.json", import.meta.url), "utf8"),
  ),
);

export function compileRegexMigration(sources, plan = migration) {
  const scripts = [],
    audit = [];
  for (const source of sources) {
    const decisions = plan.sources[source.key]?.rules;
    if (!decisions) throw new Error(`REGEX_SOURCE_NOT_REVIEWED: ${source.key}`);
    const ids = new Set();
    source.scripts.forEach((original, index) => {
      if (ids.has(original.id))
        throw new Error(`REGEX_DUPLICATE_RULE: ${original.id}`);
      ids.add(original.id);
      const decision = decisions.find((r) => r.id === original.id);
      if (!decision) throw new Error(`REGEX_RULE_NOT_REVIEWED: ${original.id}`);
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
