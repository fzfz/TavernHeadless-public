import { compileMvuController } from "./mvu-controller-migration.mjs";
import fs from "node:fs";
import { z } from "zod";
import { migratedEntryUsageSchema } from "../../../api/src/services/role-mvu-migration.mjs";
export const mvuMigrationSchema = z.record(
  z
    .object({
      disabledEntryIds: z.array(z.number().int()),
      ruleEntryIds: z.array(z.number().int()),
      readonlyPaths: z.array(z.string()),
      cleanRuleFiles: z.array(z.string()),
      controllerEntryIds: z.array(z.number().int()),
      initialEntryId: z.number().int(),
      updaterPrompt: z.string().optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .strict(),
);
const plans = mvuMigrationSchema.parse(
  JSON.parse(
    fs.readFileSync(
      new URL("./mvu-agent-migration.json", import.meta.url),
      "utf8",
    ),
  ),
);
export function migrateMvuToAgent(key, snapshot, worldbook) {
  const plan = plans[key];
  if (!plan) throw Error("MVU_MIGRATION_NOT_REVIEWED");
  const character = structuredClone(snapshot),
    book = structuredClone(worldbook);
  const entries = Array.isArray(book.entries)
    ? book.entries
    : Object.values(book.entries);
  const id = (e) => e.uid ?? e.id;
  const profile = character.extensions.tavern_headless.stateUpdate.profile;
  const files = character.extensions.tavern_headless.stateUpdate.files;
  const rules = plan.ruleEntryIds.map((uid) => {
    const entry = entries.find((e) => id(e) === uid);
    if (!entry) throw Error(`MVU_RULE_ENTRY_MISSING:${uid}`);
    return { sourceEntryId: uid, name: entry.comment, content: entry.content };
  });
  for (const uid of plan.disabledEntryIds) {
    const entry = entries.find((e) => id(e) === uid);
    if (!entry) throw Error(`MVU_ENTRY_MISSING:${uid}`);
    entry.enabled = false;
    entry.disable = true;
  }
  const file = "migrated-variable-rules.json";
  for (const name of plan.cleanRuleFiles) {
    if (files[name] === undefined) throw Error(`MVU_RULE_FILE_MISSING:${name}`);
    const document = JSON.parse(files[name]);
    document.entries = document.entries.filter(entry => !plan.disabledEntryIds.includes(entry.sourceId));
    files[name] = JSON.stringify(document, null, 2);
  }
  for (const uid of [...plan.disabledEntryIds, plan.initialEntryId]) {
    const entry = entries.find(e => id(e) === uid);
    if (!entry) throw Error(`MVU_ENTRY_MISSING:${uid}`);
    entry.enabled = false;
    entry.disable = true;
    const usage = uid === plan.initialEntryId ? "opening-state" : plan.ruleEntryIds.includes(uid) ? "variable-rule" : "retired-protocol";
    entry.extensions ||= {};
    entry.extensions.tavern_headlessMigration = migratedEntryUsageSchema.parse({
      sourceEntryId: uid, usage,
      target: usage === "opening-state" ? "openings.items[].variables" : usage === "variable-rule" ? file : "outputSchema",
    });
  }
  files[file] = JSON.stringify({ entries: rules }, null, 2);
  profile.ruleFiles = [...new Set([...(profile.ruleFiles || []), file])];
  profile.writablePaths = profile.writablePaths.filter(
    (p) => !plan.readonlyPaths.includes(p),
  );
  if (plan.controllerEntryIds.length) {
    character.extensions.tavern_headless.promptController = {
      moduleSource: compileMvuController(entries, plan.controllerEntryIds),
      controllerEntryIds: plan.controllerEntryIds,
      updaterEntryIds: plan.disabledEntryIds,
      variableRoot: "stat_data", variableMacros: [],
    };
    profile.controllerOwnedPaths = plan.readonlyPaths;
  }
  if (plan.updaterPrompt) profile.updaterPrompt = plan.updaterPrompt;
  if (plan.maxTokens) profile.maxTokens = plan.maxTokens;
  return { snapshot: character, worldbook: book };
}

export function readMvuInitialVariables(key, worldbook, parseYaml) {
  const plan = plans[key];
  if (!plan) throw Error("MVU_MIGRATION_NOT_REVIEWED");
  const entries = Array.isArray(worldbook.entries) ? worldbook.entries : Object.values(worldbook.entries);
  const entry = entries.find(e => (e.uid ?? e.id) === plan.initialEntryId);
  if (!entry) throw Error(`MVU_INITIAL_ENTRY_MISSING:${plan.initialEntryId}`);
  const variables = parseYaml(entry.content);
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw Error('MVU_INITIAL_INVALID');
  return variables;
}
