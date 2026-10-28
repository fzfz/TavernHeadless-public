import { register } from "tsx/esm/api";
register();
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import assert from "node:assert/strict";

const evidence = resolve(".planning/page-macros-implementation-2026-10-09");
const { verifyFormalPackage } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/formal.ts")
);
const { startPreviewServer } = await import(
  resolve(".agents/skills/native-card-conversion/scripts/preview.ts")
);
const { chromium } =
  await import("/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
const example = JSON.parse(
  await readFile(
    resolve(
      ".agents/skills/native-card-conversion/scripts/preview.example.json",
    ),
    "utf8",
  ),
);
const cards = [
  {
    id: "C072",
    name: "楚昭昭",
    snippet: "崴脚了。",
    description:
      "是18岁的男性，是楚昭昭的同班同学，性格沉着、直率。他已经送楚昭昭回家，并在三天后收到了一条陌生号码的消息。",
    message: "【给写作者的要求】继续使用第三人称叙述，描述当前手机提示的情况。",
  },
  {
    id: "C025",
    name: "叶昀",
    snippet: "我骗你的。我一道题都没写出来。",
    description:
      "是18岁的女性，是叶昀在匿名树洞中的网友，性格耐心、沉着。她正在阅读叶昀刚刚发来的短信。",
    message: "“我看到你发来的消息了。”",
  },
];
const personas = ["沈知夏 $ <林&>", "林婉宁"];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
try {
  for (const card of cards) {
    const conversion = JSON.parse(
      await readFile(
        join(evidence, "conversions", card.id, "result.json"),
        "utf8",
      ),
    );
    const formal = await verifyFormalPackage(
      conversion.archive,
      join(dirname(conversion.taskFile), "actual-card-formal"),
    );
    assert.equal(formal.passed, true, JSON.stringify(formal));
    const archiveCopy = join(
      evidence,
      "conversions",
      card.id,
      card.id + ".zip",
    );
    await copyFile(conversion.archive, archiveCopy);
    for (const [index, name] of personas.entries()) {
      const persona = { name, description: name + card.description };
      const scenario = {
        version: 1,
        persona,
        preset: {
          name: card.id + "整卡页面验收",
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
        modelParams: example.modelParams,
        sessionType: "individual",
        openingId: "first",
        testMessages: [
          {
            id: "scene-continuation",
            message: card.message,
            branch_id: "main",
            prompt_intent: "normal",
          },
        ],
      };
      await writeFile(
        join(dirname(conversion.taskFile), "preview.json"),
        JSON.stringify(scenario, null, 2),
      );
      const handle = await startPreviewServer(
        dirname(conversion.taskFile),
        {},
        conversion.archive,
      );
      const page = await browser.newPage();
      try {
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        await page.goto(handle.url);
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll("*")).some(
              (element) =>
                element.shadowRoot?.querySelector("h1")?.textContent ===
                expected.name,
            ),
          card,
          { timeout: 45000 },
        );
        const readPage = () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll("*"))
              .filter((element) => element.shadowRoot?.querySelector("h1"))
              .map((element) => ({
                heading: element.shadowRoot.querySelector("h1").textContent,
                chatCount: element.shadowRoot.querySelectorAll("#chat").length,
                hasChatText:
                  element.shadowRoot
                    .querySelector("#chat > div")
                    ?.shadowRoot?.querySelector(".history")?.textContent
                    .length > 0,
              })),
          );
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll("*")).some((element) =>
              element.shadowRoot
                ?.querySelector("#chat > div")
                ?.shadowRoot?.querySelector(".history")
                ?.textContent.includes(expected),
            ),
          card.snippet,
          { timeout: 15000 },
        );
        const rendered = await readPage();

        assert.equal(
          rendered.filter((item) => item.heading === card.name).length,
          1,
        );
        assert.equal(
          rendered.find((item) => item.heading === card.name).chatCount,
          1,
        );
        assert.equal(
          rendered.find((item) => item.heading === card.name).hasChatText,
          true,
        );
        const roleView = await fetch(
          handle.apiUrl + "/sessions/" + handle.sessionId + "/role-view",
        ).then((response) => response.json());
        assert.equal(roleView.data.delivery.data.performerName, name);
        const dryRun = handle.dryRuns[0];
        assert.equal(dryRun.passed, true, JSON.stringify(dryRun));
        await page.screenshot({
          path: join(evidence, card.id + "-actual-persona-" + index + ".png"),
        });
        await page.reload();
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll("*")).some(
              (element) =>
                element.shadowRoot?.querySelector("h1")?.textContent ===
                expected.name,
            ),
          card,
          { timeout: 45000 },
        );
        await page.waitForFunction(
          (expected) =>
            Array.from(document.querySelectorAll("*")).some((element) =>
              element.shadowRoot
                ?.querySelector("#chat > div")
                ?.shadowRoot?.querySelector(".history")
                ?.textContent.includes(expected),
            ),
          card.snippet,
          { timeout: 15000 },
        );
        const remounted = await readPage();
        assert.equal(
          remounted.filter((item) => item.heading === card.name).length,
          1,
        );
        assert.equal(
          remounted.find((item) => item.heading === card.name).chatCount,
          1,
        );
        assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
        results.push({
          card: card.id,
          persona,
          archive: archiveCopy,
          formal,
          sessionId: handle.sessionId,
          evidenceDirectory: handle.evidenceDirectory,
          dryRuns: handle.dryRuns,
          rendered,
          remounted,
          pageErrors,
        });
        await writeFile(
          join(evidence, "random-card-acceptance.json"),
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
    join(evidence, "random-card-acceptance.json"),
    JSON.stringify({ passed: true, results }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(evidence, "random-card-acceptance.json"),
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
  JSON.stringify({
    resultFile: join(evidence, "random-card-acceptance.json"),
  }) + "\n",
);
