import { register } from "tsx/esm/api";
register();
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import assert from "node:assert/strict";
const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const conversion = JSON.parse(
  await readFile(
    resolve(
      process.argv[2] ??
        join(evidence, "conversions/C011-positive/result.json"),
    ),
    "utf8",
  ),
);
const { verifyFormalPackage } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/formal.ts")
);
const { startPreviewServer } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/preview.ts")
);
const { chromium } =
  await import("/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
const formal = await verifyFormalPackage(
  conversion.skillArchive,
  join(dirname(conversion.taskFile), "page-macro-formal"),
);
assert.equal(formal.passed, true, JSON.stringify(formal));
const input = JSON.parse(
  await readFile(join(evidence, "acceptance-cases.json"), "utf8"),
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
const bindings = (
  await import(
    join(conversion.packageDirectory, "frontend/page-macro-bindings.js")
  )
).pageMacroBindings;
const openingConfig = JSON.parse(
  await readFile(join(conversion.packageDirectory, "openings.json"), "utf8"),
);
const introduction =
  openingConfig.items.find((item) => item.kind === "introduction") ??
  openingConfig.items.find(
    (item) => item.id === openingConfig.defaultOpeningIds.individual,
  );
const openingCases = [{ openingId: introduction.id, kind: "introduction" }];
const findNameInitial = (value, path = []) => {
  if (value === "{{user}}与陆泽的家") return path;
  if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      const found = findNameInitial(child, [...path, key]);
      if (found) return found;
    }
};
for (const opening of openingConfig.items) {
  if (!opening.initialStateFile) continue;
  const value = JSON.parse(
    await readFile(
      join(conversion.packageDirectory, opening.initialStateFile),
      "utf8",
    ),
  );
  const path = findNameInitial(value);
  if (path) {
    openingCases.push({ openingId: opening.id, kind: "state-name", path });
    break;
  }
}
assert.equal(openingCases.length, 2, "C011必须保留含姓名的开场初值");
const husband = bindings.find((binding) =>
  binding.template.includes("{{user}}的丈夫，启星科技项目负责人"),
);
assert.ok(husband);
const results = [];
try {
  for (const openingCase of openingCases)
    for (const original of input.personas) {
      const persona = {
        name: original.name,
        description:
          original.name +
          "是31岁的女性，是陆泽的妻子，性格沉着、直率。她正在阅读人物介绍，准备了解陆泽与其他人物的关系。",
      };
      const scenario = {
        version: 1,
        persona,
        preset: {
          name: "C011人物介绍验收",
          data: {
            ...example.preset.data,
            prompts: [
              {
                identifier: "main",
                name: "叙述要求",
                role: "system",
                content:
                  "叙述使用第三人称，直接引语按说话者解释。当前用户：{{user}}。",
              },
              ...example.preset.data.prompts.filter((item) => item.marker),
            ],
          },
        },
        statePreset: { name: "C011当前变量预设", data: statePresetData },
        modelParams: example.modelParams,
        sessionType: "individual",
        openingId: openingCase.openingId,
        testMessages: [
          {
            id: "read-introduction",
            message:
              openingCase.kind === "introduction"
                ? "“我已经读完人物介绍，想先了解陆泽。”"
                : "【给写作者的要求】请接续当前开场，叙述继续使用第三人称。",
            branch_id: "main",
            prompt_intent: "normal",
          },
        ],
      };
      const taskDirectory = dirname(conversion.taskFile);
      await writeFile(
        join(taskDirectory, "preview.json"),
        JSON.stringify(scenario, null, 2),
      );
      const handle = await startPreviewServer(
        taskDirectory,
        {},
        conversion.skillArchive,
      );
      const page = await browser.newPage();
      try {
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(handle.url);
        await page.waitForFunction(
          (name) =>
            Array.from(document.querySelectorAll("*")).some((element) =>
              element.shadowRoot?.textContent.includes(
                name + "的丈夫，启星科技项目负责人",
              ),
            ),
          persona.name,
          { timeout: 45000 },
        );
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll("*")).some((element) => {
              const content = element.shadowRoot?.querySelector(
                ".role-husband .char-content",
              );
              return content && getComputedStyle(content).display === "none";
            }),
          undefined,
          { timeout: 45000 },
        );
        await page.locator(".role-husband .char-header").click();
        await page
          .locator('[data-page-macro="' + husband.id + '"]')
          .waitFor({ state: "visible" });
        await page
          .locator('[data-page-macro="' + husband.id + '"]')
          .scrollIntoViewIfNeeded();
        const rendered = await page.evaluate((id) => {
          const root = Array.from(document.querySelectorAll("*")).find(
            (element) =>
              element.shadowRoot?.querySelector(
                '[data-page-macro="' + id + '"]',
              ),
          ).shadowRoot;
          return Array.from(root.querySelectorAll("[data-page-macro]")).map(
            (element) => ({
              id: element.getAttribute("data-page-macro"),
              text: element.textContent,
            }),
          );
        }, husband.id);
        for (const binding of bindings)
          assert.equal(
            rendered.find((item) => item.id === binding.id)?.text,
            binding.template.replaceAll("{{user}}", persona.name),
          );
        assert.equal(errors.length, 0, JSON.stringify(errors));
        const roleView = await fetch(
          handle.apiUrl + "/sessions/" + handle.sessionId + "/role-view",
        ).then((response) => response.json());
        if (openingCase.path) {
          let value = roleView.data.initial.variables;
          for (const key of openingCase.path) value = value[key];
          assert.equal(value, persona.name + "与陆泽的家");
        }
        const index = input.personas.indexOf(original);
        await page.screenshot({
          path: join(
            evidence,
            "C011-formal-" + openingCase.kind + "-persona-" + index + ".png",
          ),
          fullPage: true,
        });
        await page.reload();
        await page.waitForFunction(
          (name) =>
            Array.from(document.querySelectorAll("*")).some((element) =>
              element.shadowRoot?.textContent.includes(
                name + "的丈夫，启星科技项目负责人",
              ),
            ),
          persona.name,
          { timeout: 45000 },
        );
        const count = await page.evaluate(
          (id) =>
            Array.from(document.querySelectorAll("*"))
              .filter((element) =>
                element.shadowRoot?.querySelector(
                  '[data-page-macro="' + id + '"]',
                ),
              )
              .reduce(
                (sum, element) =>
                  sum +
                  element.shadowRoot.querySelectorAll(
                    '[data-page-macro="' + id + '"]',
                  ).length,
                0,
              ),
          husband.id,
        );
        assert.equal(count, 1);
        results.push({
          persona,
          openingCase,
          initial: roleView.data.initial,
          sessionId: handle.sessionId,
          evidenceDirectory: handle.evidenceDirectory,
          dryRuns: handle.dryRuns,
          rendered,
          remountCount: count,
          errors,
        });
        await page.close();
      } finally {
        await page.close();
        await handle.close();
      }
    }
  await writeFile(
    join(evidence, "C011-acceptance.json"),
    JSON.stringify({ passed: true, formal, results }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "C011-acceptance.json"),
    JSON.stringify(
      {
        passed: false,
        error: String(error),
        stack: error.stack,
        formal,
        results,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
process.stdout.write(
  JSON.stringify({ resultFile: join(evidence, "C011-acceptance.json") }) + "\n",
);
