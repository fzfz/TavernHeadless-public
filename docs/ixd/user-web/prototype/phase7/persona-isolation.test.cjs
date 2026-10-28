const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const platform of ["mobile", "desktop"]) {
      const context = await browser.newContext(),
        page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("dialog", (d) => d.accept());
      const url = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      await page.goto(url + "#personas");
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.locator("[data-persona-card]").first().waitFor();
      const id = await page
        .locator("[data-persona-card]")
        .first()
        .getAttribute("data-persona-card");
      await page
        .locator("[data-persona-card]")
        .first()
        .getByRole("link", { name: /查看与编辑/ })
        .click();
      await page.getByLabel("人格姓名", { exact: true }).waitFor();
      await page.getByLabel("模拟状态").selectOption("failure");
      await page
        .getByRole("button", { name: "重新读取人格", exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("人格姓名", { exact: true }).inputValue(),
        "裴修远",
      );
      assert(
        await page
          .getByRole("button", { name: "保存修改", exact: true })
          .isDisabled(),
      );
      await page
        .getByRole("button", { name: "重新读取人格", exact: true })
        .click();
      await page
        .getByLabel("人格姓名", { exact: true })
        .fill("账号A的未保存草稿");
      const other = await context.newPage();
      await other.goto(url + "#account");
      await other
        .getByRole("button", { name: "退出登录", exact: true })
        .click();
      await page.locator('[data-page-id="P05"]').waitFor();
      assert(
        !(await page.locator("#app").innerText()).includes("账号A的未保存草稿"),
      );
      await page.getByRole("link", { name: "注册账号", exact: true }).click();
      await page.getByLabel("昵称", { exact: true }).fill("账号B");
      await page
        .getByLabel("邮箱", { exact: true })
        .fill(`b-${platform}@example.com`);
      await page.getByLabel("密码", { exact: true }).fill("test-only");
      await page.getByLabel("确认密码", { exact: true }).fill("test-only");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .waitFor();
      await page.getByLabel("密码", { exact: true }).fill("test-only");
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "创建你的第一个演绎人格", exact: true })
        .waitFor();
      await page.evaluate((id) => (location.hash = `personas/edit/${id}`), id);
      await page
        .getByRole("heading", { name: "无法访问这个人格", exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("人格姓名", { exact: true }).count(),
        0,
      );
      await page.evaluate(() => (location.hash = "account"));
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.evaluate(() => (location.hash = "personas"));
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.locator("[data-persona-card]").first().waitFor();
      await page
        .locator("[data-persona-card]")
        .first()
        .getByRole("link", { name: /查看与编辑/ })
        .click();
      await page.getByLabel("人格姓名", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("人格姓名", { exact: true }).inputValue(),
        "裴修远",
      );
      assert.equal(
        await page
          .getByText("已恢复当前账号的人格草稿。", { exact: true })
          .count(),
        0,
      );
      console.log(
        `${platform}: 资料重读失败保留完整字段、跨标签页退出清理草稿、账号B空集合和拒绝A资源、重新登录A恢复已保存人格：通过`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
