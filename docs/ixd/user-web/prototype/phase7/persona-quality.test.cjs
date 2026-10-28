const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    results = [];
  try {
    for (const platform of ["mobile", "desktop"]) {
      const page = await browser.newPage({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(5000);
      page.on("dialog", (d) => d.accept());
      await page.goto(
        "file://" +
          resolve(__dirname, `../../phase7-prototype-${platform}.html`) +
          "#personas",
      );
      await page.getByRole("button", { name: "使用演示账号体验" }).click();
      await page.locator("[data-persona-card]").first().waitFor();
      const firstId = await page
        .locator("[data-persona-card]")
        .first()
        .getAttribute("data-persona-card");
      for (const route of [
        "personas",
        "personas/new",
        `personas/edit/${firstId}`,
      ]) {
        if (route !== "personas") {
          await page.evaluate((r) => (location.hash = r), route);
          await page
            .locator(
              '[data-page-id="' +
                (route === "personas/new" ? "P11" : "P12") +
                '"]',
            )
            .waitFor();
          await page.getByLabel("人格姓名", { exact: true }).waitFor();
        }
        if (route !== "personas") {
          await page
            .getByLabel("人格姓名", { exact: true })
            .fill("长姓名".repeat(60));
          await page
            .getByLabel("完整人设描述", { exact: true })
            .fill("人物资料完整保留。\n".repeat(300));
          assert.equal(
            await page
              .getByLabel("人格姓名", { exact: true })
              .getAttribute("maxlength"),
            "200",
          );
          assert.equal(
            await page
              .getByLabel("完整人设描述", { exact: true })
              .getAttribute("maxlength"),
            "4000",
          );
        }
        const dimensions =
          platform === "mobile"
            ? [
                [320, 740],
                [390, 844],
                [844, 390],
              ]
            : [
                [1024, 768],
                [1440, 1000],
              ];
        for (const [width, height] of dimensions) {
          await page.setViewportSize({ width, height });
          const result = await page.evaluate(() => ({
            overflow: [
              document.documentElement,
              document.querySelector("#app"),
              document.querySelector(".uw-scroll"),
            ].some((el) => el.scrollWidth > el.clientWidth + 1),
            small: [
              ...document.querySelectorAll("#app a,#app button,#app input"),
            ]
              .filter((el) => el.getClientRects().length)
              .map((el) => ({
                name: el.textContent.trim() || el.id,
                w: el.getBoundingClientRect().width,
                h: el.getBoundingClientRect().height,
              }))
              .filter((x) => x.w < 43.9 || x.h < 43.9),
          }));
          assert.equal(
            result.overflow,
            false,
            `${platform} ${route} ${width} overflow`,
          );
          assert.deepEqual(result.small, []);
        }
        await page.setViewportSize({
          width: platform === "mobile" ? 390 : 1440,
          height: 1000,
        });
        await page.evaluate(() => {
          for (const n of ["body", "meta", "title", "section", "card"])
            for (const p of ["font-size", "line-height"]) {
              const k = `--${p}-${n}`,
                v = parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    k,
                  ),
                );
              document.documentElement.style.setProperty(k, `${v * 2}px`);
            }
        });
        assert.equal(
          await page
            .locator(".uw-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
          false,
        );
        if (route !== "personas") {
          const field = page.getByLabel("完整人设描述", { exact: true });
          await field.focus();
          await field.press("Control+End");
          await page
            .getByRole("button", {
              name: route === "personas/new" ? "保存人格" : "保存修改",
              exact: true,
            })
            .scrollIntoViewIfNeeded();
        }
        await page.screenshot({
          path: resolve(
            __dirname,
            `../../phase7-evidence/${platform}-${route === "personas" ? "personas" : route === "personas/new" ? "persona-create" : "persona-edit"}-text-200.png`,
          ),
        });
        await page.evaluate(() =>
          document.documentElement.removeAttribute("style"),
        );
        if (route !== "personas") {
          await page.getByRole("link", { name: "取消", exact: true }).click();
          await page
            .getByRole("button", { name: "放弃草稿并离开", exact: true })
            .click();
          await page.locator("[data-persona-card]").first().waitFor();
        }
        results.push({
          platform,
          route,
          check:
            "HTML直接运行、三种页面的设备框、窄屏与横屏、长文本和200%文字、44px操作范围",
          result: "pass",
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await writeFile(
      resolve(__dirname, "../../phase7-evidence/batch3-quality.json"),
      JSON.stringify(results, null, 2),
    );
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
