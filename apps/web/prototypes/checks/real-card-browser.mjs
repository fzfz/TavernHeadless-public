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
  const checks = [];
  const check = (name, result) => {
    assert.ok(result, name);
    checks.push({ name, passed: true });
  };
  const base =
    origin +
    "/prototype/apps/user-web/prototypes/script-roleplay.prototype.html?session=script-";
  const open = async (name) => {
    await call("Page.navigate", { url: base + name });
    for (let i = 0; i < 100; i++) {
      if (
        await ev(
          `window.scriptPrototype?.ready && scriptPrototype.session.sessionId === 'script-${name}'`,
        )
      )
        return;
      await pause(100);
    }
    throw Error(
      "Unable to mount " +
        name +
        ": " +
        JSON.stringify(await ev("window.scriptPrototype")),
    );
  };
  const screenshot = async (name) => {
    const data = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(out, name + ".png"),
      Buffer.from(data.data, "base64"),
    );
  };
  await open("linqian");
  for (let i = 0; i < 50; i++) {
    if (
      await ev(
        `document.querySelector('#role').shadowRoot.querySelector('#status-portrait').naturalWidth>0`,
      )
    )
      break;
    await pause(100);
  }
  check(
    "source portrait loaded",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('#status-portrait').naturalWidth>0`,
    ),
  );
  check(
    "system chat overlay starts hidden",
    await ev("document.querySelector('#fallbackChat').hidden"),
  );
  check(
    "source nested affection rendered",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('#status-affection').textContent === '505'`,
    ),
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-option="1"]').click()`,
  );
  for (let i = 0; i < 100; i++) {
    if (
      await ev(
        'scriptPrototype.host.get("current").floorId && !scriptPrototype.host.diagnostics().busy',
      )
    )
      break;
    await pause(50);
  }
  check(
    "source option persisted by backend",
    await ev(
      `(async()=>{const r=scriptPrototype.host.get('current');return (await scriptPrototype.host.getMessages({branchId:r.branchId,floorId:r.floorId})).some(m=>m.role==='user'&&m.text.includes('绕到门前叫住林茜'));})()`,
    ),
  );
  check(
    "committed nested clock rendered",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('#status-time').textContent.includes('12:25')`,
    ),
  );
  await ev(
    "scriptPrototype.host.select(scriptPrototype.session.initial.snapshotId)",
  );
  check(
    "historical status reads original clock",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('#status-time').textContent.includes('12:24')`,
    ),
  );
  check(
    "current remains committed while history shown",
    await ev('Boolean(scriptPrototype.host.get("current").floorId)'),
  );
  await ev("scriptPrototype.host.latest()");
  await screenshot("linqian");
  await open("gushengman");
  await pause(400);
  check(
    "GAL card has own text container",
    await ev(
      `Boolean(document.querySelector('#role').shadowRoot.querySelector('[data-text]'))`,
    ),
  );
  check(
    "GAL card does not embed system chat list",
    await ev(
      "scriptPrototype.host.diagnostics().chatWidgets===1 && scriptPrototype.runtime.diagnostics().widgets===0",
    ),
  );
  for (let i = 0; i < 50; i++) {
    if (
      await ev(
        `document.querySelector('#role').shadowRoot.querySelector('[data-background]').naturalWidth>0`,
      )
    )
      break;
    await pause(100);
  }
  check(
    "original GAL background loaded",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-background]').naturalWidth>0`,
    ),
  );
  for (let i = 0; i < 120; i++) {
    if (
      await ev(
        `document.querySelector('#role').shadowRoot.querySelector('[data-character-center]').naturalWidth>0`,
      )
    )
      break;
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-next]').click()`,
    );
    await pause(40);
  }
  check(
    "original center portrait loaded",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-character-center]').naturalWidth>0`,
    ),
  );
  await screenshot("gushengman");
  const before = await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-speaker]').textContent + document.querySelector('#role').shadowRoot.querySelector('[data-text]').textContent`,
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-next]').click()`,
  );
  await pause(100);
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-next]').click()`,
  );
  await pause(100);
  check(
    "source dialogue advances",
    (await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-speaker]').textContent + document.querySelector('#role').shadowRoot.querySelector('[data-text]').textContent`,
    )) !== before,
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-input-open]').click()`,
  );
  await ev(
    `(()=>{const e=document.querySelector('#role').shadowRoot.querySelector('[data-input]');e.value='一起练习';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#role').shadowRoot.querySelector('[data-send]').click();})()`,
  );
  for (let i = 0; i < 100; i++) {
    if (
      await ev(
        'scriptPrototype.host.get("current").floorId && !scriptPrototype.host.diagnostics().busy',
      )
    )
      break;
    await pause(50);
  }
  check(
    "GAL custom input reaches backend",
    await ev(
      `(async()=>{const r=scriptPrototype.host.get('current');return (await scriptPrototype.host.getMessages({branchId:r.branchId,floorId:r.floorId})).some(m=>m.role==='user'&&m.text==='一起练习');})()`,
    ),
  );
  const guScenario = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "apps/web/prototypes/characters/gushengman/scenario.json",
      ),
    ),
  );
  const committedText = () =>
    ev(
      `(async()=>{const r=scriptPrototype.host.get('current');return (await scriptPrototype.host.getMessages({branchId:r.branchId,floorId:r.floorId})).filter(m=>m.role==='assistant').map(m=>m.text).join('\\n');})()`,
    );
  check(
    "first reply continues story instead of introduction",
    (await committedText()) === guScenario.turns[0].text,
  );
  const firstFloor = await ev("scriptPrototype.host.get('current').floorId");
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-skip]').click()`,
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-choice-0]').click()`,
  );
  for (let i = 0; i < 100; i++) {
    if (
      (await ev("scriptPrototype.host.get('current').floorId")) !==
        firstFloor &&
      !(await ev("scriptPrototype.host.diagnostics().busy"))
    )
      break;
    await pause(50);
  }
  check(
    "second story choice commits a new floor",
    (await ev("scriptPrototype.host.get('current').floorId")) !== firstFloor,
  );
  check(
    "second reply advances story",
    (await committedText()) === guScenario.turns[1].text,
  );
  check("no uncaught browser errors", errors.length === 0);
  check(
    "no runtime diagnostics",
    await ev("scriptPrototype.runtime.diagnostics().diagnosticEntries===0"),
  );
  fs.writeFileSync(
    path.join(out, "real-card-checks.json"),
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
