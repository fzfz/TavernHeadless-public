import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRegexMigration } from "./regex-migration.mjs";
const read = (p) =>
  JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const preset = read("../characters/linqian/preset-tianqin-beta-3.9.json");
for (const key of ["linqian", "gushengman"]) {
  const card = read(`../characters/${key}/snapshot.json`);
  const sources = [
    {
      key,
      kind: "character",
      name: card.name,
      scripts: card.extensions.regex_scripts,
    },
    {
      key: "preset",
      kind: "preset",
      name: "天琴座",
      scripts: preset.extensions.regex_scripts,
    },
  ];
  const { scripts, audit } = compileRegexMigration(sources);
  assert.equal(
    audit.length,
    sources.reduce((n, s) => n + s.scripts.length, 0),
  );
  assert(scripts.every((s) => s.source.ruleId === s.id));
  assert(scripts.every((s) => s.minDepth !== null && s.maxDepth !== null));
  assert(
    !scripts.some((s) =>
      audit.some((a) => a.id === s.id && a.decision === "remove"),
    ),
  );
  const presetScripts = scripts.filter((s) => s.source.kind === "preset");
  assert.deepEqual(
    presetScripts.map((s) => s.source.index),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(presetScripts[4].maxDepth, -1);
  assert.equal(presetScripts[5].disabled, true);
  assert.throws(
    () =>
      compileRegexMigration([{ ...sources[0], scripts: [{ id: "unknown" }] }]),
    /NOT_REVIEWED/,
  );
  assert.throws(
    () =>
      compileRegexMigration([
        {
          ...sources[0],
          scripts: [sources[0].scripts[0], sources[0].scripts[0]],
        },
      ]),
    /DUPLICATE/,
  );
}
assert.deepEqual(compileRegexMigration([]), { scripts: [], audit: [] });
console.log(
  "PASS: source ownership, all rule decisions, removal, order, unlimited depth, disabled state, unknown/duplicate rules, empty sources",
);
