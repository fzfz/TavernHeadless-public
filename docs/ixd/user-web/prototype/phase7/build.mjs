import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", {
    paths: [dirname(require.resolve("vite/package.json"))],
  }),
);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const tokens = JSON.parse(
  await readFile(resolve(root, "phase6-tokens.json"), "utf8"),
);
const common = Object.entries(tokens.common)
  .map(([k, v]) => `${k}:${v}`)
  .join(";");
const colors = (theme) =>
  Object.entries(tokens.colors)
    .map(([k, v]) => `${k}:${v[theme]}`)
    .join(";");
const tokenCSS = `:root{${common};${colors("light")}}:root[data-theme="dark"]{${colors("dark")}}`;
const baseCSS = await readFile(resolve(here, "../style.css"), "utf8");
const css =
  baseCSS +
  tokenCSS +
  (await readFile(resolve(here, "style.css"), "utf8")) +
  (await readFile(resolve(here, "session.css"), "utf8")) +
  (await readFile(resolve(here, "start.css"), "utf8")) +
  (await readFile(resolve(here, "history.css"), "utf8"));
const built = await build({
  entryPoints: [resolve(here, "../app.mjs")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  minify: true,
  plugins: [
    {
      name: "inline-prototype-resources",
      setup(builder) {
        builder.onLoad({ filter: /\.mjs$/ }, async ({ path }) => {
          let source = await readFile(path, "utf8");
          const matches = [
            ...source.matchAll(
              /new URL\("(\.\/[^"\n]+)", import\.meta\.url\)\.href/g,
            ),
          ];
          for (const match of matches) {
            const asset = resolve(dirname(path), match[1]);
            const mime = asset.endsWith(".css")
              ? "text/css"
              : "text/javascript";
            const contents = await readFile(asset, "utf8");
            source = source.replace(
              match[0],
              JSON.stringify(
                `data:${mime};charset=utf-8,${encodeURIComponent(contents)}`,
              ),
            );
          }
          return { contents: source, loader: "js" };
        });
      },
    },
  ],
});
const code = built.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
for (const platform of ["mobile", "desktop"]) {
  const label = platform === "mobile" ? "手机" : "桌面",
    frame = platform === "mobile" ? "PhoneFrame" : "WindowFrame";
  const html = `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Tavern · ${label}交互原型</title><style>${css}</style></head><body><div id="PrototypeShell" data-testid="PrototypeShell"><aside class="review-toolbar" aria-label="原型评审工具"><p><strong>${label}原型 · 本机模拟数据</strong><br><span id="review-scope"></span></p><label for="review-scenario">模拟状态</label><select id="review-scenario"></select><button id="review-theme" aria-pressed="false">深色主题</button><button id="review-boundaries" aria-pressed="true" hidden>隐藏区域说明</button><a href="phase7-prototype-${platform === "mobile" ? "desktop" : "mobile"}.html">${platform === "mobile" ? "桌面" : "手机"}原型</a></aside><section class="${frame}" data-testid="${frame}" aria-label="${label}浏览器预览"><div class="frame-chrome"><span>Tavern</span></div><div class="frame-body"><div id="app"></div><dialog id="dialog"></dialog><div id="toast" role="status" aria-live="polite"></div></div></section></div><script>window.prototypePlatform=${JSON.stringify(platform)};</script><script type="module">${code}</script></body></html>`;
  await writeFile(resolve(root, `phase7-prototype-${platform}.html`), html);
  console.log(`${platform}: ${Buffer.byteLength(html)} bytes`);
}
