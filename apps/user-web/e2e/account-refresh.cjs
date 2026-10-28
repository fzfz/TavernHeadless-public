const { chromium, expect } = require("playwright/test");
const { launchNativeChrome, baseURL } = require("./browser-fixtures.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const output =
  process.env.USER_WEB_EVIDENCE || "/tmp/tavern-user-web-portal-evidence";
(async () => {
  const native = await launchNativeChrome(chromium);
  const context = native.browser.contexts()[0];
  const page = context.pages()[0];
  const report = { cases: [] };
  const gates = [];
  try {
    const email = `account-refresh-${Date.now()}@example.test`,
      password = "Refresh-2026!";
    for (const [path, data] of [
      ["register", { email, password, name: "原昵称" }],
      ["login", { email, password }],
    ]) {
      const response = await context.request.post(
        baseURL + "/api/auth/" + path,
        { data, headers: { Origin: baseURL } },
      );
      assert.ok(response.ok(), await response.text());
    }
    await page.goto(baseURL + "/#account");
    await expect(
      page.getByRole("heading", { name: "用户中心", exact: true }),
    ).toBeVisible();
    const other = await context.newPage();
    await other.goto(baseURL + "/#discover");
    await other.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    const updated = await context.request.patch(baseURL + "/api/auth/me", {
      data: { name: "另一页面更新的昵称" },
      headers: { Origin: baseURL },
    });
    assert.ok(updated.ok(), await updated.text());
    await page.bringToFront();
    await expect(
      page
        .locator(".account-form")
        .getByText("另一页面更新的昵称", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".account-form .notice")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "另一页面更新的昵称",
    );
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    report.cases.push({
      name: "P07 无昵称草稿时返回页面自动采用当前资料",
      status: "passed",
    });
    console.log("PASS account clean refresh");
    await page.getByLabel("昵称", { exact: true }).fill("并发刷新后的昵称");
    let reads = 0;
    const arrivals = [0, 1].map(() => {
      let arrive;
      const ready = new Promise((resolve) => {
        arrive = resolve;
      });
      return { ready, arrive };
    });
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "GET" || reads >= 2)
        return route.continue();
      const index = reads++;
      const response = await route.fetch();
      const gate = new Promise((resolve) => {
        gates[index] = resolve;
      });
      arrivals[index].arrive();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await arrivals[0].ready;
    await other.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    await page.bringToFront();
    await arrivals[1].ready;
    const firstRead = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith("/auth/me"),
    );
    gates[0]();
    await firstRead;
    await page.waitForTimeout(150);
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "并发刷新后的昵称",
    );
    await expect(page.getByLabel("昵称", { exact: true })).toBeDisabled();
    gates[1]();
    await expect(
      page
        .locator(".account-form")
        .getByText("并发刷新后的昵称", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveCount(0);
    report.cases.push({
      name: "P07 保存昵称等待被后续请求取代的身份刷新完成",
      status: "passed",
    });
    console.log("PASS account concurrent identity refresh");
    await page.unroute("**/api/auth/me");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("尚未确认的昵称草稿");
    await other.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    const external = await context.request.patch(baseURL + "/api/auth/me", {
      data: { name: "其他页面的最新昵称" },
      headers: { Origin: baseURL },
    });
    assert.ok(external.ok(), await external.text());
    for (let visit = 0; visit < 2; visit++) {
      await page.bringToFront();
      await expect(
        page.getByRole("button", { name: "继续使用草稿", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "保存", exact: true }),
      ).toBeDisabled();
      if (!visit) {
        await other.bringToFront();
        await expect
          .poll(() => page.evaluate(() => document.visibilityState))
          .toBe("hidden");
      }
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "尚未确认的昵称草稿",
    );
    await page
      .getByRole("button", { name: "继续使用草稿", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page
        .locator(".account-form")
        .getByText("尚未确认的昵称草稿", { exact: true }),
    ).toBeVisible();
    report.cases.push({
      name: "P07 昵称冲突经重复切回及刷新后保留，明确确认后才允许保存",
      status: "passed",
    });
    console.log("PASS account conflict requires explicit choice");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("提交后仍需核对的昵称");
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      const overwritten = await context.request.patch(
        baseURL + "/api/auth/me",
        {
          data: { name: "保存期间被其他页面更新" },
          headers: { Origin: baseURL },
        },
      );
      assert.ok(overwritten.ok(), await overwritten.text());
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "提交后仍需核对的昵称",
    );
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "提交后仍需核对的昵称",
    );
    report.cases.push({
      name: "P07 保存期间远端再次修改昵称时保留草稿与冲突选择",
      status: "passed",
    });
    console.log("PASS account overwritten response preserves draft");
    await page.unroute("**/api/auth/me");
    await page
      .getByRole("button", { name: "使用已保存的昵称", exact: true })
      .click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("重连后需要确认的草稿");
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const reconnected = await context.request.patch(baseURL + "/api/auth/me", {
      data: { name: "断网期间的远端昵称" },
      headers: { Origin: baseURL },
    });
    assert.ok(reconnected.ok(), await reconnected.text());
    await context.setOffline(false);
    await expect(
      page
        .locator(".portal-header")
        .getByText("断网期间的远端昵称", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    report.cases.push({
      name: "P07 页面保持可见时重连核对远端昵称并保留草稿",
      status: "passed",
    });
    console.log("PASS account reconnect detects conflict");
    await page
      .getByRole("button", { name: "使用已保存的昵称", exact: true })
      .click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .getByLabel("昵称", { exact: true })
      .fill("保存失败后仍保留的草稿");
    let reached;
    const writeStarted = new Promise((resolve) => {
      reached = resolve;
    });
    let finishWrite;
    const delayedFailure = new Promise((resolve) => {
      finishWrite = resolve;
      gates.push(resolve);
    });
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      reached();
      await delayedFailure;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "rate_limited", message: "请求频繁，请稍后重试。" },
        }),
      });
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await writeStarted;
    await other.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.visibilityState))
      .toBe("hidden");
    const whileSaving = await context.request.patch(baseURL + "/api/auth/me", {
      data: { name: "保存请求等待期间的远端昵称" },
      headers: { Origin: baseURL },
    });
    assert.ok(whileSaving.ok(), await whileSaving.text());
    await page.bringToFront();
    await expect(
      page
        .locator(".portal-header")
        .getByText("保存请求等待期间的远端昵称", { exact: true }),
    ).toBeVisible();
    finishWrite();
    await expect(
      page.getByRole("button", { name: "继续使用草稿", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
      "保存失败后仍保留的草稿",
    );
    report.cases.push({
      name: "P07 保存明确失败后采用忙碌期间收到的远端昵称并保留冲突",
      status: "passed",
    });
    console.log("PASS account rejected save applies concurrent identity");
  } catch (error) {
    report.failure = String(error.stack || error);
    throw error;
  } finally {
    gates.forEach((release) => release());
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      output + "/account-refresh.json",
      JSON.stringify(report, null, 2),
    );
    await native.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
