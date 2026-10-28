const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "mobile";
const slices = process.env.SLICE
  ? [process.env.SLICE]
  : [
      "unknown",
      "unknown-missing",
      "open-failure",
      "partial",
      "preview",
      "empty",
      "source",
      "keyboard",
      "offline",
      "invalid",
      "pagination",
      "repeat",
      "role",
      "write",
      "default",
      "no-openings",
      "check-failure",
      "missing",
      "duplicate",
    ];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const slice of slices) {
      const context = await browser.newContext({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(
        `http://127.0.0.1:4180/phase7-prototype-${platform}.html#start/c1`,
      );
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.getByRole("radio", { name: "裴修远", exact: true }).waitFor();
      const create = () =>
        page.getByRole("button", { name: "开始演绎", exact: true });
      await create().waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !document.querySelector('[data-start="create"]')?.disabled,
      );
      if (
        [
          "unknown",
          "unknown-missing",
          "open-failure",
          "check-failure",
        ].includes(slice)
      ) {
        await page.locator("#review-scenario").selectOption(slice);
        await create().click();
        if (slice === "open-failure") {
          await page
            .getByText("演绎已创建，会话读取失败，请重新打开。", {
              exact: true,
            })
            .waitFor();
          await page.reload();
          await page
            .getByRole("button", { name: "重新打开演绎", exact: true })
            .click();
          await page.waitForURL(/#chat\//);
        } else {
          await page
            .getByText("创建结果尚未确认，请先核对", { exact: true })
            .waitFor();
          assert(await create().isDisabled());
          if (slice === "check-failure") {
            await page
              .getByRole("button", { name: "核对创建结果", exact: true })
              .click();
            await page
              .getByText("创建结果读取失败，请检查连接后重试。", {
                exact: true,
              })
              .waitFor();
            assert(await create().isDisabled());
          }
          await page.reload();
          assert(await create().isDisabled());
          await page
            .getByRole("button", { name: "核对创建结果", exact: true })
            .click();
          if (slice === "unknown" || slice === "check-failure") {
            await page.waitForURL(/#chat\//);
            const createdUrl = page.url();
            await page.goBack();
            await page
              .getByRole("button", { name: "重新打开演绎", exact: true })
              .click();
            await page.waitForURL(createdUrl);
          } else {
            await page
              .getByText("已确认本次演绎尚未创建，可以重新开始。", {
                exact: true,
              })
              .waitFor();
            assert(await create().isEnabled());
          }
        }
      }
      if (slice === "duplicate") {
        await page.locator("#review-scenario").selectOption("slow");
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
        await create().click({ clickCount: 2 });
        assert(
          await page
            .getByRole("radio", { name: "裴修远", exact: true })
            .isDisabled(),
        );
        await page.waitForURL(/#chat\//);
        await page.getByRole("link", { name: "返回历史", exact: true }).click();
        await page.getByText(/共 3 条/).waitFor();
        assert.equal(await page.locator("[data-history-row]").count(), 3);
      }
      if (slice === "repeat") {
        await create().click();
        await page.waitForURL(/#chat\//);
        const firstUrl = page.url();
        await page.goto(
          `http://127.0.0.1:4180/phase7-prototype-${platform}.html#detail/c1`,
        );
        await page.getByRole("link", { name: "开始演绎", exact: true }).click();
        await create().waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
        await create().click();
        await page.waitForURL(/#chat\//);
        assert.notEqual(page.url(), firstUrl);
      }
      if (slice === "role") {
        await page.locator("#review-scenario").selectOption("role-failure");
        await page.getByText("角色与开场读取失败。", { exact: true }).waitFor();
        assert(
          await page
            .getByRole("radio", { name: "裴修远", exact: true })
            .isChecked(),
        );
        assert(await create().isDisabled());
        await page
          .getByRole("group", { name: "角色开场", exact: true })
          .getByRole("button", { name: "重新读取", exact: true })
          .click();
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
      }
      if (slice === "write") {
        await page.locator("#review-scenario").selectOption("write-failure");
        await create().click();
        await page
          .getByText("演绎创建失败，本次选择已保留，请重试。", { exact: true })
          .waitFor();
        assert(await create().isEnabled());
        assert(
          await page
            .getByRole("radio", { name: "裴修远", exact: true })
            .isChecked(),
        );
      }
      if (slice === "default") {
        await page.locator("#review-scenario").selectOption("invalid-default");
        assert(await create().isDisabled());
        assert.equal(
          await page
            .getByRole("radio")
            .evaluateAll((els) => els.filter((el) => el.checked).length),
          0,
        );
        await page.getByRole("radio", { name: "陆遥", exact: true }).check();
        await page.getByRole("radio", { name: "开场 2", exact: true }).check();
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
      }
      if (slice === "no-openings") {
        await page.locator("#review-scenario").selectOption("no-openings");
        await page
          .getByText("这个角色暂时没有可用开场，请重新读取或返回角色。", {
            exact: true,
          })
          .waitFor();
        assert(await create().isDisabled());
        assert.equal(
          await page
            .getByRole("group", { name: "角色开场", exact: true })
            .getByRole("radio")
            .count(),
          0,
        );
      }
      if (slice === "missing") {
        await page.locator("#review-scenario").selectOption("missing");
        await page.locator('[data-page-id="P22"]').waitFor();
        await page
          .getByRole("link", { name: "返回角色广场", exact: true })
          .click();
        await page.waitForURL(/#discover$/);
      }
      if (slice === "partial") {
        await page.getByRole("radio", { name: "开场 2", exact: true }).check();
        await page.locator("#review-scenario").selectOption("persona-failure");
        await page
          .getByText("演绎人格读取失败，已读取的内容仍可查看。", {
            exact: true,
          })
          .waitFor();
        assert(
          await page
            .getByRole("radio", { name: "开场 2", exact: true })
            .isChecked(),
        );
        assert(await create().isDisabled());
        await page
          .getByRole("group", { name: "演绎人格", exact: true })
          .getByRole("button", { name: "重新读取", exact: true })
          .click();
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
        assert(
          await page
            .getByRole("radio", { name: "开场 2", exact: true })
            .isChecked(),
        );
      }
      if (slice === "preview") {
        await page.locator("#review-scenario").selectOption("preview-failure");
        await page.getByText("开场正文读取失败。", { exact: true }).waitFor();
        assert(await create().isDisabled());
        await page
          .getByRole("region", { name: "所选开场预览", exact: true })
          .getByRole("button", { name: "重新读取", exact: true })
          .click();
        await page
          .getByRole("button", { name: "展开开场全文", exact: true })
          .waitFor();
        assert(await create().isEnabled());
      }
      if (slice === "empty") {
        await page.locator("#review-scenario").selectOption("empty-personas");
        await page.getByText("先创建一个演绎人格", { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole("group", { name: "演绎人格", exact: true })
            .getByRole("radio")
            .count(),
          0,
        );
        assert(
          await page
            .getByRole("radio", { name: "开场 1", exact: true })
            .isChecked(),
        );
        assert(await create().isDisabled());
      }
      if (slice === "source") {
        await page.goto(
          `http://127.0.0.1:4180/phase7-prototype-${platform}.html#detail/c1`,
        );
        await page.getByRole("link", { name: "开始演绎", exact: true }).click();
        await page.getByRole("radio", { name: "开场 2", exact: true }).check();
        await page.getByRole("link", { name: "创建人格", exact: true }).click();
        await page.getByLabel("人格姓名", { exact: true }).fill("林照影");
        await page
          .getByLabel("完整人设描述", { exact: true })
          .fill("林照影，二十八岁，安静细致的修书人，正在寻找旧友。");
        await page
          .getByRole("button", { name: "保存人格", exact: true })
          .click();
        await page
          .getByRole("radio", { name: "林照影", exact: true })
          .waitFor();
        assert(
          await page
            .getByRole("radio", { name: "林照影", exact: true })
            .isChecked(),
        );
        assert(
          await page
            .getByRole("radio", { name: "开场 2", exact: true })
            .isChecked(),
        );
        await page
          .getByRole("link", { name: "返回角色详情", exact: true })
          .click();
        await page.waitForURL(/#detail\/c1$/);
      }
      if (slice === "pagination") {
        for (let index = 3; index <= 8; index++) {
          await page.goto(
            `http://127.0.0.1:4180/phase7-prototype-${platform}.html#personas/new`,
          );
          await page
            .getByLabel("人格姓名", { exact: true })
            .fill(`旅人${index}`);
          await page
            .getByLabel("完整人设描述", { exact: true })
            .fill(`旅人${index}，二十八岁，性格沉稳的旅行者。`);
          await page
            .getByRole("button", { name: "保存人格", exact: true })
            .click();
          await page.waitForURL(/#personas$/);
        }
        const last = page
          .locator("[data-persona-card]")
          .filter({
            has: page.getByRole("heading", { name: "旅人8", exact: true }),
          });
        await last.getByRole("button", { name: /设为默认/ }).click();
        await page.getByText("默认人格已更新。", { exact: true }).waitFor();
        await page.goto(
          `http://127.0.0.1:4180/phase7-prototype-${platform}.html#start/c2`,
        );
        await page.getByRole("radio", { name: "旅人8", exact: true }).waitFor();
        assert(
          await page
            .getByRole("radio", { name: "旅人8", exact: true })
            .isChecked(),
        );
        await page.getByText("已加载 7 / 8 个人格", { exact: true }).waitFor();
        await page.locator("#review-scenario").selectOption("append-failure");
        await page
          .getByRole("button", { name: "加载更多人格", exact: true })
          .click();
        await page
          .getByText("更多人格读取失败，当前选择已保留。", { exact: true })
          .waitFor();
        assert(
          await page
            .getByRole("radio", { name: "旅人8", exact: true })
            .isChecked(),
        );
        await page
          .getByRole("group", { name: "演绎人格", exact: true })
          .getByRole("button", { name: "重新读取", exact: true })
          .click();
        await page.getByText("已加载 8 / 8 个人格", { exact: true }).waitFor();
        assert(
          await page
            .getByRole("radio", { name: "旅人8", exact: true })
            .isChecked(),
        );
      }
      if (slice === "keyboard") {
        const first = page.getByRole("radio", { name: "裴修远", exact: true });
        await first.focus();
        await page.keyboard.press("ArrowDown");
        const second = page.getByRole("radio", { name: "陆遥", exact: true });
        assert(await second.isChecked());
        assert(await second.evaluate((el) => el === document.activeElement));
      }
      if (slice === "offline") {
        await context.setOffline(true);
        await page.getByText("连接恢复后再开始演绎", { exact: true }).waitFor();
        assert(await create().isDisabled());
        assert(
          await page
            .getByRole("radio", { name: "裴修远", exact: true })
            .isChecked(),
        );
        await context.setOffline(false);
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
      }
      if (slice === "invalid") {
        await page.locator("#review-scenario").selectOption("invalid-persona");
        await page
          .getByText("裴修远已失效或资料已变化，请重新选择本次人格。", {
            exact: true,
          })
          .waitFor();
        assert(await create().isDisabled());
        await page.getByRole("radio", { name: "陆遥", exact: true }).check();
        await page.locator("#review-scenario").selectOption("invalid-opening");
        await page
          .getByText("所选开场已变化，请重新选择本次开场。", { exact: true })
          .waitFor();
        assert(await create().isDisabled());
        assert(
          await page
            .getByRole("radio", { name: "陆遥", exact: true })
            .isChecked(),
        );
        await page.getByRole("radio", { name: "开场 2", exact: true }).check();
        await page.waitForFunction(
          () => !document.querySelector('[data-start="create"]')?.disabled,
        );
      }
      console.log(`${platform} start ${slice}: passed`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
