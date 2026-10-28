import assert from "node:assert/strict";
import { importOpenings } from "../shared/import-openings.js";
for (const count of [0, 1, 5]) {
  const snapshot = {
    greeting: "Main",
    alternateGreetings: Array.from(
      { length: count },
      (_, i) => "Alternate " + i,
    ),
  };
  const result = importOpenings(
    snapshot,
    { defaultOpeningId: "first", entries: {} },
    { value: 1 },
  );
  assert.equal(result.items.length, count + 1);
  assert.deepEqual(
    result.items.map((item) => item.text),
    [snapshot.greeting, ...snapshot.alternateGreetings],
  );
  assert.equal(new Set(result.items.map((item) => item.id)).size, count + 1);
  result.items[0].variables.value = 2;
  if (count) assert.equal(result.items[1].variables.value, 1);
}
const source = { greeting: "Main", alternateGreetings: ["Alternate"] };
const configured = importOpenings(
  source,
  {
    defaultOpeningId: "alternate-1",
    entries: { first: { kind: "introduction", title: "Intro" } },
  },
  {},
);
assert.equal(configured.items.length, 2);
assert.equal(configured.items[0].kind, "introduction");
assert.equal(configured.items[1].text, "Alternate");
assert.throws(
  () =>
    importOpenings(source, { defaultOpeningId: "missing", entries: {} }, {}),
  /Unknown default/,
);
assert.throws(
  () =>
    importOpenings(
      source,
      { defaultOpeningId: "first", entries: { "alternate-2": {} } },
      {},
    ),
  /Unknown opening metadata/,
);
assert.deepEqual(
  importOpenings(
    { greeting: "Main" },
    { defaultOpeningId: "first", entries: {} },
    {},
  ).items.map((item) => item.text),
  ["Main"],
);
console.log(
  "Generic opening import passed: 0/1/5 alternates, partial metadata, immutable variables and invalid references",
);
const initialized = importOpenings(
  {
    greeting:
      'Hello {{user}}<StatusPlaceHolderImpl/><UpdateVariable><initvar>data</initvar><JSONPatch>[{"op":"replace","path":"/score","value":4}]</JSONPatch></UpdateVariable>',
  },
  { defaultOpeningId: "first", entries: {} },
  {},
  { parseYaml: () => ({ score: 1 }), performerName: "访客" },
);
assert.equal(initialized.items[0].displayText, "Hello 访客");
assert.equal(initialized.items[0].variables.score, 4);
assert.throws(
  () =>
    importOpenings(
      { greeting: "<initvar>data</initvar>" },
      { defaultOpeningId: "first", entries: {} },
      {},
    ),
  /YAML parser/,
);
for (const operation of [
  { op: "remove", path: "/x" },
  { op: "replace", path: "/absent", value: 2 },
]) {
  assert.throws(
    () =>
      importOpenings(
        { greeting: `<JSONPatch>${JSON.stringify([operation])}</JSONPatch>` },
        { defaultOpeningId: "first", entries: {} },
        {},
      ),
    /opening patch/,
  );
}
