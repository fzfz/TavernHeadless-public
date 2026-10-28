const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const platform = process.env.PLATFORM || "desktop";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  try {
    const evidence = path.resolve(__dirname, "../../phase7-evidence");
    await fs.mkdir(evidence, { recursive: true });
    async function capture(name) {
      for (const theme of ["light", "dark"]) {
        if (theme === "dark")
          await page
            .getByRole("button", { name: "深色主题", exact: true })
            .click();
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(evidence, `${platform}-history-${name}-${theme}.png`),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
    }
    await page.goto(
      `http://127.0.0.1:4180/phase7-prototype-${platform}.html#history`,
    );
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await page.locator("[data-history-row]").first().waitFor();
    await page.locator("#toast.visible").waitFor({ state: "hidden" });
    await capture("list");
    if (platform === "mobile")
      await page.getByRole("button", { name: "管理记录", exact: true }).click();
    const master = page.getByRole("checkbox", { name: /选择已加载记录/ });
    await master.focus();
    await page.keyboard.press("Space");
    assert.equal(
      await master.evaluate((el) => el === document.activeElement),
      true,
      "selection keeps keyboard focus",
    );
    const first = page.locator("[data-history-row]").first();
    await first.getByRole("button", { name: /^更多：/ }).click();
    await first.getByRole("menuitem", { name: "重命名", exact: true }).click();
    await first
      .getByLabel("演绎标题", { exact: true })
      .fill("长标题".repeat(50));
    await first.getByRole("button", { name: "保存标题", exact: true }).click();
    await page.getByText("演绎标题已更新。", { exact: true }).waitFor();
    for (const width of platform === "mobile" ? [320, 390, 740] : [900, 1440]) {
      await page.setViewportSize({ width, height: 740 });
      for (const theme of ["light", "dark"]) {
        await page
          .getByRole("button", { name: "深色主题", exact: true })
          .click();
        assert.equal(
          await page
            .locator(".uw-history-page")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
          `${width} ${theme} horizontal containment`,
        );
      }
    }
    await page.setViewportSize({
      width: platform === "mobile" ? 390 : 1440,
      height: 1000,
    });
    await page.getByRole("button", { name: "删除所选", exact: true }).click();
    await capture("batch-delete");
    const dialog = page.getByRole("dialog");
    const firstButton = dialog.getByRole("button").first(),
      lastButton = dialog.getByRole("button").last();
    await firstButton.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await lastButton.evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await firstButton.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await page.locator("#app > :first-child").getAttribute("inert"),
      "",
    );
    assert.equal(
      await dialog.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const host = document.querySelector("#app").getBoundingClientRect();
        return (
          rect.left >= host.left &&
          rect.right <= host.right + 1 &&
          rect.top >= host.top &&
          rect.bottom <= host.bottom + 1
        );
      }),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${platform} history keyboard focus, long titles, themes, widths and delete focus trap: passed`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
