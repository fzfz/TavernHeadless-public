const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    results = [];
  try {
    for (const platform of ["desktop", "mobile"]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(6000);
      page.on("dialog", (d) => d.accept());
      const base = pathToFileURL(
        path.resolve(__dirname, `../../phase7-prototype-${platform}.html`),
      ).href;
      await page.goto(base + "#history");
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.locator("[data-history-row]").first().waitFor();
      for (const [width, height] of [
        [320, 780],
        [390, 844],
        [844, 390],
        [1440, 1000],
      ]) {
        await page.setViewportSize({ width, height });
        for (const route of ["start/c1", "history"]) {
          await page.goto(base + "#" + route);
          await page
            .locator(
              route === "history"
                ? "[data-history-row]"
                : "[name=start-persona]",
            )
            .first()
            .waitFor();
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            `${platform}/${route}/${width}: horizontal`,
          );
          const bad = await page
            .locator("#app button:visible,#app a:visible")
            .evaluateAll((nodes) =>
              nodes
                .filter((n) => n.getBoundingClientRect().height < 43)
                .map((n) => n.textContent),
            );
          assert.deepEqual(bad, [], `${platform}/${route}: targets`);
        }
        await page
          .getByRole("link", { name: "继续演绎", exact: true })
          .first()
          .click();
        await page.getByRole("textbox", { name: /演绎输入/ }).waitFor();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${platform}/chat/${width}: horizontal`,
        );
        await page
          .getByRole("textbox", { name: /演绎输入/ })
          .scrollIntoViewIfNeeded();
        assert(
          await page.getByRole("textbox", { name: /演绎输入/ }).isVisible(),
        );
        await page
          .getByRole("button", { name: "演绎设置", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        const rect = await dialog.boundingBox();
        assert(rect.width <= width + 1);
        await page.getByRole("button", { name: "取消", exact: true }).click();
      }
      await page.setViewportSize({
        width: platform === "mobile" ? 390 : 1440,
        height: 1000,
      });
      await page.goto(base + "#history");
      await page
        .getByRole("link", { name: "继续演绎", exact: true })
        .first()
        .click();
      await page.getByRole("textbox", { name: /演绎输入/ }).waitFor();
      await page.evaluate(() => {
        for (const name of ["body", "meta", "title", "section", "card"]) {
          const k = "--font-size-" + name;
          document.documentElement.style.setProperty(
            k,
            parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue(k),
            ) *
              2 +
              "px",
          );
        }
      });
      await page.getByRole("button", { name: "演绎设置", exact: true }).click();
      await page
        .getByLabel("演绎标题", { exact: true })
        .fill("长标题".repeat(60));
      await page
        .getByRole("button", { name: "保存标题", exact: true })
        .scrollIntoViewIfNeeded();
      assert(
        await page
          .getByRole("button", { name: "保存标题", exact: true })
          .isVisible(),
      );
      await page.screenshot({
        path: path.resolve(
          __dirname,
          `../../phase7-evidence/${platform}-session-text-200.png`,
        ),
        fullPage: true,
      });
      await page.getByRole("button", { name: "保存标题", exact: true }).click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      results.push({
        platform,
        result: "passed",
        checks: [
          "file协议独立打开",
          "320/390/844/1440宽度",
          "操作目标44px",
          "横屏输入与弹层",
          "200%字号与长标题",
        ],
      });
      await page.close();
    }
    await fs.writeFile(
      path.resolve(__dirname, "../../phase7-evidence/remaining-quality.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
