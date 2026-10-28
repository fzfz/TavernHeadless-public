const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "mobile";
const base =
  process.env.PROTOTYPE_URL ||
  `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: platform === "mobile" ? 430 : 1440, height: 1000 },
  });
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base);
    await page
      .locator(
        `[data-testid="${platform === "mobile" ? "PhoneFrame" : "WindowFrame"}"]`,
      )
      .waitFor();
    assert.equal(await page.locator('[aria-label="主导航"] a').count(), 4);
    const cards = page.locator("[data-role-card]");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    await page.getByLabel("搜索角色", { exact: true }).fill("沈知微");
    assert.equal(await cards.count(), 3, "输入草稿不应立即替换结果");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByText("共 1 个角色", { exact: true }).waitFor();
    assert.equal(await cards.count(), 1);
    await page.getByRole("radio", { name: "奇幻", exact: true }).check();
    await page
      .getByRole("heading", { name: "没有符合条件的角色", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "重置筛选", exact: true })
      .first()
      .click();
    await page
      .getByText("共 6 个角色 · 已加载 3 个", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "加载更多", exact: true }).click();
    await page.getByText("共 6 个角色", { exact: true }).waitFor();
    assert.equal(await cards.count(), 6);
    await page.getByRole("radio", { name: "古风", exact: true }).check();
    await page.getByText("共 2 个角色", { exact: true }).waitFor();
    await page.getByLabel("搜索角色", { exact: true }).fill("尚未提交的草稿");
    const title = page.getByRole("link", { name: "沈知微", exact: true });
    await title.click();
    await page
      .getByRole("heading", { name: "沈知微", exact: true, level: 1 })
      .waitFor();
    assert.equal(
      await page.locator("dialog[open]").count(),
      0,
      "详情应是完整页面",
    );
    assert.equal(
      await page.locator("[data-page-id]").getAttribute("data-page-id"),
      platform === "mobile" ? "P04" : "P03",
    );
    await page.getByRole("link", { name: "返回角色广场", exact: true }).click();
    await page.getByText("共 2 个角色", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("搜索角色", { exact: true }).inputValue(),
      "尚未提交的草稿",
    );
    assert.equal(
      await page.getByRole("radio", { name: "古风", exact: true }).isChecked(),
      true,
    );
    await page.locator('#browse-results[aria-busy="false"]').waitFor();
    assert.equal(
      await title.evaluate((el) => el === document.activeElement),
      true,
    );
    await page.reload();
    await page.getByText("共 2 个角色", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("搜索角色", { exact: true }).inputValue(),
      "尚未提交的草稿",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${platform}: 导航、搜索提交、分类、重置、分页、详情独立、返回和刷新恢复通过`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
