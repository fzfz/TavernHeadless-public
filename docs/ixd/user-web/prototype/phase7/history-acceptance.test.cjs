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
  page.setDefaultTimeout(5000);
  const rows = () => page.locator("[data-history-row]");
  async function login() {
    await page.goto(url + "#history");
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await rows().first().waitFor();
  }
  async function renameRow(row) {
    await row.getByRole("button", { name: /^更多：/ }).click();
    await row.getByRole("menuitem", { name: "重命名", exact: true }).click();
  }
  try {
    await login();
    assert.equal(await rows().count(), 2);
    let first = rows().first();
    const firstId = await first.getAttribute("data-history-row");
    await first.getByRole("button", { name: /^更多：/ }).click();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .getByRole("menuitem", { name: "删除演绎", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await first
        .getByRole("button", { name: /^更多：/ })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await renameRow(first);
    await first
      .getByLabel("演绎标题", { exact: true })
      .fill("留在标签页的标题草稿");
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "角色广场", exact: true })
      .click();
    await page
      .getByRole("button", { name: "离开并保留草稿", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "历史演绎", exact: true })
      .click();
    await first.getByLabel("演绎标题", { exact: true }).waitFor();
    assert.equal(
      await first.getByLabel("演绎标题", { exact: true }).inputValue(),
      "留在标签页的标题草稿",
    );
    const another = await context.newPage();
    another.setDefaultTimeout(5000);
    await another.goto(url + "#history");
    const sibling = another.locator(`[data-history-row="${firstId}"]`);
    await sibling.getByRole("button", { name: /^更多：/ }).click();
    await sibling
      .getByRole("menuitem", { name: "重命名", exact: true })
      .click();
    await sibling
      .getByLabel("演绎标题", { exact: true })
      .fill("另一个标签页保存的标题");
    await sibling
      .getByRole("button", { name: "保存标题", exact: true })
      .click();
    await another.getByText("演绎标题已更新。", { exact: true }).waitFor();
    await page.bringToFront();
    await page
      .getByText("保存的标题已变化，请核对后继续。", { exact: true })
      .waitFor();
    assert.equal(
      await first.getByLabel("演绎标题", { exact: true }).inputValue(),
      "留在标签页的标题草稿",
    );
    await first
      .getByRole("button", { name: "使用草稿继续编辑", exact: true })
      .click();
    await page.getByLabel("模拟状态").selectOption("unknown");
    await first.getByRole("button", { name: "保存标题", exact: true }).click();
    await page
      .getByText("标题保存结果待确认，请核对重命名结果。", { exact: true })
      .waitFor();
    assert.equal(
      await first
        .getByRole("button", { name: "等待核对", exact: true })
        .isDisabled(),
      true,
    );
    await page.reload();
    await page
      .getByRole("link", { name: "留在标签页的标题草稿", exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("演绎标题", { exact: true }).count(), 0);
    console.log(
      `${platform} rename keyboard, draft conflict and unknown reload: passed`,
    );
    await another.close();

    first = rows().first();
    await first.getByRole("button", { name: /^更多：/ }).click();
    await first
      .getByRole("menuitem", { name: "删除演绎", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("heading", { name: "删除演绎？", exact: true })
      .waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "取消", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await rows().count(), 2);
    if (platform === "mobile")
      await page.getByRole("button", { name: "管理记录", exact: true }).click();
    await page.getByRole("checkbox", { name: /选择已加载记录/ }).check();
    await page.getByLabel("模拟状态").selectOption("partial");
    await page.getByRole("button", { name: "删除所选", exact: true }).click();
    await dialog
      .getByRole("button", { name: "删除所选演绎", exact: true })
      .click();
    await dialog.getByText("已删除", { exact: true }).waitFor();
    await dialog.getByText("删除失败，可重试", { exact: true }).waitFor();
    assert.equal(await dialog.locator("[data-history-result]").count(), 2);
    await page.getByLabel("模拟状态").selectOption("normal");
    await dialog
      .getByRole("button", { name: "重试剩余项", exact: true })
      .click();
    await page.getByText("还没有演绎记录", { exact: true }).waitFor();
    assert.equal(await rows().count(), 0);
    console.log(
      `${platform} delete cancel, fixed targets and partial retry: passed`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
