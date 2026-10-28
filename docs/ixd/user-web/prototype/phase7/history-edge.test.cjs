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
    for (let i = 0; i < 4; i++) {
      await page.goto(url + `#start/c${i + 1}`);
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await page.getByRole("link", { name: "返回历史", exact: true }).waitFor();
    }
    await page.getByRole("link", { name: "返回历史", exact: true }).click();
    await page
      .getByRole("button", { name: "加载更多演绎", exact: true })
      .waitFor();
    assert.equal(await rows().count(), 4);
    if (platform === "mobile")
      await page.getByRole("button", { name: "管理记录", exact: true }).click();
    await page.getByRole("checkbox", { name: /选择已加载记录/ }).check();
    await page.getByText("已选 4 条", { exact: true }).waitFor();
    await page.getByLabel("模拟状态").selectOption("append-failure");
    await page
      .getByRole("button", { name: "加载更多演绎", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重试加载更多", exact: true })
      .waitFor();
    assert.equal(await rows().count(), 4);
    await page
      .getByRole("button", { name: "重试加载更多", exact: true })
      .click();
    await page.getByText(/已加载 6 条，共 6 条/).waitFor();
    assert.equal(await rows().count(), 6);
    assert.equal(
      await page
        .getByRole("checkbox", { name: /选择已加载记录/ })
        .evaluate((el) => el.indeterminate),
      true,
    );
    assert.equal(
      await rows().getByRole("checkbox").filter({ visible: true }).count(),
      6,
    );
    await page.getByLabel("搜索演绎记录", { exact: true }).fill("弥拉");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByText(/当前搜索：弥拉 · 已加载 1 条/).waitFor();
    assert.equal(await rows().count(), 1);
    await page.getByText("已选 0 条", { exact: true }).waitFor();
    if (platform === "mobile") {
      await page.getByRole("checkbox", { name: /选择演绎：/ }).check();
      await page.getByRole("button", { name: "完成", exact: true }).click();
      assert.equal(await rows().getByRole("checkbox").count(), 0);
      await page.getByRole("button", { name: "管理记录", exact: true }).click();
      await page.getByText("已选 0 条", { exact: true }).waitFor();
    }
    console.log(
      `${platform} pagination, loaded-only selection and applied search: passed`,
    );

    await page.getByLabel("模拟状态").selectOption("unknown");
    await rows()
      .first()
      .getByRole("button", { name: /^更多：/ })
      .click();
    await rows()
      .first()
      .getByRole("menuitem", { name: "删除演绎", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除演绎", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("结果待确认", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "返回列表", exact: true })
      .click();
    assert.equal(await rows().count(), 1);
    await page.getByLabel("模拟状态").selectOption("check-failure");
    await page
      .getByRole("button", { name: "核对删除结果", exact: true })
      .click();
    await page
      .getByText("操作结果读取失败，请恢复连接后核对。", { exact: true })
      .waitFor();
    assert.equal(await rows().count(), 1);
    await page.reload();
    await page.getByText("没有匹配的演绎记录", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清除", exact: true }).click();
    await page.getByText(/已加载 4 条，共 5 条/).waitFor();
    await page.getByLabel("模拟状态").selectOption("offline");
    await page.getByText(/当前处于离线状态，已读取的记录可继续查看/).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "删除所选", exact: true })
        .isDisabled(),
      true,
    );
    console.log(
      `${platform} delete unknown retention, failed verification, reload and offline: passed`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
