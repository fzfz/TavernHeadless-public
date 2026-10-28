import { RoleImportError } from "./error.js";
import type { RolePresetSource, PresetOutputMigration } from "@tavern/shared";
export function migratePresetOutput(
  source: RolePresetSource,
  plan: PresetOutputMigration,
) {
  const data = structuredClone(source);
  const rules = plan.sourceRuleIds.map((id) => {
    const script = data.extensions?.regex_scripts?.find(
      (rule) => rule.id === id,
    );
    if (!script)
      throw new RoleImportError("ROLE_IMPORT_PRESET_RULE_MISSING", {
        ruleId: id,
      });
    const match = script.findRegex.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
    if (!match)
      throw new RoleImportError("ROLE_IMPORT_PRESET_PATTERN_INVALID", {
        ruleId: id,
      });
    return {
      sourceRuleId: id,
      pattern: match[1],
      flags: match[2],
      replacement: script.replaceString,
    };
  });
  data.extensions ??= {};
  data.extensions.tavern_headless = {
    ...data.extensions.tavern_headless,
    outputProcessing: {
      version: 1,
      delivery: plan.delivery,
      ...(plan.streaming ? { streaming: plan.streaming } : {}),
      rules,
    },
  };
  return data;
}
