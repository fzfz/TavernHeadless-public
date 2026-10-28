import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [browserPath, origin] = process.argv.slice(2);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const out = path.join(root, "docs/plans/evidence/openrouter-live");
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
}, 360000);
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

  await open("gushengman");
  await ev(
    `window.liveChecks = {updates:0, ends:0, commits:0, samples:[]}; scriptPrototype.host.onTextStream(e=>{ if(e.type==='update'){liveChecks.updates++; if(liveChecks.samples.length<4) liveChecks.samples.push(e.text);} if(e.type==='end')liveChecks.ends++; }); scriptPrototype.host.onTurnCommitted(()=>liveChecks.commits++);`,
  );
  const before = await ev(`scriptPrototype.host.get('current')`);
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-input-open]').click(); const input=document.querySelector('#role').shadowRoot.querySelector('[data-input]'); input.value='我们在走廊又聊了两分钟，然后道别，明天再一起听琴。'; input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#role').shadowRoot.querySelector('[data-send]').click();`,
  );
  let streamedScreenshot = false;
  for (let i = 0; i < 660; i++) {
    await pause(500);
    const status = await ev(
      `({busy:scriptPrototype.host.diagnostics().busy,checks:liveChecks})`,
    );
    if (status.checks.updates > 5 && !streamedScreenshot) {
      await screenshot("browser-stream");
      streamedScreenshot = true;
    }
    if (!status.busy) break;
  }
  const result = await ev(
    `({checks:liveChecks, current:scriptPrototype.host.get('current'), diagnostics:scriptPrototype.host.diagnostics(), feedback:document.querySelector('#role').shadowRoot.querySelector('[data-feedback]').textContent, text:document.querySelector('#role').shadowRoot.querySelector('[data-text]').textContent})`,
  );
  check("actual text updates received", result.checks.updates > 1);
  check("one committed floor", result.checks.commits === 1);
  check(
    "new snapshot committed",
    result.current.snapshotId !== before.snapshotId,
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-status-toggle]').click()`,
  );
  await pause(500);
  await screenshot("browser-committed");
  const rendered = await ev(
    `(()=>{const root=document.querySelector('#role').shadowRoot;return {affection:root.querySelector('[data-affection-value]').textContent,backgroundLoaded:root.querySelector('[data-background]').naturalWidth>0, status:root.querySelector('[data-status]').textContent}})()`,
  );
  check(
    "state value rendered",
    Number(rendered.affection) === result.current.variables.顾声慢.情感连结度,
  );
  check("background loaded", rendered.backgroundLoaded);
  check("no browser runtime exceptions", errors.length === 0);
  fs.writeFileSync(
    path.join(out, "browser-result.json"),
    JSON.stringify(
      { checks, before, after: result, rendered, errors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, current: result.current }));
} finally {
  clearTimeout(timeout);
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true });
}
