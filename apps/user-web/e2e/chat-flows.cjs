const { chromium, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_CHAT_EVIDENCE || "/tmp/tavern-user-web-chat-evidence";
const report = {
  base,
  cases: [],
  screenshots: [],
  errors: [],
  generationScope: "本地确定性供应商；验收界面、传输、保存与恢复。",
};
async function check(name, action) {
  await action();
  report.cases.push({ name, status: "passed" });
  console.log("PASS " + name);
}
async function api(context, route, data) {
  const response =
    data === undefined
      ? await context.request.get(base + "/api" + route)
      : await context.request.post(base + "/api" + route, { data });
  assert.equal(response.status(), 200, await response.text());
  return (await response.json()).data;
}
async function capture(page, name) {
  const file = path.join(output, name + ".png");
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}
async function saved(page) {
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeHidden({ timeout: 15000 });
  await expect(page.locator(".status")).toHaveText("已保存", {
    timeout: 15000,
  });
}
async function menu(article, name) {
  await article.getByRole("button", { name: "消息操作", exact: true }).click();
  await article.getByRole("menuitem", { name, exact: true }).click();
}
async function createSession(page, role) {
  await page.goto(base + "/#discover");
  await page
    .getByRole("button", { name: "开始演绎 · " + role, exact: true })
    .click();
  await page.getByRole("button", { name: "开始演绎", exact: true }).click();
  await expect(page.locator(".chat textarea")).toBeVisible();
  await expect(page.locator(".records article").first()).toBeVisible();
  return page.url().split("#chat/")[1].split("?")[0];
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  let stage = "初始化";
  try {
    const email = `chat-flow-${Date.now()}@example.test`,
      password = "Chat-Flow-2026!";
    stage = "准备独立用户与人格";
    await page.goto(base + "/#register");
    await page.getByLabel("昵称", { exact: true }).fill("聊天验收独立账号");
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByLabel("确认密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "登录", exact: true }),
    ).toBeVisible();
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录并继续", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "用户中心", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: /演绎人格 →/ }).click();
    await page
      .getByRole("button", { name: "创建演绎人格", exact: true })
      .click();
    await page.getByLabel("人格姓名", { exact: true }).fill("裴修远");
    const description =
      "裴修远，男性，28岁，雾港调查员。行事谨慎，善于倾听，正在旧城区调查一封来历不明的信。";
    await page.getByLabel("完整人设描述", { exact: true }).fill(description);
    await page.getByRole("button", { name: "保存人格", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "演绎人格", exact: true }),
    ).toBeVisible();
    const customId = await createSession(page, "雾港档案 13");
    report.customSessionId = customId;
    stage = "自定义Runtime资源与组装";
    await check(stage, async () => {
      await expect(page.locator(".story")).toBeVisible();
      assert.ok(
        await page
          .locator(".story img")
          .evaluate((n) => n.complete && n.naturalWidth > 0),
      );
      const dry = await api(context, `/sessions/${customId}/respond/dry-run`, {
        message: "“先看看信封。”",
      });
      await fs.writeFile(
        path.join(output, "initial-dry-run.json"),
        JSON.stringify(dry, null, 2),
      );
      const rendered = JSON.stringify(dry);
      assert.ok(rendered.includes(description));
      assert.ok(rendered.includes("第三人称"));
      assert.ok(rendered.includes("“先看看信封。”"));
    });
    stage = "桌面IME、换行、流式发送与下一条草稿";
    await check(stage, async () => {
      let sends = 0;
      const observe = (r) => {
        if (r.url().endsWith("/respond/stream")) sends++;
      };
      page.on("request", observe);
      const input = page.locator(".chat textarea");
      await input.fill("“先看看信封。”");
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      assert.equal(sends, 0);
      await input.press("Shift+Enter");
      await expect(input).toHaveValue("“先看看信封。”\n");
      await input.press("Enter");
      await input.fill("“我把地图展开。”");
      await saved(page);
      assert.equal(sends, 1);
      await expect(input).toHaveValue("“我把地图展开。”");
      page.off("request", observe);
    });
    stage = "编辑草稿刷新恢复与保存正文";
    await check(stage, async () => {
      const article = page.locator("article.message").last();
      await menu(article, "编辑消息");
      await article
        .locator(".editor textarea")
        .fill("沈知夏把信封放在灯下，指着蓝色邮戳说：“先查旧灯塔。”");
      await page.reload();
      await expect(page.locator(".editor textarea")).toHaveValue(
        "沈知夏把信封放在灯下，指着蓝色邮戳说：“先查旧灯塔。”",
      );
      await page.getByRole("button", { name: "保存消息", exact: true }).click();
      await expect(page.locator(".editor")).toBeHidden();
      await expect(
        page.getByText("沈知夏把信封放在灯下，指着蓝色邮戳说：“先查旧灯塔。”", {
          exact: true,
        }),
      ).toBeVisible();
    });
    stage = "跨页面编辑版本冲突与刷新草稿恢复";
    await check(stage, async () => {
      const draft =
        "沈知夏把信封放在灯下，指着蓝色邮戳说：“先查旧灯塔。”（本次编辑）";
      await menu(page.locator("article.message").last(), "编辑消息");
      await expect(
        page.getByRole("button", { name: "保存消息", exact: true }),
      ).toBeEnabled();
      await page.locator(".editor textarea").fill(draft);
      const second = await context.newPage();
      second.setDefaultTimeout(10000);
      await second.goto(base + "/#chat/" + customId);
      await expect(second.locator("article.message").last()).toBeVisible();
      await menu(second.locator("article.message").last(), "编辑消息");
      await expect(
        second.getByRole("button", { name: "保存消息", exact: true }),
      ).toBeEnabled();
      await second
        .locator(".editor textarea")
        .fill("沈知夏在另一页面保存了地图标记。");
      await second
        .getByRole("button", { name: "保存消息", exact: true })
        .click();
      await expect(second.locator(".editor")).toBeHidden();
      await page.reload();
      await expect(
        page.getByText("这条消息已在其他页面修改。请选择要保留的内容。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".editor textarea")).toHaveValue(draft);
      await expect(
        page.getByRole("button", { name: "保存消息", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "保留本次编辑", exact: true })
        .click();
      await page.getByRole("button", { name: "保存消息", exact: true }).click();
      await expect(page.locator(".editor")).toBeHidden();
      await second.close();
      const messageId = await page
        .locator("article.message")
        .last()
        .getAttribute("data-message-id");
      const timeline = await api(
        context,
        `/messages/${messageId}/manual-revisions`,
      );
      assert.equal(timeline.latest_revision_no, 3);
      assert.equal(timeline.current_content, draft);
    });
    stage = "重新生成与候选切换";
    await check(stage, async () => {
      await menu(page.locator("article.message").last(), "重新生成");
      await expect(
        page.getByText("候选回复 2 / 2", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "上一条候选", exact: true })
        .click();
      await expect(
        page.getByText("候选回复 1 / 2", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator("article.message").last().locator("p.body"),
      ).toContainText("先查旧灯塔");
      const current = (await api(context, `/sessions/${customId}/role-view`))
        .current;
      const floor = await api(
        context,
        "/floors/" + current.floorId + "/reply-candidates",
      );
      assert.equal(floor.active_floor_id, current.floorId);
      report.selectedCandidate = current;
    });
    stage = "续写保存assistant-only楼层";
    await check(stage, async () => {
      await menu(page.locator("article.message").last(), "续写");
      await saved(page);
      const floors = await api(
        context,
        `/sessions/${customId}/role-messages/floors?branch_id=main&limit=100`,
      );
      const messages = await api(
        context,
        `/sessions/${customId}/role-messages?branch_id=main&floor_id=${floors.items[0].floorId}`,
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0].role, "assistant");
      report.continuedFloorId = floors.items[0].floorId;
    });
    let branchId;
    stage = "分支确认取消、创建、继承与继续演绎";
    await check(stage, async () => {
      await menu(page.locator("article.message").last(), "从此处建立分支");
      await expect(
        page.getByRole("button", { name: "取消", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await menu(page.locator("article.message").last(), "从此处建立分支");
      await page
        .getByRole("button", { name: "建立并打开分支", exact: true })
        .click();
      await expect(page.locator(".branches select")).toBeVisible();
      branchId = await page.locator(".branches select").inputValue();
      assert.notEqual(branchId, "main");
      await expect(page.locator("article.message")).toHaveCount(4);
      await page.locator(".chat textarea").fill("“先沿地图去码头。”");
      await page.locator(".chat textarea").press("Enter");
      await saved(page);
      assert.equal(
        (await api(context, `/sessions/${customId}/role-view?branch_id=main`))
          .current.floorId,
        report.continuedFloorId,
      );
      report.branchId = branchId;
    });
    stage = "单条删除的Esc、取消与修订保存";
    await check(stage, async () => {
      const article = page.locator("article.message").last(),
        messageId = await article.getAttribute("data-message-id");
      await menu(article, "删除消息");
      await expect(
        page.getByRole("dialog", { name: "删除这条消息？", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(article).toBeVisible();
      await menu(article, "删除消息");
      await page.getByRole("button", { name: "删除消息", exact: true }).click();
      await expect(
        page.locator(`[data-message-id="${messageId}"]`),
      ).toBeHidden();
      const timeline = await api(
        context,
        `/messages/${messageId}/manual-revisions`,
      );
      assert.equal(timeline.current_hidden, true);
      assert.equal(timeline.items[0].action, "delete");
    });
    stage = "编辑已保存后响应丢失的同操作核对";
    await check(stage, async () => {
      let dropped = false;
      const requests = [];
      await page.route("**/messages/*/manual-revisions", async (route) => {
        if (route.request().method() === "POST") {
          requests.push(route.request().postDataJSON());
          if (!dropped) {
            dropped = true;
            const result = await route.fetch();
            assert.equal(result.status(), 200);
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "temporarily_unavailable",
                  message: "响应暂时不可用，请核对保存结果。",
                },
              }),
            });
            return;
          }
        }
        await route.continue();
      });
      const article = page.locator("article.message").last(),
        messageId = await article.getAttribute("data-message-id");
      await menu(article, "编辑消息");
      await article.locator(".editor textarea").fill("“我先确认码头方位。”");
      await page.getByRole("button", { name: "保存消息", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "核对结果", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "核对结果", exact: true }).click();
      await expect(page.locator(".editor")).toBeHidden();
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[0], requests[1]);
      const timeline = await api(
        context,
        `/messages/${messageId}/manual-revisions`,
      );
      assert.equal(timeline.latest_revision_no, 1);
      report.lostEditOperation = requests[0].operation_id;
      await page.unroute("**/messages/*/manual-revisions");
    });
    stage = "删除后历史参与下一次生成";
    await check(stage, async () => {
      const dry = await api(context, `/sessions/${customId}/respond/dry-run`, {
        branch_id: branchId,
        message: "“我们出发吧。”",
      });
      assert.ok(JSON.stringify(dry).includes("“我先确认码头方位。”"));
      await page.locator(".chat textarea").fill("“我们出发吧。”");
      await page.locator(".chat textarea").press("Enter");
      await saved(page);
    });
    await capture(page, "desktop-custom");
    stage = "手机自定义布局、Enter换行与外接键盘发送";
    await check(stage, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.locator(".chat textarea")).toBeAttached();
      await page
        .locator(".role-session")
        .evaluate((n) => (n.scrollTop = n.scrollHeight));
      const input = page.locator(".chat textarea");
      await input.fill("“灯塔还远吗？”");
      await input.press("Enter");
      await expect(input).toHaveValue("“灯塔还远吗？”\n");
      await input.press("Control+Enter");
      await saved(page);
      await page
        .locator(".role-session")
        .evaluate((n) => (n.scrollTop = n.scrollHeight));
      const box = await page
        .getByRole("button", { name: "发送消息", exact: true })
        .boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 844);
      assert.ok(box.height >= 44);
      assert.equal((await page.locator(".session-header").boundingBox()).y, 0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await capture(page, "mobile-custom");
    });
    const systemId = await createSession(page, "雾港档案 14");
    report.systemSessionId = systemId;
    stage = "手机系统聊天的固定输入和页头";
    await check(stage, async () => {
      const box = await page
        .getByRole("button", { name: "发送消息", exact: true })
        .boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 844);
      assert.equal((await page.locator(".session-header").boundingBox()).y, 0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      );
      await capture(page, "mobile-system");
    });
    stage = "首个响应丢失后刷新核对唯一生成";
    await check(stage, async () => {
      let sent,
        firstResponseDropped = false;
      await page.route("**/respond/stream", async (route) => {
        sent = route.request().postDataJSON();
        const result = await route.fetch();
        assert.equal(result.status(), 200);
        await result.body();
        await route.abort("failed");
        firstResponseDropped = true;
      });
      await page.locator(".chat textarea").fill("“先看看信封。”");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect
        .poll(() => firstResponseDropped, { timeout: 15000 })
        .toBe(true);
      await page.unroute("**/respond/stream");
      await page.reload();
      await saved(page);
      await expect(page.locator(".chat textarea")).toHaveValue("");
      const operation = await api(
        context,
        `/sessions/${systemId}/respond/operations/${sent.client_operation_id}`,
      );
      assert.equal(operation.floorState, "committed");
      const floors = await api(
        context,
        `/sessions/${systemId}/role-messages/floors?branch_id=main&limit=100`,
      );
      assert.equal(floors.items.length, 2);
      assert.equal(floors.items[0].floorId, operation.floorId);
      report.lostStartOperation = operation;
    });
    stage = "停止生成与服务器取消结果";
    await check(stage, async () => {
      let sent;
      const observe = (r) => {
        if (r.url().endsWith("/respond/stream")) sent = r.postDataJSON();
      };
      page.on("request", observe);
      await page.locator(".chat textarea").fill("“封口处有标记吗？”");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(page.locator(".live .body")).toHaveText(/./, {
        timeout: 10000,
      });
      await page.locator(".chat textarea").fill("“我把地图展开。”");
      await page.getByRole("button", { name: "停止生成", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "停止生成", exact: true }),
      ).toBeHidden({ timeout: 10000 });
      await expect(
        page.getByRole("button", { name: "核对结果", exact: true }),
      ).toBeHidden({ timeout: 10000 });
      await expect(page.locator(".chat textarea")).toHaveValue(
        "“我把地图展开。”",
      );
      const operation = await api(
        context,
        `/sessions/${systemId}/respond/operations/${sent.client_operation_id}`,
      );
      assert.equal(operation.floorState, "failed");
      assert.equal(operation.runStatus, "cancelled");
      await expect(page.locator(".stream-entry .body")).not.toBeEmpty();
      await expect(page.locator(".stream-status")).toHaveText(
        "未保存的生成内容",
      );
      report.stoppedOperation = operation;
      page.off("request", observe);
      await capture(page, "mobile-stopped");
    });
    assert.deepEqual(report.errors, []);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failedStage = stage;
    report.failure = String(error.stack || error);
    await capture(page, "failure");
    throw error;
  } finally {
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
    console.log(path.join(output, "report.json"));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
