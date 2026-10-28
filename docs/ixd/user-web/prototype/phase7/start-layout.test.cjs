const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const out = resolve(__dirname, "../../phase7-evidence");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    results = [];
  await mkdir(out, { recursive: true });
  try {
    for (const platform of ["mobile", "desktop"]) {
      const page = await browser.newPage({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(5000);
      await page.goto(
        `http://127.0.0.1:4180/phase7-prototype-${platform}.html#start/c1`,
      );
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.getByRole("radio", { name: "裴修远", exact: true }).waitFor();
      await page
        .getByRole("button", { name: "展开开场全文", exact: true })
        .waitFor();
      await page.locator("#toast.visible").waitFor({ state: "hidden" });
      await page.screenshot({
        path: resolve(out, `${platform}-start-top.png`),
      });
      await page
        .getByRole("button", { name: "展开开场全文", exact: true })
        .click();
      for (const [width, height] of platform === "mobile"
        ? [
            [320, 740],
            [390, 1000],
            [844, 390],
          ]
        : [
            [1024, 768],
            [1440, 1000],
          ]) {
        await page.setViewportSize({ width, height });
        const result = await page.evaluate(() => ({
          overflow: [
            document.documentElement,
            document.querySelector("#app"),
            document.querySelector(".uw-scroll"),
          ].some((el) => el.scrollWidth > el.clientWidth + 1),
          small: [
            ...document.querySelectorAll("#app a,#app button,.uw-start-option"),
          ]
            .filter((el) => el.getClientRects().length)
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width < 43.9 || r.height < 43.9;
            })
            .map((el) => el.textContent.trim()),
        }));
        const shellGap = await page.locator("[data-page-id]").evaluate((el) => {
          const first = el.querySelector(".uw-mobile-header,.uw-sidebar");
          return (
            first.getBoundingClientRect().top - el.getBoundingClientRect().top
          );
        });
        assert(
          shellGap < 2,
          `${platform} ${width} navigation begins at frame edge: ${shellGap}`,
        );
        assert.equal(result.overflow, false, `${platform} ${width} overflow`);
        assert.deepEqual(
          result.small,
          [],
          `${platform} ${width} touch targets`,
        );
      }
      await page.setViewportSize({
        width: platform === "mobile" ? 390 : 1440,
        height: 1000,
      });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await page.screenshot({
          path: resolve(out, `${platform}-start-${theme}.png`),
        });
      }
      await page.evaluate(() => {
        for (const n of ["body", "meta", "title", "section", "card"])
          for (const p of ["font-size", "line-height"]) {
            const key = `--${p}-${n}`,
              value = parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  key,
                ),
              );
            document.documentElement.style.setProperty(key, `${value * 2}px`);
          }
      });
      await page.waitForTimeout(100);
      const enlarged = await page.evaluate(() => {
        const scroll = document.querySelector(".uw-scroll"),
          submit = document.querySelector(".uw-start-submit");
        return {
          overflow: scroll.scrollWidth > scroll.clientWidth + 1,
          obscures:
            submit.offsetHeight > scroll.clientHeight * 0.45 &&
            getComputedStyle(submit).position === "sticky",
        };
      });
      assert.equal(enlarged.overflow, false, `${platform} 200% text overflow`);
      assert.equal(
        enlarged.obscures,
        false,
        `${platform} 200% text submission covers the content`,
      );
      await page
        .getByRole("button", { name: "开始演绎", exact: true })
        .scrollIntoViewIfNeeded();
      assert(
        await page
          .getByRole("button", { name: "开始演绎", exact: true })
          .isVisible(),
      );
      await page.screenshot({
        path: resolve(out, `${platform}-start-text-200.png`),
      });
      results.push({
        platform,
        dimensions:
          platform === "mobile"
            ? [
                [320, 740],
                [390, 1000],
                [844, 390],
              ]
            : [
                [1024, 768],
                [1440, 1000],
              ],
        themes: ["light", "dark"],
        textScale: 200,
        overflow: false,
        controlsReachable: true,
        result: "passed",
      });
      console.log(`${platform} start layout: passed`);
      await page.close();
    }
    await writeFile(
      resolve(out, "start-layout.json"),
      JSON.stringify(results, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
