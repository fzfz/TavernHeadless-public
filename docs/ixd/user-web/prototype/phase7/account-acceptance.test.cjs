const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const evidence = path.resolve(__dirname, "../../phase7-evidence");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  try {
    for (const platform of ["mobile", "desktop"]) {
      const context = await browser.newContext({
        viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const url = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      const button = (name) => page.getByRole("button", { name, exact: true });
      const input = (name) => page.getByLabel(name, { exact: true });
      const scenario = (value) =>
        page.locator("#review-scenario").selectOption(value);
      const go = async (route) => {
        await page.evaluate((route) => (location.hash = route), route);
        await page.waitForURL(`**#${route}`);
      };
      const login = async () => {
        await go("auth");
        await button("使用演示账号体验").click();
        await page.waitForURL("**#account");
      };
      const accountId = platform === "mobile" ? "P08" : "P07";
      await page.goto(url + "#account");
      await page.locator('[data-page-id="P05"]').waitFor();
      await input("邮箱").fill("traveler@example.com");
      await input("密码").fill("secret-in-memory-only");
      await input("密码").dispatchEvent("keydown", {
        key: "Enter",
        isComposing: true,
      });
      assert.equal(new URL(page.url()).hash, "#auth");
      for (const [state, message] of [
        ["credentials", "邮箱或密码不正确"],
        ["network", "连接失败，请重试"],
        ["offline", "当前离线，请连接网络后再登录。"],
      ]) {
        await scenario(state);
        await button("登录并继续").click();
        await page
          .locator("#app")
          .getByText(message, { exact: true })
          .waitFor();
        assert.equal(await input("密码").inputValue(), "secret-in-memory-only");
      }
      await scenario("unknown");
      await button("登录并继续").click();
      await button("重新核对登录状态").waitFor();
      const storage = await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      );
      assert(!storage.includes("secret-in-memory-only"));
      await page.reload();
      await button("重新核对登录状态").waitFor();
      assert.equal(await input("密码").inputValue(), "");
      await scenario("check-failure");
      await button("重新核对登录状态").click();
      await page
        .getByText("登录状态读取失败，请检查连接后重试。", { exact: true })
        .waitFor();
      await scenario("normal");
      await button("重新核对登录状态").click();
      await page.locator(`[data-page-id="${accountId}"]`).waitFor();
      await page
        .getByRole("link", { name: "演绎人格 2 个人格", exact: true })
        .waitFor();
      results.push({
        platform,
        check: "登录校验、离线保留、待确认刷新、密码仅驻留内存",
        result: "pass",
      });
      await scenario("counts-loading");
      await page.getByText("正在读取…", { exact: true }).first().waitFor();
      await scenario("counts-failure");
      await page
        .getByRole("link", { name: "演绎人格 数量暂不可用", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "历史演绎 2 段演绎", exact: true })
        .waitFor();
      await button("重新读取数量").click();
      await scenario("profile-loading");
      await page.getByRole("heading", { name: "正在读取账号资料…" }).waitFor();
      await scenario("profile-failure");
      await button("重新读取资料").click();
      await button("编辑昵称").waitFor();
      await button("编辑昵称").click();
      await input("昵称").fill("保留的草稿");
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link", { name: "角色广场" })
        .click();
      await page.getByRole("dialog", { name: "离开昵称编辑？" }).waitFor();
      assert.equal(new URL(page.url()).hash, "#account");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.locator(":focus").textContent(),
        "离开并保留草稿",
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link", { name: "角色广场" })
        .click();
      await button("离开并保留草稿").click();
      await page.waitForURL("**#discover");
      await go("account");
      await page.getByRole("dialog", { name: "恢复昵称草稿？" }).waitFor();
      await button("恢复草稿").click();
      assert.equal(await input("昵称").inputValue(), "保留的草稿");
      await page.reload();
      await button("恢复草稿").click();
      assert.equal(await input("昵称").inputValue(), "保留的草稿");
      await input("昵称").fill("");
      await button("保存昵称").click();
      await page.getByText("请填写昵称。", { exact: true }).waitFor();
      await input("昵称").fill("雨中旅人");
      await scenario("network");
      await button("保存昵称").click();
      await page.getByText("昵称保存失败，请重试。", { exact: true }).waitFor();
      assert.equal(await input("昵称").inputValue(), "雨中旅人");
      await scenario("offline");
      await button("保存昵称").click();
      await page
        .getByText("当前离线，请连接网络后再保存昵称。", { exact: true })
        .waitFor();
      await scenario("unknown");
      await button("保存昵称").click();
      await button("核对保存结果").waitFor();
      await scenario("check-failure");
      await button("核对保存结果").click();
      await page
        .getByText("昵称读取失败，请检查连接后重试。", { exact: true })
        .waitFor();
      await scenario("normal");
      await button("核对保存结果").click();
      await page
        .getByRole("heading", { name: "雨中旅人", exact: true })
        .waitFor();
      assert.equal(await page.locator(":focus").textContent(), "编辑昵称");
      await button("编辑昵称").click();
      await input("昵称").fill("取消的昵称");
      await page.keyboard.press("Escape");
      await page
        .getByRole("heading", { name: "雨中旅人", exact: true })
        .waitFor();
      results.push({
        platform,
        check:
          "资料和计数局部失败、离开确认、焦点循环、刷新恢复、昵称错误和结果核对",
        result: "pass",
      });
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") {
          await button("深色主题").click();
          await page.waitForTimeout(200);
        }
        await page.screenshot({
          path: path.join(evidence, `${platform}-account-${theme}.png`),
          fullPage: true,
        });
      }
      await button("深色主题").click();
      // Storage events reflect another tab's current identity before showing protected data.
      const other = await context.newPage();
      await other.goto(url + "#account");
      await other
        .getByRole("button", { name: "退出登录", exact: true })
        .click();
      await page.locator('[data-page-id="P05"]').waitFor();
      assert(!(await page.locator("#app").innerText()).includes("雨中旅人"));
      await other.close();
      await scenario("slow");
      await button("使用演示账号体验").click();
      await page.getByText("正在登录…", { exact: true }).waitFor();
      await page
        .getByRole("link", { name: "返回角色广场", exact: true })
        .click();
      await page.waitForTimeout(1600);
      assert.equal(new URL(page.url()).hash, "#discover");
      await go("auth");
      await page.getByRole("link", { name: "注册账号", exact: true }).click();
      await page.locator('[data-page-id="P06"]').waitFor();
      await input("昵称").fill("新旅人");
      await input("邮箱").fill(`${platform}@example.com`);
      await input("密码").fill("temporary-password");
      await input("确认密码").fill("temporary-password");
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") {
          await button("深色主题").click();
          await page.waitForTimeout(200);
        }
        await page.screenshot({
          path: path.join(evidence, `${platform}-register-${theme}.png`),
          fullPage: true,
        });
      }
      await button("深色主题").click();
      await scenario("unknown");
      await button("创建账号").click();
      await button("核对注册结果").waitFor();
      assert(await button("创建账号").isDisabled());
      await page.reload();
      await button("核对注册结果").waitFor();
      assert.equal(await input("密码").inputValue(), "");
      await scenario("check-failure");
      await button("核对注册结果").click();
      await page
        .getByText("注册结果读取失败，请检查连接后重试。", { exact: true })
        .waitFor();
      await scenario("normal");
      await button("核对注册结果").click();
      await page.getByText("账号已创建，请登录", { exact: true }).waitFor();
      assert.equal(await input("邮箱").inputValue(), `${platform}@example.com`);
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") {
          await button("深色主题").click();
          await page.waitForTimeout(200);
        }
        await page.screenshot({
          path: path.join(evidence, `${platform}-login-${theme}.png`),
          fullPage: true,
        });
      }
      await button("深色主题").click();
      await input("密码").fill("temporary-password");
      await button("登录并继续").click();
      await page.waitForTimeout(250);
      await go("account");
      await page
        .getByRole("link", { name: "演绎人格 0 个人格", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "历史演绎 0 段演绎", exact: true })
        .waitFor();
      assert(!(await page.locator("#app").innerText()).includes("雨中旅人"));
      await scenario("logout-unknown");
      await button("退出登录").click();
      await page.waitForURL("**#discover");
      await button("核对退出结果").click();
      await page
        .getByText("已确认当前模拟账号退出。", { exact: true })
        .waitFor();
      await go("account");
      await page.locator('[data-page-id="P05"]').waitFor();
      results.push({
        platform,
        check:
          "跨标签页退出、迟到响应、注册结果刷新核对、新账号空集合、账号隔离和退出结果核对",
        result: "pass",
      });
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(evidence, "batch2-acceptance.json"),
      JSON.stringify(results, null, 2),
    );
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
