import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const shared = path.join(root, "apps/web/prototypes/shared");
const out = path.join(root, "docs/plans/evidence/layout-boundary");
const [browserPath, ajvPath] = process.argv.slice(2);
assert(
  browserPath && ajvPath,
  "Pass the installed Chromium executable and Ajv module path",
);
const Ajv = createRequire(import.meta.url)(ajvPath);
const ajv = new Ajv({ allErrors: true });
const check = ajv.compile(
  JSON.parse(
    fs.readFileSync(
      path.join(shared, "role-view-config.schema.prototype.json"),
    ),
  ),
);
const checkPerformer = ajv.compile(
  JSON.parse(
    fs.readFileSync(path.join(shared, "role-performer.schema.prototype.json")),
  ),
);
const context = { structuredClone };
context.window = context;
vm.runInNewContext(
  fs.readFileSync(path.join(shared, "role-view-data.prototype.js"), "utf8"),
  context,
);
for (const config of Object.values(context.RoleViewDefinition.variants))
  assert(check(config), JSON.stringify(check.errors));
assert(checkPerformer(context.RoleViewDefinition.performer));
const invalid = structuredClone(context.RoleViewDefinition.config);
invalid.choices[0].action = "set_variable";
assert.equal(check(invalid), false);
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
const report = {
  schema: {
    validVariants: Object.keys(context.RoleViewDefinition.variants).length,
    invalidVariableActionRejected: true,
  },
  variants: [],
  checks: [],
};
const timeout = setTimeout(() => {
  chrome.kill();
  process.exit(2);
}, 90000);
try {
  for (const variant of ["bookshop", "harbor", "plain"]) {
    const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const call = (m, p) => send(m, p, sessionId);
    await call("Page.enable");
    await call("Runtime.enable");
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
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
    const url = pathToFileURL(
      path.join(root, "apps/user-web/prototypes/user-roleplay.prototype.html"),
    );
    url.search = `session=session-port-bookshop&presentation=${variant}`;
    await call("Page.navigate", { url: url.href });
    await pause(650);
    assert.equal(
      await ev("validateRoleTemplate(getSession().config.presentation)"),
      "",
    );
    assert.equal(
      await ev("JSON.stringify(RolePresentationSchema)"),
      JSON.stringify(
        JSON.parse(
          fs.readFileSync(
            path.join(shared, "role-view-config.schema.prototype.json"),
          ),
        ),
      ),
    );

    const state = await ev(
      `(()=>{const s=getSession();return {title:s.config.presentation.title,layout:s.config.presentation.layout,sceneX:document.querySelector('.role-scene')?.getBoundingClientRect().x,chatX:document.querySelector('.role-chat-pane')?.getBoundingClientRect().x,composers:document.querySelectorAll('#composer').length,timelines:document.querySelectorAll('#messages').length,topbarVisible:getComputedStyle(document.querySelector('.topbar')).display!=='none',choices:[...document.querySelectorAll('.role-current-actions [data-role-choice]')].map(b=>b.dataset.roleChoice),cards:document.querySelectorAll('.role-inline-card').length,avatars:[...document.querySelectorAll('.role-message-avatar')].every(i=>i.complete&&i.naturalWidth>0),width:document.documentElement.scrollWidth}})()`,
    );
    assert.equal(state.composers, 1);
    assert.equal(state.timelines, 1);
    assert(state.topbarVisible);
    assert(state.avatars);
    assert.equal(state.width, 1247);
    if (variant === "bookshop") assert(state.sceneX < state.chatX);
    if (variant === "harbor") assert(state.chatX < state.sceneX);
    if (variant === "plain") {
      assert.equal(state.cards, 3);
      assert.equal(state.choices.length, 0);
    }
    const shot = async (name) => {
      const r = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(out, name + ".png"),
        Buffer.from(r.data, "base64"),
      );
    };
    await shot(variant + "-desktop");
    if (variant !== "plain") {
      const emptyMedia = await ev(
        `(()=>{const s=getSession(),f=roleFloors(s).at(-1),r=roleRecord(s,f),before=clone(r.config.media);r.config.media.background=null;r.config.media.portrait=null;render();const result=!document.querySelector('.role-portrait')&&!document.querySelector('.role-scenery').style.backgroundImage;r.config.media=before;render();return result})()`,
      );
      assert(emptyMedia);
      const sceneBounds = await ev(
        `(()=>{const e=document.querySelector('.role-scene');return {width:e.clientWidth,scroll:e.scrollWidth}})()`,
      );
      assert(sceneBounds.scroll <= sceneBounds.width + 1);
      const history = await ev(
        `(()=>{const s=getSession(),before=document.querySelector('.role-current-actions').innerHTML;const input='继续问起信件';s.input=input;s.chatScroll=80;render();document.querySelector('#roleHistory').value=s.rounds[0].id;document.querySelector('#roleHistory').dispatchEvent(new Event('change'));return {unchanged:before===document.querySelector('.role-current-actions').innerHTML,input:document.querySelector('#prompt').value,trust:roleRecord(s,s.rounds[0]).variables['relationship.trust'],topbarVisible:getComputedStyle(document.querySelector('.topbar')).display!=='none'}})()`,
      );
      assert(history.unchanged);
      assert.equal(history.input, "继续问起信件");
      assert.equal(history.trust, 20);
      assert(history.topbarVisible);
      const bad = await ev(
        `(()=>{const c=clone(getSession().config.presentation);c.shell.html='<div><slot name="scene"></slot></div>';return validateRoleComposition(c)})()`,
      );
      assert(bad.includes("chat"));
      report.checks.push({
        variant,
        historyOptionsIsolated: true,
        missingChatSlotRejected: true,
        inputPreserved: true,
        nullMediaRendersWithoutImages: true,
        sceneHasNoHorizontalOverflow: true,
      });
    }
    if (variant === "harbor") {
      const nodeIdentity = await ev(
        `(()=>{window.originalMessages=document.querySelector('#messages');window.originalComposer=document.querySelector('#composer');return originalMessages.parentElement.className})()`,
      );
      assert(nodeIdentity);
      await ev(`document.querySelector('[data-action="retry"]').click()`);
      for (let n = 0; n < 80 && (await ev("getSession().running")); n++)
        await pause(200);
      assert.equal(await ev("getSession().rounds.at(-1).state"), "committed");
      const fill = await ev(
        `(()=>{const s=getSession(),count=s.rounds.length;document.querySelector('[data-role-choice="listen"]').click();return {same:count===s.rounds.length,input:s.input}})()`,
      );
      assert(fill.same);
      assert(fill.input.includes("海风"));
      const before = await ev("getSession().rounds.length");
      await ev(`document.querySelector('[data-role-choice="letter"]').click()`);
      assert.equal(await ev("getSession().rounds.length"), before + 1);
      const isolation = await ev(
        `(()=>{const s=getSession(),f=roleFloors(s)[0],r=roleRecord(s,f),old=r.config.media.characterAvatar;s.config.presentation.media.characterAvatar='visitor.svg';return {oldAvatar:r.config.media.characterAvatar===old,performer:r.performer.avatar==='visitor.svg',runningActions:document.querySelectorAll('.message [data-r^="message-"]').length}})()`,
      );
      assert(isolation.oldAvatar && isolation.performer);
      assert.equal(isolation.runningActions, 0);
      report.checks.push({
        variant,
        failedRetryCommitted: true,
        fillWithoutSend: true,
        sendCreatesOneRound: true,
        historicalAvatarFixed: true,
        performerIndependent: true,
      });
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await ev("render()");
    await pause(100);
    await shot(variant + "-mobile");
    assert.equal(await ev("document.documentElement.scrollWidth"), 390);
    if (variant !== "plain")
      assert.equal(await ev("getSession().viewDetails"), true);
    report.variants.push({ ...state, variant, mobileWidth: 390 });
    if (variant === "bookshop") {
      await call("Emulation.setDeviceMetricsOverride", {
        width: 1247,
        height: 884,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await ev(`document.querySelector('[data-return-admin]').click()`);
      await pause(650);
      await ev(`document.querySelector('[data-role-edit]').click()`);
      const editorChecks = await ev(
        `(()=>{const valid=clone(editingRoleView);const cases=[c=>c.choices[0].action='set_variable',c=>c.media.portrait=12,c=>c.shell.html='<div><slot name="scene"></slot></div>',c=>c.shell.html+='<slot name="chat"></slot>',c=>c.scene.html='<script></'+'script>',c=>c.shell.html=c.shell.html.replace('class=', 'onclick='),c=>c.meterMax=0,c=>c.media.extra='x'];const results=cases.map(change=>{const c=clone(valid);change(c);return validateRoleTemplate(c)});const e=document.querySelector('[data-view-structured="media"]');e.value='{';e.dispatchEvent(new Event('input',{bubbles:true}));const syntax=document.querySelector('#roleEditError').textContent;e.value=JSON.stringify(valid.media);e.dispatchEvent(new Event('input',{bubbles:true}));return {results,syntax,restored:document.querySelector('#roleEditError').textContent===''}})()`,
      );
      assert(editorChecks.results.every(Boolean));
      assert(editorChecks.syntax.includes("JSON"));
      assert(editorChecks.restored);
      await ev(
        `(()=>{const field=document.querySelector('[data-view-structured="shell"]');field.value=JSON.stringify(RoleViewDefinition.variants.harbor.shell);field.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-role-apply]').click();document.querySelector('[data-action="save-draft"]').click();})()`,
      );
      assert.equal(
        await ev("saved.presentation.shell.html"),
        context.RoleViewDefinition.variants.harbor.shell.html,
      );
      await ev(
        `document.querySelector('[data-action="start"]').click();document.querySelector('#confirmAccept').click()`,
      );
      await pause(800);
      const trial = await ev(
        `({composers:document.querySelectorAll('#composer').length,rounds:getSession().rounds.length,sceneX:document.querySelector('.role-scene').getBoundingClientRect().x,chatX:document.querySelector('.role-chat-pane').getBoundingClientRect().x})`,
      );
      assert.equal(trial.composers, 1);
      assert.equal(trial.rounds, 0);
      assert(trial.chatX < trial.sceneX);
      report.checks.push({
        variant,
        editorInvalidConfigurationsRejected: editorChecks.results.length,
        jsonSyntaxLocated: true,
        savedLayoutUsedInNewTrial: true,
      });
    }
    await send("Target.closeTarget", { targetId });
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  report.consoleErrors = errors;
  report.result = "passed";
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  await send("Browser.close").catch(() => {});
  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
