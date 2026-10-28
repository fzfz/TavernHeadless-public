const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    results = [];
  try {
    for (const platform of ["desktop", "mobile"]) {
      const context = await browser.newContext({
          viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
        }),
        page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on("dialog", (d) => d.accept());
      const errors = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error(e.stack);
      });
      const b = (n) => page.getByRole("button", { name: n, exact: true }),
        scenario = (v) => page.getByLabel("模拟状态").selectOption(v),
        input = () => page.getByRole("textbox", { name: /演绎输入/ });
      const url = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      await page.goto(url + "#history");
      await b("使用演示账号体验").click();
      await page
        .getByRole("link", { name: "继续演绎", exact: true })
        .first()
        .click();
      await input().waitFor();
      const sessionURL = page.url();
      async function shot(name) {
        for (const theme of ["light", "dark"]) {
          if (theme === "dark") await b("深色主题").click();
          await page.screenshot({
            path: path.resolve(
              __dirname,
              `../../phase7-evidence/${platform}-${name}-${theme}.png`,
            ),
            fullPage: true,
          });
        }
        await page.locator("#review-theme").click();
      }
      await shot("session");
      assert.equal(await page.locator("#app .uw-sidebar").count(), 0);
      assert.equal(await page.locator("[data-owner=card]").count(), 1);
      assert.equal(await page.locator("[data-owner=system-chat]").count(), 1);
      await input().fill("未发送的动作与台词");
      await page.reload();
      await input().waitFor();
      assert.equal(await input().inputValue(), "未发送的动作与台词");
      await page.getByText("已恢复未发送内容", { exact: true }).waitFor();
      await b("演绎设置").click();
      await page.getByLabel("演绎标题", { exact: true }).fill("雨夜的新线索");
      await b("查看完整人设").last().click();
      await page.locator("[data-page-id=P20]").waitFor();
      assert((await page.getByRole("dialog").innerText()).includes("裴修远"));
      await shot("snapshot");
      await b("关闭").click();
      assert.equal(
        await page.getByLabel("演绎标题", { exact: true }).inputValue(),
        "雨夜的新线索",
      );
      await shot("session-settings");
      await b("保存标题").click();
      await page
        .getByRole("heading", { name: "雨夜的新线索", exact: true })
        .waitFor();
      assert.equal(await input().inputValue(), "未发送的动作与台词");
      await input().fill("“请看看信封上的署名。”");
      await input().dispatchEvent?.("keydown", {
        key: "Enter",
        isComposing: true,
      }); // real key behavior is tested below
      if (platform === "mobile") {
        await input().press("Enter");
        assert((await input().inputValue()).includes("\n"));
        await input().press("Control+Enter");
      } else {
        await input().press("Shift+Enter");
        assert((await input().inputValue()).includes("\n"));
        await input().press("Enter");
      }
      await b("停止生成").waitFor();
      await input().fill("下一条尚未发送");
      await b("停止生成").click();
      await page.getByText("已保存", { exact: true }).first().waitFor();
      assert.equal(await input().inputValue(), "下一条尚未发送");
      await input().fill("");
      const last = () => page.locator(".message").last();
      await last()
        .getByRole("button", { name: "消息操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "重新生成", exact: true })
        .click();
      await b("停止生成").waitFor();
      await b("停止生成").click();
      await b("上一条回复").last().click();
      await page.getByText("1 / 2", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("1 / 2", { exact: true }).waitFor();
      await b("下一条回复").last().click();
      await page.getByText("2 / 2", { exact: true }).waitFor();
      const count = await page.locator(".message").count();
      await page
        .locator(".message")
        .nth(1)
        .getByRole("button", { name: "消息操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "删除消息", exact: true })
        .click();
      await page.locator("[data-page-id=P21]").waitFor();
      await shot("message-delete");
      await b("删除消息").click();
      assert.equal(await page.locator(".message").count(), count - 1);
      await page.reload();
      await input().waitFor();
      assert.equal(await page.locator(".message").count(), count - 1);
      await scenario("unknown");
      await input().fill("“我会在这里等。”");
      await b("发送").click();
      await b("停止生成").waitFor();
      await b("停止生成").click();
      await b("核对演绎结果").waitFor();
      await page.reload();
      await input().waitFor();
      await input().fill("等待核对后的下一条");
      assert(await b("发送").isDisabled());
      await scenario("check-failure");
      await b("核对演绎结果").click();
      await b("核对演绎结果").waitFor();
      await scenario("normal");
      await b("核对演绎结果").click();
      assert(await b("发送").isEnabled());
      await input().fill("");
      await scenario("runtime-failure");
      await page
        .getByRole("heading", { name: "角色页面加载失败", exact: true })
        .waitFor();
      assert.equal(await input().count(), 0);
      await b("重新加载角色页面").click();
      await input().waitFor();
      await scenario("failure");
      await b("重新读取演绎").click();
      await input().waitFor();
      await scenario("offline");
      await input().fill("离线保留的输入");
      assert(await b("发送").isDisabled());
      await scenario("normal");
      await input().waitFor();
      assert.equal(await input().inputValue(), "离线保留的输入");
      await page.getByRole("link", { name: "返回历史", exact: true }).click();
      await b("离开并保留草稿").click();
      await page.locator("[data-history-row]").first().waitFor();
      await page.goto(sessionURL);
      await input().waitFor();
      assert.equal(await input().inputValue(), "离线保留的输入");
      await input().fill("");
      await page.goto(url + "#chat/missing-session");
      await page.locator("[data-page-id=P22]").waitFor();
      await shot("unavailable");
      await page
        .getByRole("link", { name: "返回历史演绎", exact: true })
        .click();
      await page.locator("[data-history-row]").first().waitFor();
      await page.goto(url + "#unknown-route");
      await page.getByText("没有找到这个页面。", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      results.push({
        platform,
        result: "passed",
        coverage: [
          "Runtime与宿主边界",
          "设置与人设往返",
          "消息输入及停止",
          "候选保存",
          "单条删除",
          "未知结果刷新恢复",
          "失败与离线",
          "草稿离开恢复",
          "P22导航",
        ],
      });
      await context.close();
    }
    await fs.writeFile(
      path.resolve(__dirname, "../../phase7-evidence/batch5-acceptance.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
