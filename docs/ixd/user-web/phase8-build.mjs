import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const MarkdownIt = require(require.resolve('markdown-it', { paths: [resolve(repo, 'apps/user-web')] }));
const { chromium } = require('playwright');
const document = await readFile(resolve(here, 'phase8-document.md'), 'utf8');
const sources = [...document.matchAll(/<!-- expand:([^>]+) -->/g)].map(m => m[1]);
const sourceId = file => `source-${file.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const ids = new Map(sources.map(file => [resolve(here, file), sourceId(file)]));
const escape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const clean = text => text.replace(/^---\n[\s\S]*?\n---\n/, '');
const toc = [];
let currentFile = 'phase8-document.md';
let inSource = false;
let diagrams = 0;
const md = new MarkdownIt({ html: false });
md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
  const title = tokens[i + 1].content;
  const level = Number(tokens[i].tag.slice(1));
  const id = (inSource ? `${sourceId(currentFile)}-` : '') + slug(title);
  tokens[i].attrSet('id', id);
  if ((!inSource && level === 2) || (inSource && level === 1)) toc.push({ id, title, nested: inSource });
  return self.renderToken(tokens, i, options);
};
const originalLink = md.renderer.rules.link_open || ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  const token = tokens[i];
  const href = token.attrGet('href');
  if (href && !/^(?:[a-z]+:|#)/i.test(href)) {
    const [file, anchor] = href.split('#');
    const absolute = resolve(here, dirname(currentFile), decodeURI(file));
    token.attrSet('href', ids.has(absolute) && !anchor ? `#${ids.get(absolute)}` : relative(here, absolute) + (anchor ? `#${anchor}` : ''));
  }
  return originalLink(tokens, i, options, env, self);
};
const originalFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, i, options, env, self) => {
  if (tokens[i].info.trim() !== 'mermaid') return originalFence(tokens, i, options, env, self);
  diagrams++;
  return `<div class="diagram"><pre class="mermaid">${escape(tokens[i].content)}</pre></div>`;
};
let content = '';
let offset = 0;
for (const match of document.matchAll(/<!-- expand:([^>]+) -->/g)) {
  currentFile = 'phase8-document.md'; inSource = false;
  content += md.render(clean(document.slice(offset, match.index)));
  currentFile = match[1]; inSource = true;
  let body = clean(await readFile(resolve(here, currentFile), 'utf8'));
  if (currentFile.startsWith('phase4-page-specs/')) body = body.replace(/^## 9\.[\s\S]*?(?=^## 10\.)/m, '');
  content += `<section class="source" id="${sourceId(currentFile)}" data-source="${escape(currentFile)}"><a class="source-link" href="${escape(currentFile)}">来源文件</a>${md.render(body)}</section>`;
  offset = match.index + match[0].length;
}
currentFile = 'phase8-document.md'; inSource = false;
content += md.render(document.slice(offset));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TavernHeadless 用户 Web · 设计交付</title><style>
*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;color:#283c34;background:#f7f6f2;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:#2f604c;text-underline-offset:3px}nav{position:fixed;inset:0 auto 0 0;width:260px;padding:24px 16px;overflow:auto;background:#edf1e9;border-right:1px solid #cdd7c9}nav a{display:block;padding:5px 8px;font-size:14px;text-decoration:none}nav .nested{padding-left:20px;font-size:12px}main{margin-left:260px;padding:40px;max-width:1540px;min-width:0}h1{font-size:30px}h2{margin-top:56px;padding-top:24px;border-top:2px solid #bacabf}h3{font-size:22px;margin-top:32px}h4{font-size:18px}h1,h2,h3,h4,h5,h6{line-height:1.5;scroll-margin-top:24px}p,li{overflow-wrap:anywhere}li{margin:6px 0}table{border-collapse:collapse;width:100%;font-size:14px;margin:20px 0}th,td{border:1px solid #cdd7c9;padding:10px 12px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e3ece1}tr:nth-child(even){background:#f0f2ec}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf1e9;padding:16px;border-radius:8px;font-size:13px}code{font-family:ui-monospace,monospace;font-size:13px}img{max-width:100%}.source{margin:32px 0;padding:24px;background:#fff;border:1px solid #d7dfd3;border-radius:12px;min-width:0}.source>h1{font-size:26px}.source>h2{font-size:22px;margin-top:32px;border-width:1px}.source-link{font-size:13px}.diagram{overflow:auto;background:#fff;padding:16px;border:1px solid #cdd7c9}.diagram svg{display:block;min-width:700px;height:auto;margin:auto}a:focus-visible{outline:3px solid #2f604c;outline-offset:3px}@media(max-width:800px){nav{position:static;width:auto;max-height:250px;border-bottom:1px solid #cdd7c9}main{margin:0;padding:16px}.source{padding:12px}table{display:block;overflow:auto}h1{font-size:25px}}@media print{nav,.source-link{display:none}main{margin:0;padding:0;max-width:none}body{background:white;font-size:12px}.source{border:0;padding:0}h2,h3{break-after:avoid}tr{break-inside:avoid}.diagram svg{min-width:0;max-width:100%}}
</style></head><body><nav aria-label="交付文档目录">${toc.map(item => `<a class="${item.nested ? 'nested' : ''}" href="#${item.id}">${escape(item.title)}</a>`).join('')}</nav><main>${content}</main></body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent(html);
  await page.addScriptTag({ content: await readFile(resolve(repo, 'node_modules/.pnpm/mermaid@11.16.0/node_modules/mermaid/dist/mermaid.min.js'), 'utf8') });
  await page.evaluate(async () => { window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', flowchart: { useMaxWidth: true } }); await window.mermaid.run({ querySelector: '.mermaid' }); });
  const rendered = await page.locator('.diagram svg').count();
  if (rendered !== diagrams) throw new Error(`Rendered ${rendered}/${diagrams} diagrams`);
  await page.locator('script').evaluateAll(nodes => nodes.forEach(node => node.remove()));
  await writeFile(resolve(here, 'phase8-document.html'), '<!doctype html>\n' + await page.locator('html').evaluate(node => node.outerHTML));
  console.log(JSON.stringify({ output: 'phase8-document.html', sources: sources.length, pages: sources.filter(s => s.startsWith('phase4-page-specs/')).length, diagrams: rendered }));
} finally { await browser.close(); }
