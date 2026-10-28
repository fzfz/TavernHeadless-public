const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const platform = process.env.PLATFORM || "mobile";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: platform === "mobile" ? 390 : 1440, height: 1000 },
  });
  page.setDefaultTimeout(4000);
  try {
    await page.goto(
      `http://127.0.0.1:4180/phase7-prototype-${platform}.html#start/c1`,
    );
    await page
      .getByRole("button", { name: "使用演示账号体验", exact: true })
      .click();
    await page
      .locator(`[data-page-id="${platform === "mobile" ? "P14" : "P13"}"]`)
      .waitFor();
    const personas = page.getByRole("group", { name: "演绎人格", exact: true });
    await personas.getByRole("radio", { name: /裴修远/ }).waitFor();
    assert(await personas.getByRole("radio", { name: /裴修远/ }).isChecked());
    await personas.getByRole("radio", { name: /陆遥/ }).check();
    await page
      .getByRole("region", { name: "所选人格完整描述" })
      .getByText(
        "陆遥，女，25岁，独立飞船领航员。好奇、坦率，擅长辨认星图与维修导航仪，正在追寻父亲留下的失落航线。",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("radio", { name: "开场 2", exact: true }).check();
    await page
      .getByRole("button", { name: "展开开场全文", exact: true })
      .click();
    await page.reload();
    await page.getByRole("radio", { name: /陆遥/ }).waitFor();
    assert(await page.getByRole("radio", { name: /陆遥/ }).isChecked());
    assert(
      await page
        .getByRole("radio", { name: "开场 2", exact: true })
        .isChecked(),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "收起开场全文", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.getByRole("button", { name: "开始演绎", exact: true }).click();
    await page.waitForURL(/#chat\//);
    console.log(`${platform} start selection and creation: passed`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
