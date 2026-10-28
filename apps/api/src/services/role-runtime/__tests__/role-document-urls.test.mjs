import { expect, it } from "vitest";
import { parseFragment } from "parse5";
import * as csstree from "css-tree";
import { roleDeliverySchema } from "@tavern/shared";
import { prepareRoleDocumentUrls } from "../role-document-urls.ts";
import { resolveRoleDocumentUrls } from "../../../../../user-web/src/runtime/script-runtime.ts";

function elements(html) {
  const result = [];
  const visit = (node) => {
    if ("tagName" in node) result.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
    if ("content" in node) node.content.childNodes.forEach(visit);
  };
  visit(parseFragment(html));
  return result;
}

it("renders native HTML resources on the configured API origin and pinned file directory", () => {
  const prepared = prepareRoleDocumentUrls(
    `<p>../assets/a.svg 😀</p><img src="../assets/a.svg"><object data="../assets/a.svg"></object><table background="../assets/a.svg"></table><form action="./next.html"><button formaction="./next.html">Next</button></form><svg><use xlink:href="../assets/a.svg#icon"></use></svg>`,
    "/role-assets/fixed/frontend/index.html",
  );
  const html = resolveRoleDocumentUrls(prepared.html, "https://api.example:8443/role-assets/fixed/frontend/index.html", prepared.assetOriginOffsets);
  const nodes = elements(html);
  const attribute = (tag, name) => nodes.find(node => node.tagName === tag)?.attrs.find(attr => attr.name === name)?.value;
  expect(attribute("img", "src")).toBe("https://api.example:8443/role-assets/fixed/assets/a.svg");
  expect(attribute("object", "data")).toBe("https://api.example:8443/role-assets/fixed/assets/a.svg");
  expect(attribute("table", "background")).toBe("https://api.example:8443/role-assets/fixed/assets/a.svg");
  expect(attribute("form", "action")).toBe("https://api.example:8443/role-assets/fixed/frontend/next.html");
  expect(attribute("button", "formaction")).toBe("https://api.example:8443/role-assets/fixed/frontend/next.html");
  expect(attribute("use", "href")).toBe("https://api.example:8443/role-assets/fixed/assets/a.svg#icon");
  expect(html).toContain("<p>../assets/a.svg 😀</p>");
});

it("renders escaped CSS URLs, imports, custom properties and entity-encoded inline styles from the HTML directory", () => {
  const prepared = prepareRoleDocumentUrls(String.raw`
    <style>@import "./theme.css"; @import url('./print.css') print;
      .icon { background-image: url(../assets/a\20 b.svg); --picture: url('../assets/a.svg?x=1&y=2'); mask: url(#icon); }
    </style>
    <div style="background-image: url(&quot;../assets/a.svg?x=1&amp;y=2&quot;); --local: url(./local.svg)"></div>
  `, "/role-assets/fixed/frontend/nested/floor.html");
  const html = resolveRoleDocumentUrls(prepared.html, "https://api.example/role-assets/fixed/frontend/nested/floor.html", prepared.assetOriginOffsets);
  const nodes = elements(html);
  const stylesheet = nodes.find(node => node.tagName === "style").childNodes.map(node => node.value).join("");
  const inline = nodes.find(node => node.tagName === "div").attrs.find(attr => attr.name === "style").value;
  const urls = [];
  for (const [source, context] of [[stylesheet, "stylesheet"], [inline, "declarationList"]]) {
    csstree.walk(csstree.parse(source, { context, parseCustomProperty: true }), node => {
      if (node.type === "Url" || node.type === "String") urls.push(node.value);
    });
  }
  expect(urls).toEqual([
    "https://api.example/role-assets/fixed/frontend/nested/theme.css",
    "https://api.example/role-assets/fixed/frontend/nested/print.css",
    "https://api.example/role-assets/fixed/frontend/assets/a%20b.svg",
    "https://api.example/role-assets/fixed/frontend/assets/a.svg?x=1&y=2",
    "#icon",
    "https://api.example/role-assets/fixed/frontend/assets/a.svg?x=1&y=2",
    "https://api.example/role-assets/fixed/frontend/nested/local.svg",
  ]);
});

it("keeps data URI commas, external URLs and fragments while resolving every srcset candidate and nested template", () => {
  const prepared = prepareRoleDocumentUrls(`<picture><source srcset="data:image/svg+xml,%3Csvg%3E,%3C/svg%3E 1x, ../assets/a.svg 2x, https://cdn.example/a.svg 3x"></picture><template><img srcset="../assets/b.svg, ../assets/c.svg 2x" src="data:image/png;base64,AA=="><a href="#local"></a><a href="//cdn.example/file"></a></template>`, "/role-assets/fixed/frontend/index.html");
  const html = resolveRoleDocumentUrls(prepared.html, "https://api.example/role-assets/fixed/frontend/index.html", prepared.assetOriginOffsets);
  const nodes = elements(html);
  expect(nodes.find(node => node.tagName === "source").attrs[0].value).toBe("data:image/svg+xml,%3Csvg%3E,%3C/svg%3E 1x, https://api.example/role-assets/fixed/assets/a.svg 2x, https://cdn.example/a.svg 3x");
  expect(nodes.find(node => node.tagName === "img").attrs).toEqual([
    { name: "srcset", value: "https://api.example/role-assets/fixed/assets/b.svg, https://api.example/role-assets/fixed/assets/c.svg 2x" },
    { name: "src", value: "data:image/png;base64,AA==" },
  ]);
  expect(nodes.filter(node => node.tagName === "a").map(node => node.attrs[0].value)).toEqual(["#local", "//cdn.example/file"]);
});

