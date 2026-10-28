import fs from 'node:fs';
const plan=JSON.parse(fs.readFileSync(new URL('./preset-output-migration.json',import.meta.url),'utf8'));
export function migratePresetOutput(source){
  const data=structuredClone(source);
  const rules=plan.sourceRuleIds.map(id=>{
    const script=data.extensions?.regex_scripts?.find(rule=>rule.id===id);
    if(!script) throw new Error(`PRESET_OUTPUT_RULE_MISSING:${id}`);
    const match=script.findRegex.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
    if(!match) throw new Error(`PRESET_OUTPUT_PATTERN_INVALID:${id}`);
    return {sourceRuleId:id,pattern:match[1],flags:match[2],replacement:script.replaceString};
  });
  data.extensions.tavern_headless={...data.extensions.tavern_headless,outputProcessing:{version:1,delivery:plan.delivery,rules}};
  return data;
}
