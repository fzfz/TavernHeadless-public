const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function navigate(name) {
    const exit = page.getByRole("button", { name: "返回历史", exact: true });
    if (await exit.count()) await exit.click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  try {
    await page.goto("http://127.0.0.1:4178");
    await page
      .getByRole("heading", { name: "故事，由你续写。" })
      .waitFor({ timeout: 3000 });
    assert.equal(
      await page.getByRole("button", { name: "我的收藏" }).count(),
      0,
    );
    assert.equal(await page.getByLabel("角色排序").count(), 0);
    assert.equal(await page.getByText(/本期故事/).count(), 0);
    await page.getByRole("button", { name: "古风", exact: true }).click();
    assert.equal(await page.locator(".card").count(), 2);
    await page.getByPlaceholder("搜索角色、故事或标签").fill("没有这个角色");
    await page
      .getByRole("heading", { name: "没有符合筛选条件的角色" })
      .waitFor();
    await page.getByRole("button", { name: "重置筛选" }).click();
    await page.getByRole("button", { name: "查看沈知微" }).click();
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.getByRole("button", { name: "使用演示账号体验" }).click();
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page
      .getByPlaceholder("写下你的动作或台词……")
      .fill("“我叫裴修远，想打听这封信的来处。”");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "停止生成" }).waitFor();
    await page
      .getByRole("button", { name: "停止生成" })
      .waitFor({ state: "hidden" });
    assert.equal(await page.locator(".message").count(), 3);
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await page
      .getByRole("button", { name: "停止生成" })
      .waitFor({ state: "hidden" });
    await page.getByText("2 / 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "上一条回复" }).click();
    await page.getByText("1 / 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "续写", exact: true }).click();
    await page
      .getByRole("button", { name: "停止生成" })
      .waitFor({ state: "hidden" });
    await page.getByText(/白鹭渡。/).waitFor();
    await page.reload();
    await page.getByText("1 / 2", { exact: true }).waitFor();
    await page.screenshot({
      path: "/tmp/tavern-prototype-chat.png",
      fullPage: true,
    });
    await navigate("历史演绎");
    await page
      .locator(".history-row")
      .first()
      .getByRole("button", { name: "删除演绎" })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    const count = await page.locator(".history-row").count();
    await page
      .locator(".history-row")
      .first()
      .getByRole("button", { name: "删除演绎" })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    assert.equal(await page.locator(".history-row").count(), count - 1);
    await navigate("角色广场");
    await page.screenshot({
      path: "/tmp/tavern-prototype-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/tavern-prototype-mobile.png",
      fullPage: false,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "用户中心", exact: true }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("测试旅人");
    await page.getByLabel("邮箱", { exact: true }).fill("test@example.com");
    await page.getByLabel("演示密码", { exact: true }).fill("testpass123");
    await page.getByLabel("确认演示密码", { exact: true }).fill("different123");
    await page.getByRole("button", { name: "创建账号并继续" }).click();
    await page
      .getByText("两次输入的密码不一致，请重新输入确认密码。")
      .waitFor();
    await page.getByLabel("确认演示密码", { exact: true }).fill("testpass123");
    await page.getByRole("button", { name: "创建账号并继续" }).click();
    await navigate("演绎人格");
    assert.equal(await page.locator(".persona-item").count(), 0);
    await page.getByRole("button", { name: "创建人格", exact: true }).click();
    const modal = page.locator("dialog");
    await modal.getByLabel("故事中的姓名").fill("许清");
    await modal
      .getByLabel("完整人设描述")
      .fill("许清，女，28岁，旅居临安的画师，观察细致，正在寻找一间画室。");
    await modal.getByRole("button", { name: "创建人格", exact: true }).click();
    await navigate("角色广场");
    await page.getByRole("button", { name: "查看沈知微" }).click();
    await modal.getByLabel("选择演绎人格").selectOption({ label: "许清" });
    await modal.getByLabel("选择故事开场").selectOption("1");
    await modal.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.getByText("正在扮演 · 许清").waitFor();
    const boundRoute = page.url();
    await navigate("演绎人格");
    await page.getByLabel("故事中的姓名").fill("许清雨");
    await page.getByRole("button", { name: "保存人格", exact: true }).click();
    await page.goto(boundRoute);
    await page.getByText("正在扮演 · 许清", { exact: true }).waitFor();
    await page
      .getByPlaceholder("写下你的动作或台词……")
      .fill("“可以让我看看吗？”");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "停止生成" }).click();
    await page
      .getByRole("button", { name: "停止生成" })
      .waitFor({ state: "hidden" });
    await page
      .locator(".message")
      .first()
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await modal.getByLabel("消息正文").fill("沈知微把那封旧信放在桌上。");
    await modal.getByRole("button", { name: "保存消息" }).click();
    await page
      .getByText("沈知微把那封旧信放在桌上。", { exact: true })
      .waitFor();
    await page
      .locator(".message")
      .first()
      .getByRole("button", { name: "从这里分支" })
      .click();
    await page.locator('#role-runtime-host[data-ready="true"]').waitFor();
    assert.equal(await page.locator(".message").count(), 1);
    await page
      .getByRole("heading", { name: "与沈知微的故事 · 分支" })
      .waitFor();
    await navigate("历史演绎");
    await page.getByLabel("选择当前结果").check();
    await page.getByRole("button", { name: "删除所选" }).click();
    await modal.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.getByRole("heading", { name: "第一段故事，等你开始" }).waitFor();
    await navigate("演绎人格");
    await page.getByRole("button", { name: "创建人格", exact: true }).click();
    await modal.getByLabel("故事中的姓名").fill("江宁");
    await modal
      .getByLabel("完整人设描述")
      .fill("江宁，女，30岁，住在山中的药师，性格沉静。");
    await modal.getByRole("button", { name: "创建人格", exact: true }).click();
    assert.equal(await page.locator(".persona-item").count(), 2);
    await page.getByLabel("用于新演绎的默认人格").check();
    await page.getByRole("button", { name: "保存人格", exact: true }).click();
    await navigate("用户中心");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.goto("http://127.0.0.1:4178/#personas");
    assert.equal(await page.locator(".persona-item").count(), 0);
    await page.getByRole("button", { name: "使用演示账号体验" }).click();
    await navigate("演绎人格");
    assert.equal(await page.locator(".persona-item").count(), 2);
    assert.equal(
      await page.locator(".persona-item").filter({ hasText: "江宁" }).count(),
      0,
    );
    await navigate("用户中心");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("邮箱", { exact: true }).fill("test@example.com");
    await page.getByLabel("演示密码", { exact: true }).fill("testpass123");
    await page.getByRole("button", { name: "登录并继续", exact: true }).click();
    await navigate("演绎人格");
    await page.reload();
    assert.equal(await page.locator(".persona-item").count(), 2);
    await page
      .locator(".persona-item.selected")
      .getByRole("heading", { name: /江宁/ })
      .waitFor();
    assert.equal(
      await page.getByLabel("用于新演绎的默认人格").isChecked(),
      true,
    );
    await navigate("角色广场");
    await page.getByRole("button", { name: "查看沈知微" }).click();
    assert.equal(
      await modal
        .locator('select[name="persona"] option:checked')
        .textContent(),
      "江宁",
    );
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.getByText("正在扮演 · 江宁", { exact: true }).waitFor();
    await navigate("演绎人格");
    await page.getByRole("button", { name: "删除人格", exact: true }).click();
    await modal
      .getByRole("button", { name: "确认删除人格", exact: true })
      .click();
    assert.equal(await page.locator(".persona-item").count(), 1);
    assert.equal(
      await page.getByLabel("用于新演绎的默认人格").isChecked(),
      true,
    );
    await page.getByRole("button", { name: "删除人格", exact: true }).click();
    await modal
      .getByRole("button", { name: "确认删除人格", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "创建你的第一个演绎人格" })
      .waitFor();
    assert.equal(await page.locator(".persona-item").count(), 0);
    await page.reload();
    await page
      .getByRole("heading", { name: "创建你的第一个演绎人格" })
      .waitFor();
    await navigate("角色广场");
    await page.getByRole("button", { name: "查看沈知微" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "开始演绎", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await navigate("用户中心");
    assert.equal(await page.getByLabel("邮箱", { exact: true }).count(), 0);
    assert.equal(await page.getByText("收藏角色", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 筛选、登录与注册、多个人格、账号隔离、默认人格、人格快照、发送、停止、重生成、续写、编辑、分支、刷新恢复、删除、390px 布局。",
    );
  } catch (error) {
    await page.screenshot({
      path: "/tmp/tavern-prototype-failure.png",
      fullPage: true,
    });
    console.error("PAGE ERRORS", errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
