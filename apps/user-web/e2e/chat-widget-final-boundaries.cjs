const { chromium, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mountChatFixture } = require("./chat-widget-fixture.cjs");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_CHAT_FINAL_EVIDENCE || "/tmp/tavern-user-web-chat-final";
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  page.setDefaultTimeout(5000);
  const report = {
    scope: "真实 Chrome 生产聊天组件与控制器，受控传输验证最终异步边界。",
    cases: [],
    errors: [],
  };
  page.on("pageerror", (error) => report.errors.push(error.message));
  await fs.mkdir(output, { recursive: true });
  const mount = (config) => mountChatFixture(page, config);
  const editor = () => page.locator('[data-message-id="m-6"] .editor');
  async function openEditor() {
    const row = page.locator('[data-message-id="m-6"]');
    await row.getByRole("button", { name: "消息操作", exact: true }).click();
    await row.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  }
  async function installController() {
    await page.evaluate(async () => {
      const f = window.fixture;
      f.mounted.destroy();
      const root = document.querySelector("#controlled");
      const { createSessionHost } =
        await import("/src/features/chat/session-controller.ts");
      const pointer = {
        sessionId: "controlled",
        branchId: "main",
        floorId: "6",
        attemptId: "a",
        versionId: "v",
        snapshotId: "snapshot",
        parentSnapshotId: null,
        variables: {},
        source: { kind: "floor", runId: "run", jobId: null },
      };
      const session = {
        sessionId: "controlled",
        branchId: "main",
        versionId: "v",
        name: "Controlled",
        initial: pointer,
        current: pointer,
        messages: [],
        processing: { pendingMain: null, pendingFollowups: false },
        delivery: { assets: {}, data: {} },
      };
      const o = f.options;
      f.loads = 0;
      const host = createSessionHost({
        session,
        policy: {
          overscanFloors: 0,
          historyCache: { maxEntries: 4, maxBytes: 4096 },
          settledStreamCache: { maxEntries: 4, maxBytes: 4096 },
          diagnosticsCache: { maxEntries: 4, maxBytes: 4096 },
        },
        errors: { SCRIPT_FAILED: "脚本读取失败" },
        transport: {
          subscribeState: () => () => {},
          listFloors: o.listFloors,
          getMessages: ({ floorId }) => o.getMessages(floorId),
          getFloorContext: o.getContext,
          getMessageRevision: o.getRevision,
          performAction: async () => {
            f.locked = true;
            throw Object.assign(new Error("此轮正在生成，请稍后操作。"), {
              code: "content_target_locked",
              status: 409,
            });
          },
          loadSession: async () => {
            f.loads++;
            return session;
          },
          dispose() {},
        },
      });
      f.host = host;
      const mounted = host.mountChat(root);
      f.mounted = {
        destroy: () => {
          mounted.destroy();
          host.dispose();
        },
      };
      f.shadow = root.firstElementChild.shadowRoot;
    });
  }
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
      "取消后重开同一消息，迟到的前一个版本读取不能覆盖当前编辑器和草稿存储",
      async () => {
        await mount({ storage: "tavern.user.chat:instance-A:session:main" });
        await page.evaluate(() => {
          const f = window.fixture;
          f.revisionResponses.push(
            new Promise((resolve) => (f.resolveOld = resolve)),
          );
        });
        await openEditor();
        await editor()
          .getByRole("button", { name: "取消", exact: true })
          .click();
        await openEditor();
        await editor().locator("textarea").fill("第二个编辑器的草稿");
        await page.evaluate(() =>
          window.fixture.resolveOld({
            revisionNo: 0,
            content: window.fixture.body("6"),
            hidden: false,
          }),
        );
        await expect(editor().locator("textarea")).toHaveValue(
          "第二个编辑器的草稿",
        );
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                JSON.parse(
                  sessionStorage.getItem(
                    "tavern.user.chat:instance-A:session:main:editor",
                  ),
                ).text,
            ),
          )
          .toBe("第二个编辑器的草稿");
      },
    );
    await check(
      "刷新与追加读取等待菜单权限期间，用户的新阅读位置持续保留",
      async () => {
        for (const action of ["refresh", "loadNext"]) {
          await mount();
          if (action === "refresh")
            await page.evaluate(async () => {
              await window.fixture.mounted.loadNext();
              await window.fixture.mounted.loadNext();
            });
          await page.evaluate((action) => {
            const f = window.fixture,
              h = f.shadow.querySelector(".history");
            h.scrollTop = 0;
            f.contextResponses.push(
              new Promise((resolve) => (f.finishContext = resolve)),
            );
            f.pending = f.mounted[action]();
          }, action);
          await page.waitForFunction(() =>
            Boolean(window.fixture.blockedContextId),
          );
          const before = await page.evaluate(() => {
            const f = window.fixture,
              h = f.shadow.querySelector(".history");
            h.scrollTop = Math.min(280, h.scrollHeight - h.clientHeight);
            h.dispatchEvent(new Event("scroll"));
            return h.scrollTop;
          });
          await page.evaluate(async () => {
            const f = window.fixture;
            f.finishContext(f.contextFor(f.blockedContextId));
            await f.pending;
          });
          const after = await page
            .locator(".history")
            .evaluate((node) => node.scrollTop);
          assert.ok(
            Math.abs(before - after) < 2,
            JSON.stringify({ action, before, after }),
          );
        }
      },
    );
    await check(
      "活动编辑在刷新时核对外部修改和删除，保留草稿并要求版本确认",
      async () => {
        await mount({ storage: "tavern.user.chat:active-A:session:main" });
        await openEditor();
        await editor().locator("textarea").fill("本页保留的编辑内容");
        await page.evaluate(async () => {
          const f = window.fixture;
          f.revisions.set("6", 1);
          f.bodyChanges.set("6", "另一页已保存的正文");
          await f.mounted.refresh();
        });
        await expect(editor().locator(".revision-conflict")).toBeVisible();
        await expect(editor().locator("textarea")).toHaveValue(
          "本页保留的编辑内容",
        );
        await expect(
          editor().getByRole("button", { name: "保存消息", exact: true }),
        ).toBeDisabled();
        await editor()
          .getByRole("button", { name: "保留本次编辑", exact: true })
          .click();
        await expect(
          editor().getByRole("button", { name: "保存消息", exact: true }),
        ).toBeEnabled();
        await page.evaluate(async () => {
          const f = window.fixture;
          f.rows.delete("6");
          await f.mounted.refresh();
        });
        await expect(editor()).toHaveCount(0);
        await expect(page.locator(".editor-recovery textarea")).toHaveValue(
          "本页保留的编辑内容",
        );
        await expect(page.locator('[data-message-id="m-6"]')).toHaveCount(0);
      },
    );
    await check(
      "编辑、删除和候选操作被服务端拒绝后，控制器重读目标权限并保留下一条草稿",
      async () => {
        for (const kind of ["edit", "delete", "candidate"]) {
          await mount();
          await installController();
          await expect(page.locator('[data-message-id="m-6"]')).toBeVisible();
          await page.locator(".chat textarea").fill("下一条草稿");
          await page.evaluate(async (kind) => {
            try {
              await window.fixture.host.performAction(
                kind === "candidate"
                  ? { kind, floorId: "6", candidateFloorId: "60" }
                  : {
                      kind,
                      floorId: "6",
                      messageId: "m-6",
                      text: "修改正文",
                      expectedRevisionNo: 0,
                    },
              );
            } catch (error) {
              if (error.code !== "content_target_locked") throw error;
            }
          }, kind);
          assert.equal(await page.evaluate(() => window.fixture.loads), 1);
          await expect(
            page.getByRole("button", { name: "下一条候选", exact: true }),
          ).toBeDisabled();
          await expect(page.locator(".chat textarea")).toHaveValue(
            "下一条草稿",
          );
        }
      },
    );
    await check(
      "初次、追加与刷新部分正文失败均保留成功正文，并仅重试失败轮次",
      async () => {
        await mount({ messageFailures: ["5"] });
        await expect(
          page.locator('[data-message-id="m-6"] .body'),
        ).toBeVisible();
        await expect(
          page.locator('[data-floor-id="5"] .floor-read-error'),
        ).toBeVisible();
        await page.evaluate(() => window.fixture.messageFailures.delete("5"));
        await page
          .locator('[data-floor-id="5"] .floor-read-error')
          .getByRole("button", { name: "重新读取", exact: true })
          .click();
        await expect(
          page.locator('[data-message-id="m-5"] .body'),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => window.fixture.messageCalls.filter((id) => id === "6").length,
          ),
          1,
        );
        await page.evaluate(async () => {
          const f = window.fixture;
          f.messageFailures.add("4");
          await f.mounted.loadNext();
        });
        await expect(
          page.locator('[data-message-id="m-3"] .body'),
        ).toBeVisible();
        await expect(
          page.locator('[data-floor-id="4"] .floor-read-error'),
        ).toBeVisible();
        await page.evaluate(async () => {
          const f = window.fixture;
          f.messageFailures.delete("4");
          f.messageFailures.add("5");
          await f.mounted.refresh();
        });
        await expect(
          page.locator('[data-message-id="m-6"] .body'),
        ).toBeVisible();
        await expect(
          page.locator('[data-message-id="m-5"] .body'),
        ).toBeVisible();
        await expect(
          page.locator('[data-floor-id="5"] .floor-read-error'),
        ).toBeVisible();
      },
    );
    await check(
      "编辑保存及结果待确认期间锁定提交内容，恢复后保留草稿与下一条输入",
      async () => {
        await mount({ storage: "tavern.user.chat:saving-A:session:main" });
        await openEditor();
        await editor().locator("textarea").fill("本次提交的编辑A");
        await page.evaluate(() => {
          const f = window.fixture;
          f.editResponses.push(
            new Promise((_resolve, reject) => (f.failEdit = reject)),
          );
        });
        await editor()
          .getByRole("button", { name: "保存消息", exact: true })
          .click();
        await expect(editor().locator("textarea")).toBeDisabled();
        await page.evaluate(() => {
          const f = window.fixture;
          f.state.unknown = true;
          f.failEdit(
            Object.assign(new Error("保存结果待确认"), { status: 503 }),
          );
        });
        await expect(editor().locator("textarea")).toBeDisabled();
        await expect(editor().locator("textarea")).toHaveValue(
          "本次提交的编辑A",
        );
        await page.evaluate(() => {
          const f = window.fixture;
          f.state.unknown = false;
          f.notify();
        });
        await expect(editor().locator("textarea")).toBeEnabled();
        await page.evaluate(() => {
          const f = window.fixture;
          f.editResponses.push(
            new Promise((resolve) => (f.finishEdit = resolve)),
          );
        });
        await editor()
          .getByRole("button", { name: "保存消息", exact: true })
          .click();
        await expect(editor().locator("textarea")).toBeDisabled();
        await page
          .locator(".compose > label > textarea")
          .fill("保存期间准备的下一条消息");
        await page.evaluate(() => window.fixture.finishEdit());
        await expect(editor()).toHaveCount(0);
        await expect(page.locator(".compose > label > textarea")).toHaveValue(
          "保存期间准备的下一条消息",
        );
        assert.deepEqual(
          await page.evaluate(() =>
            window.fixture.submissions.map((action) => action.text),
          ),
          ["本次提交的编辑A", "本次提交的编辑A"],
        );
      },
    );
    await check(
      "真实编辑器保存拒绝后消费最新编辑权限，保留草稿并禁用保存",
      async () => {
        await mount();
        await installController();
        await expect(page.locator('[data-message-id="m-6"]')).toBeVisible();
        await openEditor();
        await editor().locator("textarea").fill("锁定后保留的编辑内容");
        await page.evaluate(() => (window.fixture.locked = true));
        await editor()
          .getByRole("button", { name: "保存消息", exact: true })
          .click();
        await expect(
          editor().getByRole("button", { name: "保存消息", exact: true }),
        ).toBeDisabled();
        await expect(editor().locator("textarea")).toHaveValue(
          "锁定后保留的编辑内容",
        );
        await expect
          .poll(() => page.evaluate(() => window.fixture.loads))
          .toBe(1);
      },
    );
    await check(
      "外部删除活动编辑目标时只移交编辑器内部焦点，保留其他输入焦点",
      async () => {
        for (const inside of [true, false]) {
          await mount();
          await openEditor();
          await editor().locator("textarea").fill("待复制的编辑草稿");
          if (!inside)
            await page
              .locator(".compose > label > textarea")
              .fill("下一条消息");
          await page.evaluate(async () => {
            const f = window.fixture;
            f.rows.delete("6");
            await f.mounted.refresh();
          });
          await expect(page.locator(".editor-recovery textarea")).toHaveValue(
            "待复制的编辑草稿",
          );
          await expect(
            inside
              ? page.locator(".editor-recovery textarea")
              : page.locator(".compose > label > textarea"),
          ).toBeFocused();
        }
      },
    );
    report.status =
      report.cases.every((item) => item.status === "passed") &&
      report.errors.length === 0
        ? "passed"
        : "failed";
    await page.screenshot({ path: output + "/partial-history.png" });
  } finally {
    await fs.writeFile(
      output + "/report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        status: report.status,
        cases: report.cases.map((item) => ({
          name: item.name,
          status: item.status,
        })),
        report: output + "/report.json",
      }),
    );
    await browser.close();
    if (report.status !== "passed") process.exitCode = 1;
  }
})();
