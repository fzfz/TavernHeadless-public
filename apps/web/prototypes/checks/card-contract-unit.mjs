import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
await import("../shared/card-contract.prototype.js");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const dir = path.join(root, "apps/web/prototypes/shared");
const schema = JSON.parse(
  fs.readFileSync(path.join(dir, "card-contract.schema.json")),
);
const Ajv = createRequire(import.meta.url)(process.argv[2]);
const validate = new Ajv({ strict: false }).compile(schema);
const cards = JSON.parse(
  fs.readFileSync(path.join(dir, "characters.seed.prototype.json")),
);
const turns = JSON.parse(
  fs.readFileSync(path.join(dir, "card-turns.fixture.json")),
);
globalThis.CardErrors = JSON.parse(
  fs.readFileSync(path.join(dir, "card-errors.json")),
);
assert.match(
  CardContract.explain(CardContract.variables({}, null)),
  /要求为对象/,
);
for (const type of ["string", "number", "boolean", "array"])
  assert.match(
    CardContract.explain('field: type "' + type + '"'),
    /请管理员修正/,
  );
const checks = [];
for (const card of cards) {
  const pkg = card.snapshot.extensions.tavern_headless.card_view;
  assert(validate(pkg), JSON.stringify(validate.errors));
  assert.equal(CardContract.validate(pkg, schema), "");
  for (const turn of turns[card.id])
    assert.equal(CardContract.variables(pkg, turn.variables), "");
  for (const change of [
    (p) => p.tree.children.push(structuredClone(p.tree.children[0])),
    (p) => (p.actions.fill.type = "run_script"),
    (p) => (p.actions.fill.text.source = "view"),
    (p) => (p.actions.status.target = "missing"),
    (p) => (p.avatar = "missing"),
    (p) => (p.initial[Object.keys(p.variables)[0]] = 999),
    (p) => delete p.initial.location,
    (p) => (p.initial.location = 42),
    (p) => (p.initial.background = "missing"),
    (p) =>
      p.tree.children.push({ id: "bad-slot", type: "slot", name: "history" }),
    (p) => (p.initial.gallery = "bad"),
  ]) {
    const bad = structuredClone(pkg);
    change(bad);
    assert(CardContract.validate(bad, schema));
  }
  checks.push({
    card: card.id,
    schema: true,
    commits: turns[card.id].length,
    invalidPackages: 11,
  });
}
const lit = (value) => ({ source: "literal", value });
for (const [op, left, right, expected] of [
  ["eq", 1, 1, true],
  ["eq", 1, "1", false],
  ["ne", 1, 2, true],
  ["gt", 2, 1, true],
  ["gte", 2, 2, true],
  ["lt", 1, 2, true],
  ["lte", 2, 2, true],
])
  assert.equal(
    CardContract.condition({ op, left: lit(left), right: lit(right) }, {}),
    expected,
  );
const yes = { op: "eq", left: lit(1), right: lit(1) },
  no = { op: "not", arg: yes };
assert.equal(CardContract.condition({ op: "and", args: [yes, no] }, {}), false);
assert.equal(CardContract.condition({ op: "or", args: [yes, no] }, {}), true);
const request = {
  sessionId: "s",
  branchId: "b",
  floorId: "f",
  attemptId: "a",
  versionId: "v",
  cardId: "c",
  expectedSnapshotId: "initial",
  text: "hi",
};
assert.equal(
  CardContract.check(request, schema.definitions.request, schema),
  "",
);
assert(
  CardContract.check(
    { ...request, actionId: "x" },
    schema.definitions.request,
    schema,
  ),
);
assert(CardContract.check({ text: "hi" }, schema.definitions.request, schema));
const out = path.join(root, "docs/plans/evidence/card-contract");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "schema-report.json"),
  JSON.stringify(
    {
      result: "passed",
      checks,
      expressionOperators: 9,
      requestExclusiveInput: true,
    },
    null,
    2,
  ),
);
console.log(
  "Card schemas, 22 invalid configurations, expressions and request validation passed",
);
