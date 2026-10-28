import assert from "node:assert/strict";
import fs from "node:fs";
for (const name of ["harbor", "novel", "expedition"]) {
  const base = new URL("../characters/" + name + "/", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", base)));
  const layouts = new Map();
  let sent;
  const api = {
    data: { get: (key) => manifest.data[key] },
    ui: {
      register(id) {
        const layout = {
          bind(scope, cb) {
            this.binding = cb;
          },
          on(key, event, cb) {
            this[key] = cb;
          },
          update(patch) {
            this.lastPatch = patch;
          },
        };
        layouts.set(id, layout);
        return layout;
      },
      mountFloors() {},
    },
    variables: { watch() {}, onTurnCommitted() {} },
    messages: { onTextStream() {} },
    widgets: { mountChat() {} },
    chat: {
      async send(value) {
        sent = value.text;
      },
    },
  };
  const { mount } = await import(new URL("main.js", base));
  mount({ api });
  const controls = layouts.get("controls");
  for (const trust of [49, 50]) {
    const shown = controls.binding({ variables: { "actor.trust": trust } });
    await controls.b();
    assert.equal(
      sent,
      shown.b.text,
      name + ": shown choice equals sent choice at trust " + trust,
    );
  }
  if (name === "expedition") {
    const map = layouts.get("map");
    for (const destination of manifest.data.destinations) {
      await map[destination.id]();
      assert.equal(sent, destination.message);
    }
    let rejectSend;
    let calls = 0;
    api.chat.send = () => {
      calls++;
      return new Promise((resolve, reject) => {
        rejectSend = reject;
      });
    };
    const pending = map.camp();
    await map.camp();
    assert.equal(calls, 1);
    rejectSend(new Error("生成失败，请重试。"));
    await pending;
    assert.equal(map.lastPatch.camp.disabled, false);
    assert.equal(layouts.get("scene").lastPatch, undefined);
  }
}
console.log("All three cards send the displayed choice at trust 49 and 50");
