import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [browserPath, origin] = process.argv.slice(2);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const out = path.join(root, "docs/plans/evidence/card-contract");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(process.env.TMPDIR || "/tmp/", "layout-boundary-"),
);
const chrome = spawn(
  browserPath,
  ["--remote-debugging-pipe", "--no-first-run", "--user-data-dir=" + profile],
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
      m.error ? p.reject(m.error) : p.resolve(m.result);
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
}, 90000);
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
  await call("Page.navigate", {
    url:
      origin +
      "/prototype/apps/user-web/prototypes/user-roleplay.prototype.html?source=backend&session=session-port-bookshop",
  });
  await pause(1000);
  console.log(
    await ev(
      'JSON.stringify({notice:$("notice").textContent,package:!!getSession().cardPackage})',
    ),
  );
  const results = [];
  for (const id of ["card-bookshop", "card-novel"]) {
    await ev(`selectBackendCharacter(${JSON.stringify(id)})`);
    await ev(
      '(()=>{const s=getSession();s.id+="-check-"+Date.now();selected=s.id;render()})()',
    );
    assert.equal(
      await ev("CardContract.validate(getSession().cardPackage,cardSchema)"),
      "",
    );
    await ev(
      'window.cardRoot=()=>document.querySelector(".card-package-host").shadowRoot',
    );
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=metric-value]").textContent',
      ),
      "10",
    );
    assert.equal(
      await ev('cardRoot().querySelector("[data-node=unlocked]").hidden'),
      true,
    );
    await ev(
      'getSession().input="尚未发送的草稿";cardAction(getSession(),"advance")',
    );
    await pause(350);
    console.log(
      await ev(
        'JSON.stringify({notice:$("notice").textContent,records:getSession().cardRecords.length,failed:getSession().failed})',
      ),
    );
    assert.equal(await ev("getSession().cardRecords.length"), 2);
    assert.equal(
      await ev("getSession().cardRecords.at(-1).input"),
      await ev("getSession().cardPackage.initial.actionText"),
    );
    assert.equal(await ev("getSession().input"), "尚未发送的草稿");
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=metric-value]").textContent',
      ),
      "35",
    );
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=root]").classList.contains("expanded")',
      ),
      true,
    );
    assert.equal(
      await ev('cardRoot().querySelector("[data-node=unlocked]").hidden'),
      false,
    );
    assert.match(
      await ev('cardRoot().querySelector("[data-node=background]").src'),
      /harbor.svg/,
    );
    await ev('cardAction(getSession(),"gallery")');
    assert.equal(
      await ev(
        'cardRoot().querySelectorAll("[data-node=gallery-image]").length',
      ),
      2,
    );
    await ev('cardAction(getSession(),"gallery")');
    const shot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(out, id + "-turn1.png"),
      Buffer.from(shot.data, "base64"),
    );
    await ev('cardAction(getSession(),"previous")');
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=metric-value]").textContent',
      ),
      "10",
    );
    assert.equal(
      await ev('cardRoot().querySelector("[data-node=advance]").textContent'),
      "追问信件来源",
    );
    await ev('cardAction(getSession(),"advance")');
    await pause(350);
    assert.equal(await ev("getSession().cardRecords.length"), 3);
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=metric-value]").textContent',
      ),
      "10",
    );
    await ev('cardAction(getSession(),"latest")');
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=metric-value]").textContent',
      ),
      "75",
    );
    assert.equal(
      await ev(
        'cardRoot().querySelector("[data-node=root]").classList.contains("expanded")',
      ),
      false,
    );
    assert.match(
      await ev('cardRoot().querySelector("[data-node=background]").src'),
      /bookshop.svg/,
    );
    await ev('cardAction(getSession(),"fill")');
    assert.equal(await ev("getSession().input"), "我想听你继续说。");
    assert.equal(await ev("getSession().rounds.length"), 2);
    const stale = await ev(
      `(async()=>{const s=getSession();return (await fetch('/prototype-runtime/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s.id,branchId:s.activeBranch,floorId:'stale',attemptId:'stale',cardId:s.backendCharacter,versionId:s.backendVersion,expectedSnapshotId:'initial',actionId:'advance'})})).status})()`,
    );
    assert.equal(stale, 409);
    const immutable = await ev("JSON.stringify(getSession().cardRecords)");
    await ev('cardAction(getSession(),"status")');
    assert.equal(
      await ev('cardRoot().querySelector("[data-node=status]").hidden'),
      true,
    );
    await ev('cardAction(getSession(),"status")');
    assert.equal(
      await ev("JSON.stringify(getSession().cardRecords)"),
      immutable,
    );
    await ev('cardAction(getSession(),"nextText")');
    assert.equal(await ev("getSession().cardReading"), 1);
    await ev('cardAction(getSession(),"prevText")');
    assert.equal(await ev("getSession().cardReading"), 0);
    await ev('cardAction(getSession(),"auto")');
    await pause(950);
    assert.equal(await ev("getSession().cardReading"), 1);
    await ev('cardAction(getSession(),"lastText")');
    assert.equal(await ev("getSession().cardAuto"), null);
    await ev('cardAction(getSession(),"music")');
    assert.equal(await ev("cardAudio.paused"), false);
    await ev('cardAction(getSession(),"music")');
    assert.equal(await ev("cardAudio.paused"), true);
    const before = await ev("JSON.stringify(getSession().cardRecords)");
    await ev('cardAction(getSession(),"advance")');
    await pause(250);
    assert.equal(await ev("getSession().failed"), true);
    assert.equal(await ev("JSON.stringify(getSession().cardRecords)"), before);
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert.equal(await ev("document.documentElement.scrollWidth"), 390);
    const mobile = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(out, id + "-mobile.png"),
      Buffer.from(mobile.data, "base64"),
    );
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1247,
      height: 884,
      deviceScaleFactor: 1,
      mobile: false,
    });
    results.push({
      id,
      packageValid: true,
      turnValues: [10, 35, 75],
      conditionalLayout: true,
      historyIsolated: true,
      staleRejected: true,
      failedCommitPreserved: true,
    });
  }
  // A third composition uses exactly the same interpreter and a changed package only.
  const original = (
    await (await fetch(origin + "/characters/card-novel")).json()
  ).data.latest_version.snapshot;
  const changed = structuredClone(original);
  changed.extensions.tavern_headless.card_view.css +=
    " .layout{display:flex;flex-direction:column-reverse}.scene{height:230px;min-height:230px}";
  changed.extensions.tavern_headless.card_view.title = "另一种排列";
  const post = await fetch(origin + "/characters/card-novel/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: changed }),
  });
  assert(post.ok);
  await ev('selectBackendCharacter("card-novel")');
  assert.equal(
    await ev("CardContract.validate(getSession().cardPackage,cardSchema)"),
    "",
  );
  assert.equal(
    await ev(
      'getComputedStyle(cardRoot().querySelector("[data-node=root]")).flexDirection',
    ),
    "column-reverse",
  );
  assert.equal(await ev('document.querySelectorAll("#composer").length'), 1);
  const third = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(out, "third-composition.png"),
    Buffer.from(third.data, "base64"),
  );
  await fetch(origin + "/characters/card-novel/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: original }),
  });
  const invalidPackage = structuredClone(original);
  const definition = invalidPackage.extensions.tavern_headless.card_view;
  const numeric = Object.keys(definition.variables).find(
    (k) => definition.variables[k].type === "number",
  );
  definition.variables[numeric].maximum = 20;
  await fetch(origin + "/characters/card-novel/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: invalidPackage }),
  });
  const invalidVersion = (
    await (await fetch(origin + "/characters/card-novel")).json()
  ).data.latest_version.id;
  const baseRequest = {
    sessionId: "invalid-" + Date.now(),
    branchId: "main",
    floorId: "invalid-floor",
    attemptId: "invalid-attempt",
    versionId: invalidVersion,
    cardId: "card-novel",
    expectedSnapshotId: "initial",
  };
  const denied = await fetch(origin + "/prototype-runtime/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseRequest, actionId: "status" }),
  });
  assert.equal((await denied.json()).error.code, "ACTION_UNAVAILABLE");
  const rejected = await fetch(origin + "/prototype-runtime/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseRequest, text: "继续" }),
  });
  assert.equal((await rejected.json()).error.code, "INVALID_VARIABLES");
  await fetch(origin + "/characters/card-novel/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot: original }),
  });
  await call("Page.reload");
  await pause(1000);
  assert.equal(
    await ev('!!document.querySelector(".card-package-host")'),
    true,
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const report = {
    result: "passed",
    cards: results,
    thirdComposition: "passed without renderer changes",
    serverVariableValidation: true,
    serverActionValidation: true,
    actions: [
      "ui.toggle",
      "chat.fill",
      "chat.send",
      "history.prev",
      "history.latest",
      "reading.prev",
      "reading.next",
      "reading.auto",
      "reading.latest",
      "audio.toggle",
    ],
    consoleErrors: errors,
  };
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  clearTimeout(timeout);
  const closed = new Promise((r) => chrome.once("exit", r));
  await send("Browser.close").catch(() => {});
  chrome.kill();
  await closed;
  fs.rmSync(profile, { recursive: true, force: true });
}
