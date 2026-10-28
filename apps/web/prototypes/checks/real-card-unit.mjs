import assert from "node:assert/strict";
import { importOpenings } from "../shared/import-openings.js";
import { setImmediate } from "node:timers";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/package.json",
);
const Ajv = require("./dist/ajv.js");
const parseYaml = createRequire(
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/package.json",
)("./dist/index.js").parse;
const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/character-authoring/script-runtime.schema.json",
      import.meta.url,
    ),
  ),
);
const ajv = new Ajv({ strict: true });
ajv.addSchema(schema);
const validate = ajv.compile({ $ref: schema.$id + "#/definitions/package" });
for (const name of ["linqian", "gushengman"]) {
  const root = new URL("../characters/" + name + "/", import.meta.url);
  const read = (file) => JSON.parse(fs.readFileSync(new URL(file, root)));
  const source = read("source-card.json").data,
    snapshot = read("snapshot.json"),
    manifest = read("manifest.json");
  assert(validate(manifest), JSON.stringify(validate.errors));
  assert.equal(snapshot.description, source.description);
  assert.deepEqual(snapshot.characterBook, source.character_book);
  assert.deepEqual(snapshot.extensions, source.extensions);
  assert.equal(snapshot.greeting, source.first_mes);
  for (const file of [
    manifest.html,
    manifest.css,
    manifest.script,
    ...Object.values(manifest.assets).map((a) => a.file),
  ])
    assert(fs.statSync(new URL(file, root)).size > 0, file);
}
const root = new URL("../characters/linqian/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root))),
  fixture = JSON.parse(fs.readFileSync(new URL("scenario.json", root)));
manifest.data.opening = importOpenings(
  JSON.parse(fs.readFileSync(new URL("snapshot.json", root))),
  JSON.parse(fs.readFileSync(new URL("openings.json", root))),
  fixture.initial,
  { parseYaml, performerName: manifest.data.performerName },
).items[0].displayText;
const layouts = {},
  watches = {};
let sent;
const api = {
  ui: {
    register(id) {
      return (layouts[id] = {
        update(patch) {
          this.patch = { ...this.patch, ...patch };
        },
        bind(scope, fn) {
          this.mapper = fn;
          this.scope = scope;
          this.update(fn({ variables: fixture.initial }));
        },
        on(id, event, fn) {
          this[id] = fn;
        },
      });
    },
  },
  data: { get: (key) => manifest.data[key] },
  variables: {
    watch(scope, fn) {
      watches[scope] = fn;
      fn({ variables: fixture.initial });
    },
  },
  widgets: { mountChat() {} },
  chat: {
    async send(value) {
      sent = value.text;
    },
  },
};
const { mount } = await import(new URL("main.js", root));
mount({ api });
assert.equal(layouts.status.scope, "view");
assert.equal(layouts.status.patch.affection.text, "505");
await layouts.controls.option1();
assert.equal(sent, fixture.initial.行动选项[1]);
const changed = structuredClone(fixture.initial);
changed.林茜.感情 = 600;
changed.世界.分钟 = 35;
const patch = layouts.status.mapper({ variables: changed });
assert.equal(patch.affectionBar.value, 600);
assert.match(patch.time.text, /12:35/);
watches.current({ variables: { ...changed, 行动选项: [] } });
assert.equal(layouts.controls.patch.option1.disabled, true);
let failCalls = 0;
api.chat.send = async () => {
  failCalls++;
  throw new Error("failure");
};
watches.current({ variables: fixture.initial });
await layouts.controls.option1();
assert.equal(failCalls, 1);
assert.equal(layouts.controls.patch.feedback.text, "failure");
assert.equal(layouts.controls.patch.option1.disabled, false);
console.log(
  "Real card source preservation, package assets, nested variables, current choices and failure checks passed",
);

const guRoot = new URL("../characters/gushengman/", import.meta.url);
const guManifest = JSON.parse(
  fs.readFileSync(new URL("manifest.json", guRoot)),
);
guManifest.data.opening = importOpenings(
  JSON.parse(fs.readFileSync(new URL("snapshot.json", guRoot))),
  JSON.parse(fs.readFileSync(new URL("openings.json", guRoot))),
  {},
  { parseYaml },
).items[1].displayText;
const guFixture = JSON.parse(fs.readFileSync(new URL("scenario.json", guRoot)));
const guLayouts = {},
  guWatches = {};
let floorData,
  guSent,
  failSend = false;
const guApi = {
  ui: {
    register(id) {
      return (guLayouts[id] = {
        patch: {},
        update(p) {
          Object.assign(this.patch, p);
        },
        on(key, event, fn) {
          this[key] = fn;
        },
      });
    },
  },
  data: { get: (key) => guManifest.data[key] },
  assets: { list: () => Object.keys(guManifest.assets).map((id) => ({ id })) },
  media: { stop() {}, pause() {}, async play() {} },
  timers: { after: () => () => {}, every: () => () => {} },
  variables: {
    watch(scope, fn) {
      guWatches[scope] = fn;
    },
    getFloor: async () => floorData,
  },
  messages: { onTextStream() {}, getFloor: async () => [] },
  history: { async latest() {} },
  chat: {
    async send({ text }) {
      if (failSend) throw new Error("发送失败，请重试。");
      guSent = text;
    },
  },
};
const guModule = await import(new URL("main.js", guRoot));
guModule.mount({ api: guApi });
const guView = guLayouts["gushengman-stage"],
  guControls = guLayouts["gushengman-controls"];
async function compare(before, after) {
  floorData = { before: { variables: before }, after: { variables: after } };
  guWatches.view({ floorId: "floor-test", branchId: "main", variables: after });
  await new Promise((resolve) => setImmediate(resolve));
  return guView.patch.turnDelta.text;
}
const initial = structuredClone(guFixture.initial),
  updated = structuredClone(initial);
updated.顾声慢.情感连结度 += 5;
assert.match(await compare(initial, updated), /情感连结度 \+5/);
const other = structuredClone(initial);
other.世界.当前地址 = "走廊";
assert.equal(
  await compare(initial, other),
  "本轮：情感连结度未变化，创作完成度未变化",
);
assert.equal(await compare({}, {}), "");
guControls.input({ target: { value: "一起练习" } });
await guControls.send();
assert.equal(guSent, "一起练习");
failSend = true;
guControls.input({ target: { value: "再试一次" } });
await guControls.send();
assert.equal(guControls.patch.send.disabled, false);
assert.equal(guView.patch.feedback.text, "发送失败，请重试。");
console.log(
  "Gu Shengman floor delta, missing values, custom input and send failure checks passed",
);

const guSource = JSON.parse(
  fs.readFileSync(new URL("source-card.json", guRoot)),
).data;
assert.equal(
  guManifest.data.opening.trim(),
  guSource.alternate_greetings[0].trim(),
);
assert(guFixture.turns.length >= 2, "GAL requires two continuation fixtures");
for (const turn of guFixture.turns) {
  assert.notEqual(
    turn.text,
    guSource.first_mes,
    "continuation must not replay card introduction",
  );
  assert.notEqual(
    turn.text,
    guManifest.data.opening,
    "continuation must not replay opening",
  );
}
assert.notEqual(guFixture.turns[0].text, guFixture.turns[1].text);
