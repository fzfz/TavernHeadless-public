const { chromium, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { launchNativeChrome, baseURL } = require("./browser-fixtures.cjs");
const evidence =
  process.env.USER_WEB_EVIDENCE || "/tmp/tavern-auth-recovery-evidence";
const report = { cases: [], startedAt: new Date().toISOString() };
const registrationKey = "user-web:registration-pending";
const endpoint = "**/api/auth/register";
const resolveEndpoint = "**/api/auth/register/operations/resolve";
const password = "Recovery-2026!";
async function check(name, action) {
  await action();
  report.cases.push({ name, status: "passed" });
  console.log("PASS " + name);
}
(async () => {
  const native = await launchNativeChrome(chromium);
  const context = await native.browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  let postCount = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/auth/register" &&
      request.method() === "POST"
    )
      postCount++;
  });
  async function fill(label) {
    await page.goto(baseURL + "/#register");
    await expect(
      page.getByRole("heading", { name: "创建账号", exact: true }),
    ).toBeVisible();
    await page.getByLabel("昵称", { exact: true }).fill("注册恢复验收");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(`register-${label}-${Date.now()}@example.test`);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByLabel("确认密码", { exact: true }).fill(password);
  }
  async function assertPending() {
    await expect(
      page.getByRole("button", { name: "核对注册结果", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "创建账号", exact: true }),
    ).toBeDisabled();
    const saved = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)),
      registrationKey,
    );
    assert.ok(saved.operationId);
    assert.ok(saved.email);
    assert.equal(JSON.stringify(saved).includes(password), false);
    assert.equal(
      Object.keys(saved).some((key) => /password|confirmation/i.test(key)),
      false,
    );
  }
  try {
    await check(
      "P06 丢失创建响应后保留操作凭据，离开再进入先核对已有结果",
      async () => {
        await fill("leave");
        await page.route(endpoint, async (route) => {
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          await route.abort("failed");
        });
        await page
          .getByRole("button", { name: "创建账号", exact: true })
          .click();
        await assertPending();
        const count = postCount;
        await page.getByRole("link", { name: "返回登录", exact: true }).click();
        await page.getByRole("link", { name: "注册账号", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "登录", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("账号已创建，请登录", { exact: true }),
        ).toBeVisible();
        assert.equal(postCount, count);
        assert.equal(
          await page.evaluate(
            (key) => sessionStorage.getItem(key),
            registrationKey,
          ),
          null,
        );
        await page.unroute(endpoint);
      },
    );
    await check(
      "P06 创建请求尚未返回时离开，返回后核对原请求并清理密码",
      async () => {
        await fill("in-flight");
        let releaseResponse;
        let savedResponse;
        const held = new Promise((resolve) => {
          releaseResponse = resolve;
        });
        const saved = new Promise((resolve) => {
          savedResponse = resolve;
        });
        await page.route(endpoint, async (route) => {
          const response = await route.fetch();
          assert.equal(response.status(), 201);
          savedResponse();
          await held;
          await route.abort("failed").catch(() => {});
        });
        try {
          await page
            .getByRole("button", { name: "创建账号", exact: true })
            .click();
          await saved;
          const count = postCount;
          await page
            .getByRole("link", { name: "返回登录", exact: true })
            .click();
          await expect(page.getByLabel("密码", { exact: true })).toHaveValue(
            "",
          );
          await page
            .getByRole("link", { name: "注册账号", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "登录", exact: true }),
          ).toBeVisible();
          assert.equal(postCount, count);
        } finally {
          releaseResponse();
          await page.unroute(endpoint);
        }
      },
    );
    await check(
      "P06 刷新后核对失败仍锁定提交，读取恢复后确认原注册",
      async () => {
        await fill("refresh");
        await page.route(endpoint, async (route) => {
          await route.fetch();
          await route.abort("failed");
        });
        await page.route(resolveEndpoint, (route) => route.abort("failed"));
        await page
          .getByRole("button", { name: "创建账号", exact: true })
          .click();
        await assertPending();
        const count = postCount;
        await page.reload();
        await assertPending();
        await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
        await page.unroute(resolveEndpoint);
        await page
          .getByRole("button", { name: "核对注册结果", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "登录", exact: true }),
        ).toBeVisible();
        assert.equal(postCount, count);
        await page.unroute(endpoint);
      },
    );
    await check(
      "P06 确认未创建后允许重新填写密码并提交一次新请求",
      async () => {
        await fill("not-created");
        await page.route(endpoint, (route) => route.abort("failed"));
        await page
          .getByRole("button", { name: "创建账号", exact: true })
          .click();
        await assertPending();
        const original = await page.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key)),
          registrationKey,
        );
        await page.unroute(endpoint);
        await page.reload();
        await expect(
          page.getByText("账号尚未创建，请核对资料后重新提交。", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "创建账号", exact: true }),
        ).toBeEnabled();
        await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
        await page.getByLabel("密码", { exact: true }).fill(password);
        await page.getByLabel("确认密码", { exact: true }).fill(password);
        const submitted = page.waitForRequest(
          (request) => new URL(request.url()).pathname === "/api/auth/register",
        );
        await page
          .getByRole("button", { name: "创建账号", exact: true })
          .click();
        const request = await submitted;
        assert.notEqual(
          request.postDataJSON().operation_id,
          original.operationId,
        );
        await expect(
          page.getByRole("heading", { name: "登录", exact: true }),
        ).toBeVisible();
      },
    );
    await fs.mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: evidence + "/registration-recovered.png",
      fullPage: true,
    });
  } catch (error) {
    report.failure = String(error.stack || error);
    await fs.mkdir(evidence, { recursive: true });
    await page
      .screenshot({ path: evidence + "/failure.png", fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(
      evidence + "/report.json",
      JSON.stringify(report, null, 2),
    );
    await context.close();
    await native.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
