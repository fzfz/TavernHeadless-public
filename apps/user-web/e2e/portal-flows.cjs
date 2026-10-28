const { chromium, expect } = require("playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.USER_WEB_URL || "http://127.0.0.1:4190";
const output =
  process.env.USER_WEB_EVIDENCE || "/tmp/tavern-user-web-portal-evidence";
const report = {
  base,
  startedAt: new Date().toISOString(),
  cases: [],
  screenshots: [],
};
async function check(name, action) {
  await action();
  report.cases.push({ name, status: "passed" });
  console.log("PASS " + name);
}
async function capture(page, name) {
  const file = path.join(output, name + ".png");
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
}
async function navigate(page, name) {
  await page
    .getByRole("navigation", { name: "角色演绎" })
    .filter({ visible: true })
    .getByRole("link", { name, exact: true })
    .click();
}
async function heading(page, name) {
  await expect(
    page.getByRole("heading", { name, exact: true, level: 1 }),
  ).toBeVisible();
}
async function createPersona(page, name, description) {
  await page.getByRole("button", { name: "创建演绎人格", exact: true }).click();
  await heading(page, "创建演绎人格");
  await page.getByLabel("人格姓名", { exact: true }).fill(name);
  await page.getByLabel("完整人设描述", { exact: true }).fill(description);
  await page.getByRole("button", { name: "保存人格", exact: true }).click();
  await heading(page, "演绎人格");
  await expect(
    page.getByRole("heading", { name: new RegExp(name) }),
  ).toBeVisible();
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  let currentPage;
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
          viewport: { width, height: 960 },
          reducedMotion: "reduce",
        }),
        page = await context.newPage();
      currentPage = page;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const email = `portal-${width}-${Date.now()}@example.test`,
        password = "Portal-Acceptance-2026!",
        nickname = `浏览器验收${width}`;
      await check(
        `${width} P05/P06 注册字段、显示密码、校验、返回与真实注册登录`,
        async () => {
          await page.goto(base + "/#auth");
          await heading(page, "登录");
          await page
            .getByRole("button", { name: "登录并继续", exact: true })
            .click();
          await expect(page.getByText("请填写此项").first()).toBeVisible();
          await page
            .getByRole("link", { name: "注册账号", exact: true })
            .click();
          await heading(page, "创建账号");
          await page.getByLabel("昵称", { exact: true }).fill(nickname);
          await page.getByLabel("邮箱", { exact: true }).fill(email);
          await page.getByLabel("密码", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "显示密码", exact: true })
            .click();
          await expect(
            page.getByLabel("密码", { exact: true }),
          ).toHaveAttribute("type", "text");
          await page.getByLabel("确认密码", { exact: true }).fill("mismatch");
          await page
            .getByRole("button", { name: "创建账号", exact: true })
            .click();
          await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
          await page.getByLabel("确认密码", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "显示确认密码", exact: true })
            .click();
          await expect(
            page.getByLabel("确认密码", { exact: true }),
          ).toHaveAttribute("type", "text");
          await capture(page, `${width}-P06-register`);
          await page
            .getByRole("button", { name: "创建账号", exact: true })
            .click();
          await heading(page, "登录");
          await expect(page.getByLabel("密码", { exact: true })).toHaveValue(
            "",
          );
          await page.getByLabel("密码", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "登录并继续", exact: true })
            .click();
          await heading(page, "用户中心");
          await expect(page.getByText(email, { exact: true })).toBeVisible();
        },
      );
      await check(
        `${width} P07/P08 本人资料、真实数量、昵称取消及保存`,
        async () => {
          await expect(
            page.getByRole("link", { name: /演绎人格 →/ }),
          ).toContainText("0 个人格");
          await expect(
            page.getByRole("link", { name: /历史演绎 →/ }),
          ).toContainText("0 段演绎");
          await page.getByRole("button", { name: "编辑", exact: true }).click();
          await page.getByLabel("昵称", { exact: true }).fill("取消的昵称");
          await page.getByRole("button", { name: "取消", exact: true }).click();
          await expect(
            page.getByText(nickname, { exact: true }).last(),
          ).toBeVisible();
          await page.getByRole("button", { name: "编辑", exact: true }).click();
          await page
            .getByLabel("昵称", { exact: true })
            .fill(nickname + "已保存");
          await page.getByRole("button", { name: "保存", exact: true }).click();
          await expect(
            page.getByText("昵称已更新", { exact: true }),
          ).toBeVisible();
          await capture(page, `${width}-P07-account`);
        },
      );
      await check(
        `${width} P09–P12 多个人格、默认、完整描述与编辑快照`,
        async () => {
          await navigate(page, "演绎人格");
          await heading(page, "演绎人格");
          await expect(
            page.getByText("还没有演绎人格", { exact: true }),
          ).toBeVisible();
          await createPersona(
            page,
            "裴修远",
            "裴修远，男性，28岁。旧城书店的修复师，沉稳细致，随身带着一封未拆开的信。",
          );
          await expect(
            page.getByRole("heading", { name: "裴修远 默认人格" }),
          ).toBeVisible();
          await createPersona(
            page,
            "林见月",
            "林见月，女性，30岁。城市档案整理员，耐心谨慎，擅长从旧档案中寻找线索。",
          );
          await page
            .getByRole("button", { name: "设为默认人格 林见月", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "林见月 默认人格" }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "编辑 裴修远", exact: true })
            .click();
          await heading(page, "编辑演绎人格");
          await expect(
            page.getByLabel("完整人设描述", { exact: true }),
          ).toHaveValue(/28岁/);
          await page
            .getByLabel("完整人设描述", { exact: true })
            .fill(
              "裴修远，男性，28岁。旧城书店修复师，沉稳细致。当前正在寻找信封上的地址。",
            );
          await capture(page, `${width}-P12-edit-persona`);
          await page
            .getByRole("button", { name: "保存人格", exact: true })
            .click();
          await heading(page, "演绎人格");
          await capture(page, `${width}-P09-personas`);
        },
      );
      await check(`${width} P11 草稿离开、恢复与放弃`, async () => {
        await page
          .getByRole("button", { name: "创建演绎人格", exact: true })
          .click();
        await heading(page, "创建演绎人格");
        await page.getByLabel("人格姓名", { exact: true }).fill("草稿人物");
        await page
          .getByLabel("完整人设描述", { exact: true })
          .fill("此人物用于验收未保存草稿。");
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByRole("button", { name: "继续填写", exact: true })
          .click();
        await expect(page.getByLabel("人格姓名", { exact: true })).toHaveValue(
          "草稿人物",
        );
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await page
          .getByRole("button", { name: "保留草稿并离开", exact: true })
          .click();
        await heading(page, "演绎人格");
        await page
          .getByRole("button", { name: "创建演绎人格", exact: true })
          .click();
        await heading(page, "创建演绎人格");
        await expect(page.getByLabel("人格姓名", { exact: true })).toHaveValue(
          "草稿人物",
        );
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await page
          .getByRole("button", { name: "放弃草稿并离开", exact: true })
          .click();
        await heading(page, "演绎人格");
        await page
          .getByRole("button", { name: "创建演绎人格", exact: true })
          .click();
        await heading(page, "创建演绎人格");
        await expect(page.getByLabel("人格姓名", { exact: true })).toHaveValue(
          "",
        );
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await heading(page, "演绎人格");
      });
      await check(`${width} 人格创建丢响应后幂等核对`, async () => {
        let dropped = false;
        await page.route("**/api/users", async (route) => {
          if (route.request().method() === "POST" && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await page
          .getByRole("button", { name: "创建演绎人格", exact: true })
          .click();
        await heading(page, "创建演绎人格");
        await page.getByLabel("人格姓名", { exact: true }).fill("核对人物");
        await page
          .getByLabel("完整人设描述", { exact: true })
          .fill("核对人物，男性，32岁。负责整理港口来信的邮递员。");
        await page
          .getByRole("button", { name: "保存人格", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "核对保存结果", exact: true }),
        ).toBeVisible();
        await page.unrouteAll({ behavior: "wait" });
        await page
          .getByRole("button", { name: "核对保存结果", exact: true })
          .click();
        await heading(page, "演绎人格");
        await expect(
          page.getByRole("heading", { name: "核对人物", exact: true }),
        ).toHaveCount(1);
      });
      let sessionId;
      await check(
        `${width} P13/P14 角色开场与本人默认人格创建真实会话`,
        async () => {
          await navigate(page, "角色广场");
          await heading(page, "角色广场");
          await page.getByLabel("搜索角色", { exact: true }).fill("旧城夜话");
          await page.getByRole("button", { name: "搜索", exact: true }).click();
          await page
            .getByRole("link", { name: /旧城夜话/ })
            .first()
            .click();
          await page
            .getByRole("button", { name: "开始演绎", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: /开始演绎 · 旧城夜话/ }),
          ).toBeVisible();
          await expect(
            page.getByRole("radio", { name: /林见月/ }),
          ).toBeChecked();
          await page.getByRole("radio", { name: /裴修远/ }).check();
          await capture(page, `${width}-P13-start`);
          await page
            .getByRole("button", { name: "开始演绎", exact: true })
            .click();
          await expect(page).toHaveURL(/#chat\//);
          sessionId = new URL(page.url()).hash.slice(6).split("?")[0];
          await expect(
            page.getByRole("button", { name: "演绎设置", exact: true }),
          ).toBeVisible();
          assert.equal(await page.locator(".portal-sidebar").count(), 0);
          assert.equal(await page.locator(".mobile-nav").count(), 0);
          await capture(page, `${width}-P17-session`);
        },
      );
      await check(
        `${width} P19/P20 设置往返、完整固定人设、标题保存`,
        async () => {
          await page
            .getByRole("button", { name: "演绎设置", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page
            .getByLabel("演绎标题", { exact: true })
            .fill("浏览器完整演绎验收");
          await page
            .getByRole("button", { name: "查看完整人设", exact: true })
            .click();
          await expect(
            page.getByText(
              "裴修远，男性，28岁。旧城书店修复师，沉稳细致。当前正在寻找信封上的地址。",
              { exact: true },
            ),
          ).toBeVisible();
          await capture(page, `${width}-P20-snapshot`);
          await page
            .getByRole("button", { name: "返回演绎设置", exact: true })
            .click();
          await expect(
            page.getByLabel("演绎标题", { exact: true }),
          ).toHaveValue("浏览器完整演绎验收");
          await capture(page, `${width}-P19-settings`);
          await page
            .getByRole("button", { name: "保存名称", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await heading(page, "浏览器完整演绎验收");
        },
      );
      await check(`${width} P21 删除人格确认、取消、固定快照保留`, async () => {
        await page
          .getByRole("link", { name: "返回历史演绎", exact: true })
          .click();
        await heading(page, "历史演绎");
        await navigate(page, "演绎人格");
        await heading(page, "演绎人格");
        await page
          .getByRole("button", { name: "删除人格 裴修远", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "删除人格" }),
        ).toBeVisible();
        await capture(page, `${width}-P21-delete-persona`);
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "裴修远", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "删除人格 裴修远", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "删除人格", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "裴修远", exact: true }),
        ).toHaveCount(0);
        await page.goto(base + "/#chat/" + sessionId);
        await page
          .getByRole("button", { name: "演绎设置", exact: true })
          .click();
        await page
          .getByRole("button", { name: "查看完整人设", exact: true })
          .click();
        await expect(
          page.getByText(/当前正在寻找信封上的地址。/),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "返回演绎设置", exact: true })
          .click();
        await page.getByRole("button", { name: "关闭", exact: true }).click();
      });
      await check(`${width} P22 无法访问、恢复入口及双主题窄屏`, async () => {
        await page.goto(base + "/#chat/missing-session");
        await expect(
          page.getByRole("heading", { name: "页面无法访问", exact: true }),
        ).toBeVisible();
        await capture(page, `${width}-P22-unavailable`);
        await page
          .getByRole("link", { name: "返回历史演绎", exact: true })
          .last()
          .click();
        await heading(page, "历史演绎");
        await page.getByLabel("外观", { exact: true }).selectOption("dark");
        await capture(page, `${width}-dark-history`);
        await page.getByLabel("外观", { exact: true }).selectOption("light");
        for (const size of [320, 390, 844, 1440]) {
          await page.setViewportSize({ width: size, height: 844 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `overflow at ${size}`,
          );
        }
        await page.setViewportSize({ width, height: 960 });
      });
      await check(`${width} 退出登录、会话访问隔离和账号空数据`, async () => {
        await navigate(page, "用户中心");
        await heading(page, "用户中心");
        await page
          .getByRole("button", { name: "退出登录", exact: true })
          .click();
        await heading(page, "角色广场");
        await page.goto(base + "/#chat/" + sessionId);
        await heading(page, "登录");
        await page
          .getByRole("button", { name: "登录并继续", exact: true })
          .click();
        await heading(page, "登录");
        await page
          .getByLabel("邮箱", { exact: true })
          .fill("reader-b@example.test");
        await page.getByLabel("密码", { exact: true }).fill("Reader-B-2026!");
        await page
          .getByRole("button", { name: "登录并继续", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "页面无法访问", exact: true }),
        ).toBeVisible();
      });
      assert.deepEqual(errors, []);
      report.cases.push({
        name: `${width} 浏览器未捕获异常`,
        status: "passed",
      });
      await context.close();
    }
  } catch (error) {
    if (currentPage && !currentPage.isClosed())
      await capture(currentPage, "failure");
    throw error;
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(output, "portal-acceptance.json"),
      JSON.stringify(report, null, 2),
    );
  }
})().catch(async (error) => {
  report.failure = String(error.stack || error);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, "portal-acceptance.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
});
