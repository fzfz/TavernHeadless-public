const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "desktop";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
  });
  page.setDefaultTimeout(4500);
  try {
    await page.goto(
      `http://127.0.0.1:4180/phase7-prototype-${platform}.html#history`,
    );
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await page
      .locator(`[data-page-id="${platform === "mobile" ? "P16" : "P15"}"]`)
      .waitFor();
    const search = page.getByLabel("搜索演绎记录", { exact: true });
    await search.fill("不存在的演绎标题");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByText("没有匹配的演绎记录", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    const nav = page.getByRole("navigation", { name: "主导航" });
    assert.equal(
      await nav
        .getByRole("link", { name: "历史演绎", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(await nav.getByRole("link").count(), 4);
    console.log(`${platform} history search and navigation: passed`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
