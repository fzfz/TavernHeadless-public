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
      const file = resolve(
        __dirname,
        `../../phase7-prototype-${platform}.html`,
      );
      await page.goto(`file://${file}#auth`);
      const widths =
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
      for (const route of ["auth", "register", "account"]) {
        if (route === "account") {
          await page.evaluate(() => (location.hash = "auth"));
          await page.getByRole("button", { name: "使用演示账号体验" }).click();
          await page.waitForURL("**#account");
        } else {
          await page.evaluate((r) => (location.hash = r), route);
          await page.waitForURL(`**#${route}`);
        }
        await page
          .locator(
            `[data-page-id="${route === "auth" ? "P05" : route === "register" ? "P06" : platform === "mobile" ? "P08" : "P07"}"]`,
          )
          .waitFor();
        for (const [width, height] of widths) {
          await page.setViewportSize({ width, height });
          const geometry = await page.evaluate(() => ({
            overflow: [
              document.documentElement,
              document.querySelector("#app"),
              document.querySelector(".uw-scroll"),
            ].some((el) => el.scrollWidth > el.clientWidth + 1),
            targets: [
              ...document.querySelectorAll("#app a,#app button,#app input"),
            ]
              .filter((el) => el.getClientRects().length)
              .map((el) => ({
                name: el.textContent.trim() || el.id,
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
              }))
              .filter((x) => x.width < 43.9 || x.height < 43.9),
          }));
          assert.equal(
            geometry.overflow,
            false,
            `${platform} ${route} ${width} overflow`,
          );
          assert.deepEqual(
            geometry.targets,
            [],
            `${platform} ${route} ${width} target size`,
          );
        }
        await page.setViewportSize({
          width: platform === "mobile" ? 390 : 1440,
          height: 1000,
        });
        if (route === "account") {
          await page.getByRole("button", { name: "编辑昵称" }).click();
          await page
            .getByLabel("昵称", { exact: true })
            .fill("在长篇故事中旅行的人".repeat(8));
        } else {
          await page
            .getByLabel("邮箱", { exact: true })
            .fill("a-very-long-account-name@example.com");
        }
        await page.evaluate(() => {
          for (const name of ["body", "meta", "title", "section", "card"])
            for (const prefix of ["font-size", "line-height"]) {
              const key = `--${prefix}-${name}`,
                size = parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    key,
                  ),
                );
              document.documentElement.style.setProperty(key, `${size * 2}px`);
            }
        });
        assert.equal(
          await page
            .locator(".uw-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
          false,
          `${platform} ${route} 200%`,
        );
        const submit = page.getByRole("button", {
          name:
            route === "account"
              ? "保存昵称"
              : route === "register"
                ? "创建账号"
                : "登录并继续",
          exact: true,
        });
        await submit.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve(
            __dirname,
            `../../phase7-evidence/${platform}-${route}-text-200.png`,
          ),
        });
        await page.evaluate(() =>
          document.documentElement.removeAttribute("style"),
        );
        if (route === "account") {
          await page.keyboard.press("Escape");
        }
        results.push({
          platform,
          route,
          check:
            "独立文件运行、设备框、窄屏和横屏无横向溢出、操作目标44px、200%文字",
          result: "pass",
        });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await writeFile(
      resolve(__dirname, "../../phase7-evidence/batch2-quality.json"),
      JSON.stringify(results, null, 2),
    );
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
