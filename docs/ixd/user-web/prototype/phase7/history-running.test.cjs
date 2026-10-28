const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "desktop";
const url = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  try {
    await page.goto(url + "#history");
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    const first = page.locator("[data-history-row]").first();
    await first.waitFor();
    const id = await first.getAttribute("data-history-row");
    if (platform === "mobile")
      await page.getByRole("button", { name: "管理记录", exact: true }).click();
    const other = await context.newPage();
    other.setDefaultTimeout(7000);
    await other.goto(url + `#chat/${id}`);
    await other.getByRole("textbox", { name: /演绎输入/ }).waitFor();
    await other.getByLabel("模拟状态").selectOption("slow");
    await other
      .getByRole("textbox", { name: /演绎输入/ })
      .fill("“请继续讲述信封的来历。”");
    await other.getByRole("button", { name: "发送", exact: true }).click();
    const target = page.locator(`[data-history-row="${id}"]`);
    await target
      .getByText("演绎正在生成，请结束后再删除。", { exact: true })
      .waitFor();
    assert.equal(await target.getByRole("checkbox").isDisabled(), true);
    await target.getByRole("button", { name: /^更多：/ }).click();
    assert.equal(
      await target
        .getByRole("menuitem", { name: "删除演绎", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await target
        .getByRole("link", { name: "继续演绎", exact: true })
        .isVisible(),
      true,
    );
    await other.getByRole("button", { name: "停止生成", exact: true }).click();
    await other.close();
    console.log(
      `${platform} running session remains readable and excludes deletion: passed`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
