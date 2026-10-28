const { chromium, expect } = require("playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_EVIDENCE || "/tmp/tavern-user-web-portal-evidence";
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const other = await context.newPage();
  let release;
  const responseGate = new Promise((resolve) => {
    release = resolve;
  });
  let received;
  const responseReady = new Promise((resolve) => {
    received = resolve;
  });
  const report = { cases: [], startedAt: new Date().toISOString() };
  try {
    const email = `identity-race-${Date.now()}@example.test`;
    for (const [path, data] of [
      [
        "register",
        { email, name: "账号竞态验收", password: "Identity-Race-2026!" },
      ],
      ["login", { email, password: "Identity-Race-2026!" }],
    ]) {
      const response = await context.request.post(base + "/api/auth/" + path, {
        data,
        headers: { Origin: base },
      });
      assert.ok(response.ok(), await response.text());
    }
    await page.goto(base + "/#account");
    await other.goto(base + "/#account");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("延迟返回的昵称");
    await page.route("**/api/auth/me", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      received();
      await responseGate;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await responseReady;
    await other.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "核对退出结果", exact: true }),
    ).toHaveCount(0);
    let privateReloads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/users") privateReloads++;
    });
    const completed = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().endsWith("/auth/me"),
    );
    release();
    await completed;
    await page.waitForTimeout(250);
    await expect(
      page.getByRole("heading", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "用户中心", exact: true }),
    ).toHaveCount(0);
    assert.equal(privateReloads, 0, "迟到响应导致用户中心重新加载私有资料");
    assert.equal(
      (await context.request.get(base + "/api/auth/me")).status(),
      401,
    );
    for (const tab of [page, other]) {
      const privateDrafts = await tab.evaluate(() =>
        Object.keys(sessionStorage).filter(
          (key) =>
            /^user-web:[^:]+:(profile|persona|session)/.test(key) ||
            key.startsWith("tavern.user.chat:"),
        ),
      );
      assert.deepEqual(privateDrafts, [], "退出后重新写入了账号草稿");
    }
    report.cases.push({
      name: "P07/P08 另一标签页退出后，延迟昵称响应不能恢复原账号",
      status: "passed",
    });
    await page.screenshot({
      path: output + "/identity-race.png",
      fullPage: true,
    });
    console.log("PASS identity delayed response after logout");
  } catch (error) {
    report.failure = String(error.stack || error);
    throw error;
  } finally {
    release();
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      output + "/identity-race.json",
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
