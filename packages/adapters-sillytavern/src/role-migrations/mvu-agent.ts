import { RoleImportError } from "./error.js";
import {
  migratedEntryUsageSchema,
  roleStatePolicy,
  type RoleImportCharacter,
  type RoleWorldbook,
  type RoleWorldbookEntry,
  type MvuMigrationPlan,
} from "@tavern/shared";
import { compileMvuController } from "./mvu-controller.js";
export function migrateMvuToAgent(
  snapshot: RoleImportCharacter,
  worldbook: RoleWorldbook,
  plan: MvuMigrationPlan,
) {
  const character = structuredClone(snapshot),
    book = structuredClone(worldbook);
  const entries = Array.isArray(book.entries)
    ? book.entries
    : Object.values(book.entries);
  const id = (e: RoleWorldbookEntry) => e.uid ?? e.id;
  const profile = character.extensions.tavern_headless.stateUpdate.profile;
  const files = character.extensions.tavern_headless.stateUpdate.files;
  const rules = plan.ruleEntryIds.map((uid) => {
    const entry = entries.find((e) => id(e) === uid);
    if (!entry)
      throw new RoleImportError("ROLE_IMPORT_ENTRY_MISSING", { entryId: uid });
    return { sourceEntryId: uid, name: entry.comment, content: entry.content };
  });
  for (const uid of plan.disabledEntryIds) {
    const entry = entries.find((e) => id(e) === uid);
    if (!entry)
      throw new RoleImportError("ROLE_IMPORT_ENTRY_MISSING", { entryId: uid });
    entry.enabled = false;
    entry.disable = true;
  }
  const file = "migrated-variable-rules.json";
  for (const name of plan.cleanRuleFiles) {
    if (files[name] === undefined)
      throw new RoleImportError("ROLE_IMPORT_RULE_FILE_MISSING", {
        path: name,
      });
    const document = JSON.parse(files[name]);
    document.entries = document.entries.filter(
      (entry: { sourceId: number }) =>
        !plan.disabledEntryIds.includes(entry.sourceId),
    );
    files[name] = JSON.stringify(document, null, 2);
  }
  for (const uid of [...plan.disabledEntryIds, plan.initialEntryId]) {
    const entry = entries.find((e) => id(e) === uid);
    if (!entry)
      throw new RoleImportError("ROLE_IMPORT_ENTRY_MISSING", { entryId: uid });
    entry.enabled = false;
    entry.disable = true;
    const usage =
      uid === plan.initialEntryId
        ? "opening-state"
        : plan.ruleEntryIds.includes(uid)
          ? "variable-rule"
          : "retired-protocol";
    entry.extensions ||= {};
    entry.extensions.tavern_headlessMigration = migratedEntryUsageSchema.parse({
      sourceEntryId: uid,
      usage,
      target:
        usage === "opening-state"
          ? "openings.items[].variables"
          : usage === "variable-rule"
            ? file
            : "outputSchema",
    });
  }
  files[file] = JSON.stringify({ entries: rules }, null, 2);
  profile.ruleFiles = [...new Set([...(profile.ruleFiles || []), file])];
  profile.writablePaths = profile.writablePaths.filter(
    (p) => !plan.readonlyPaths.includes(p),
  );
  if (plan.controllerEntryIds.length) {
    files[roleStatePolicy.controllerModulePath] = compileMvuController(
      entries,
      plan.controllerEntryIds,
    );
    profile.moduleFiles = [
      ...new Set([
        ...(profile.moduleFiles ?? []),
        roleStatePolicy.controllerModulePath,
      ]),
    ];
    character.extensions.tavern_headless.promptController = {
      modulePath: roleStatePolicy.controllerModulePath,
      controllerEntryIds: plan.controllerEntryIds,
      updaterEntryIds: plan.disabledEntryIds,
      variableRoot: "stat_data",
      variableMacros: plan.variableMacros ?? [],
    };
    profile.controllerOwnedPaths = plan.readonlyPaths;
  }
  if (plan.updaterPrompt) profile.updaterPrompt = plan.updaterPrompt;
  if (plan.maxTokens) profile.maxTokens = plan.maxTokens;
  return { snapshot: character, worldbook: book };
}

export function readMvuInitialVariables(
  worldbook: RoleWorldbook,
  plan: MvuMigrationPlan,
  parseYaml: (text: string) => unknown,
) {
  const entries = Array.isArray(worldbook.entries)
    ? worldbook.entries
    : Object.values(worldbook.entries);
  const entry = entries.find((e) => (e.uid ?? e.id) === plan.initialEntryId);
  if (!entry)
    throw new RoleImportError("ROLE_IMPORT_ENTRY_MISSING", {
      entryId: plan.initialEntryId,
    });
  const variables = parseYaml(entry.content);
  if (!variables || typeof variables !== "object" || Array.isArray(variables))
    throw new RoleImportError("ROLE_IMPORT_INITIAL_INVALID");
  return variables as Record<string, unknown>;
}
