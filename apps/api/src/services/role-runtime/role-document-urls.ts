import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import * as csstree from "css-tree";
import { nativeCardFileRules } from "@tavern/shared";
import { srcsetCandidates } from "../native-card/frontend-resource-references.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function visitElements(node: HtmlNode, visit: (element: HtmlElement) => void): void {
  if ("tagName" in node) visit(node);
  if ("childNodes" in node) node.childNodes.forEach(child => visitElements(child, visit));
  if ("content" in node) node.content.childNodes.forEach(child => visitElements(child, visit));
}

function rewriteCss(source: string, context: "stylesheet" | "declarationList", resolve: (url: string) => string): string {
  const ast = csstree.parse(source, { context, parseCustomProperty: true });
  csstree.walk(ast, node => {
    if (node.type === "Url") node.value = resolve(node.value);
    if (node.type === "Atrule" && node.name.toLowerCase() === "import" && node.prelude?.type === "AtrulePrelude") {
      const target = [...node.prelude.children].find(child => child.type === "String");
      if (target?.type === "String") target.value = resolve(target.value);
    }
  });
  return csstree.generate(ast);
}

function rewriteElementCss(element: HtmlElement, resolve: (url: string) => string): void {
  for (const attribute of element.attrs) {
    if (attribute.name === "style") attribute.value = rewriteCss(attribute.value, "declarationList", resolve);
  }
  if (element.tagName === "style") {
    for (const child of element.childNodes) {
      if (child.nodeName === "#text" && "value" in child) {
        child.value = rewriteCss(child.value, "stylesheet", resolve).replace(/<\/style/gi, match => `\\3c ${match.slice(1)}`);
      }
    }
  }
}

/** Marks UTF-16 insertion offsets for the client's API origin in serialized HTML. */
export function prepareRoleDocumentUrls(source: string, documentPath: string): {
  html: string;
  assetOriginOffsets: number[];
} {
  const fragment = parseFragment(source);
  // Normalize CSS before choosing the marker so decoded CSS escapes cannot collide with it.
  visitElements(fragment, element => rewriteElementCss(element, value => value));
  const normalized = serialize(fragment);
  let markerIndex = 0;
  let markerOrigin: string;
  do {
    markerOrigin = `https://role-resource-${markerIndex++}.invalid`;
  } while (normalized.includes(markerOrigin));
  const documentUrl = new URL(documentPath, markerOrigin);
  const attributes = new Set<string>(nativeCardFileRules.frontendResourceAttributes);
  const resolve = (raw: string): string => {
    const value = raw.trim();
    if (!value || value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value)) return raw;
    return new URL(value, documentUrl).href;
  };
  visitElements(fragment, element => {
    rewriteElementCss(element, resolve);
    for (const attribute of element.attrs) {
      const name = `${attribute.prefix ? `${attribute.prefix}:` : ""}${attribute.name}`;
      if (name === "srcset") {
        let value = attribute.value;
        for (const candidate of srcsetCandidates(value).reverse()) {
          value = value.slice(0, candidate.offset) + resolve(candidate.value) + value.slice(candidate.offset + candidate.value.length);
        }
        attribute.value = value;
      } else if (attributes.has(name)) attribute.value = resolve(attribute.value);
    }
  });
  const parts = serialize(fragment).split(markerOrigin);
  let html = parts[0]!;
  const assetOriginOffsets: number[] = [];
  for (const part of parts.slice(1)) {
    assetOriginOffsets.push(html.length);
    html += part;
  }
  return { html, assetOriginOffsets };
}
