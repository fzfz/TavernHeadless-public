const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const {
  root,
  baseURL,
  origin,
  apiURL,
  seedHistory,
} = require("./browser-fixtures.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, label) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw Error("timeout: " + label);
};
const results = [];
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  try {
    for (const platform of ["desktop", "mobile"]) {
      const fixture = await seedHistory(23, platform);
      const context = await browser.newContext({
        viewport:
          platform === "desktop"
            ? { width: 1440, height: 1000 }
            : { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      const login = await context.request.post(baseURL + "/api/auth/login", {
        data: fixture.credentials,
        headers: { Origin: origin },
      });
      assert.equal(login.status(), 200, await login.text());
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const checks = [];
      await page.goto(baseURL + "/#history");
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 20),
        "initial20",
      );
      if (platform === "mobile")
        await page
          .getByRole("button", { name: "管理记录", exact: true })
          .click();
      await wait(
        () => page.locator(".select-loaded input").isEnabled(),
        "run checks",
      );
      const search = page.getByLabel("搜索历史演绎", { exact: true });
      await search.fill("陆知行");
      await sleep(200);
      assert.equal(await page.locator(".history-row").count(), 20);
      assert.match(await page.locator(".query-status").textContent(), /全部/);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("draft does not apply query");
      await page.locator(".select-loaded input").check();
      assert.equal(
        await page.locator(".history-row input:checked").count(),
        20,
      );
      let failMore = true;
      await page.route("**/api/sessions?**", async (route) => {
        const url = new URL(route.request().url());
        if (failMore && url.searchParams.get("offset") === "20") {
          failMore = false;
          return route.abort("failed");
        }
        return route.continue();
      });
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await page
        .getByRole("button", { name: "重新加载更多演绎", exact: true })
        .waitFor();
      assert.equal(await page.locator(".history-row").count(), 20);
      assert.equal(
        await page.locator(".history-row input:checked").count(),
        20,
      );
      await page.screenshot({
        path: `${root}/history-${platform}-append-error.png`,
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "重新加载更多演绎", exact: true })
        .click();
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 23),
        "append23",
      );
      await wait(
        () => page.locator(".select-loaded input").isEnabled(),
        "runs after append",
      );
      assert.equal(
        await page.locator(".history-row input:checked").count(),
        20,
      );
      assert.equal(
        await page
          .locator(".select-loaded input")
          .evaluate((e) => e.indeterminate),
        true,
      );
      assert.equal(await search.inputValue(), "陆知行");
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push(
        "append failure preserves loaded range, retries offset, new rows unselected and mixed state",
      );
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 1),
        "persona full collection search",
      );
      assert.match(await page.locator(".history-row").textContent(), /陆知行/);
      assert.equal(await page.locator(".history-row input:checked").count(), 0);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("applied persona snapshot search and selection clear");
      await page.getByRole("button", { name: "重置筛选", exact: true }).click();
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 20),
        "reset20",
      );
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 23),
        "reset append23",
      );
      await wait(
        () => page.locator(".select-loaded input").isEnabled(),
        "runchecks",
      );
      const last = page.locator(".history-row").last();
      await last.scrollIntoViewIfNeeded();
      await sleep(200);
      const lastId = await last.getAttribute("data-session-id");
      const before = (await last.boundingBox()).y;
      await last.getByRole("button", { name: "继续演绎", exact: true }).click();
      await page.waitForURL("**/#chat/**");
      await page.goBack();
      await wait(
        () =>
          page
            .locator(".history-row")
            .count()
            .then((n) => n === 23),
        "returnrange23",
      );
      await sleep(400);
      const after = (
        await page.locator(`[data-session-id="${lastId}"]`).boundingBox()
      ).y;
      assert.ok(Math.abs(after - before) < 40, `anchor ${before} -> ${after}`);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("continue/back restores loaded 23 and reading anchor");
      const first = page.locator(".history-row").first();
      await first.scrollIntoViewIfNeeded();
      await wait(() => first.locator("input").isEnabled(), "first idle");
      const more = first.locator(".history-more");
      await more.focus();
      await more.press("ArrowDown");
      const menu = page.getByRole("menu");
      await menu.waitFor();
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "删除",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await more.evaluate((e) => document.activeElement === e),
        true,
      );
      await more.click();
      await page.goBack();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).hash, "#history");
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("menu keyboard, Escape focus return and browser Back");
      await more.click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await page.locator("#session-title-input").waitFor();
      await page
        .locator("#session-title-input")
        .fill(`${platform}历史改名${Date.now()}`);
      await page.locator('button[form="session-title-form"]').click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.match(
        await first.locator("h2").textContent(),
        new RegExp(platform + "历史改名"),
      );
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("rename through shared settings and row update");
      if (platform === "mobile") {
        await page
          .getByRole("button", { name: "完成管理", exact: true })
          .click();
        assert.equal(await page.locator(".history-row input").count(), 0);
        await page
          .getByRole("button", { name: "管理记录", exact: true })
          .click();
      }
      await page.locator(".history-row input").nth(0).check();
      await page.locator(".history-row input").nth(1).check();
      const ids = await page
        .locator(".history-row:has(input:checked)")
        .evaluateAll((rows) => rows.map((r) => r.dataset.sessionId));
      await page
        .getByRole("button", { name: "删除所选演绎", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.locator(".delete-targets li").first().waitFor();
      await wait(
        () =>
          dialog
            .getByRole("button", { name: "确认删除", exact: true })
            .isEnabled(),
        "confirm enabled",
      );
      assert.equal(await dialog.locator(".delete-targets li").count(), 2);
      assert.equal(
        await dialog
          .getByRole("button", { name: "取消", exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      let posts = 0,
        releaseResponse;
      const responseGate = new Promise((r) => (releaseResponse = r));
      await page.route("**/api/sessions/batch/delete", async (route) => {
        posts++;
        const actual = await route.fetch();
        assert.equal(actual.status(), 200);
        const real = await actual.json();
        assert.equal(real.results?.length || real.data?.results?.length, 2);
        await responseGate;
        await route.abort("failed");
      });
      await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await wait(() => posts === 1, "one post");
      await dialog
        .getByRole("button", { name: "返回列表", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.locator(".receipt-banner").waitFor();
      releaseResponse();
      await wait(
        () =>
          page
            .locator(".receipt-banner")
            .textContent()
            .then((t) => t.includes("尚未确认")),
        "unknown receipt",
      );
      assert.equal(posts, 1);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push(
        "fixed two-target confirmation and close during submitted delete",
      );
      let blockDetails = true;
      await page.route("**/api/sessions/*", (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1);
        if (
          blockDetails &&
          ids.includes(id) &&
          route.request().method() === "GET"
        )
          return route.abort("failed");
        return route.continue();
      });
      await page.reload();
      await page.locator(".receipt-banner").waitFor();
      assert.equal(posts, 1);
      await page.locator(".receipt-banner button").click();
      await dialog.waitFor();
      assert.equal(await dialog.locator(".delete-targets li").count(), 2);
      assert.equal(
        await dialog
          .getByRole("button", { name: "重试剩余项", exact: true })
          .isDisabled(),
        true,
      );
      await page.screenshot({
        path: `${root}/history-${platform}-delete-unknown.png`,
        fullPage: false,
      });
      blockDetails = false;
      await dialog
        .getByRole("button", { name: "核对删除结果", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await wait(
        () =>
          page
            .locator(".receipt-banner")
            .count()
            .then((n) => n === 0),
        "verified receipt cleared",
      );
      assert.equal(posts, 1);
      for (const id of ids)
        assert.equal(
          await page.locator(`[data-session-id="${id}"]`).count(),
          0,
        );
      const current = await context.request.get(
        baseURL + "/api/sessions?limit=100",
      );
      assert.equal((await current.json()).meta.total, 21);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push(
        "account scoped receipt survives reload, unknown never resent, 404 verifies actual committed removal",
      );
      await page.unroute("**/api/sessions/batch/delete");
      await page.unroute("**/api/sessions/*");
      if (
        platform === "mobile" &&
        !(await page.locator(".select-loaded").count())
      )
        await page
          .getByRole("button", { name: "管理记录", exact: true })
          .click();
      await wait(
        () =>
          page
            .locator(".history-row input:enabled")
            .count()
            .then((n) => n >= 2),
        "idle two",
      );
      await page.locator(".history-row input").nth(0).check();
      await page.locator(".history-row input").nth(1).check();
      const partialIds = await page
        .locator(".history-row:has(input:checked)")
        .evaluateAll((rows) => rows.map((r) => r.dataset.sessionId));
      await page
        .getByRole("button", { name: "删除所选演绎", exact: true })
        .click();
      await wait(
        () =>
          dialog
            .getByRole("button", { name: "确认删除", exact: true })
            .isEnabled(),
        "partial confirm",
      );
      const cookies = (await context.cookies())
        .map((c) => c.name + "=" + c.value)
        .join("; ");
      let streamDone;
      let partialPosts = [];
      await page.route("**/api/sessions/batch/delete", async (route) => {
        const submitted = route.request().postDataJSON().ids;
        partialPosts.push(submitted);
        if (partialPosts.length === 1) {
          const stream = await fetch(
            apiURL + "/sessions/" + partialIds[0] + "/respond/stream",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookies,
                Origin: origin,
              },
              body: JSON.stringify({
                message: "“我先看看邮戳。”",
                operation_id: "history-busy-" + platform + "-" + Date.now(),
              }),
            },
          );
          assert.equal(stream.status, 200);
          streamDone = stream.text();
        }
        const actual = await route.fetch();
        await route.fulfill({ response: actual });
      });
      await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await wait(
        () =>
          dialog
            .locator(".delete-targets")
            .textContent()
            .then(
              (t) =>
                t.includes("正在生成，暂时无法删除") && t.includes("已删除"),
            ),
        "actual partial result",
      );
      assert.equal(await dialog.locator(".delete-targets li").count(), 2);
      await page.screenshot({
        path: `${root}/history-${platform}-delete-partial.png`,
        fullPage: false,
      });
      await dialog
        .getByRole("button", { name: "返回列表", exact: true })
        .click();
      const busyRow = page.locator(`[data-session-id="${partialIds[0]}"]`);
      assert.equal(
        await busyRow
          .getByRole("button", { name: "继续演绎", exact: true })
          .isEnabled(),
        true,
      );
      assert.equal(await busyRow.locator("input").isDisabled(), true);
      if (platform === "mobile") {
        await page
          .getByRole("button", { name: "完成管理", exact: true })
          .click();
        assert.equal(await page.locator(".receipt-banner").count(), 1);
      }
      await streamDone;
      await page.locator(".receipt-banner button").click();
      await dialog
        .getByRole("button", { name: "核对删除结果", exact: true })
        .click();
      await wait(
        () =>
          dialog
            .getByRole("button", { name: "重试剩余项", exact: true })
            .isEnabled(),
        "remaining idle",
      );
      await dialog
        .getByRole("button", { name: "重试剩余项", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(partialPosts.length, 2);
      assert.deepEqual(partialPosts[1], [partialIds[0]]);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push(
        "real generation busy preserves continue, per-item partial results, retry submits only confirmed remaining item",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(platform, "checkpoint", checks.length + 1);
      checks.push("no overflow or browser exceptions");
      await page.screenshot({
        path: `${root}/history-${platform}-final.png`,
        fullPage: false,
      });
      results.push({
        platform,
        checks,
        passed: true,
        fixture: fixture.credentials.email,
      });
      await context.close();
      console.log(platform + " PASS " + checks.length);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(
      root + "/history-acceptance.json",
      JSON.stringify(results, null, 2),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
