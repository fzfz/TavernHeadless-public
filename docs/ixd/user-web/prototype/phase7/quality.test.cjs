const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  try {
    for (const platform of ["mobile", "desktop"]) {
      const page = await browser.newPage({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      await page.goto(
        `http://127.0.0.1:4180/phase7-prototype-${platform}.html`,
      );
      await page.locator('#browse-results[aria-busy="false"]').waitFor();
      await page.getByRole("radio", { name: "全部", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("radio", { name: "古风", exact: true })
          .isChecked(),
        true,
      );
      await page.locator('#browse-results[aria-busy="false"]').waitFor();
      const reset = page.getByRole("button", { name: "重置筛选", exact: true });
      await reset.click();
      await page.locator('#browse-results[aria-busy="false"]').waitFor();
      await page
        .getByRole("link", { name: "跳到角色列表", exact: true })
        .click();
      assert.equal(
        await page
          .locator("#role-results")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      const dimensions = async () =>
        page
          .locator(
            '.uw-button,.uw-link,.uw-card h3 a,.uw-categories label,[aria-label="主导航"] a,input[type="search"]',
          )
          .evaluateAll((elements) =>
            elements
              .filter((e) => e.getClientRects().length)
              .map((e) => {
                const r = e.getBoundingClientRect();
                return {
                  label:
                    e.textContent.trim() ||
                    e.getAttribute("aria-label") ||
                    e.id,
                  width: r.width,
                  height: r.height,
                };
              }),
          );
      let targets = await dimensions();
      assert.deepEqual(
        targets.filter((t) => t.width < 43.9 || t.height < 43.9),
        [],
        "全部操作目标至少44px",
      );
      await page.getByRole("link", { name: "沈知微", exact: true }).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .getByRole("link", { name: "沈知微", exact: true })
          .evaluate((el) => getComputedStyle(el).outlineStyle),
        "solid",
      );
      await page.keyboard.press("Enter");
      await page
        .getByRole("heading", { name: "沈知微", level: 1, exact: true })
        .waitFor();
      await page.locator("#detail-start[href]").waitFor();
      targets = await dimensions();
      assert.deepEqual(
        targets.filter((t) => t.width < 43.9 || t.height < 43.9),
        [],
      );
      await page
        .getByLabel("模拟状态", { exact: true })
        .selectOption("longtext");
      await page.locator("#detail-start[href]").waitFor();
      await page
        .locator("#browse-scroll")
        .evaluate((el) => (el.scrollTop = 300));
      await page.waitForTimeout(100);
      const before = await page
        .locator("#browse-scroll")
        .evaluate((el) => el.scrollTop);
      await page.goBack();
      await page.locator('#browse-results[aria-busy="false"]').waitFor();
      await page.getByRole("link", { name: "沈知微", exact: true }).click();
      await page.locator("#detail-start[href]").waitFor();
      assert.equal(
        await page.locator("#browse-scroll").evaluate((el) => el.scrollTop),
        before,
        `${platform}详情阅读位置恢复`,
      );
      await page.evaluate(() => {
        for (const name of ["body", "meta", "title", "section", "card"]) {
          const root = document.documentElement;
          const size = parseFloat(
            getComputedStyle(root).getPropertyValue(`--font-size-${name}`),
          );
          const line = parseFloat(
            getComputedStyle(root).getPropertyValue(`--line-height-${name}`),
          );
          root.style.setProperty(`--font-size-${name}`, `${size * 2}px`);
          root.style.setProperty(`--line-height-${name}`, `${line * 2}px`);
        }
      });
      await page.waitForTimeout(100);
      assert.equal(
        await page
          .locator(".uw-story p")
          .first()
          .evaluate(
            (el) =>
              parseFloat(getComputedStyle(el).lineHeight) >=
              parseFloat(getComputedStyle(el).fontSize),
          ),
        true,
        "放大文字后行高仍可容纳文字",
      );
      assert.equal(
        await page
          .locator("#browse-scroll")
          .evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
        "200%文字不横向溢出",
      );
      if (platform === "mobile")
        assert.equal(
          await page
            .locator("#start-area")
            .evaluate((el) =>
              el.parentElement.classList.contains("uw-detail-copy"),
            ),
          true,
          "大字模式操作区回到正文流",
        );
      await page.locator("#detail-start").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(
          __dirname,
          `../../phase7-evidence/${platform}-text-200.png`,
        ),
      });
      assert.equal(
        await page
          .locator("#detail-start")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      results.push({
        platform,
        checks: [
          "方向键单选",
          "跳至结果焦点",
          "44px操作范围",
          "可见键盘焦点",
          `${platform}详情阅读位置恢复`,
          "200%文字",
          "减少动态效果",
        ],
        status: "passed",
      });
      await page.close();
    }
    await writeFile(
      resolve(__dirname, "../../phase7-evidence/quality.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
