const { chromium, expect } = require("playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const {
  root,
  baseURL,
  origin,
  apiURL,
  fixture,
  launchNativeChrome,
} = require("./browser-fixtures.cjs");
const report = { cases: [] };
async function run(platform, scenario) {
  const native = await launchNativeChrome(chromium),
    browser = native.browser,
    context = browser.contexts()[0],
    page = context.pages()[0];
  await page.setViewportSize(
    platform === "desktop"
      ? { width: 1440, height: 1000 }
      : { width: 390, height: 844 },
  );
  async function call(method, path, data, admin = false) {
    if (admin) {
      const response = await fetch(apiURL + path, {
        method,
        headers: {
          Origin: origin,
          Authorization: "Bearer " + process.env.USER_WEB_ADMIN_KEY,
          "Content-Type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const body = await response.json();
      assert.ok(
        response.ok,
        `${method} ${path}: ${response.status} ${JSON.stringify(body)}`,
      );
      return body;
    }
    const response = await context.request.fetch(baseURL + "/api" + path, {
      method,
      data,
      headers: { Origin: origin },
    });
    assert.ok(
      response.ok(),
      `${method} ${path}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  let restoredRole;
  try {
    const credentials = {
      email: `start-${scenario}-${platform}-${Date.now()}@example.test`,
      password: "Start-Recovery-2026!",
      name: "开始演绎验收",
    };
    await call("POST", "/auth/register", credentials);
    await call("POST", "/auth/login", credentials);
    const persona = (
      await call("POST", "/users", {
        snapshot: {
          name: "江宁",
          description: "江宁，女性，二十七岁，旧城信件整理员，耐心谨慎。",
        },
      })
    ).data;
    const role =
      fixture.roles.find((item) => item.name === "雾港档案 12") ||
      fixture.roles.find((item) => item.mode === "system_chat");
    await page.goto(baseURL + "/#start/" + role.id);
    await expect(page.getByRole("radio", { name: /江宁/ })).toBeVisible();
    await page.getByRole("radio", { name: /江宁/ }).check();
    await expect(
      page.getByRole("button", { name: "开始演绎", exact: true }),
    ).toBeEnabled();
    if (scenario === "receipt") {
      let writes = 0,
        sessionId;
      await page.route("**/api/public/roles/*/sessions", async (route) => {
        writes++;
        const actual = await route.fetch();
        assert.equal(actual.status(), 201);
        sessionId = (await actual.json()).data.session.id;
        await route.abort("failed");
      });
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "核对创建结果", exact: true }),
      ).toBeVisible();
      await page.unrouteAll({ behavior: "wait" });
      await call("DELETE", "/users/" + persona.id);
      await page.reload();
      await expect(page.getByRole("radio", { name: /江宁/ })).toHaveCount(0);
      await page
        .getByRole("button", { name: "核对创建结果", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp("#chat/" + sessionId), {
        timeout: 7000,
      });
      assert.equal(writes, 1);
      assert.equal((await call("GET", "/sessions")).meta.total, 1);
    } else if (scenario === "cas") {
      const revised = "江宁，女性，二十七岁，旧城信件整理员，熟悉港区地图。";
      let writes = 0,
        sessionId;
      await page.route("**/api/public/roles/*/sessions", async (route) => {
        writes++;
        assert.equal(
          route.request().postDataJSON().expected_user_revision,
          writes === 1 ? persona.revision : persona.revision + 1,
        );
        if (writes === 1)
          await call("PATCH", "/users/" + persona.id, {
            expected_revision: persona.revision,
            snapshot: { name: "江宁", description: revised },
          });
        const actual = await route.fetch();
        assert.equal(actual.status(), writes === 1 ? 409 : 201);
        if (writes !== 1) sessionId = (await actual.json()).data.session.id;
        await route.fulfill({ response: actual });
      });
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await expect(
        page.getByText("演绎人格资料已更新，请查看最新人设并重新确认。", {
          exact: true,
        }),
      ).toBeVisible();
      assert.equal((await call("GET", "/sessions")).meta.total, 0);
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeDisabled();
      await page.getByText("查看完整人设", { exact: true }).click();
      await expect(page.locator(".prose").first()).toContainText(
        "熟悉港区地图",
      );
      await page
        .getByRole("button", { name: "确认使用当前资料", exact: true })
        .click();
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await expect(page).toHaveURL(/#chat\//);
      assert.equal(writes, 2);
      assert.equal(
        (await call("GET", "/sessions/" + sessionId)).data.user_binding.snapshot
          .description,
        revised,
      );
    } else {
      const updated =
        "江宁，女性，二十七岁，旧城信件整理员，行动果断，熟悉港区地图。";
      await page.getByText("查看完整人设", { exact: true }).click();
      await expect(page.locator(".prose").first()).toContainText("耐心谨慎");
      await call("PATCH", "/users/" + persona.id, {
        snapshot: { name: "江宁", description: updated },
        expected_revision: persona.revision,
      });
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      await page.waitForFunction(
        () => document.visibilityState === "hidden",
        undefined,
        { polling: 100 },
      );
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
      await page.bringToFront();
      await expect(page.locator(".prose").first()).toContainText("行动果断", {
        timeout: 7000,
      });
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "确认使用当前资料", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeEnabled();
      await context.setOffline(true);
      await call("DELETE", "/users/" + persona.id);
      await context.setOffline(false);
      await expect(
        page.getByText("选中的演绎人格已不可用，请重新选择。", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeDisabled();
      assert.ok(
        process.env.USER_WEB_ADMIN_KEY,
        "Set USER_WEB_ADMIN_KEY to the isolated fixture seed administrator key.",
      );
      await call(
        "PUT",
        "/role-releases/" + role.id + "/publication",
        { active: false },
        true,
      );
      restoredRole = role.id;
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      await page.waitForFunction(
        () => document.visibilityState === "hidden",
        undefined,
        { polling: 100 },
      );
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
      await page.bringToFront();
      await expect(
        page.getByText("这个角色已停止发布，请返回角色广场重新选择。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeDisabled();
      await call(
        "PUT",
        "/role-releases/" + role.id + "/publication",
        { active: true },
        true,
      );
      restoredRole = undefined;
      await cdp.detach();
    }
    report.cases.push({ platform, scenario, status: "passed" });
    await page.screenshot({
      path: root + `/start-${platform}-${scenario}.png`,
      fullPage: true,
    });
    console.log("PASS", platform, scenario);
  } catch (error) {
    report.cases.push({
      platform,
      scenario,
      status: "failed",
      error: String(error),
    });
    await page.screenshot({
      path: root + `/start-${platform}-${scenario}-failure.png`,
      fullPage: true,
    });
    console.error("FAIL", platform, scenario, String(error));
  } finally {
    if (restoredRole)
      await call(
        "PUT",
        "/role-releases/" + restoredRole + "/publication",
        { active: true },
        true,
      );
    await native.close();
  }
}
(async () => {
  const platforms = process.env.USER_WEB_PLATFORM
    ? [process.env.USER_WEB_PLATFORM]
    : ["desktop", "mobile"];
  const scenarios = process.env.USER_WEB_START_CASE
    ? [process.env.USER_WEB_START_CASE]
    : ["receipt", "freshness", "cas"];
  for (const platform of platforms)
    for (const scenario of scenarios) await run(platform, scenario);
  await fs.writeFile(
    root + "/start-recovery.json",
    JSON.stringify(report, null, 2),
  );
  if (report.cases.some((item) => item.status !== "passed"))
    process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
