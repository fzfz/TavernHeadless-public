const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  async function navigate(name) {
    const exit = page.getByRole("button", { name: "返回历史", exact: true });
    if (await exit.count()) await exit.click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  try {
    await page.goto("http://127.0.0.1:4178/#auth");
    await page.getByRole("button", { name: "使用演示账号体验" }).click();
    await page.getByRole("button", { name: "查看沈知微" }).click();
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page
      .locator('#role-runtime-host[data-ready="true"]')
      .waitFor({ timeout: 3000 });
    assert.equal(await page.locator(".shell, .sidebar, .topbar").count(), 0);
    assert.equal(await page.locator('[data-owner="card"]').count(), 1);
    assert.equal(await page.locator('[data-owner="system-chat"]').count(), 1);
    await page.getByRole("button", { name: "询问信的来处" }).click();
    assert.equal(
      await page.getByPlaceholder("写下你的动作或台词……").inputValue(),
      "“这封信，是谁留下的？”",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page
      .getByRole("button", { name: "停止生成" })
      .waitFor({ state: "hidden" });
    assert.equal(await page.locator(".message").count(), 3);
    await page.getByRole("button", { name: "原型：隐藏区域说明" }).click();
    assert.equal(await page.locator(".ownership-label:visible").count(), 0);
    await page.getByRole("button", { name: "原型：显示区域说明" }).click();
    await page.screenshot({ path: "/tmp/tavern-runtime-custom.png" });
    await navigate("角色广场");
    await page.getByRole("button", { name: "查看弥拉" }).click();
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.getByRole("heading", { name: "远航者号 · 领航台" }).waitFor();
    await page.locator('#role-runtime-host[data-ready="true"]').waitFor();
    await page.getByRole("button", { name: "查看星图", exact: true }).click();
    assert.equal(
      await page.getByPlaceholder("写下你的动作或台词……").inputValue(),
      "“把信号来源标在星图上吧。”",
    );
    await page.screenshot({ path: "/tmp/tavern-runtime-ship.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/tavern-runtime-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate("角色广场");
    await page.getByRole("button", { name: "查看顾南舟" }).click();
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.locator('#role-runtime-host[data-ready="true"]').waitFor();
    assert.equal(await page.locator('[data-owner="card"]').count(), 0);
    assert.equal(await page.locator('[data-owner="system-chat"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 真实 Runtime 挂载、角色布局、系统聊天嵌入、角色选项填入系统输入框、生成、边界切换、不同角色布局、纯对话卡。",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