it("keeps marker-like author text and the same resource URL in prose unchanged", () => {
  const prepared = prepareRoleDocumentUrls(String.raw`<p>https://role-resource-0.invalid /role-assets/fixed/assets/a.svg 😀</p><style>.label::before { content: "https://role-resource-\31.invalid"; }</style><img src="../assets/a.svg">`, "/role-assets/fixed/frontend/index.html");
  const html = resolveRoleDocumentUrls(prepared.html, "https://api.example/role-assets/fixed/frontend/index.html", prepared.assetOriginOffsets);
  expect(prepared.assetOriginOffsets).toHaveLength(1);
  expect(html).toContain("<p>https://role-resource-0.invalid /role-assets/fixed/assets/a.svg 😀</p>");
  expect(html).toContain('content:"https://role-resource-1.invalid"');
  expect(html).toContain('<img src="https://api.example/role-assets/fixed/assets/a.svg">');
});

it("resolves page and floor HTML from distinct directories without changing the pinned version or API origin", () => {
  const page = prepareRoleDocumentUrls('<img src="./icon.svg?size=2#picture"><a href="?view=detail">Detail</a>', "/role-assets/version%20%2F%20fixed/frontend/index.html");
  const floor = prepareRoleDocumentUrls('<img src="./icon.svg">', "/role-assets/version%20%2F%20fixed/frontend/floors/item.html");
  const renderedPage = resolveRoleDocumentUrls(page.html, "https://api.example/role-assets/version%20%2F%20fixed/frontend/index.html", page.assetOriginOffsets);
  const renderedFloor = resolveRoleDocumentUrls(floor.html, "https://api.example/role-assets/version%20%2F%20fixed/frontend/floors/item.html", floor.assetOriginOffsets);
  expect(renderedPage).toBe('<img src="https://api.example/role-assets/version%20%2F%20fixed/frontend/icon.svg?size=2#picture"><a href="https://api.example/role-assets/version%20%2F%20fixed/frontend/index.html?view=detail">Detail</a>');
  expect(renderedFloor).toBe('<img src="https://api.example/role-assets/version%20%2F%20fixed/frontend/floors/icon.svg">');
});

it("keeps CSS escapes from producing HTML end tags during serialization", () => {
  const prepared = prepareRoleDocumentUrls(String.raw`<style>.label::before{content:"\3c /style>";background:url(./a.svg)}</style><p>after</p>`, "/role-assets/fixed/index.html");
  const html = resolveRoleDocumentUrls(prepared.html, "https://api.example/role-assets/fixed/index.html", prepared.assetOriginOffsets);
  expect(elements(html).map(node => node.tagName)).toEqual(["style", "p"]);
  const style = elements(html)[0].childNodes[0].value;
  const contents = [];
  csstree.walk(csstree.parse(style), node => { if (node.type === "String") contents.push(node.value); });
  expect(contents).toEqual(["</style>"]);
});

const delivery = {
  html: '<img src="/role-assets/fixed/a.svg">',
  htmlUrl: "/role-assets/fixed/index.html",
  htmlAssetOriginOffsets: [10],
  css: "", scriptUrl: "/role-assets/fixed/main.js", floorHtml: null,
  assets: {}, data: {},
};

it("accepts origin offsets only for a matching HTML source and root-relative resource start", () => {
  expect(roleDeliverySchema.safeParse(delivery).success).toBe(true);
  expect(roleDeliverySchema.safeParse({ ...delivery, html: "", htmlAssetOriginOffsets: [] }).success).toBe(true);
});

it.each([
  { htmlAssetOriginOffsets: [-1] },
  { htmlAssetOriginOffsets: [10.5] },
  { htmlAssetOriginOffsets: [10, 10] },
  { htmlAssetOriginOffsets: [11, 10] },
  { htmlAssetOriginOffsets: [1000] },
  { htmlAssetOriginOffsets: [1] },
  { htmlUrl: undefined },
  { html: '<img src="//cdn.example/a.svg">' },
  { floorHtmlAssetOriginOffsets: [0] },
])("rejects invalid origin offset metadata %j", invalid => {
  expect(roleDeliverySchema.safeParse({ ...delivery, ...invalid }).success).toBe(false);
});
