const { chromium, expect } = require("playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_EVIDENCE || "/tmp/tavern-user-web-portal-evidence";
const report = { cases: [], startedAt: new Date().toISOString() };
async function check(name, action) {
  await action();
  report.cases.push({ name, status: "passed" });
  console.log("PASS " + name);
}
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const email = `recovery-${Date.now()}@example.test`,
    password = "Recovery-2026!";
  async function api(method, url, data) {
    const response = await context.request.fetch(base + "/api" + url, {
      method,
      data,
      headers: { Origin: base },
    });
    assert.ok(
      response.ok(),
      `${method} ${url} ${response.status()} ${await response.text()}`,
    );
    return response.json();
  }
  async function go(hash, heading) {
    await page.goto(base + "/#" + hash);
    if (heading)
      await expect(
        page.getByRole("heading", { name: heading, exact: true, level: 1 }),
      ).toBeVisible();
  }
  try {
    await api("POST", "/auth/register", { name: "恢复验收", email, password });
    await api("POST", "/auth/login", { email, password });
    const a = (
      await api("POST", "/users", {
        snapshot: {
          name: "顾青",
          description: "顾青，男性，31岁。古籍修复师，谨慎细致。",
        },
        operation_id: crypto.randomUUID(),
      })
    ).data;
    const b = (
      await api("POST", "/users", {
        snapshot: {
          name: "陆遥",
          description: "陆遥，女性，29岁。记者，善于观察。",
        },
        operation_id: crypto.randomUUID(),
      })
    ).data;
    await check("P12 并发修改显示冲突，保留草稿后按当前版本保存", async () => {
      await go("personas/edit/" + a.id, "编辑演绎人格");
      await page
        .getByLabel("完整人设描述", { exact: true })
        .fill("顾青，男性，31岁。古籍修复师，正在整理信件。");
      await api("PATCH", "/users/" + a.id, {
        expected_revision: a.revision,
        snapshot: {
          name: "顾青",
          description: "顾青，男性，31岁。古籍修复师，另一标签页补充了资料。",
        },
      });
      await page.getByRole("button", { name: "保存人格", exact: true }).click();
      await expect(
        page.getByText("此人格已更新，请核对当前保存的人设后再保存。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "保存人格", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "保留人设草稿", exact: true })
        .click();
      await page.getByRole("button", { name: "保存人格", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "演绎人格", exact: true, level: 1 }),
      ).toBeVisible();
      assert.equal(
        (await api("GET", "/users/" + a.id)).data.snapshot.description,
        "顾青，男性，31岁。古籍修复师，正在整理信件。",
      );
    });
    await check("P09 默认选择丢响应，刷新后读取已保存结果", async () => {
      let dropped = false;
      await page.route("**/api/auth/preferences", async (route) => {
        if (route.request().method() === "PATCH" && !dropped) {
          dropped = true;
          await route.fetch();
          await route.fulfill({
            status: 503,
            json: {
              error: { code: "proxy_unavailable", message: "连接暂时不可用" },
            },
          });
        } else await route.continue();
      });
      await page
        .getByRole("button", { name: "设为默认人格 陆遥", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "核对默认选择", exact: true }),
      ).toBeVisible();
      await page.unrouteAll({ behavior: "wait" });
      await page.reload();
      await page
        .getByRole("button", { name: "核对默认选择", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "陆遥 默认人格", exact: true }),
      ).toBeVisible();
    });
    await check(
      "P21 删除默认人格丢响应，关闭重开核对并回退剩余人格",
      async () => {
        let dropped = false;
        await page.route("**/api/users/" + b.id, async (route) => {
          if (route.request().method() === "DELETE" && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await page
          .getByRole("button", { name: "删除人格 陆遥", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "删除人格", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "核对删除结果", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "返回列表", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.unrouteAll({ behavior: "wait" });
        await page
          .getByRole("button", { name: "核对删除结果", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "核对删除结果", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "顾青 默认人格", exact: true }),
        ).toBeVisible();
      },
    );
    await check("P21 删除最后人格后默认为空，开始演绎引导创建", async () => {
      await page
        .getByRole("button", { name: "删除人格 顾青", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "删除人格", exact: true })
        .click();
      await expect(
        page.getByText("还没有演绎人格", { exact: true }),
      ).toBeVisible();
      await page.reload();
      assert.equal(
        (await api("GET", "/auth/me")).data.default_persona_id,
        null,
      );
      const role = (await api("GET", "/public/roles?limit=1")).data[0];
      await go("start/" + role.id);
      await expect(
        page.getByRole("button", { name: "创建演绎人格", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "开始演绎", exact: true }),
      ).toBeDisabled();
    });
    await check(
      "P07 昵称保存丢响应可核对，离线退出刷新不恢复私有页面",
      async () => {
        await go("account", "用户中心");
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        await page.getByLabel("昵称", { exact: true }).fill("恢复已确认");
        let dropped = false;
        await page.route("**/api/auth/me", async (route) => {
          if (route.request().method() === "PATCH" && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "核对保存结果", exact: true }),
        ).toBeVisible();
        await page.unrouteAll({ behavior: "wait" });
        await page
          .getByRole("button", { name: "核对保存结果", exact: true })
          .click();
        await expect(
          page.getByText("昵称已更新", { exact: true }),
        ).toBeVisible();
        await context.setOffline(true);
        await page
          .getByRole("button", { name: "退出登录", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "角色广场",
            exact: true,
            level: 1,
          }),
        ).toBeVisible();
        await context.setOffline(false);
        await page.reload();
        await go("account", "登录");
      },
    );
    await check("P09 分页、独立默认记录、编辑返回已加载范围", async () => {
      await page
        .getByRole("button", { name: "核对退出结果", exact: true })
        .click();
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .click();
      await page.getByLabel("邮箱", { exact: true }).fill(email);
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "用户中心", exact: true, level: 1 }),
      ).toBeVisible();
      const personas = [];
      for (let i = 0; i < 22; i++)
        personas.push(
          (
            await api("POST", "/users", {
              snapshot: {
                name: "分页人物" + i,
                description: `分页人物${i}，男性，30岁。档案管理员。`,
              },
              operation_id: crypto.randomUUID(),
            })
          ).data,
        );
      await api("PATCH", "/auth/preferences", {
        default_persona_id: personas[0].id,
      });
      await go("personas", "演绎人格");
      await expect(
        page.getByText("默认人格：分页人物0", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await page
        .getByRole("button", { name: "编辑 分页人物0", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "编辑演绎人格", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "编辑 分页人物0", exact: true }),
      ).toBeVisible();
      assert.equal(await page.locator(".persona-grid article").count(), 22);
    });
    await check("P22 已删除或不存在的人格显示恢复入口",async()=>{await go("personas/edit/missing-persona","编辑演绎人格");await expect(page.getByRole("heading",{name:"页面无法访问",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"保存人格",exact:true})).toHaveCount(0);await page.locator("main").getByRole("link",{name:"演绎人格",exact:true}).click();await expect(page.getByRole("heading",{name:"演绎人格",exact:true,level:1})).toBeVisible();});
    await page.screenshot({
      path: output + "/390-recovery-personas.png",
      fullPage: true,
    });
  } catch (error) {
    report.failure = String(error.stack || error);
    await page.screenshot({
      path: output + "/recovery-failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(
      output + "/portal-recovery.json",
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
