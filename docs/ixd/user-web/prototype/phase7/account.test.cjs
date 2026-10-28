const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "mobile";
const slice = process.env.SLICE || "login";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
  });
  page.setDefaultTimeout(4000);
  try {
    const base = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
    await page.goto(base + "#auth");
    await page.locator('[data-page-id="P05"]').waitFor();
    assert.equal(
      await page.getByRole("navigation", { name: "主导航" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByLabel("邮箱", { exact: true })
        .getAttribute("autocomplete"),
      "username",
    );
    const password = page.getByLabel("密码", { exact: true });
    await password.fill("sample-only");
    await page.getByRole("button", { name: "显示密码", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "sample-only");
    await page.getByRole("button", { name: "登录并继续", exact: true }).click();
    await page.getByText("请填写邮箱。", { exact: true }).waitFor();
    if (slice === "login") {
      await page
        .getByLabel("邮箱", { exact: true })
        .fill("traveler@example.com");
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .click();
      await page.waitForURL("**#account");
      console.log(`${platform}: 登录校验、显隐、独立页面和登录目标通过`);
    }
    if (slice === "register") {
      await page.getByRole("link", { name: "注册账号", exact: true }).click();
      await page.locator('[data-page-id="P06"]').waitFor();
      assert.equal(
        await page.getByLabel("密码", { exact: true }).inputValue(),
        "",
      );
      await page.getByLabel("昵称", { exact: true }).fill("新旅人");
      await page.getByLabel("邮箱", { exact: true }).fill("new@example.com");
      await page.getByLabel("密码", { exact: true }).fill("example");
      await page.getByLabel("确认密码", { exact: true }).fill("different");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await page
        .getByText("两次输入的密码不一致，请重新输入确认密码。", {
          exact: true,
        })
        .waitFor();
      await page.getByLabel("确认密码", { exact: true }).fill("example");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await page.locator('[data-page-id="P05"]').waitFor();
      await page.getByText("账号已创建，请登录", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("邮箱", { exact: true }).inputValue(),
        "new@example.com",
      );
      assert.equal(
        await page.getByLabel("密码", { exact: true }).inputValue(),
        "",
      );
      console.log(`${platform}: 注册字段校验、创建后返回登录和密码清理通过`);
    }
    if (slice === "account") {
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page
        .locator(`[data-page-id="${platform === "mobile" ? "P08" : "P07"}"]`)
        .waitFor();
      assert.equal(
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("link")
          .count(),
        4,
      );
      await page
        .getByRole("link", { name: "演绎人格 2 个人格", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "编辑昵称", exact: true }).click();
      await page.getByLabel("昵称", { exact: true }).fill("雨中旅人");
      await page.getByRole("button", { name: "保存昵称", exact: true }).click();
      await page
        .getByRole("heading", { name: "雨中旅人", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.waitForURL("**#discover");
      await page.goto(base + "#account");
      await page.locator('[data-page-id="P05"]').waitFor();
      console.log(`${platform}: 个人计数、昵称编辑、退出和身份保护通过`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
