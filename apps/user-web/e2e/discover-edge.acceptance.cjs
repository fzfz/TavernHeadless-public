const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const {
  root,
  baseURL,
  ensureEmptyApi,
  launchNativeChrome,
} = require("./browser-fixtures.cjs");
(async () => {
  const emptyApi = await ensureEmptyApi();
  const nativeChrome = await launchNativeChrome(chromium);
  const browser = nativeChrome.browser;
  try {
    const context = browser.contexts()[0];
    const p = context.pages()[0] || (await context.newPage());
    await p.setViewportSize({ width: 1440, height: 1000 });
    let fail = true;
    await p.route("**/api/public/roles?**", async (r) => {
      if (fail) {
        fail = false;
        await r.abort("failed");
      } else await r.continue();
    });
    await p.goto(baseURL + "/#discover");
    await p.locator(".error-panel button").waitFor();
    assert.equal(await p.locator(".role-card").count(), 0);
    await p.locator(".error-panel button").click();
    await p.waitForFunction(
      () => document.querySelectorAll(".role-card").length === 12,
    );
    await p.unroute("**/api/public/roles?**");
    let reads = 0;
    p.on("request", (r) => {
      if (r.url().includes("/api/public/roles?")) reads++;
    });
    const before = reads;
    await p.getByLabel("搜索角色", { exact: true }).fill("未提交");
    await p.getByLabel("搜索角色", { exact: true }).evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(reads, before);
    let delayed;
    const delayedDone = new Promise((r) => (delayed = r));
    await p.route("**/api/public/roles?**", async (r) => {
      const u = new URL(r.request().url());
      if (u.searchParams.get("keyword") === "过期查询") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await r.continue();
        delayed();
      } else await r.continue();
    });
    await p.getByLabel("搜索角色", { exact: true }).fill("过期查询");
    await p.locator(".search-bar button").click();
    await p.getByLabel("搜索角色", { exact: true }).fill("邮局");
    await p.locator(".search-bar button").click();
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".role-card").length === 12 &&
        location.hash.includes("q="),
    );
    await delayedDone;
    await p.waitForLoadState("networkidle");
    assert.equal(await p.locator(".role-card").count(), 12);
    assert.ok(
      (await p.locator(".list-heading").textContent()).includes("邮局"),
    );
    await p.unroute("**/api/public/roles?**");
    const oldReads = reads;
    const browserWindow = await context.newCDPSession(p);
    const { windowId } = await browserWindow.send("Browser.getWindowForTarget");
    await browserWindow.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await p.waitForFunction(
      () => document.visibilityState === "hidden",
      undefined,
      { polling: 100 },
    );
    const refetch = p.waitForResponse((r) =>
      r.url().includes("/api/public/roles?"),
    );
    await browserWindow.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await p.bringToFront();
    await p.waitForFunction(() => document.visibilityState === "visible");
    await refetch;
    assert.ok(reads > oldReads);
    await browserWindow.detach();
    await p.goto(baseURL + "/#role/nonexistent-role");
    await p.waitForURL(/#unavailable/);
    await p.getByRole("heading", { name: "页面无法访问" }).waitFor();
    const empty = await browser.newContext();
    const e = await empty.newPage();
    await e.route("**/api/public/roles?**", (r) => {
      const u = new URL(r.request().url());
      return r.continue({
        url: emptyApi.url + u.pathname.replace(/^\/api/, "") + u.search,
      });
    });
    await e.goto(baseURL + "/#discover");
    await e.getByRole("heading", { name: "暂无可浏览的角色" }).waitFor();
    assert.equal(await e.locator(".role-card").count(), 0);
    await e.getByRole("button", { name: "重新读取角色" }).click();
    await e.getByRole("heading", { name: "暂无可浏览的角色" }).waitFor();
    await e.screenshot({
      path: root + "/discover-empty-real-backend.png",
      fullPage: true,
    });
    const result = {
      status: "PASS",
      checks: [
        "first request failure and same-query retry",
        "IME composing Enter does not apply search",
        "draft edit sends no request",
        "newest query wins delayed earlier response",
        "real Chrome window minimize/restore reloads current query",
        "missing role actual404 enters inaccessible page",
        "empty isolated API collection and reload",
      ],
    };
    await fs.writeFile(
      root + "/discover-edge-acceptance.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    await empty.close();
  } finally {
    await nativeChrome.close();
    emptyApi.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
