import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [browserPath, origin, mode] = process.argv.slice(2);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
if (mode === "crossday")
  throw new Error(
    "Cross-day roleplay requires a separately prepared opening, not user-side timing instructions",
  );
const cases = JSON.parse(
  fs.readFileSync(
    new URL("./linqian-live-cases.json", import.meta.url),
    "utf8",
  ),
);
const roleProfile = JSON.parse(
  fs.readFileSync(
    path.join(root, "apps/web/prototypes/characters/linqian/live-model.json"),
    "utf8",
  ),
);
const expectedJobs = roleProfile.sourceAgentBindingIds.length;
const out = path.join(
  root,
  "docs/plans/evidence/linqian-live/normal-roleplay",
  mode === "continuation" ? "continuation" : "opening",
);
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
}, 900000);
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
  let before, result;
  if (mode === "verify-existing") {
    result = JSON.parse(
      fs.readFileSync(path.join(out, "browser-attempt.json"), "utf8"),
    );
    before = result.view;
    check(
      "saved live result matches server",
      (await ev(`scriptPrototype.host.get('current').snapshotId`)) ===
        result.current.snapshotId,
    );
    await ev(
      `scriptPrototype.host.select(${JSON.stringify(before.snapshotId)})`,
    );
  } else {
    await ev(
      `window.liveChecks={updates:0,ends:0,commits:0,jobs:[],snapshots:[],historicalStable:true}; window.original=scriptPrototype.host.get('current'); scriptPrototype.host.onTextStream(e=>{if(e.type==='update')liveChecks.updates++;if(e.type==='end')liveChecks.ends++;if(e.jobId&&!liveChecks.jobs.includes(e.jobId))liveChecks.jobs.push(e.jobId)});scriptPrototype.host.onTurnCommitted(()=>{liveChecks.commits++;scriptPrototype.host.select(original.snapshotId)});scriptPrototype.host.watch('current',r=>{liveChecks.snapshots.push(r.snapshotId);if(r.source.kind==='job'&&scriptPrototype.host.get('view').snapshotId!==original.snapshotId)liveChecks.historicalStable=false});`,
    );
    before = await ev(`scriptPrototype.host.get('current')`);
    await ev(
      `window.chat=document.querySelector('#role').shadowRoot.querySelector('[data-chat]').firstElementChild.shadowRoot;chat.querySelector('textarea').value=${JSON.stringify(mode === "continuation" ? cases.continuation : cases.opening)};chat.querySelector('textarea').dispatchEvent(new Event('input'));if(!chat.querySelector('.retry-state').hidden)chat.querySelector('.retry-state').click();else chat.querySelector('.send').click();`,
    );
    let streamedScreenshot = false,
      retries = 0;
    for (let i = 0; i < 1700; i++) {
      await pause(500);
      const status = await ev(
        `({busy:scriptPrototype.host.diagnostics().busy,checks:liveChecks})`,
      );
      if (status.checks.updates > 5 && !streamedScreenshot) {
        await screenshot("linqian-stream");
        streamedScreenshot = true;
      }
      if (!status.busy) {
        const retrySelector = await ev(
          `!chat.querySelector('.retry-state').hidden ? '.retry-state' : !chat.querySelector('.retry-followups').hidden ? '.retry-followups' : null`,
        );
        if (retrySelector && retries < 2) {
          await screenshot("linqian-retry-" + ++retries);
          await ev(
            `chat.querySelector(${JSON.stringify(retrySelector)}).click()`,
          );
          continue;
        }
        break;
      }
    }
    result = await ev(
      `({checks:liveChecks,current:scriptPrototype.host.get('current'),view:scriptPrototype.host.get('view'),error:chat.querySelector('.error').textContent,diagnostics:scriptPrototype.host.diagnostics()})`,
    );
    fs.writeFileSync(
      path.join(out, "browser-attempt.json"),
      JSON.stringify(result, null, 2),
    );
  }
  check("actual streaming", result.checks.updates > 1);
  check("one main commit", result.checks.commits === 1);
  check(
    "configured followup streams",
    result.checks.jobs.length === expectedJobs,
  );
  check(
    "one main update and configured followups",
    new Set(result.checks.snapshots).size === expectedJobs + 2,
  );
  check(
    "historical selection remains stable",
    result.checks.historicalStable &&
      result.view.snapshotId === before.snapshotId,
  );
  check("no generation errors", !result.error);
  await ev(`scriptPrototype.host.latest()`);
  await pause(300);
  const rendered = await ev(
    `(()=>{const r=document.querySelector('#role').shadowRoot;return {time:r.querySelector('#status-time').textContent,place:r.querySelector('#status-place').textContent,affection:r.querySelector('#status-affection').textContent}})()`,
  );
  check(
    "latest variables rendered",
    Number(rendered.affection) ===
      Math.round(result.current.variables.林茜.感情) &&
      rendered.place === result.current.variables.世界.地点,
  );
  check("no browser runtime exceptions", errors.length === 0);
  await screenshot("linqian-completed");
  const evidence = await (
    await fetch(origin + "/script-api/sessions/script-linqian/live-evidence")
  ).json();
  fs.writeFileSync(
    path.join(out, "browser-result.json"),
    JSON.stringify(
      { checks, before, after: result, rendered, evidence, errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      checks,
      rendered,
      models: evidence.turns.map((t) => t.models),
    }),
  );
} finally {
  clearTimeout(timeout);
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true });
}
