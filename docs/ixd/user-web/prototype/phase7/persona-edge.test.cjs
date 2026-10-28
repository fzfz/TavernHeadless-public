const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext(),
      page = await context.newPage();
    page.setDefaultTimeout(4000);
    page.on("dialog", (d) => d.accept());
    const url = "http://127.0.0.1:4180/phase7-prototype-desktop.html";
    await page.goto(url + "#personas");
    await page.getByRole("button", { name: "使用演示账号体验" }).click();
    await page.locator("[data-persona-card]").first().waitFor();
    await page.getByRole("link", { name: "创建人格", exact: true }).click();
    await page.getByLabel("人格姓名", { exact: true }).fill("第三个人格");
    await page
      .getByLabel("完整人设描述", { exact: true })
      .fill("一名三十岁的画师，喜欢观察山林。");
    await page.getByRole("button", { name: "保存人格", exact: true }).click();
    await page.getByRole("heading", { name: "第三个人格" }).waitFor();
    const another = await context.newPage();
    another.setDefaultTimeout(4000);
    await another.goto(url + "#personas");
    await another
      .getByRole("button", { name: "加载更多", exact: true })
      .waitFor();
    assert.equal(await another.locator("[data-persona-card]").count(), 2);
    await another.getByLabel("模拟状态").selectOption("append-failure");
    await another
      .getByRole("button", { name: "加载更多", exact: true })
      .click();
    await another
      .getByRole("button", { name: "重试读取", exact: true })
      .waitFor();
    assert.equal(await another.locator("[data-persona-card]").count(), 2);
    await another
      .getByRole("button", { name: "重试读取", exact: true })
      .click();
    await another
      .getByRole("heading", { name: "第三个人格", exact: true })
      .waitFor();
    console.log("分页追加失败后的重试恢复目标页：通过");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
