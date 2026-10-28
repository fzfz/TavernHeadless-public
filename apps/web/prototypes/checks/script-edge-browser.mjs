import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [browserPath, origin] = process.argv.slice(2);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const out = path.join(root, "docs/plans/evidence/script-runtime");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(process.env.TMPDIR || "/tmp/", "layout-boundary-"),
);
const chrome = spawn(
  browserPath,
  [
    "--headless=new",
    "--remote-debugging-pipe",
    "--no-first-run",
    "--user-data-dir=" + profile,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let serial = 0,
  buffer = "";
const pending = new Map(),
  errors = [];
chrome.stdio[4].on("data", (b) => {
  buffer += b;
  let n;
  while ((n = buffer.indexOf("\0")) >= 0) {
    const m = JSON.parse(buffer.slice(0, n));
    buffer = buffer.slice(n + 1);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(m.error);
      else p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + "\0",
    );
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = setTimeout(() => {
  chrome.kill();
  process.exit(2);
}, 240000);
try {
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (m, p) => send(m, p, sessionId);
  await call("Runtime.enable");
  await call("Page.enable");
  const ev = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw r.exceptionDetails;
    return r.result.value;
  };
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1247,
    height: 884,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const base =
    origin +
    "/prototype/apps/user-web/prototypes/script-roleplay.prototype.html";
  const checks = [];
  const test = (name, value) => {
    assert.ok(value, name);
    checks.push({ name, passed: true });
  };
  async function ready() {
    for (let i = 0; i < 100; i++) {
      if (await ev("window.scriptPrototype?.ready")) return;
      await pause(100);
    }
    throw Error("page not ready");
  }
  await call("Page.navigate", { url: base + "?session=script-novel" });
  await ready();
  await pause(200);
  const before = await ev("scriptPrototype.documentId");
  await ev(
    `const selector=document.querySelector('#characters');selector.value='script-cinema';selector.dispatchEvent(new Event('change'))`,
  );
  await pause(300);
  await ready();
  test(
    "role selector loads a new document",
    (await ev("scriptPrototype.documentId")) !== before,
  );
  test(
    "role selector opens selected session",
    (await ev("scriptPrototype.session.sessionId")) === "script-cinema",
  );
  await ev(`scriptPrototype.runtime.api.chat.send({text:'继续'})`);
  await pause(100);
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-auto]').click()`,
  );
  await pause(2350);
  test(
    "author Auto timer advances current text",
    await ev(
      `!document.querySelector('#role').shadowRoot.querySelector('[data-page]').textContent.startsWith('1 /')`,
    ),
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-auto]').click();document.querySelector('#role').shadowRoot.querySelector('[data-input-open]').click()`,
  );
  await ev(
    `(()=>{const root=document.querySelector('#role').shadowRoot;const input=root.querySelector('[data-input]');input.value='这段旋律很好听。';input.dispatchEvent(new Event('input'));root.querySelector('[data-send]').click()})()`,
  );
  await pause(500);
  test(
    "author input closes after shared send completes",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-input-panel]').hidden`,
    ),
  );
  const saved = await ev(
    `scriptPrototype.runtime.api.messages.getFloor({branchId:scriptPrototype.session.branchId,floorId:scriptPrototype.host.get('current').floorId})`,
  );
  test(
    "author input persisted via shared host",
    saved.some((m) => m.role === "user" && m.text === "这段旋律很好听。"),
  );
  await ev(
    `scriptPrototype.runtime.api.media.play({asset:'music-0',channel:'acceptance',loop:true,volume:0})`,
  );
  test(
    "managed audio channel created",
    (await ev("scriptPrototype.runtime.diagnostics().media")) === 1,
  );
  await ev(
    `scriptPrototype.runtime.api.media.pause('acceptance');scriptPrototype.runtime.api.media.stop('acceptance')`,
  );
  const disconnected = await ev(
    `scriptPrototype.host.send({text:'连接中断'},{'X-Prototype-Scenario':'disconnect-main'}).then(()=>null,e=>e.code)`,
  );
  await pause(200);
  test(
    "interrupted main response has explicit unknown result",
    disconnected === "RESULT_UNKNOWN",
  );
  test(
    "interrupted main stream released",
    (await ev("scriptPrototype.host.diagnostics().activeStreams")) === 0,
  );
  const background = await ev(
    `scriptPrototype.host.send({text:'后台中断'},{'X-Prototype-Scenario':'disconnect-job'})`,
  );
  await pause(300);
  test(
    "main promise remains successful when later stream disconnects",
    typeof background.snapshotId === "string",
  );
  test(
    "interrupted job stream released",
    (await ev("scriptPrototype.host.diagnostics().activeStreams")) === 0,
  );
  test(
    "subscriber receives no obsolete live streams",
    (await ev(
      `(()=>{let count=0;const off=scriptPrototype.host.onTextStream(()=>count++);off();return count})()`,
    )) === 0,
  );
  test("no uncaught browser exceptions", errors.length === 0);
  fs.writeFileSync(
    path.join(out, "edge-checks.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  clearTimeout(timeout);
  const closed = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await closed;
  fs.rmSync(profile, { recursive: true, force: true });
}
