import { z } from 'zod';

export const migratedEntryUsageSchema = z.object({
  sourceEntryId: z.number().int(),
  usage: z.enum(['variable-rule', 'retired-protocol', 'opening-state']),
  target: z.string().min(1),
}).strict();

// Validate only bundles whose worldbook explicitly records this migration.
export function validateMigratedMvu(bundle, worldbook) {
  const entries = Array.isArray(worldbook?.entries) ? worldbook.entries : Object.values(worldbook?.entries || {});
  const migrated = entries.filter(e => e.extensions?.tavern_headlessMigration);
  if (!migrated.length) return [];
  const issues = [];
  for (const entry of migrated) {
    const result = migratedEntryUsageSchema.safeParse(entry.extensions.tavern_headlessMigration);
    if (!result.success) { issues.push({reason:'migration_metadata_invalid'}); continue; }
    const metadata = result.data;
    if (!(entry.enabled !== undefined ? entry.enabled === false : entry.disable === true))
      issues.push({entryId: metadata.sourceEntryId, reason: 'source_entry_enabled', target: metadata.target});
  }
  for (const path of bundle?.profile?.controllerOwnedPaths || []) {
    if ((bundle.profile.writablePaths || []).some(other=>other===path || other.startsWith(path+'/') || path.startsWith(other+'/')))
      issues.push({reason:'controller_agent_path_overlap',target:path});
  }
  const seen = new Set();
  for (const file of bundle?.profile?.ruleFiles || []) {
    const text = bundle.files?.[file];
    if (typeof text !== 'string') { issues.push({file, reason:'rule_file_missing'}); continue; }
    if (/<\/?(?:Analysis|UpdateVariable|JSONPatch)>/.test(text)) issues.push({file, reason:'legacy_output_protocol'});
    if (file.endsWith('.json')) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { issues.push({file,reason:'rule_file_invalid_json'}); continue; }
      if (!parsed || typeof parsed !== 'object' || (parsed.entries !== undefined && !Array.isArray(parsed.entries))) { issues.push({file,reason:'rule_entries_invalid'}); continue; }
      for (const entry of parsed.entries || []) {
        if (!entry || typeof entry !== 'object') { issues.push({file,reason:'rule_entries_invalid'}); continue; }
        const id = entry.sourceEntryId ?? entry.sourceId;
        if (id === undefined) continue;
        if (seen.has(id)) issues.push({file, entryId:id, reason:'duplicate_rule'});
        seen.add(id);
      }
    }
  }
  return issues;
}

export const controllerOwnedPathsSchema = z.array(z.string().startsWith('/')).refine(paths=>new Set(paths).size===paths.length);
export function mergeControllerState(previous, resolved, paths) {
  const result=structuredClone(previous);
  for(const path of controllerOwnedPathsSchema.parse(paths)) {
    const parts=path.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
    let target=result, source=resolved;
    const key=parts.pop();
    for(const part of parts) { target=target?.[part]; source=source?.[part]; }
    if(!target || !source || !Object.hasOwn(source,key) || !Object.hasOwn(target,key)) throw Error('CONTROLLER_STATE_PATH_MISSING:'+path);
    target[key]=structuredClone(source[key]);
  }
  return result;
}

export const stateContractParamsSchema=z.object({id:z.string().min(1),versionId:z.string().min(1)}).strict();
export const stateContractResponseSchema=z.object({systemPrompt:z.string(),outputSchema:z.record(z.string(), z.unknown())}).strict();
