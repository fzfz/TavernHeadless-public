import { describe, expect, it } from "vitest";
import type { NativeCardPackageFile } from "@tavern/shared";
import { validateNativeCardFrontendMarkup } from "../frontend-markup-checker.js";

function file(path: string, content: string): NativeCardPackageFile {
  return { path, content: Buffer.from(content, "utf8") };
}

describe("native card frontend HTML and CSS checks", () => {
  it("accepts a full page and fragment with valid CSS and local, external, and data resources", () => {
    const issues = validateNativeCardFrontendMarkup([
      file(
        "frontend/index.html",
        `<!doctype html>
<html><head><link rel="stylesheet" href="./style.css"><style>.hero { background-image: url("./assets/hero.png"); }</style></head>
<body><img src="./assets/icon.svg" style="mask-image: url('./assets/mask.svg')">
<img src="https://cdn.example.test/photo.png"><img src="data:image/png;base64,AAAA"></body></html>`,
      ),
      file("frontend/style.css", `@import "https://cdn.example.test/theme.css";
.hero { background: url("./assets/background.png"); border-image: url(data:image/svg+xml,%3Csvg%3E) 1; }`),
      file("frontend/assets/hero.png", "image"),
      file("frontend/assets/icon.svg", "<svg/>"),
      file("frontend/assets/mask.svg", "<svg/>"),
      file("frontend/assets/background.png", "image"),
      file("frontend/fragment.html", `<section><img src="./assets/icon.svg"><p>fragment</p></section>`),
      file("frontend/escaped.css", String.raw`.escaped::before { content: "quoted \" text"; }`),
    ]);

    expect(issues).toEqual([]);
  });

  it("reports HTML tokenizer syntax errors with file and source location", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/index.html", "<main>ok</main>\n<img src=\"broken.png>"),
    ]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "NATIVE_CARD_FRONTEND_MARKUP_INVALID",
        path: "frontend/index.html",
        line: 2,
        column: expect.any(Number),
        expected: expect.stringContaining("HTML"),
      }),
    ]));
  });

  it("reports stylesheet syntax errors with file and source location", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/style.css", ".panel {\n  color red;\n}"),
    ]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "NATIVE_CARD_FRONTEND_MARKUP_INVALID",
        path: "frontend/style.css",
        line: 2,
        column: expect.any(Number),
        expected: expect.stringContaining("CSS"),
      }),
    ]));
  });

  it("reports unterminated CSS strings, comments, blocks, and functions", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/string.css", `.story { color: "unfinished; }`),
      file("frontend/comment.css", `.story { /* unfinished`),
      file("frontend/block.css", `.story { color: red;`),
      file("frontend/function.css", `.story { background: url("asset.png"`),
      file("frontend/url-escape.css", String.raw`.story { background: url(asset\)`),
      file("frontend/inline-string.html", `<div style='content:"'></div>`),
    ]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "frontend/string.css", expected: expect.stringContaining("closing quote") }),
      expect.objectContaining({ path: "frontend/comment.css", expected: expect.stringContaining("closing */") }),
      expect.objectContaining({ path: "frontend/block.css", expected: expect.stringContaining("closing }") }),
      expect.objectContaining({ path: "frontend/function.css", expected: expect.stringContaining("closing )") }),
      expect.objectContaining({ path: "frontend/url-escape.css", expected: expect.stringContaining("url() is missing its closing parenthesis") }),
      expect.objectContaining({ path: "frontend/inline-string.html", expected: expect.stringContaining("closing quote") }),
    ]));
  });

  it("accepts CSS strings with escaped quotes", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/escaped.css", String.raw`.escaped::before { content: "quoted \" text"; }`),
      file("frontend/escaped-url.css", String.raw`.escaped { background: url(asset\)part.png); }`),
      file("frontend/asset)part.png", "image"),
    ]);

    expect(issues).toEqual([]);
  });

  it("maps inline style attribute and style-element syntax errors to HTML line and column", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/index.html", `<main>\n<div style="color red;"></div>\n<style>\n.hero { color blue; }\n</style></main>`),
    ]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "frontend/index.html",
        line: 2,
        column: expect.any(Number),
        expected: expect.stringContaining("CSS syntax error"),
      }),
      expect.objectContaining({
        path: "frontend/index.html",
        line: 4,
        column: expect.any(Number),
        expected: expect.stringContaining("CSS syntax error"),
      }),
    ]));
  });

  it("checks HTML, style attributes, embedded styles, CSS imports, and url() references", () => {
    const issues = validateNativeCardFrontendMarkup([
      file(
        "frontend/index.html",
        `<main style="background-image: url('./missing-inline.png')">
<img src="./missing-image.png"><style>@import "./missing-import.css";
.hero { background: url("./missing-style.png"); }</style></main>`,
      ),
    ]);

    expect(issues.map((issue) => issue.expected)).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-inline.png"),
      expect.stringContaining("missing-image.png"),
      expect.stringContaining("missing-import.css"),
      expect.stringContaining("missing-style.png"),
    ]));
    expect(issues.every((issue) => issue.path === "frontend/index.html" && issue.line && issue.column)).toBe(true);
  });

  it("rejects relative references that escape the package and accepts valid external and data URLs", () => {
    const issues = validateNativeCardFrontendMarkup([
      file(
        "frontend/index.html",
        `<img src="../../outside.png"><img src="https://cdn.example.test/ok.png"><img src="data:image/svg+xml,%3Csvg%3E">`,
      ),
      file("frontend/style.css", `.panel { background: url("../../../outside.png"); }`),
    ]);

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.expected)).toEqual(expect.arrayContaining([
      expect.stringContaining("outside the role package"),
    ]));
  });

  it("parses srcset candidates without splitting data URL payload commas", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/index.html", `<img srcset="data:image/png;base64,AAAA 1x, ./assets/large.png 2x">`),
      file("frontend/assets/large.png", "image"),
    ]);

    expect(issues).toEqual([]);
  });

  it("rejects a non-empty base href that would change package-relative resolution", () => {
    const issues = validateNativeCardFrontendMarkup([
      file("frontend/index.html", `<base href="./assets/">`),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        path: "frontend/index.html",
        expected: expect.stringContaining("<base href> changes package-relative URL resolution"),
      }),
    ]);
  });
});
