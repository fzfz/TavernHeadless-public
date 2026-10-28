const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { writeFile } = require("node:fs/promises");
const out = resolve(__dirname, "../../phase7-evidence");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  try {
    for (const platform of ["mobile", "desktop"]) {
      const context = await browser.newContext({
        viewport: { width: platform === "mobile" ? 430 : 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(4000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const base = `http://127.0.0.1:4180/phase7-prototype-${platform}.html`;
      const settled = () =>
        page.locator('#browse-results[aria-busy="false"]').waitFor();
      const scenario = (value) =>
        page.getByLabel("模拟状态", { exact: true }).selectOption(value);
      await page.goto(base);
      await settled();
      await page.screenshot({
        path: resolve(out, `${platform}-discover-light.png`),
      });
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await page.screenshot({
        path: resolve(out, `${platform}-discover-dark.png`),
      });
      assert.equal(
        await page
          .locator(".uw-button.uw-primary")
          .first()
          .evaluate((el) => getComputedStyle(el).color),
        "rgb(23, 45, 32)",
      );
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await scenario("append-failure");
      await settled();
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await settled();
      await page
        .getByText("更多角色加载失败，已读取的角色仍可浏览。", { exact: true })
        .waitFor();
      assert.equal(await page.locator("[data-role-card]").count(), 3);
      await page.getByRole("button", { name: "重试读取", exact: true }).click();
      await settled();
      assert.equal(await page.locator("[data-role-card]").count(), 6);
      await scenario("failure");
      await settled();
      await page
        .getByRole("heading", { name: "角色读取失败", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "重试读取", exact: true }).click();
      await settled();
      assert.equal(await page.locator("[data-role-card]").count(), 3);
      await scenario("empty");
      await settled();
      await page
        .getByRole("heading", { name: "暂无可浏览的角色", exact: true })
        .waitFor();
      await scenario("normal");
      await settled();
      const query = page.getByLabel("搜索角色", { exact: true });
      await query.fill("不会匹配");
      await query.dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
      });
      assert.equal(await page.locator("[data-role-card]").count(), 3);
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await settled();
      await page
        .getByRole("heading", { name: "没有符合条件的角色", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "重置筛选", exact: true })
        .first()
        .click();
      await settled();
      await scenario("slow");
      await query.fill("沈知微");
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await query.fill("弥拉");
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page
        .getByText("正在读取：全部 · “弥拉”…", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("[data-role-card]").count(),
        3,
        "更新条件时保留旧卡片",
      );
      await settled();
      assert.equal(await page.locator("[data-role-card]").count(), 1);
      assert.equal(
        await page.locator("[data-role-card]").getAttribute("data-role-card"),
        "c5",
      );
      await scenario("normal");
      await settled();
      await page
        .getByRole("button", { name: "重置筛选", exact: true })
        .first()
        .click();
      await settled();
      await context.setOffline(true);
      await settled();
      assert.equal(await page.locator("[data-role-card]").count(), 3);
      assert.equal(
        await page.locator('[href^="#start/"]').count(),
        0,
        "离线不可开始",
      );
      await context.setOffline(false);
      await settled();
      await page.getByRole("link", { name: "沈知微", exact: true }).click();
      await page
        .getByRole("heading", { name: "沈知微", level: 1, exact: true })
        .waitFor();
      await page.screenshot({
        path: resolve(out, `${platform}-detail-light.png`),
      });
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await page.screenshot({
        path: resolve(out, `${platform}-detail-dark.png`),
      });
      await scenario("blocked");
      await page
        .getByText("这个角色暂时无法开始演绎，可稍后重新读取。", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.locator("#detail-start").getAttribute("aria-disabled"),
        "true",
      );
      await scenario("image-failure");
      await page.getByText("封面暂未显示", { exact: true }).waitFor();
      await page.locator('#detail-start[href="#start/c1"]').waitFor();
      await scenario("longtext");
      await page.waitForFunction(
        () => document.querySelectorAll(".uw-story p").length === 12,
      );
      await page.locator("#detail-start[href]").waitFor();
      if (platform === "mobile") {
        assert.equal(
          await page.locator("#detail-start").evaluate((el) => {
            const r = el.getBoundingClientRect();
            const f = document
              .querySelector(".frame-body")
              .getBoundingClientRect();
            return r.top >= f.top && r.bottom <= f.bottom;
          }),
          true,
          "长文开始入口应留在手机底部",
        );
      }
      await page.locator("#detail-start").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `${platform}-longtext.png`) });
      await scenario("normal");
      await page.waitForFunction(
        () => document.querySelectorAll(".uw-story p").length === 1,
      );
      await context.setOffline(true);
      await page
        .getByText("连接恢复并加载角色资料后，即可开始演绎。", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#detail-start").getAttribute("aria-disabled"),
        "true",
      );
      await context.setOffline(false);
      await page.locator("#detail-start[href]").waitFor();
      await page.locator("#detail-start").click();
      await page
        .getByRole("button", { name: "使用演示账号体验", exact: true })
        .click();
      await page.locator(`[data-page-id="${platform === "mobile" ? "P14" : "P13"}"]`).waitFor();
      await page.getByRole("heading", { name: "沈知微", exact: true }).waitFor();
      assert(await page.getByRole("radio", { name: "开场 1", exact: true }).isChecked());
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await page.locator('#role-runtime-host[data-ready="true"]').waitFor();
      assert.equal(
        await page.locator(".uw-sidebar,.sidebar").count(),
        0,
        "演绎独立于站点导航",
      );
      await page.getByRole("link", { name: "返回历史", exact: true }).click();
      await page.goto(base + "#detail/c1");
      await page
        .getByRole("heading", { name: "沈知微", level: 1, exact: true })
        .waitFor();
      await scenario("missing");
      await page
        .getByRole("heading", { name: "页面无法访问", exact: true })
        .waitFor();
      assert.match(page.url(), /#unavailable\/c1$/);
      await page
        .getByRole("link", { name: "返回角色广场", exact: true })
        .click();
      await settled();
      await scenario("normal");
      await settled();
      for (const size of platform === "mobile"
        ? [
            { width: 320, height: 740 },
            { width: 390, height: 844 },
            { width: 844, height: 390 },
          ]
        : [
            { width: 1024, height: 768 },
            { width: 1440, height: 1000 },
          ]) {
        await page.setViewportSize(size);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${platform} ${size.width} 不应横向溢出`,
        );
        assert.equal(
          await page
            .locator("#browse-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
        );
      }
      assert.deepEqual(errors, []);
      results.push({
        platform,
        checks: [
          "浅深主题",
          "追加失败重试",
          "初次读取失败重试",
          "空集合与无匹配",
          "输入法",
          "并发查询与旧结果",
          "离线与恢复",
          "详情可用性",
          "封面失败",
          "长文",
          "登录目标恢复",
          "角色Runtime独立页面",
          "访问失效",
          "视口适配",
        ],
        status: "passed",
      });
      await context.close();
      const offline = await browser.newContext();
      await offline.route("http://**/*", (r) => r.abort());
      await offline.route("https://**/*", (r) => r.abort());
      const filePage = await offline.newPage();
      await filePage.goto(
        pathToFileURL(
          resolve(__dirname, `../../phase7-prototype-${platform}.html`),
        ).href,
      );
      await filePage.locator("[data-role-card]").first().waitFor();
      await offline.close();
    }
    await writeFile(
      resolve(out, "acceptance.json"),
      JSON.stringify({ results }, null, 2) + "\n",
    );
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
