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
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if (await ev("Boolean(window.scriptPrototype)")) return;
      await pause(100);
    }
    throw Error("page ready timeout");
  };
  const open = async (url) => {
    await call("Page.navigate", { url });
    await ready();
    if (!(await ev("scriptPrototype.ready")))
      throw Error(
        JSON.stringify({ page: await ev("scriptPrototype"), errors }),
      );
    test("page mounted " + url, true);
    await pause(400);
  };
  await open(base);
  const catalog = await ev('fetch("/script-api/catalog").then(r=>r.json())');
  for (const card of catalog.filter((c) => ["harbor", "novel", "expedition"].includes(c.id))) {
    await open(base + "?session=" + encodeURIComponent(card.sessionId));
    test(
      card.id + " script mounted",
      await ev(
        'document.querySelector("#role").shadowRoot.querySelectorAll("[data-chat]").length===1',
      ),
    );
    test(
      card.id + " no rendering errors",
      await ev('document.querySelector("#notice").textContent===""'),
    );
    test(
      card.id + " state expanded",
      await ev(
        '!document.querySelector("#role").shadowRoot.querySelector("[data-status-panel]").hidden',
      ),
    );
    await ev(
      `window.observed=[];scriptPrototype.host.watch('current',r=>observed.push(['current',r.snapshotId]));scriptPrototype.host.onTurnCommitted(e=>observed.push(['commit',e.after.snapshotId]));scriptPrototype.host.onTextStream(e=>observed.push(['text',e.type,e.streamId,e.revision]));scriptPrototype.host.send({text:'继续'},{'X-Prototype-Scenario':'interleaved'}).then(r=>observed.push(['resolved',r.snapshotId]))`,
    );
    await pause(400);
    const events = await ev("observed");
    test(
      card.id + " commit before send resolve",
      events.findIndex((e) => e[0] === "commit") <
        events.findIndex((e) => e[0] === "resolved"),
    );
    test(
      card.id + " stream before commit",
      events.findIndex((e) => e[0] === "text") <
        events.findIndex((e) => e[0] === "commit"),
    );
    const identities = await ev(
      `(async()=>{const p=await scriptPrototype.host.listFloors({branchId:scriptPrototype.session.branchId});const r=await scriptPrototype.host.getFloor({branchId:scriptPrototype.session.branchId,floorId:p.items[0].floorId});return{item:p.items[0],before:r.before,after:r.after,current:scriptPrototype.host.get('current')}})()`,
    );
    test(
      card.id + " immutable main snapshot and job snapshot",
      identities.after.snapshotId !== identities.current.snapshotId &&
        identities.after.source.kind === "floor" &&
        identities.current.source.kind === "job",
    );
    await ev(
      `scriptPrototype.host.select(${JSON.stringify(identities.item.snapshotId)})`,
    );
    test(
      card.id + " historical state selected",
      await ev(
        `scriptPrototype.host.get('view').snapshotId===${JSON.stringify(identities.item.snapshotId)}`,
      ),
    );
    await ev(`scriptPrototype.host.send({text:'继续前行'})`);
    await pause(300);
    test(
      card.id + " history pinned while new current arrives",
      await ev(
        `scriptPrototype.host.get('view').snapshotId===${JSON.stringify(identities.item.snapshotId)}`,
      ),
    );
    await ev("scriptPrototype.host.latest()");
    test(
      card.id + " persisted floor messages",
      await ev(
        `scriptPrototype.runtime.api.messages.getFloor({branchId:scriptPrototype.session.branchId,floorId:scriptPrototype.host.get('current').floorId}).then(messages=>messages.some(m=>m.role==='assistant'))`,
      ),
    );
    test(
      card.id + " view returns latest",
      await ev(
        `scriptPrototype.host.get('view').snapshotId===scriptPrototype.host.get('current').snapshotId`,
      ),
    );
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(out, card.id + ".png"),
      Buffer.from(screenshot.data, "base64"),
    );
    if (card.id === "expedition") {
      for (const [id, location, message] of [
        ["camp", "inside", "前往营地"],
        ["bridge", "valley", "前往石桥"],
        ["ridge", "moon", "前往月下山脊"],
      ]) {
        const previous = await ev(
          'scriptPrototype.host.get("current").snapshotId',
        );
        await ev(
          `document.querySelector('#role').shadowRoot.querySelector('[data-${id}]').click()`,
        );
        for (let i = 0; i < 100; i++) {
          if (
            await ev(
              `scriptPrototype.host.get('current').snapshotId !== ${JSON.stringify(previous)} && !scriptPrototype.host.diagnostics().busy`,
            )
          )
            break;
          await pause(50);
        }
        test(
          "map " + id + " commits backend location",
          await ev(
            `scriptPrototype.host.get('current').variables['scene.id'] === ${JSON.stringify(location)}`,
          ),
        );
        test(
          "map " + id + " saves destination message",
          await ev(
            `(async()=>{ const r=scriptPrototype.host.get('current'); const messages=await scriptPrototype.host.getMessages({branchId:r.branchId,floorId:r.floorId,attemptId:r.attemptId}); return messages.some(m=>m.role==='user'&&m.text===${JSON.stringify(message)}); })()`,
          ),
        );
      }
    }
  }
  const cinema = catalog.find((c) => c.id === "cinema");
  await open(base + "?session=" + encodeURIComponent(cinema.sessionId));
  test(
    "cinema owns narrative container without chat or floor slots",
    await ev(
      `(()=>{const root=document.querySelector('#role').shadowRoot;return !!root.querySelector('[data-text]')&&!root.querySelector('[data-chat]')&&!root.querySelector('[data-floors]')&&document.querySelector('#fallbackChat').hidden})()`,
    ),
  );
  await ev(
    `window.cinemaFrames=[];scriptPrototype.host.onTextStream(e=>{if(!e.jobId)cinemaFrames.push({type:e.type,text:document.querySelector('#role').shadowRoot.querySelector('[data-text]').textContent})});scriptPrototype.host.send({text:'开始剧情'})`,
  );
  await pause(300);
  test(
    "cinema receives stream into author DOM",
    await ev(`cinemaFrames.some(f=>f.type==='update'&&f.text.length>0)`),
  );
  test(
    "cinema displays only one narrative block",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelectorAll('[data-text]').length===1`,
    ),
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-next]').click()`,
  );
  test(
    "cinema paragraph navigation",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-page]').textContent.startsWith('2 /')`,
    ),
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-hide]').click()`,
  );
  test(
    "cinema hides its own text container",
    await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-narration]').hidden`,
    ),
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-hide]').click()`,
  );
  await ev(
    `document.querySelector('#role').shadowRoot.querySelector('[data-status-toggle]').click()`,
  );
  test(
    "cinema toggles own status panel",
    await ev(
      `!document.querySelector('#role').shadowRoot.querySelector('[data-status]').hidden`,
    ),
  );
  const picture = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(out, "cinema.png"),
    Buffer.from(picture.data, "base64"),
  );
  const savedText = await ev(
    `scriptPrototype.host.getMessages({branchId:scriptPrototype.session.branchId,floorId:scriptPrototype.host.get('current').floorId}).then(messages=>messages.find(m=>m.role==='assistant').text.split(/\\n\\s*\\n/)[0])`,
  );
  await open(base + "?session=" + encodeURIComponent(cinema.sessionId));
  test(
    "cinema restores persisted text after full reload",
    (await ev(
      `document.querySelector('#role').shadowRoot.querySelector('[data-text]').textContent`,
    )) === savedText,
  );
  await open(base + "?session=" + encodeURIComponent(catalog[0].sessionId));
  const beforeFailure = await ev(
    'scriptPrototype.host.get("current").snapshotId',
  );
  const failed = await ev(
    `scriptPrototype.host.send({text:'失败检查'},{'X-Prototype-Scenario':'fail'}).then(()=>null,e=>e.code)`,
  );
  test("failed generation rejects", failed === "GENERATION_FAILED");
  test(
    "failed generation leaves committed variables",
    (await ev('scriptPrototype.host.get("current").snapshotId')) ===
      beforeFailure,
  );
  const busy = await ev(
    `(()=>{const a=scriptPrototype.host.send({text:'一'});const b=scriptPrototype.host.send({text:'二'}).then(()=>null,e=>e.code);return Promise.all([a,b]).then(r=>r[1])})()`,
  );
  test("double send uses shared busy gate", busy === "SEND_BUSY");
  await pause(300);
  await ev(
    `(async()=>{for(let i=0;i<100;i++){await scriptPrototype.host.send({text:'继续 '+i});await new Promise(r=>setTimeout(r,10))}})()`,
  );
  await pause(800);
  await ev(
    `window.chatHistory=document.querySelector('#role').shadowRoot.querySelector('[data-chat]').firstElementChild.shadowRoot.querySelector('.history')`,
  );
  for (let i = 0; i < 8; i++) {
    await ev(
      'chatHistory.scrollTop=chatHistory.scrollHeight;chatHistory.dispatchEvent(new Event("scroll"))',
    );
    await pause(180);
  }
  const atEnd = await ev("scriptPrototype.host.diagnostics().lists[0]");
  test(
    "100 floor scroll reaches final page",
    atEnd.items >= 100 && !atEnd.hasNextPage,
  );
  test("virtualized chat keeps mounted rows bounded", atEnd.mounted <= 12);
  await ev(
    'chatHistory.scrollTop=0;chatHistory.dispatchEvent(new Event("scroll"))',
  );
  await pause(300);
  test(
    "scroll back restores first floor",
    await ev(
      'scriptPrototype.host.diagnostics().lists[0].firstVisibleFloorId.endsWith(":floor:1")',
    ),
  );
  await ev(
    'document.querySelector("#role").shadowRoot.querySelector(".journal").open=true',
  );
  await pause(300);
  test(
    "custom floor template mounts on expansion",
    await ev("scriptPrototype.runtime.diagnostics().floorScopes>0"),
  );
  await ev(
    'document.querySelector("#role").shadowRoot.querySelector(".journal").open=false',
  );
  await pause(300);
  test(
    "collapsed floor list releases scopes",
    await ev("scriptPrototype.runtime.diagnostics().floorScopes===0"),
  );
  const resources = await ev(
    "({runtime:scriptPrototype.runtime.diagnostics(),host:scriptPrototype.host.diagnostics()})",
  );
  test(
    "history cache bounded",
    resources.host.history.entries <= 24 &&
      resources.host.history.bytes <= 8388608,
  );
  test("streams released", resources.host.activeStreams === 0);
  const lists = resources.host.lists;
  test("chat virtual list exists", lists.length > 0);
  fs.writeFileSync(
    path.join(out, "resources.json"),
    JSON.stringify(resources, null, 2),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(500);
  test(
    "mobile no document overflow",
    await ev("document.documentElement.scrollWidth<=390"),
  );
  fs.writeFileSync(
    path.join(out, "mobile.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  test(
    "no reported runtime errors",
    resources.host.diagnostics.entries === 0 &&
      resources.runtime.diagnosticEntries === 0,
  );
  test("no uncaught browser exceptions", errors.length === 0);
  fs.writeFileSync(
    path.join(out, "checks.json"),
    JSON.stringify({ checks, errors, resources }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: checks.length, output: out, resources }),
  );
} finally {
  clearTimeout(timeout);
  const closed = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await closed;
  fs.rmSync(profile, { recursive: true, force: true });
}
