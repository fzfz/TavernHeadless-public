const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "mobile";
const slice = process.env.SLICE || "list";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    page = await browser.newPage({
      viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
    });
  page.setDefaultTimeout(4000);
  try {
    await page.goto(
      `http://127.0.0.1:4180/phase7-prototype-${platform}.html#personas`,
    );
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await page
      .locator(`[data-page-id="${platform === "mobile" ? "P10" : "P09"}"]`)
      .waitFor();
    assert.equal(
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link")
        .count(),
      4,
    );
    const first = page.locator("[data-persona-card]").first();
    const original = await first.getByRole("heading").innerText();
    if (slice === "list") {
      await page
        .locator("[data-persona-card]")
        .nth(1)
        .getByRole("button", { name: /设为默认/ })
        .click();
      await page.getByText("默认人格已更新。", { exact: true }).waitFor();
      await page.reload();
      await page
        .locator("[data-persona-card]")
        .nth(1)
        .getByText("默认人格", { exact: true })
        .waitFor();
    }
    if (slice === "create") {
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      await page.locator('[data-page-id="P11"]').waitFor();
      await page.getByRole("button", { name: "保存人格", exact: true }).click();
      await page.getByText("请填写人格姓名。", { exact: true }).waitFor();
      await page.getByLabel("人格姓名", { exact: true }).fill("沈砚青");
      await page
        .getByLabel("完整人设描述", { exact: true })
        .fill("沈砚青，三十二岁，游学归来的书生，性格沉稳。");
      await page.getByRole("button", { name: "保存人格", exact: true }).click();
      await page
        .getByRole("heading", { name: "沈砚青", exact: true })
        .waitFor();
    }
    if (slice === "edit") {
      await first.getByRole("link", { name: /查看与编辑/ }).click();
      await page.locator('[data-page-id="P12"]').waitFor();
      assert(
        await page
          .getByRole("button", { name: "保存修改", exact: true })
          .isDisabled(),
      );
      assert.equal(
        await page.getByLabel("人格姓名", { exact: true }).inputValue(),
        original,
      );
      await page.getByLabel("人格姓名", { exact: true }).fill("更新后的姓名");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      await page
        .getByRole("heading", { name: "更新后的姓名", exact: true })
        .waitFor();
    }
    console.log(`${platform} ${slice}: passed`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
