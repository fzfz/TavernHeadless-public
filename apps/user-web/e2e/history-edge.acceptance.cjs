const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const {
  root: dir,
  baseURL,
  origin,
  seedHistory,
} = require("./browser-fixtures.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, n) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw Error("timeout " + n);
};
(async () => {
  const f = await seedHistory(105, "limit");
  const b = await chromium.launch({ channel: "chrome", headless: false });
  const checks = [];
  try {
    const c = await b.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    assert.equal(
      (
        await c.request.post(baseURL + "/api/auth/login", {
          data: f.credentials,
          headers: { Origin: origin },
        })
      ).status(),
      200,
    );
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    let first = true;
    await p.route("**/api/sessions?**", (r) => {
      if (first) {
        first = false;
        return r.abort("failed");
      }
      return r.continue();
    });
    await p.goto(baseURL + "/#history");
    await p
      .getByRole("alert")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await wait(
      () =>
        p
          .locator(".history-row")
          .count()
          .then((n) => n === 20),
      "firstretry20",
    );
    checks.push("first owned-list failure and retry");
    for (const count of [40, 60, 80, 100, 105]) {
      await p.getByRole("button", { name: "加载更多", exact: true }).click();
      await wait(
        () =>
          p
            .locator(".history-row")
            .count()
            .then((n) => n === count),
        "loaded" + count,
      );
    }
    assert.equal(await p.locator(".history-row input:checked").count(), 0);
    checks.push("read 105 real sessions in six pages");
    const reloadQueries = [];
    p.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/sessions")
        reloadQueries.push({
          limit: Number(u.searchParams.get("limit")),
          offset: Number(u.searchParams.get("offset")),
        });
    });
    await p.reload();
    await wait(
      () => reloadQueries.some((x) => x.offset === 100),
      "range restore100",
    );
    await wait(
      () =>
        p
          .locator(".history-row input:enabled")
          .count()
          .then((n) => n === 105),
      "allrun105",
    );
    assert.ok(reloadQueries.every((x) => x.limit <= 100));
    assert.ok(reloadQueries.some((x) => x.limit === 100 && x.offset === 0));
    assert.ok(reloadQueries.some((x) => x.limit === 5 && x.offset === 100));
    checks.push("reload restores all 105 through 100+5 list requests");
    await p.locator(".select-loaded input").check();
    await p.getByRole("button", { name: "删除所选演绎", exact: true }).click();
    let dialog = p.getByRole("dialog");
    await wait(
      () =>
        dialog
          .getByRole("button", { name: "确认删除", exact: true })
          .isEnabled(),
      "all105confirm",
    );
    assert.equal(await dialog.locator(".delete-targets li").count(), 105);
    const batches = [];
    await p.route("**/api/sessions/batch/delete", async (r) => {
      batches.push(r.request().postDataJSON().ids);
      const res = await r.fetch();
      assert.equal(res.status(), 200);
      await r.fulfill({ response: res });
    });
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(
      batches.map((x) => x.length),
      [100, 5],
    );
    await p
      .getByRole("heading", { name: "还没有历史演绎", exact: true })
      .waitFor();
    assert.equal(
      await p.evaluate(() => document.activeElement.getAttribute("href")),
      "#discover",
    );
    checks.push(
      "105 selected targets delete as 100+5, empty entry receives focus",
    );
    const role = JSON.parse(fs.readFileSync(dir + "/fixture.json")).roles.find(
      (r) => r.mode === "system_chat",
    );
    const create = await c.request.post(
      baseURL + "/api/public/roles/" + role.id + "/sessions",
      {
        headers: { Origin: origin },
        data: {
          user_id: f.personas[0].id,
          opening_id: "first",
          operation_id: "history-unknown-uncommitted-" + Date.now(),
        },
      },
    );
    assert.equal(create.status(), 201, await create.text());
    await p.reload();
    await wait(
      () =>
        p
          .locator(".history-row input:enabled")
          .count()
          .then((n) => n === 1),
      "new1",
    );
    await p.locator(".history-more").click();
    await p.getByRole("menuitem", { name: "删除", exact: true }).click();
    await wait(
      () =>
        dialog
          .getByRole("button", { name: "确认删除", exact: true })
          .isEnabled(),
      "singleconfirm",
    );
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(batches.length, 2);
    checks.push("cancel delete through Escape sends no write");
    await p.locator(".history-more").click();
    await p.getByRole("menuitem", { name: "删除", exact: true }).click();
    await wait(
      () =>
        dialog
          .getByRole("button", { name: "确认删除", exact: true })
          .isEnabled(),
      "singleconfirm2",
    );
    await p.unroute("**/api/sessions/batch/delete");
    let attempts = 0;
    await p.route("**/api/sessions/batch/delete", (r) => {
      attempts++;
      if (attempts === 1) return r.abort("failed");
      return r.continue();
    });
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog
      .getByText("删除结果尚未确认，请先核对", { exact: true })
      .waitFor();
    assert.equal(attempts, 1);
    assert.equal(
      await dialog
        .getByRole("button", { name: "重试剩余项", exact: true })
        .isDisabled(),
      true,
    );
    await dialog
      .getByRole("button", { name: "核对删除结果", exact: true })
      .click();
    await dialog.getByText("仍然存在，可重试删除", { exact: true }).waitFor();
    assert.equal(attempts, 1);
    await dialog
      .getByRole("button", { name: "重试剩余项", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(attempts, 2);
    assert.equal(
      (await (await c.request.get(baseURL + "/api/sessions?limit=1")).json())
        .meta.total,
      0,
    );
    checks.push(
      "unknown write not delivered: real detail200 verifies existence before explicit retry",
    );
    assert.deepEqual(errors, []);
    await p.screenshot({ path: dir + "/history-boundary-empty.png" });
    fs.writeFileSync(
      dir + "/history-edge-acceptance.json",
      JSON.stringify(
        {
          passed: true,
          checks,
          reloadQueries,
          batches: batches.map((x) => x.length),
          errors,
        },
        null,
        2,
      ),
    );
    console.log("PASS " + checks.length);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
