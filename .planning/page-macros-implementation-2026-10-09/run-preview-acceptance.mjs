import { register } from "tsx/esm/api";
register();
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import assert from "node:assert/strict";
const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const { startPreviewServer } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/preview.ts")
);
const { chromium } =
  await import("/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
const input = JSON.parse(
  await readFile(join(evidence, "acceptance-cases.json"), "utf8"),
);
const fixtureData = JSON.parse(
  await readFile(join(evidence, "macro-fixtures.json"), "utf8"),
);
const example = JSON.parse(
  await readFile(
    resolve(
      ".agents/skills/native-card-conversion/scripts/preview.example.json",
    ),
    "utf8",
  ),
);
const statePresetData = JSON.parse(
  await readFile(
    resolve(
      ".planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json",
    ),
    "utf8",
  ),
);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
try {
  for (const fixture of fixtureData.fixtures) {
    for (const persona of input.personas) {
      const taskDirectory = dirname(fixture.taskFile);
      const scenario = {
        version: 1,
        persona,
        preset: {
          name: "页面宏资料核对",
          data: {
            ...example.preset.data,
            prompts: [
              {
                identifier: "main",
                name: "叙述要求",
                role: "system",
                content:
                  "叙述使用第三人称，直接引语按说话者解释。当前角色：{{char}}；当前用户：{{user}}。",
              },
              ...example.preset.data.prompts.filter((item) => item.marker),
            ],
          },
        },
        statePreset: { name: "页面宏当前变量预设", data: statePresetData },
        modelParams: example.modelParams,
        sessionType: "individual",
        openingId: "main",
        testMessages: [
          {
            id: "identity",
            message: "“我正在核对当前角色页面的资料。”",
            branch_id: "main",
            prompt_intent: "normal",
          },
        ],
      };
      await writeFile(
        join(taskDirectory, "preview.json"),
        JSON.stringify(scenario, null, 2),
      );
      const handle = await startPreviewServer(
        taskDirectory,
        {},
        fixture.archive,
      );
      const page = await browser.newPage();
      try {
        const consoleErrors = [];
        page.on("pageerror", (error) => consoleErrors.push(String(error)));
        await page.goto(handle.url);
        await page.waitForFunction(
          (name) =>
            Array.from(document.querySelectorAll("*")).some((element) =>
              element.shadowRoot?.textContent.includes(name + " / " + name),
            ),
          persona.name,
          { timeout: 45000 },
        );
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll("*")).some(
              (element) =>
                element.shadowRoot?.querySelector("#lastMessage")
                  ?.textContent === expected &&
                element.shadowRoot?.querySelector("#lastCharMessage")
                  ?.textContent === expected,
            ),
          "姓名：" + persona.name + "，请核对当前资料。",
          { timeout: 30000 },
        );
        const view = await page.evaluate(() => {
          const host = Array.from(document.querySelectorAll("*")).find(
            (element) =>
              element.shadowRoot?.querySelector('[data-page-macro="user"]'),
          );
          const shadow = host.shadowRoot;
          return {
            user: shadow.querySelector("#user").textContent,
            card: shadow.querySelector("#char").textContent,
            state: shadow.querySelector("#getvar").textContent,
            message: shadow.querySelector("#lastMessage").textContent,
            lastUser: shadow.querySelector("#lastUserMessage").textContent,
            lastChar: shadow.querySelector("#lastCharMessage").textContent,
          };
        });
        assert.equal(view.user, persona.name + " / " + persona.name);
        assert.equal(view.card, fixture.cardName);
        assert.equal(view.state, "0");
        assert.equal(
          view.message,
          "姓名：" + persona.name + "，请核对当前资料。",
        );
        assert.equal(view.lastChar, view.message);
        assert.equal(view.lastUser, "");
        assert.equal(consoleErrors.length, 0, JSON.stringify(consoleErrors));
        const roleView = await fetch(
          handle.apiUrl + "/sessions/" + handle.sessionId + "/role-view",
        ).then((response) => response.json());
        assert.equal(
          roleView.data.initial.variables.details.address,
          persona.name + "与" + fixture.cardName + "的资料室",
        );
        assert.deepEqual(roleView.data.initial.variables.labels, [
          persona.name,
          fixture.cardName,
        ]);
        const personaIndex = input.personas.indexOf(persona);
        await page.screenshot({
          path: join(
            evidence,
            fixture.id + "-formal-persona-" + personaIndex + ".png",
          ),
          fullPage: true,
        });
        const record = {
          card: fixture.id,
          persona,
          view,
          initial: roleView.data.initial,
          current: roleView.data.current,
          url: handle.url,
          sessionId: handle.sessionId,
          evidenceDirectory: handle.evidenceDirectory,
          dryRuns: handle.dryRuns,
          consoleErrors,
        };
        results.push(record);
        await writeFile(
          join(evidence, "preview-acceptance.json"),
          JSON.stringify({ passed: false, inProgress: true, results }, null, 2),
        );
        await page.close();
      } finally {
        await page.close();
        await handle.close();
      }
    }
  }
  await writeFile(
    join(evidence, "preview-acceptance.json"),
    JSON.stringify({ passed: true, results }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "preview-acceptance.json"),
    JSON.stringify(
      { passed: false, error: String(error), stack: error.stack, results },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
process.stdout.write(
  JSON.stringify({ resultFile: join(evidence, "preview-acceptance.json") }) +
    "\n",
);
