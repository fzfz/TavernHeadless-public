import { register } from "tsx/esm/api";
register();
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
const root = process.cwd(),
  evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const skill = resolve(".agents/skills/native-card-conversion/scripts");
const { begin } = await import(join(skill, "source.ts"));
const { v2Card } = await import(join(skill, "source-fixtures.ts"));
const { bindPageMacros } = await import(join(skill, "page-macro-bindings.ts"));
const { indexPackage } = await import(join(skill, "index.ts"));
const { pack } = await import(join(skill, "tool.ts"));
const { verifyFormalPackage } = await import(join(skill, "formal.ts"));
const input = JSON.parse(
  await readFile(join(evidence, "acceptance-cases.json"), "utf8"),
);
const selection = JSON.parse(
  await readFile(join(evidence, "card-selection.json"), "utf8"),
);
const summary = JSON.parse(
  await readFile(join(evidence, "source-summary.json"), "utf8"),
);
const selectedIds = ["C005", "C063", "C013", "C072", "C025"];
const fixtureDirectory = join(evidence, "macro-fixtures");
await mkdir(fixtureDirectory, { recursive: true });
const fixtures = [];
const conditions = {
  card: "package-card",
  session: "single-character",
  variables: { score: ["score"] },
  messages: "saved-visible-active",
};
for (const id of selectedIds) {
  if (process.argv.includes("--reuse-packages")) {
    fixtures.push(
      JSON.parse(
        await readFile(
          join(fixtureDirectory, id, "package-result.json"),
          "utf8",
        ),
      ),
    );
    continue;
  }
  const cardName = summary.find((item) => item.id === id).name;
  const page =
    '<h1 id="heading"></h1>' +
    input.cases
      .map((item) => `<p id="${item.id}">${item.template}</p>`)
      .join("\n");
  const source = v2Card({
    name: cardName,
    description: "这份资料属于{{char}}。姓名：{{user}}。",
    personality: "沉着",
    scenario: "资料核对",
    mes_example: "示例：{{char}}。",
    creator_notes: "作者说明",
    character_version: " 1.2.3 {{revision}} ",
    first_mes: "姓名：{{user}}，请核对当前资料。",
    alternate_greetings: ["候选开场：{{user}}。"],
    extensions: { depth_prompt: { prompt: "深度：{{user}}。" }, page },
  });
  const directory = join(fixtureDirectory, id);
  await mkdir(directory, { recursive: true });
  const sourceFile = join(directory, "source.json");
  await writeFile(sourceFile, JSON.stringify(source, null, 2));
  const begun = await begin(sourceFile);
  let taskFile = begun.taskFile,
    task = JSON.parse(await readFile(taskFile, "utf8"));
  const put = async (path, value) => {
    const file = join(task.packageDirectory, path);
    await mkdir(resolve(file, ".."), { recursive: true });
    await writeFile(
      file,
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
  };
  await put("frontend/index.html", page);
  await put("frontend/style.css", "p { white-space: pre-wrap; }");
  await put(
    "frontend/main.js",
    "export function mount({api}){const layout=api.ui.register('original',{elements:{heading:{selector:'#heading',kind:'text'}}});layout.update({heading:{text:'页面宏验收'}});}",
  );
  const manifest = {
    apiVersion: 1,
    html: "frontend/index.html",
    css: "frontend/style.css",
    script: "frontend/main.js",
    assets: {},
    data: {},
  };
  await put("frontend/manifest.json", manifest);
  const character = JSON.parse(
    await readFile(join(task.packageDirectory, "character.json"), "utf8"),
  );
  await put("character.json", {
    ...character,
    stateUpdate: "agents/state-update/profile.json",
  });
  await put("agents/state-update/profile.json", {
    updaterPrompt: "按保存消息更新测试变量。",
    writablePaths: ["/score"],
    stateSchemaFile: "state/schema.json",
  });
  await put("state/schema.json", {
    type: "object",
    properties: {
      score: { type: "boolean" },
      details: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
        additionalProperties: false,
      },
      labels: { type: "array", items: { type: "string" } },
    },
    required: ["score"],
    additionalProperties: false,
  });
  await put("state/initial/main.json", {
    score: false,
    details: { address: "{{user}}与{{char}}的资料室" },
    labels: ["{{user}}", "{{char}}"],
  });
  await put("openings/main.txt", source.data.first_mes);
  await put("openings.json", {
    defaultOpeningIds: { individual: "main" },
    items: [
      {
        id: "main",
        title: "资料核对",
        summary: "核对角色资料与会话姓名。",
        kind: "introduction",
        audience: "individual",
        textFile: "openings/main.txt",
        initialStateFile: "state/initial/main.json",
      },
    ],
  });
  const bindings = [];
  for (const item of input.cases) {
    const start = page.indexOf(item.template);
    const request = {
      id: item.id,
      source: {
        pointer: "/data/extensions/page",
        start,
        end: start + item.template.length,
      },
      htmlFile: manifest.html,
      template: item.template,
      conditions,
      stateSchemaFile: "state/schema.json",
    };
    const requestFile = join(directory, item.id + ".request.json");
    await writeFile(requestFile, JSON.stringify(request));
    const result = await bindPageMacros(taskFile, requestFile);
    assert.equal(result.passed, true, JSON.stringify(result));
    bindings.push(result);
    taskFile = result.taskFile;
    task = JSON.parse(await readFile(taskFile, "utf8"));
  }
  const indexed = await indexPackage(
    taskFile,
    manifest.html.replace("index.html", "manifest.json"),
  );
  assert.equal(indexed.passed, true, JSON.stringify(indexed));
  const packed = await pack(taskFile);
  assert.equal(packed.passed, true, JSON.stringify(packed));
  const formal = await verifyFormalPackage(
    packed.archive,
    join(dirname(taskFile), "acceptance-formal"),
  );
  assert.equal(formal.passed, true, JSON.stringify(formal));
  const frontend = JSON.parse(
    await readFile(
      join(task.packageDirectory, "frontend/manifest.json"),
      "utf8",
    ),
  );
  const card = JSON.parse(
    await readFile(
      join(task.packageDirectory, "data/page-macro-card.json"),
      "utf8",
    ),
  );
  fixtures.push({
    id,
    cardName,
    sourceFile,
    taskFile,
    packageDirectory: task.packageDirectory,
    archive: packed.archive,
    formal,
    frontend,
    card,
  });
  await writeFile(
    join(directory, "package-result.json"),
    JSON.stringify(fixtures.at(-1), null, 2),
  );
}
await writeFile(
  join(evidence, "macro-fixtures.json"),
  JSON.stringify({ scope: input.scope, selection, fixtures }, null, 2),
);
await build({
  entryPoints: [join(root, "apps/user-web/src/runtime/script-runtime.ts")],
  outfile: join(evidence, "browser-runtime.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
});
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    let file;
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><title>页面宏验收</title><main id="results"></main>',
      );
      return;
    }
    if (pathname === "/runtime.js") file = join(evidence, "browser-runtime.js");
    else {
      const match = pathname.match(/^\/([A-Z]\d+)\/(.+)$/);
      if (!match) throw Error("unknown route");
      const fixture = fixtures.find((item) => item.id === match[1]);
      file = resolve(fixture.packageDirectory, match[2]);
      assert.ok(file.startsWith(fixture.packageDirectory + "/"));
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "text/javascript" : "text/plain",
    );
    res.end(await readFile(file));
  } catch (error) {
    res.statusCode = 404;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const { chromium } =
  await import("/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const context = await browser.newContext({ timezoneId: input.timezone });
  const page = await context.newPage();
  await page.goto(url);
  const results = await page.evaluate(
    async ({ fixtures, input, url }) => {
      const { createScriptRuntime } = await import(url + "/runtime.js");
      globalThis.__acceptanceRuntimes = [];
      const results = [];
      const check = (actual, expected, label) => {
        if (actual !== expected)
          throw Error(label + ": " + JSON.stringify({ actual, expected }));
      };
      const makeRecord = (
        id,
        branchId = "main",
        variables = { score: false },
      ) => ({
        sessionId: "session",
        branchId,
        floorId: null,
        attemptId: null,
        versionId: "v",
        snapshotId: id,
        parentSnapshotId: null,
        variables,
        source: { kind: "initial", runId: null, jobId: null },
      });
      for (const fixture of fixtures) {
        const module = await import(
          url + "/" + fixture.id + "/frontend/page-macros.js"
        );
        const messages = [
          { role: "user", text: "最后用户消息" },
          { role: "assistant", text: "最后角色消息" },
        ];
        const semantic = [];
        for (const item of input.cases) {
          const actual = module.evaluatePageMacros(
            item.template,
            {
              performerName: input.personas[0].name,
              card: fixture.card,
              state: makeRecord("initial"),
              messages,
              now: () => new Date(input.now),
              random: () => 0,
              userAgent: input.userAgent,
            },
            {
              card: "package-card",
              session: "single-character",
              variables: { score: ["score"] },
              messages: "saved-visible-active",
            },
          );
          const expected = item.expected
            .replaceAll("{user}", input.personas[0].name)
            .replaceAll("{char}", fixture.cardName);
          check(actual, expected, fixture.id + "/" + item.id);
          semantic.push({ id: item.id, actual, expected });
        }
        const instances = [];
        for (const persona of input.personas) {
          const root = document.createElement("section");
          root.dataset.card = fixture.id;
          document.querySelector("#results").append(root);
          let current = makeRecord("initial"),
            pages = 0;
          const watches = new Set(),
            commits = new Set(),
            reports = [];
          const host = {
            get: () => current,
            watch: (scope, cb) => {
              watches.add(cb);
              cb(current);
              return () => watches.delete(cb);
            },
            onTurnCommitted: (cb) => {
              commits.add(cb);
              return () => commits.delete(cb);
            },
            onTextStream: () => () => {},
            listFloors: async ({ cursor }) => {
              pages++;
              return cursor
                ? { items: [{ floorId: "old" }], nextCursor: null }
                : { items: [{ floorId: "new" }], nextCursor: "older" };
            },
            getMessages: async ({ floorId }) => [
              {
                id: floorId,
                role: floorId === "old" ? "user" : "assistant",
                text: floorId === "old" ? "最后用户消息" : "最后角色消息",
                floorId,
                streamId: null,
                status: "completed",
              },
            ],
            report: (report) => reports.push(report),
          };
          const html = await (
            await fetch(url + "/" + fixture.id + "/" + fixture.frontend.html)
          ).text();
          const runtime = createScriptRuntime({
            root,
            host,
            delivery: {
              html,
              css: "p {white-space:pre-wrap}",
              scriptUrl: url + "/" + fixture.id + "/" + fixture.frontend.script,
              assets: {},
              data: {
                performerName: persona.name,
                pageMacroCard: fixture.card,
              },
            },
            policy: {
              overscanFloors: 0,
              historyCache: { maxEntries: 64, maxBytes: 1000000 },
              settledStreamCache: { maxEntries: 8, maxBytes: 100000 },
              diagnosticsCache: { maxEntries: 64, maxBytes: 100000 },
            },
          });
          await runtime.mount();
          const text = (id) =>
            root.shadowRoot.querySelector("#" + id).textContent;
          check(
            text("user"),
            persona.name + " / " + persona.name,
            "runtime user",
          );
          check(text("char"), fixture.cardName, "runtime card");
          check(text("getvar"), "0", "runtime state");
          check(text("lastMessage"), "最后角色消息", "runtime message");
          check(
            root.shadowRoot.querySelector("#user").children.length,
            1,
            "text element structure",
          );
          const initial = runtime.getDiagnostics();
          check(initial.layouts, 2, "layout count");
          current = makeRecord("second", "main", { score: true });
          for (const callback of watches) await callback(current);
          check(text("getvar"), "1", "updated state");
          for (const callback of commits) await callback();
          check(text("lastMessage"), "最后角色消息", "committed message");
          check(reports.length, 0, "runtime reports");
          const rendered = {
            user: text("user"),
            card: text("char"),
            state: text("getvar"),
            message: text("lastMessage"),
          };
          runtime.destroy();
          check(watches.size, 0, "released state subscriptions");
          check(commits.size, 0, "released commit subscriptions");
          check(runtime.getDiagnostics().layouts, 0, "released layouts");
          const remountRoot = document.createElement("section");
          remountRoot.dataset.card = fixture.id;
          document.querySelector("#results").append(remountRoot);
          const remount = createScriptRuntime({
            root: remountRoot,
            host,
            delivery: {
              html,
              css: "p {white-space:pre-wrap}",
              scriptUrl: url + "/" + fixture.id + "/" + fixture.frontend.script,
              assets: {},
              data: {
                performerName: persona.name,
                pageMacroCard: fixture.card,
              },
            },
            policy: {
              overscanFloors: 0,
              historyCache: { maxEntries: 64, maxBytes: 1000000 },
              settledStreamCache: { maxEntries: 8, maxBytes: 100000 },
              diagnosticsCache: { maxEntries: 64, maxBytes: 100000 },
            },
          });
          await remount.mount();
          check(
            remountRoot.shadowRoot.querySelector("#user").textContent,
            persona.name + " / " + persona.name,
            "remount user",
          );
          check(remount.getDiagnostics().layouts, 2, "remount layouts");
          instances.push({
            persona,
            rendered,
            initial,
            remount: remount.getDiagnostics(),
            pages,
          });
          globalThis.__acceptanceRuntimes.push(remount);
        }
        results.push({ id: fixture.id, semantic, instances });
      }
      return results;
    },
    { fixtures, input, url },
  );
  await page.screenshot({
    path: join(evidence, "five-card-macros.png"),
    fullPage: true,
  });
  for (const fixture of fixtures)
    await page
      .locator('section[data-card="' + fixture.id + '"]')
      .last()
      .screenshot({ path: join(evidence, fixture.id + "-macro-page.png") });
  await page.evaluate(() => {
    for (const runtime of globalThis.__acceptanceRuntimes) runtime.destroy();
  });
  await writeFile(
    join(evidence, "browser-acceptance.json"),
    JSON.stringify({ passed: true, results }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "browser-acceptance.json"),
    JSON.stringify(
      { passed: false, error: String(error), stack: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
process.stdout.write(
  JSON.stringify({ resultFile: join(evidence, "browser-acceptance.json") }) +
    "\n",
);
