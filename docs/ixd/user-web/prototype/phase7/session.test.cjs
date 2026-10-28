const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const platform of ["desktop", "mobile"]) {
      const page = await browser.newPage({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 960 },
      });
      page.setDefaultTimeout(5000);
      page.on("dialog", (d) => d.accept());
      await page.goto(
        `http://127.0.0.1:4180/phase7-prototype-${platform}.html#history`,
      );
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page
        .getByRole("link", { name: "继续演绎", exact: true })
        .first()
        .click();
      await page
        .locator(`[data-page-id="${platform === "desktop" ? "P17" : "P18"}"]`)
        .waitFor();
      assert.equal(await page.locator("#app .uw-sidebar").count(), 0);
      await page
        .getByRole("button", { name: "查看完整人设", exact: true })
        .click();
      await page.locator('[data-page-id="P20"]').waitFor();
      assert((await page.getByRole("dialog").innerText()).includes("裴修远"));
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      const input = page.getByRole("textbox", { name: /演绎输入/ });
      await input.fill("“这封信应当交给谁？”");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page
        .getByRole("button", { name: "停止生成", exact: true })
        .waitFor();
      await input.fill("下一条草稿");
      await page.getByRole("button", { name: "停止生成", exact: true }).click();
      await page.getByText("已保存", { exact: true }).first().waitFor();
      assert.equal(await input.inputValue(), "下一条草稿");
      console.log(platform + ": 独立会话、人设快照、发送停止与下一条草稿通过");
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
