const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const evidence = path.resolve(__dirname, "../../phase7-evidence");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" }),
    results = [];
  try {
    for (const platform of ["mobile", "desktop"]) {
      const context = await browser.newContext({
          viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
        }),
        page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("dialog", (d) => d.accept());
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const url = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      const button = (n) => page.getByRole("button", { name: n, exact: true }),
        input = (n) => page.getByLabel(n, { exact: true });
      const go = async (route) => {
        await page.evaluate((r) => (location.hash = r), route);
        await page.waitForURL(`**#${route}`);
      };
      const scenario = (v) => page.locator("#review-scenario").selectOption(v);
      const ready = () => page.locator("[data-persona-card]").first().waitFor();
      const shot = async (name) => {
        for (const theme of ["light", "dark"]) {
          if (theme === "dark") {
            await page.locator("#review-theme").click();
            await page.waitForTimeout(180);
          }
          await page.screenshot({
            path: path.join(evidence, `${platform}-${name}-${theme}.png`),
            fullPage: true,
          });
        }
        await page.locator("#review-theme").click();
      };
      await page.goto(url + "#personas");
      await button("使用演示账号体验").click();
      await ready();
      const cards = page.locator("[data-persona-card]"),
        firstName = await cards.first().getByRole("heading").innerText(),
        firstId = await cards.first().getAttribute("data-persona-card");
      const secondName = await cards.nth(1).getByRole("heading").innerText();
      await shot("personas");
      await scenario("failure");
      await button("重试读取").waitFor();
      await button("重试读取").click();
      await ready();
      await scenario("default-failure");
      await button("重新读取默认人格").click();
      await ready();
      await scenario("write-failure");
      await cards
        .nth(1)
        .getByRole("button", { name: /设为默认/ })
        .click();
      await page
        .getByText("默认人格保存失败，请重试。", { exact: true })
        .waitFor();
      await cards.first().getByText("默认人格", { exact: true }).waitFor();
      await scenario("unknown");
      await cards
        .nth(1)
        .getByRole("button", { name: /设为默认/ })
        .click();
      await button("核对默认选择").waitFor();
      await page.reload();
      await button("核对默认选择").waitFor();
      await scenario("check-failure");
      await button("核对默认选择").click();
      await page
        .getByText("操作结果读取失败，请检查连接后重试。", { exact: true })
        .waitFor();
      await scenario("normal");
      await button("核对默认选择").click();
      await page.getByText("默认人格已更新。", { exact: true }).waitFor();
      await cards.nth(1).getByText("默认人格", { exact: true }).waitFor();
      results.push({
        platform,
        check: "人格读取与默认读取局部失败、默认保存失败、刷新后核对默认选择",
        result: "pass",
      });
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      await page.locator('[data-page-id="P11"]').waitFor();
      await button("保存人格").click();
      await page.getByText("请填写人格姓名。", { exact: true }).waitFor();
      await input("人格姓名").fill("沈砚青");
      await button("保存人格").click();
      await page.getByText("请填写完整人设描述。", { exact: true }).waitFor();
      const description =
        "沈砚青，三十二岁，游学归来的书生。\n性格沉稳，习惯先听后说。";
      await input("完整人设描述").fill(description);
      await input("完整人设描述").press("Enter");
      assert.equal(
        await input("完整人设描述").inputValue(),
        description + "\n",
      );
      await input("完整人设描述").dispatchEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
      });
      assert(new URL(page.url()).hash.includes("personas/new"));
      await button("保存人格").focus();
      await page.getByRole("link", { name: "取消", exact: true }).click();
      await page.getByRole("dialog", { name: "离开人格编辑？" }).waitFor();
      await button("保留草稿并离开").click();
      await ready();
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      assert.equal(await input("人格姓名").inputValue(), "沈砚青");
      await page.reload();
      await page
        .getByText("已恢复当前账号的人格草稿。", { exact: true })
        .waitFor();
      assert.equal(
        await input("完整人设描述").inputValue(),
        description + "\n",
      );
      await shot("persona-create");
      await scenario("write-failure");
      await button("保存人格").click();
      await page
        .getByText("人格保存失败，输入已保留，请重试。", { exact: true })
        .waitFor();
      await scenario("offline");
      await button("保存人格").click();
      await page
        .getByText("当前离线，请连接网络后再保存人格。", { exact: true })
        .waitFor();
      await scenario("unknown");
      await button("保存人格").click();
      await button("核对保存结果").waitFor();
      assert(await button("保存人格").isDisabled());
      await page.reload();
      await button("核对保存结果").waitFor();
      await scenario("normal");
      await button("核对保存结果").click();
      await page
        .getByRole("heading", { name: "沈砚青", exact: true })
        .waitFor();
      assert.equal(await cards.count(), 3);
      const newCard = page.locator("[data-persona-card]").filter({
        has: page.getByRole("heading", { name: "沈砚青", exact: true }),
      });
      const newId = await newCard.getAttribute("data-persona-card");
      await newCard.getByRole("link", { name: /查看与编辑/ }).click();
      await page.locator('[data-page-id="P12"]').waitFor();
      assert.equal(await input("完整人设描述").inputValue(), description);
      assert(await button("保存修改").isDisabled());
      await input("人格姓名").fill("本地草稿");
      await shot("persona-edit");
      const other = await context.newPage();
      other.on("dialog", (d) => d.accept());
      await other.goto(url + `#personas/edit/${newId}`);
      await other
        .getByLabel("人格姓名", { exact: true })
        .fill("另一标签页保存的姓名");
      await other
        .getByRole("button", { name: "保存修改", exact: true })
        .click();
      await other.waitForURL("**#personas");
      await page.getByRole("region", { name: "人格资料已变化" }).waitFor();
      await page
        .getByRole("heading", { name: "当前已保存资料", exact: true })
        .waitFor();
      assert(await button("保存修改").isDisabled());
      await button("继续编辑草稿").click();
      assert.equal(await input("人格姓名").inputValue(), "本地草稿");
      await input("完整人设描述").press("Control+Enter");
      await page
        .getByRole("heading", { name: "本地草稿", exact: true })
        .waitFor();
      await other.close();
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      await input("人格姓名").fill("要放弃的草稿");
      await page.getByRole("link", { name: "取消", exact: true }).click();
      await button("放弃草稿并离开").click();
      await ready();
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      assert.equal(await input("人格姓名").inputValue(), "");
      await page.getByRole("link", { name: "取消", exact: true }).click();
      await ready();
      results.push({
        platform,
        check:
          "创建校验、输入法、草稿保留与放弃、刷新恢复、唯一创建核对、完整描述、跨标签页冲突与快捷键保存",
        result: "pass",
      });
      // Keep the original session snapshot while the source persona changes.
      await go(`personas/edit/${firstId}`);
      await input("人格姓名").fill("新的源人格姓名");
      await button("保存修改").click();
      await ready();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link", { name: "历史演绎", exact: true })
        .click();
      await page
        .locator("[data-history-row]")
        .filter({ hasText: firstName })
        .getByRole("link", { name: "继续演绎", exact: true })
        .click();
      await button("查看完整人设").click();
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: firstName, exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await go("personas");
      await ready();
      await scenario("unknown");
      await page
        .locator(`[data-persona-card="${firstId}"]`)
        .getByRole("button", { name: /删除/ })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "删除人格", exact: true })
        .click();
      await button("核对删除结果").waitFor();
      await scenario("normal");
      await button("核对删除结果").click();
      await page.getByText("人格已删除。", { exact: true }).waitFor();
      assert.equal(
        await page.locator(`[data-persona-card="${firstId}"]`).count(),
        0,
      );
      while (await cards.count()) {
        await cards.first().getByRole("button", { name: /删除/ }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "删除人格", exact: true })
          .click();
        await page.getByText("人格已删除。", { exact: true }).waitFor();
      }
      await page
        .getByRole("heading", { name: "创建你的第一个演绎人格", exact: true })
        .waitFor();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link", { name: "角色广场", exact: true })
        .click();
      await page.locator('#browse-results[aria-busy="false"]').waitFor();
      await page
        .getByRole("link", { name: /开始与/ })
        .first()
        .click();
      await page.locator(`[data-page-id="${platform === "mobile" ? "P14" : "P13"}"]`).waitFor();
      await page.getByRole("radio", { name: "开场 2", exact: true }).check();
      await page.getByRole("link", { name: "创建人格", exact: true }).click();
      await input("人格姓名").fill("顾行舟");
      await input("完整人设描述").fill(
        "顾行舟，二十七岁，行走各地的商人，善于观察。",
      );
      await button("保存人格").click();
      await page.getByRole("radio", { name: "顾行舟", exact: true }).waitFor();
      assert(await page.getByRole("radio", { name: "开场 2", exact: true }).isChecked());
      assert(await page.getByRole("radio", { name: "顾行舟", exact: true }).isChecked());
      await go(`personas/edit/${firstId}`);
      await page
        .getByRole("heading", { name: "无法访问这个人格", exact: true })
        .waitFor();
      results.push({
        platform,
        check:
          "会话人格快照、删除结果核对、删除默认与最后一个人格、开始任务来源和开场保留、资源失效",
        result: "pass",
      });
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(evidence, "batch3-acceptance.json"),
      JSON.stringify(results, null, 2),
    );
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
