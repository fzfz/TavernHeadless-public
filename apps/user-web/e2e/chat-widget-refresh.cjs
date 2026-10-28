const { mountChatFixture } = require("./chat-widget-fixture.cjs");
const { chromium, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_CHAT_REFRESH_EVIDENCE ||
  "/tmp/tavern-user-web-chat-refresh";

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  page.setDefaultTimeout(5000);
  const report = {
    scope:
      "真实 Chrome 生产 widget，受控传输验证上下文、请求所有权及会话恢复。",
    cases: [],
    errors: [],
  };
  page.on("pageerror", (error) => report.errors.push(error.message));
  await fs.mkdir(output, { recursive: true });
  const mount = (config) => mountChatFixture(page, config);
  async function check(name, fn) {
    try {
      await fn();
      report.cases.push({ name, status: "passed" });
    } catch (error) {
      report.cases.push({
        name,
        status: "failed",
        error: String(error.stack || error),
      });
    }
  }
  try {
    await page.goto(base + "/#discover");
    await check(
      "新增楼层后，已打开及保留的消息菜单更新权限且保持焦点",
      async () => {
        await mount();
        const old = page.locator('[data-message-id="m-6"]');
        await old
          .getByRole("button", { name: "消息操作", exact: true })
          .click();
        await expect(
          old.getByRole("menuitem", { name: "重新生成", exact: true }),
        ).toBeEnabled();
        await old
          .getByRole("menuitem", { name: "编辑消息", exact: true })
          .focus();
        await page.evaluate(async () => {
          const f = window.fixture;
          f.active = "7";
          f.rows.set("7", { floorId: "7", floorNo: 7, state: "committed" });
          await f.mounted.refresh();
        });
        await expect(
          old.getByRole("menuitem", { name: "重新生成", exact: true }),
        ).toBeDisabled();
        await expect(
          old.getByRole("button", { name: "下一条候选", exact: true }),
        ).toBeDisabled();
        await expect(
          old.getByRole("menuitem", { name: "编辑消息", exact: true }),
        ).toBeFocused();
      },
    );
    await check("过期刷新失败不覆盖已成功的新请求", async () => {
      await mount();
      await page.evaluate(async () => {
        const f = window.fixture;
        let reject;
        f.responses.push(new Promise((_resolve, r) => (reject = r)));
        const old = f.mounted.refresh();
        await f.mounted.refresh();
        reject(new Error("STALE REFRESH ERROR"));
        await old;
      });
      await expect(page.locator(".history-error")).toBeHidden();
      assert.deepEqual(await page.evaluate(() => window.fixture.reports), []);
    });
    await check("旧分页失败与finally保持新刷新loading的所有权", async () => {
      await mount();
      await page.evaluate(async () => {
        const f = window.fixture;
        let reject;
        f.responses.push(new Promise((_resolve, r) => (reject = r)));
        const old = f.mounted.loadNext();
        let finish;
        f.responses.push(new Promise((resolve) => (finish = resolve)));
        f.pending = f.mounted.refresh();
        reject(new Error("STALE OLDER ERROR"));
        await old;
        f.finish = () =>
          finish({
            items: [
              { floorId: "6", floorNo: 6, state: "committed" },
              { floorId: "5", floorNo: 5, state: "committed" },
            ],
            nextCursor: "5",
          });
      });
      await expect(page.locator(".history-error")).toBeHidden();
      await expect(page.locator(".older-messages")).toBeDisabled();
      await page.evaluate(async () => {
        window.fixture.finish();
        await window.fixture.pending;
      });
    });
    await check("卸载后迟到的分页失败不写入错误、按钮或报告", async () => {
      await mount();
      const result = await page.evaluate(async () => {
        const f = window.fixture;
        let reject;
        f.responses.push(new Promise((_resolve, r) => (reject = r)));
        const pending = f.mounted.loadNext();
        const older = f.shadow.querySelector(".older-messages"),
          error = f.shadow.querySelector(".history-error");
        f.mounted.destroy();
        const before = {
          disabled: older.disabled,
          error: error.textContent,
          hidden: error.hidden,
        };
        reject(new Error("DESTROYED ERROR"));
        await pending;
        return {
          before,
          after: {
            disabled: older.disabled,
            error: error.textContent,
            hidden: error.hidden,
          },
          reports: f.reports,
        };
      });
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.reports, []);
    });
    await check("零可见正文完成后显示消息空态", async () => {
      await mount({ empty: true });
      await expect(
        page.getByText("发送消息，开始演绎。", { exact: true }),
      ).toBeVisible();
    });
    await check(
      "候选切换按逻辑轮次恢复候选控件焦点，并在普通刷新后保留焦点",
      async () => {
        await mount();
        await page
          .getByRole("button", { name: "下一条候选", exact: true })
          .click();
        const previous = page.getByRole("button", {
          name: "上一条候选",
          exact: true,
        });
        await expect(previous).toBeFocused();
        await page.evaluate(async () => window.fixture.mounted.refresh());
        await expect(previous).toBeFocused();
      },
    );
    await check(
      "真实刷新后自动加载并恢复较早消息阅读锚点，存储范围隔离",
      async () => {
        await mount({ storage: "tavern.user.chat:reader-A:session:main" });
        await page.evaluate(async () => {
          const f = window.fixture;
          await f.mounted.loadNext();
          await f.mounted.loadNext();
          const article = f.shadow.querySelector('[data-message-id="m-2"]'),
            history = f.shadow.querySelector(".history");
          history.scrollTop +=
            article.getBoundingClientRect().top -
            history.getBoundingClientRect().top -
            45;
          history.dispatchEvent(new Event("scroll"));
          f.offset =
            article.getBoundingClientRect().top -
            history.getBoundingClientRect().top;
        });
        const before = await page.evaluate(() => window.fixture.offset);
        await page.reload();
        await mount({ storage: "tavern.user.chat:reader-A:session:main" });
        const after = await page
          .locator('[data-message-id="m-2"]')
          .evaluate(
            (article) =>
              article.getBoundingClientRect().top -
              article
                .getRootNode()
                .querySelector(".history")
                .getBoundingClientRect().top,
          );
        assert.ok(
          Math.abs(before - after) < 2,
          JSON.stringify({ before, after }),
        );
        await mount({ storage: "tavern.user.chat:reader-B:session:main" });
        await expect(page.locator('[data-message-id="m-2"]')).toHaveCount(0);
      },
    );
    await check("真实刷新后自动定位较早消息编辑草稿并核对版本", async () => {
      await mount({ storage: "tavern.user.chat:editor-A:session:main" });
      await page.evaluate(async () => {
        await window.fixture.mounted.loadNext();
        await window.fixture.mounted.loadNext();
      });
      const old = page.locator('[data-message-id="m-1"]');
      await old.scrollIntoViewIfNeeded();
      await old.getByRole("button", { name: "消息操作", exact: true }).click();
      await old
        .getByRole("menuitem", { name: "编辑消息", exact: true })
        .click();
      await old.locator("textarea").fill("保留的较早消息编辑草稿");
      await page.reload();
      await mount({ storage: "tavern.user.chat:editor-A:session:main" });
      await expect(
        page.locator('[data-message-id="m-1"] .editor textarea'),
      ).toHaveValue("保留的较早消息编辑草稿");
    });
    await check("编辑草稿目标已删除时保留草稿并给出明确恢复反馈", async () => {
      await page.evaluate(() => {
        const key = "tavern.user.chat:missing-A:session:main:editor";
        sessionStorage.setItem(
          key,
          JSON.stringify({
            messageId: "m-missing",
            floorId: "missing",
            floorNo: 1,
            text: "目标删除后保留的编辑草稿",
            expectedRevisionNo: 0,
            committed: true,
          }),
        );
      });
      await mount({ storage: "tavern.user.chat:missing-A:session:main" });
      await expect(page.locator(".editor-recovery textarea")).toHaveValue(
        "目标删除后保留的编辑草稿",
      );
      await expect(page.locator(".editor-recovery")).toContainText(
        "已没有这条消息",
      );
    });
    report.status =
      report.cases.every((item) => item.status === "passed") &&
      report.errors.length === 0
        ? "passed"
        : "failed";
    await page.screenshot({ path: output + "/recovery.png" });
  } finally {
    await fs.writeFile(
      output + "/report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        status: report.status,
        report: output + "/report.json",
        cases: report.cases.map((item) => ({
          name: item.name,
          status: item.status,
        })),
      }),
    );
    await browser.close();
    if (report.status !== "passed") process.exitCode = 1;
  }
})();
