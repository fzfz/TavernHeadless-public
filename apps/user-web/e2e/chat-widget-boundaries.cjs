const { chromium, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_CHAT_BOUNDARY_EVIDENCE ||
  "/tmp/tavern-user-web-chat-boundaries";

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  const report = {
    scope:
      "真实 Chrome 中的生产聊天组件边界；使用受控传输，完整 API 流程另见 chat-flows.cjs。",
    cases: [],
    errors: [],
  };
  page.on("pageerror", (error) => report.errors.push(error.message));
  try {
    await page.goto(base + "/#discover");
    await page.evaluate(async () => {
      const { mountChatWidget } =
        await import("/src/features/chat/chat-widget.ts");
      document.querySelector("#app").style.display = "none";
      const element = document.createElement("div");
      element.style.cssText = "height:760px;width:1000px;margin:30px auto";
      document.body.append(element);
      const data = new Map(
        Array.from({ length: 6 }, (_, index) => [
          index + 1,
          `FLOOR ${index + 1}\n` + "已保存的正文。".repeat(32),
        ]),
      );
      const state = {
        busy: false,
        stopping: false,
        unknown: false,
        draft: "",
        pendingInput: null,
        pendingMain: null,
        editing: false,
        notice: "",
      };
      let textListener, stateListener;
      const queries = [];
      const mounted = mountChatWidget(element, {
        session: {
          sessionId: "controlled",
          branchId: "main",
          delivery: { assets: {}, data: {} },
        },
        state: () => state,
        subscribe: (listener) => {
          stateListener = listener;
          return () => {};
        },
        onText: (listener) => {
          textListener = listener;
          return () => {};
        },
        listFloors: async ({ cursor }) => {
          queries.push(cursor ?? null);
          const before = cursor ? Number(cursor) : Infinity;
          const ids = [...data.keys()]
            .filter((id) => id < before)
            .sort((a, b) => b - a);
          const page = ids.slice(0, 2);
          return {
            items: page.map((id) => ({
              floorId: String(id),
              floorNo: id,
              state: "committed",
            })),
            nextCursor: ids.length > 2 ? String(page.at(-1)) : null,
          };
        },
        getMessages: async (floorId) => [
          {
            id: `m-${floorId}`,
            floorId,
            role: "assistant",
            text: data.get(Number(floorId)),
            status: "completed",
          },
        ],
        getContext: async (floorId) => ({
          floor: { id: floorId, state: "committed" },
          pages: [],
          messagePages: {},
          canEdit: true,
          canDelete: true,
          canGenerate: false,
          reason: "",
          candidates: { activeFloorId: floorId, canActivate: false, items: [] },
        }),
        setDraft() {},
        setEditing() {},
        send: async () => {},
        stop() {},
        reconcile: async () => {},
        retryResponse: async () => {},
        retryState: async () => {},
        perform: async () => {},
        report: (error) => {
          throw error;
        },
      });
      await mounted.ready;
      window.boundary = {
        mounted,
        state,
        data,
        queries,
        emit: (event) => textListener(event),
        notify: () => stateListener(),
        shadow: element.firstElementChild.shadowRoot,
      };
    });
    const history = page.locator(".history");
    await page.evaluate(async () => {
      await window.boundary.mounted.loadNext();
      await window.boundary.mounted.loadNext();
    });
    await expect(page.locator(".records article")).toHaveCount(6);
    const target = page.locator('[data-message-id="m-4"]');
    await target.scrollIntoViewIfNeeded();
    await target.getByRole("button", { name: "消息操作", exact: true }).click();
    await target
      .getByRole("menuitem", { name: "编辑消息", exact: true })
      .focus();
    const before = await page.evaluate(() => {
      const { shadow } = window.boundary;
      const article = shadow.querySelector('[data-message-id="m-4"]');
      window.boundary.retained = article;
      return {
        top: article.getBoundingClientRect().top,
        scrollTop: shadow.querySelector(".history").scrollTop,
      };
    });
    await page.evaluate(async () => {
      const test = window.boundary;
      test.queries.length = 0;
      test.data.set(1, "CHANGED EARLIER\n" + "增加的正文。\n".repeat(36));
      await test.mounted.refresh();
    });
    await expect(page.locator('[data-message-id="m-1"] .body')).toContainText(
      "CHANGED EARLIER",
    );
    const after = await page.evaluate(() => {
      const test = window.boundary,
        article = test.shadow.querySelector('[data-message-id="m-4"]');
      return {
        top: article.getBoundingClientRect().top,
        same: article === test.retained,
        menu: article.querySelector("details").open,
        focus: test.shadow.activeElement?.textContent,
        queries: test.queries,
      };
    });
    assert.equal(after.same, true);
    assert.equal(after.menu, true);
    assert.equal(after.focus, "编辑消息");
    assert.ok(
      Math.abs(after.top - before.top) < 2,
      JSON.stringify({ before, after }),
    );
    assert.deepEqual(after.queries, [null, "5", "3"]);
    report.cases.push({
      name: "有界重读已加载较早页，更新正文并保持阅读锚点、菜单与键盘焦点",
      status: "passed",
      queries: after.queries,
      anchorDelta: after.top - before.top,
    });
    await page.evaluate(async () => {
      const test = window.boundary;
      test.data.delete(1);
      await test.mounted.refresh();
    });
    await expect(page.locator('[data-message-id="m-1"]')).toHaveCount(0);
    await expect(page.locator(".records article")).toHaveCount(5);
    report.cases.push({
      name: "已加载较早页消息删除后移除原正文",
      status: "passed",
    });
    await page.evaluate(async () => {
      const test = window.boundary;
      test.data.set(4, "CHANGED FOCUSED MESSAGE");
      await test.mounted.refresh();
    });
    await expect(target.locator("details")).toHaveAttribute("open", "");
    await expect(
      target.getByRole("menuitem", { name: "编辑消息", exact: true }),
    ).toBeFocused();
    await expect(target.locator(".body")).toHaveText("CHANGED FOCUSED MESSAGE");
    await page.evaluate(async () => {
      const test = window.boundary;
      test.data.delete(4);
      await test.mounted.refresh();
    });
    await expect(
      page
        .locator('[data-message-id="m-5"]')
        .getByRole("button", { name: "消息操作", exact: true }),
    ).toBeFocused();
    report.cases.push({
      name: "正在操作的消息更新后恢复菜单动作焦点，删除后焦点移至相邻消息",
      status: "passed",
    });
    await page.evaluate(() => {
      const test = window.boundary;
      test.emit({
        streamId: "partial",
        floorId: "unsaved",
        status: "streaming",
        text: "PARTIAL OUTPUT",
        messageId: null,
      });
      test.state.unknown = true;
      test.emit({
        streamId: "partial",
        floorId: "unsaved",
        status: "failed",
        text: "PARTIAL OUTPUT",
        messageId: null,
      });
    });
    await expect(page.locator(".stream-entry .body")).toHaveText(
      "PARTIAL OUTPUT",
    );
    await expect(page.locator(".stream-status")).toHaveText("保存结果待确认");
    await page.evaluate(() => {
      const test = window.boundary;
      test.state.unknown = false;
      test.notify();
    });
    await expect(page.locator(".stream-status")).toHaveText("未保存的生成内容");
    assert.equal(
      await page
        .locator(".records")
        .innerText()
        .then((text) => text.includes("PARTIAL OUTPUT")),
      false,
    );
    await page.locator(".stream-entry").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, "preserved-partial-and-history.png"),
    });
    report.cases.push({
      name: "中断正文保持可读取文本，分别显示待确认与未保存状态，并与保存历史分开",
      status: "passed",
    });
    await expect(history).toBeVisible();
    assert.deepEqual(report.errors, []);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = String(error.stack || error);
    report.focus = await page.evaluate(() => ({
      text: window.boundary?.shadow.activeElement?.textContent,
      tag: window.boundary?.shadow.activeElement?.tagName,
      connected: window.boundary?.shadow.activeElement?.isConnected,
    }));
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        status: report.status,
        cases: report.cases.length,
        report: path.join(output, "report.json"),
      }),
    );
    await browser.close();
  }
})();
