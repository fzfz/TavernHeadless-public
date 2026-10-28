const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const platform of ["desktop", "mobile"]) {
      const page = await browser.newPage({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
      });
      page.setDefaultTimeout(6000);
      page.on("dialog", (d) => d.accept());
      const b = (n) => page.getByRole("button", { name: n, exact: true });
      await page.goto(
        `http://127.0.0.1:4180/phase7-prototype-${platform}.html#history`,
      );
      await b("使用演示账号体验").click();
      await page
        .getByRole("link", { name: "继续演绎", exact: true })
        .first()
        .click();
      const original = page.url();
      await page
        .locator(".message")
        .last()
        .getByRole("button", { name: "消息操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "编辑消息", exact: true })
        .click();
      await page
        .getByLabel("编辑消息正文")
        .fill("她接过信，仔细看着信封上的名字。");
      await b("保存消息").click();
      await page
        .getByText("她接过信，仔细看着信封上的名字。", { exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByText("她接过信，仔细看着信封上的名字。", { exact: true })
        .waitFor();
      await page
        .locator(".message")
        .last()
        .getByRole("button", { name: "消息操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "从此处建立分支", exact: true })
        .click();
      await b("建立分支").click();
      assert.equal(page.url(), original);
      assert.equal(await page.locator(".message").count(), 3);
      await b("演绎设置").click();
      await page.getByLabel("当前分支").selectOption("main");
      await page.locator(".message").first().waitFor();
      console.log(platform + ": 消息编辑持久化与同会话分支通过");
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
