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
  page.setDefaultTimeout(6000);
  const rows = () => page.locator("[data-history-row]");
  try {
    await page.goto(url + "#history");
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await rows().first().waitFor();
    let first = rows().first();
    const sessionId = await first.getAttribute("data-history-row");
    await first.getByRole("button", { name: /^更多：/ }).click();
    await first.getByRole("menuitem", { name: "重命名", exact: true }).click();
    await first
      .getByLabel("演绎标题", { exact: true })
      .fill("历史页面保留的标题");
    await first.getByRole("link", { name: "继续演绎", exact: true }).click();
    await page
      .getByRole("button", { name: "离开并保留草稿", exact: true })
      .click();
    await page.getByRole("button", { name: "演绎设置", exact: true }).click();
    assert.equal(
      await page.getByLabel("演绎标题", { exact: true }).inputValue(),
      "历史页面保留的标题",
    );
    await page
      .getByLabel("演绎标题", { exact: true })
      .fill("会话设置保留的标题");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "保留草稿并关闭", exact: true })
      .click();
    await page.getByRole("link", { name: "返回历史", exact: true }).click();
    first = page.locator(`[data-history-row="${sessionId}"]`);
    await first.getByLabel("演绎标题", { exact: true }).waitFor();
    assert.equal(
      await first.getByLabel("演绎标题", { exact: true }).inputValue(),
      "会话设置保留的标题",
    );
    await page.locator(`[data-history-row="${sessionId}"]:focus`).waitFor();
    assert.equal(
      await first.evaluate((el) => el === document.activeElement),
      true,
      "return to the original history row",
    );
    console.log(
      `${platform} shared title draft and history return anchor: passed`,
    );

    const other = await context.newPage();
    await other.goto(url + "#account");
    await other.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.locator('[data-page-id="P05"]').waitFor();
    assert.equal(
      (await page.locator("#app").innerText()).includes("会话设置保留的标题"),
      false,
    );
    await page.getByRole("link", { name: "注册账号", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("历史隔离账号");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(`history-${platform}@example.com`);
    await page.getByLabel("密码", { exact: true }).fill("test-only");
    await page.getByLabel("确认密码", { exact: true }).fill("test-only");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await page
      .getByRole("button", { name: "登录并继续", exact: true })
      .waitFor();
    await page.getByLabel("密码", { exact: true }).fill("test-only");
    await page.getByRole("button", { name: "登录并继续", exact: true }).click();
    await page.getByText("还没有演绎记录", { exact: true }).waitFor();
    assert.equal(await rows().count(), 0);
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "用户中心", exact: true })
      .click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.goto(url + "#history");
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await rows().first().waitFor();
    assert.equal(
      await page.getByLabel("演绎标题", { exact: true }).count(),
      0,
      "logout clears the account title draft",
    );
    assert.equal(
      (await page.locator("#app").innerText()).includes("会话设置保留的标题"),
      false,
    );
    console.log(
      `${platform} cross-tab logout, account isolation and draft cleanup: passed`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
