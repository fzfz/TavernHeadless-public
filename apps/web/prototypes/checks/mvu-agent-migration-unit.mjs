import fs from "node:fs";
import assert from "node:assert/strict";
import { migrateMvuToAgent } from "./mvu-agent-migration.mjs";
import { compileRegexMigration } from "./regex-migration.mjs";
for (const key of ["linqian", "gushengman"]) {
  const original = JSON.parse(
    fs.readFileSync(
      new URL(`../characters/${key}/snapshot.json`, import.meta.url),
      "utf8",
    ),
  );
  const profile = JSON.parse(
    fs.readFileSync(
      new URL(`../characters/${key}/live-model.json`, import.meta.url),
      "utf8",
    ),
  );
  const snapshot = {
    ...original,
    extensions: {
      ...original.extensions,
      tavern_headless: { stateUpdate: { profile, files: Object.fromEntries((profile.ruleFiles || []).map(file => [file, fs.readFileSync(new URL(`../characters/${key}/${file}`, import.meta.url), "utf8")])) } },
    },
  };
  const before = structuredClone(snapshot);
  const result = migrateMvuToAgent(key, snapshot, original.characterBook);
  assert.deepEqual(snapshot, before);
  const agent = result.snapshot.extensions.tavern_headless.stateUpdate;
  assert(!Object.values(agent.files).join("\n").match(/<\/?(?:Analysis|UpdateVariable|JSONPatch)>/));
  const file = JSON.parse(agent.files["migrated-variable-rules.json"]);
  for (const rule of file.entries) {
    assert.equal(
      rule.content,
      original.characterBook.entries.find((e) => e.id === rule.sourceEntryId)
        .content,
    );
    assert.equal(
      result.worldbook.entries.find((e) => e.id === rule.sourceEntryId).enabled,
      false,
    );
  }
  assert(
    result.worldbook.entries
      .filter((e) => e.enabled)
      .every((e) => !/<(?:Analysis|UpdateVariable|JSONPatch)>/.test(e.content)),
  );
  if (key === "gushengman") {
    assert(!agent.profile.writablePaths.includes("/世界/事件状态"));
    assert(!agent.profile.updaterPrompt.includes("1至3"));
  }
  assert.equal(
    compileRegexMigration([
      {
        key,
        kind: "character",
        name: original.name,
        scripts: original.extensions.regex_scripts,
      },
    ]).scripts.length,
    0,
  );
  assert.throws(
    () => migrateMvuToAgent(key, snapshot, { entries: [] }),
    /MVU_RULE_ENTRY_MISSING/,
  );
  const repeated = migrateMvuToAgent(key, result.snapshot, result.worldbook);
  assert.deepEqual(repeated, result);
}
assert.throws(() => migrateMvuToAgent("unknown", {}, {}), /NOT_REVIEWED/);
console.log(
  "PASS: exact source rules, narrator exclusion, immutable inputs, readonly paths, obsolete regex removal, missing source errors, repeatability",
);

const {validateMigratedMvu} = await import('../../../api/src/services/role-mvu-migration.mjs');
const book={entries:[{disable:true,extensions:{tavern_headlessMigration:{sourceEntryId:115,usage:'variable-rule',target:'rules.json'}}}]};
const bundle={profile:{ruleFiles:['rules.json']},files:{'rules.json':JSON.stringify({entries:[{sourceEntryId:115,content:'rule'}]})}};
assert.deepEqual(validateMigratedMvu(bundle,book),[]);
assert.equal(validateMigratedMvu(bundle,{entries:[{...book.entries[0],disable:false}]} )[0].reason,'source_entry_enabled');
assert.equal(validateMigratedMvu({...bundle,files:{}},book)[0].reason,'rule_file_missing');
assert.equal(validateMigratedMvu({...bundle,files:{'rules.json':JSON.stringify({entries:[{sourceEntryId:115},{sourceId:115}]})}},book)[0].reason,'duplicate_rule');
assert.equal(validateMigratedMvu({...bundle,files:{'rules.json':JSON.stringify({text:'<UpdateVariable>'})}},book)[0].reason,'legacy_output_protocol');
assert.deepEqual(validateMigratedMvu({}, {entries:[]}),[]);
console.log('PASS: migrated bundle validation normal, enabled source, missing file, duplicate and legacy protocol');
assert.equal(validateMigratedMvu(bundle,{entries:[{...book.entries[0],enabled:true,disable:true}]} )[0].reason,'source_entry_enabled');
assert.equal(validateMigratedMvu({...bundle,profile:{...bundle.profile,controllerOwnedPaths:['/event'],writablePaths:['/event']}},book)[0].reason,'controller_agent_path_overlap');

for (const [text, reason] of [['{','rule_file_invalid_json'],['null','rule_entries_invalid'],['{\"entries\":{}}','rule_entries_invalid'],['{\"entries\":[null]}','rule_entries_invalid']]) assert.equal(validateMigratedMvu({...bundle,files:{'rules.json':text}},book)[0].reason,reason);
assert.equal(validateMigratedMvu(bundle,{entries:[{extensions:{tavern_headlessMigration:{}}}]} )[0].reason,'migration_metadata_invalid');
