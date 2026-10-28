const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const platform of ["desktop", "mobile"]) {
      const ctx = await browser.newContext(),
        p = await ctx.newPage();
      p.setDefaultTimeout(6000);
      p.on("dialog", (d) => d.accept());
      const b = (n) => p.getByRole("button", { name: n, exact: true }),
        inp = () => p.getByRole("textbox", { name: /演绎输入/ }),
        menu = () =>
          p
            .locator(".message")
            .last()
            .getByRole("button", { name: "消息操作", exact: true });
      const base = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      await p.goto(base + "#history");
      await b("使用演示账号体验").click();
      await p
        .getByRole("link", { name: "继续演绎", exact: true })
        .first()
        .click();
      await inp().waitFor();
      const url = p.url();
      await menu().click();
      await p.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
      await p.getByLabel("编辑消息正文").fill("我保留的本地草稿");
      const other = await ctx.newPage();
      await other.goto(url);
      await other
        .locator(".message")
        .last()
        .getByRole("button", { name: "消息操作", exact: true })
        .click();
      await other
        .getByRole("menuitem", { name: "编辑消息", exact: true })
        .click();
      await other.getByLabel("编辑消息正文").fill("另一标签页保存的正文");
      await other
        .getByRole("button", { name: "保存消息", exact: true })
        .click();
      await p
        .getByRole("button", { name: "继续编辑草稿", exact: true })
        .waitFor();
      assert(await b("保存消息").isDisabled());
      await b("继续编辑草稿").click();
      await b("保存消息").click();
      await p.getByText("我保留的本地草稿", { exact: true }).waitFor();
      await other.close();
      await p.getByLabel("模拟状态").selectOption("write-failure");
      await inp().fill("“这是一封旧信。”");
      await b("发送").click();
      assert.equal(await inp().inputValue(), "“这是一封旧信。”");
      await p.getByLabel("模拟状态").selectOption("normal");
      await inp().waitFor();
      for (let i = 0; i < 12; i++) {
        await inp().fill(`“请看第${i + 1}处字迹。”`);
        await b("发送").click();
        await b("停止生成").click();
      }
      await b("加载更早消息").waitFor();
      const before = await p.locator(".message").count();
      await p.getByLabel("模拟状态").selectOption("earlier-failure");
      await b("加载更早消息").click();
      assert.equal(await p.locator(".message").count(), before);
      await b("重试读取更早消息").click();
      assert((await p.locator(".message").count()) > before);
      await menu().click();
      await p.getByRole("menuitem", { name: "续写", exact: true }).click();
      await b("停止生成").click();
      await p.getByLabel("模拟状态").selectOption("snapshot-failure");
      await b("查看完整人设").click();
      await b("重试读取人设").click();
      await p.locator("[data-page-id=P20]").waitFor();
      await b("关闭").click();
      const logout = await ctx.newPage();
      await logout.goto(base + "#account");
      await logout
        .getByRole("button", { name: "退出登录", exact: true })
        .click();
      await p.locator("[data-page-id=P05]").waitFor();
      assert.equal(await inp().count(), 0);
      await p.goto(url);
      await p.locator("[data-page-id=P05]").waitFor();
      console.log(
        `${platform}: 跨标签页消息冲突、发送失败保留、消息分页重试、续写、人设重读、退出隔离通过`,
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
