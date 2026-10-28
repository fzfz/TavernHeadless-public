const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { root, baseURL } = require("./browser-fixtures.cjs");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const report = [];
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const waitCards = (n) =>
        page.waitForFunction(
          (count) => document.querySelectorAll(".role-card").length === count,
          n,
        );
      const checkedTag = (name) =>
        page.getByRole("radio", { name, exact: true });
      await page.goto(baseURL + "/#discover");
      await waitCards(12);
      assert.equal(await page.locator(".role-card h2 a").count(), 12);
      assert.equal(await page.locator(".role-card .cover-link").count(), 12);
      assert.equal(await page.locator(".role-card button.primary").count(), 12);
      await page.getByLabel("搜索角色", { exact: true }).fill("尚未提交的文字");
      await checkedTag("悬疑").check();
      await waitCards(7);
      assert.equal(
        await page.getByLabel("搜索角色", { exact: true }).inputValue(),
        "尚未提交的文字",
      );
      assert.ok(!new URL(page.url()).hash.includes("q="));
      await page.getByRole("button", { name: "重置筛选", exact: true }).click();
      await waitCards(12);
      await checkedTag("全部").focus();
      await page.keyboard.press("ArrowRight");
      await waitCards(7);
      assert.equal(
        await page.locator("input[name=role-category]:checked").count(),
        1,
      );
      await page.getByRole("button", { name: "重置筛选", exact: true }).click();
      await waitCards(12);
      await page
        .getByLabel("搜索角色", { exact: true })
        .fill("不存在的角色名称");
      await page.locator(".search-bar button").click();
      await waitCards(0);
      await page
        .getByRole("heading", { name: "没有符合筛选条件的角色" })
        .waitFor();
      await page
        .getByRole("button", { name: "重置筛选", exact: true })
        .first()
        .click();
      await waitCards(12);
      let failMore = true;
      await page.route("**/api/public/roles?**", async (route) => {
        const u = new URL(route.request().url());
        if (failMore && u.searchParams.get("offset") === "12") {
          failMore = false;
          await route.abort("failed");
        } else await route.continue();
      });
      await page.getByRole("button", { name: "加载更多", exact: true }).click();
      await page
        .getByRole("button", { name: "重新加载更多角色", exact: true })
        .waitFor();
      assert.equal(await page.locator(".role-card").count(), 12);
      await page.screenshot({
        path: `${root}/discover-${mobile ? "mobile" : "desktop"}-append-error.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "重新加载更多角色", exact: true })
        .click();
      await waitCards(14);
      assert.equal(
        new Set(
          await page
            .locator(".role-card")
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.roleId)),
        ).size,
        14,
      );
      await page.unroute("**/api/public/roles?**");
      const last = page.locator(".role-card").last();
      await last.scrollIntoViewIfNeeded();
      const roleId = await last.getAttribute("data-role-id");
      const beforeY = await page.evaluate(() => scrollY);
      await last.locator("h2 a").click();
      await page.locator(".detail-page .surface").first().waitFor();
      const choices = page.locator("input[name=preview-opening]");
      await choices.nth(1).check();
      const opening = await choices.nth(1).inputValue();
      await page.locator(".opening-preview").nth(1).locator("summary").click();
      assert.ok(
        (await page
          .locator(".opening-preview")
          .nth(1)
          .locator("details")
          .getAttribute("open")) !== null,
      );
      await page.screenshot({
        path: `${root}/discover-${mobile ? "mobile" : "desktop"}-detail.png`,
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "返回角色广场", exact: true })
        .first()
        .click();
      await waitCards(14);
      await page.waitForFunction((y) => Math.abs(scrollY - y) < 90, beforeY);
      await page.screenshot({
        path: `${root}/discover-${mobile ? "mobile" : "desktop"}-restored.png`,
        fullPage: true,
      });
      await page.locator(`.role-card[data-role-id="${roleId}"] h2 a`).click();
      await page.locator(".detail-page footer button").waitFor();
      await context.setOffline(true);
      await page.waitForFunction(
        () => document.querySelector(".detail-page footer button")?.disabled,
      );
      assert.ok(
        await page.locator(".detail-page .prose").first().textContent(),
      );
      await context.setOffline(false);
      await page.waitForFunction(
        () =>
          document.querySelector(".detail-page footer button") &&
          !document.querySelector(".detail-page footer button").disabled,
      );
      await page.getByRole("button", { name: "开始演绎", exact: true }).click();
      await page.getByRole("heading", { name: "登录", exact: true }).waitFor();
      const returnTarget = await page.evaluate(() =>
        sessionStorage.getItem("user-web:return"),
      );
      assert.ok(returnTarget.includes(`opening=${opening}`));
      await page
        .getByLabel("邮箱", { exact: true })
        .fill("reader-b@example.test");
      await page.getByLabel("密码", { exact: true }).fill("Reader-B-2026!");
      await page
        .getByRole("button", { name: "登录并继续", exact: true })
        .click();
      await page.waitForURL(/#start\//);
      await page.locator("input[name=opening]:checked").waitFor();
      assert.equal(
        await page.locator("input[name=opening]:checked").inputValue(),
        opening,
      );
      await page.goto(baseURL + "/#discover");
      await waitCards(14);
      await page.setViewportSize({ width: mobile ? 320 : 1024, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.setViewportSize({
        width: mobile ? 844 : 1440,
        height: mobile ? 390 : 1000,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(errors, []);
      report.push({
        platform: mobile ? "mobile" : "desktop",
        status: "PASS",
        initial: 12,
        total: 14,
        checks: [
          "title and cover detail links",
          "card start",
          "unapplied keyword remains draft when tag changes",
          "native radio arrow selection",
          "search and no match reset",
          "append failure preserves cards and retries same offset",
          "full catalogue pagination",
          "return restores loaded cards and scroll anchor",
          "opening preview selection and expansion",
          "offline cached reading and disabled start",
          "reconnect revalidation",
          "login returns selected role/opening",
          "narrow and landscape overflow",
          "browser errors none",
        ],
      });
      await context.close();
    }
    await fs.writeFile(
      `${root}/discover-acceptance.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
