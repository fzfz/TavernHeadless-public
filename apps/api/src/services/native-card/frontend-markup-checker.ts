import { posix } from "node:path";
import * as csstree from "css-tree";
import { parseFragment, type DefaultTreeAdapterMap, type ParserError } from "parse5";
import {
  apiErrorMessages,
  getNativeCardPackageFileRule,
  nativeCardFileRules,
  type NativeCardIssue,
  type NativeCardPackageFile,
} from "@tavern/shared";

import { srcsetCandidates } from "./frontend-resource-references.js";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlLocation = NonNullable<HtmlElement["sourceCodeLocation"]>;
type HtmlAttributeLocation = NonNullable<HtmlLocation["attrs"]>[string];
type SourcePosition = { line: number; column: number; offset: number };
type CssDelimiter = { closeType: number; closeName: string; offset: number };

const markupIssueCode = "NATIVE_CARD_FRONTEND_MARKUP_INVALID";
const resourceAttributes = new Set<string>(nativeCardFileRules.frontendResourceAttributes);

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function createPositionLookup(source: string): (offset: number) => SourcePosition {
  const lineStarts = [0];
  const carriageReturns: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") carriageReturns.push(index);
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  return (offset) => {
    const boundedOffset = Math.max(0, Math.min(offset, source.length));
    const lineIndex = lowerBound(lineStarts, boundedOffset + 1) - 1;
    const lineStart = lineStarts[lineIndex]!;
    const carriageReturnCount = lowerBound(carriageReturns, boundedOffset) - lowerBound(carriageReturns, lineStart);
    return {
      line: lineIndex + 1,
      column: boundedOffset - lineStart - carriageReturnCount + 1,
      offset: boundedOffset,
    };
  };
}

function makeIssue(
  path: string,
  expected: string,
  position: Pick<SourcePosition, "line" | "column"> = { line: 1, column: 1 },
): NativeCardIssue {
  const message = apiErrorMessages.NATIVE_CARD_FRONTEND_MARKUP_INVALID;
  return {
    code: markupIssueCode,
    path,
    line: position.line,
    column: position.column,
    message,
    action: message,
    expected,
  };
}

function decodeUtf8(path: string, bytes: Uint8Array, issues: NativeCardIssue[]): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    issues.push(makeIssue(path, "HTML and CSS files must use valid UTF-8."));
    return undefined;
  }
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function attributeValueOffset(source: string, location: HtmlAttributeLocation | undefined): number {
  if (!location) return 0;
  const text = source.slice(location.startOffset, location.endOffset);
  const equal = text.indexOf("=");
  if (equal < 0) return location.startOffset;
  let offset = equal + 1;
  while (isWhitespace(text[offset])) offset += 1;
  const quote = text[offset];
  if (quote === "\"" || quote === "'") offset += 1;
  return location.startOffset + offset;
}


function isAllowedExternalUrl(value: string): boolean {
  if (value.startsWith("//")) {
    try {
      const url = new URL(`https:${value}`);
      return url.protocol === "https:" && url.hostname.length > 0;
    } catch {
      return false;
    }
  }

  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
    } catch {
      return false;
    }
  }

  if (/^data:/i.test(value)) {
    const commaOffset = value.indexOf(",", value.indexOf(":") + 1);
    if (commaOffset < 0) return false;
    try {
      return new URL(value).protocol === "data:";
    } catch {
      return false;
    }
  }

  return false;
}

function validateReference(
  path: string,
  sourcePath: string,
  rawValue: string,
  files: ReadonlyMap<string, Uint8Array>,
  position: Pick<SourcePosition, "line" | "column">,
  issues: NativeCardIssue[],
): void {
  const value = rawValue.trim();
  if (!value || value.startsWith("#")) return;
  if (isAllowedExternalUrl(value)) return;

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    issues.push(makeIssue(path, `Resource reference ${JSON.stringify(value)} must use a valid HTTP(S), data, or package-relative URL.`, position));
    return;
  }
  if (value.startsWith("//")) {
    issues.push(makeIssue(path, `External resource reference ${JSON.stringify(value)} is not a valid protocol-relative HTTP(S) URL.`, position));
    return;
  }
  if (value.includes("\\")) {
    issues.push(makeIssue(path, `Relative resource reference ${JSON.stringify(value)} must use URL forward slashes.`, position));
    return;
  }

  const pathPart = value.split(/[?#]/, 1)[0] ?? "";
  if (!pathPart) return;
  if (pathPart.startsWith("/")) {
    issues.push(makeIssue(path, `Resource reference ${JSON.stringify(value)} must remain relative to its package file or use an explicit external URL.`, position));
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    issues.push(makeIssue(path, `Relative resource reference ${JSON.stringify(value)} contains an invalid percent escape.`, position));
    return;
  }
  if (decodedPath.includes("\\") || decodedPath.includes("\0") || decodedPath.startsWith("/")) {
    issues.push(makeIssue(path, `Relative resource reference ${JSON.stringify(value)} must use a valid package-relative URL path.`, position));
    return;
  }

  const resolvedPath = posix.normalize(posix.join(posix.dirname(sourcePath), decodedPath));
  if (resolvedPath === ".." || resolvedPath.startsWith("../") || resolvedPath.startsWith("/")) {
    issues.push(makeIssue(path, `Relative resource reference ${JSON.stringify(value)} resolves outside the role package.`, position));
    return;
  }
  if (!files.has(resolvedPath)) {
    issues.push(makeIssue(path, `Relative resource reference ${JSON.stringify(value)} points to missing package file ${JSON.stringify(resolvedPath)}.`, position));
  }
}

function cssErrorPosition(
  positionAtSource: (offset: number) => SourcePosition,
  anchorOffset: number,
  localOffset: number,
): SourcePosition {
  return positionAtSource(anchorOffset + localOffset);
}

function endsWithUnescaped(source: string, suffix: string): boolean {
  if (!source.endsWith(suffix)) return false;
  let backslashCount = 0;
  for (let index = source.length - suffix.length - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 0;
}

function cssTokenizerErrors(source: string): Array<{ offset: number; message: string }> {
  const errors = new Map<number, string>();
  const delimiters: CssDelimiter[] = [];
  const tokens = csstree.tokenTypes;
  const addError = (offset: number, message: string): void => {
    if (!errors.has(offset)) errors.set(offset, message);
  };

  csstree.tokenize(source, (type, start, end) => {
    const raw = source.slice(start, end);
    if (type === tokens.BadString) {
      addError(start, "string contains a newline before its closing quote");
    } else if (type === tokens.String) {
      const quote = raw[0];
      if ((quote !== "\"" && quote !== "'") || raw.length < 2 || !endsWithUnescaped(raw, quote)) {
        addError(start, "string is missing its closing quote");
      }
    } else if (type === tokens.Comment && !raw.endsWith("*/")) {
      addError(start, "comment is missing its closing */");
    } else if (type === tokens.BadUrl) {
      addError(start, "url() contains invalid or unclosed syntax");
    } else if (type === tokens.Url && !endsWithUnescaped(raw, ")")) {
      addError(start, "url() is missing its closing parenthesis");
    }

    if (type === tokens.Function) {
      delimiters.push({ closeType: tokens.RightParenthesis, closeName: ")", offset: end - 1 });
    } else if (type === tokens.LeftParenthesis) {
      delimiters.push({ closeType: tokens.RightParenthesis, closeName: ")", offset: start });
    } else if (type === tokens.LeftSquareBracket) {
      delimiters.push({ closeType: tokens.RightSquareBracket, closeName: "]", offset: start });
    } else if (type === tokens.LeftCurlyBracket) {
      delimiters.push({ closeType: tokens.RightCurlyBracket, closeName: "}", offset: start });
    } else if (
      type === tokens.RightParenthesis ||
      type === tokens.RightSquareBracket ||
      type === tokens.RightCurlyBracket
    ) {
      const opener = delimiters.at(-1);
      if (opener?.closeType === type) {
        delimiters.pop();
      } else {
        addError(start, `unexpected or mismatched closing delimiter ${JSON.stringify(raw)}`);
      }
    }
  });

  for (const delimiter of delimiters) {
    addError(delimiter.offset, `block is missing its closing ${delimiter.closeName}`);
  }

  return [...errors].map(([offset, message]) => ({ offset, message }));
}

function validateCss(
  path: string,
  sourcePath: string,
  source: string,
  files: ReadonlyMap<string, Uint8Array>,
  issues: NativeCardIssue[],
  context: "stylesheet" | "declarationList",
  anchorOffset = 0,
  locationSource = source,
  positionAtSource = createPositionLookup(locationSource),
): void {
  const parseErrors: Array<{ offset: number; message: string }> = [];
  const tokenErrors = cssTokenizerErrors(source);
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(source, {
      context,
      positions: true,
      onParseError: (error) => parseErrors.push({ offset: error.offset, message: error.message }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    issues.push(makeIssue(path, `CSS syntax error: ${message}`, cssErrorPosition(positionAtSource, anchorOffset, 0)));
    for (const error of tokenErrors) {
      issues.push(makeIssue(path, `CSS syntax error: ${error.message}.`, cssErrorPosition(positionAtSource, anchorOffset, error.offset)));
    }
    return;
  }

  for (const error of parseErrors) {
    issues.push(makeIssue(
      path,
      `CSS syntax error: ${error.message}`,
      cssErrorPosition(positionAtSource, anchorOffset, error.offset),
    ));
  }
  for (const error of tokenErrors) {
    if (parseErrors.some((parseError) => parseError.offset === error.offset)) continue;
    issues.push(makeIssue(
      path,
      `CSS syntax error: ${error.message}.`,
      cssErrorPosition(positionAtSource, anchorOffset, error.offset),
    ));
  }

  const checkCssUrl = (value: string, offset: number): void => {
    validateReference(
      path,
      sourcePath,
      value,
      files,
      cssErrorPosition(positionAtSource, anchorOffset, offset),
      issues,
    );
  };

  csstree.walk(ast, (node) => {
    if (node.type === "Url") checkCssUrl(node.value, node.loc?.start.offset ?? 0);
    if (node.type === "Atrule" && node.name.toLowerCase() === "import" && node.prelude?.type === "AtrulePrelude") {
      const target = [...node.prelude.children].find((child) => child.type === "String");
      if (target?.type === "String") checkCssUrl(target.value, target.loc?.start.offset ?? 0);
    }
  });
}

function nodeChildren(node: HtmlNode): HtmlNode[] {
  if ("childNodes" in node) return node.childNodes;
  return [];
}

function elementAttributes(element: HtmlElement): Map<string, string> {
  return new Map(element.attrs.map((attribute) => [
    `${attribute.prefix ? `${attribute.prefix}:` : ""}${attribute.name}`.toLowerCase(),
    attribute.value,
  ]));
}

function collectHtmlIssues(
  path: string,
  source: string,
  files: ReadonlyMap<string, Uint8Array>,
  issues: NativeCardIssue[],
): void {
  const positionAtSource = createPositionLookup(source);
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error),
  });
  for (const error of parseErrors) {
    issues.push(makeIssue(path, `HTML syntax error: ${error.code}.`, { line: error.startLine, column: error.startCol }));
  }

  const visit = (node: HtmlNode): void => {
    if ("tagName" in node) {
      const element = node as HtmlElement;
      const attributes = elementAttributes(element);
      const location = element.sourceCodeLocation;
      const baseLocation = location?.attrs?.href;
      if (element.tagName.toLowerCase() === "base" && attributes.get("href")?.trim()) {
        const basePosition = positionAtSource(attributeValueOffset(source, baseLocation));
        issues.push(makeIssue(
          path,
          "A non-empty <base href> changes package-relative URL resolution; remove the base or give resources explicit URLs relative to their owning files.",
          basePosition,
        ));
      }

      for (const attribute of element.attrs) {
        const name = `${attribute.prefix ? `${attribute.prefix}:` : ""}${attribute.name}`.toLowerCase();
        const attributeLocation = location?.attrs?.[name];
        const valueOffset = attributeValueOffset(source, attributeLocation);
        if (name === "style") {
          validateCss(path, path, attribute.value, files, issues, "declarationList", valueOffset, source, positionAtSource);
          continue;
        }
        if (!resourceAttributes.has(name) || (element.tagName.toLowerCase() === "base" && name === "href")) continue;

        const references = name === "srcset"
          ? srcsetCandidates(attribute.value)
          : [{ value: attribute.value, offset: 0 }];
        for (const reference of references) {
          const referencePosition = positionAtSource(valueOffset + reference.offset);
          validateReference(path, path, reference.value, files, referencePosition, issues);
        }
      }

      if (element.tagName.toLowerCase() === "style") {
        const startOffset = location?.startTag?.endOffset ?? 0;
        const endOffset = location?.endTag?.startOffset ?? source.length;
        validateCss(path, path, source.slice(startOffset, endOffset), files, issues, "stylesheet", startOffset, source, positionAtSource);
      }
    }

    for (const child of nodeChildren(node)) visit(child);
    if ("tagName" in node && node.tagName.toLowerCase() === "template") {
      for (const child of (node as DefaultTreeAdapterMap["template"]).content.childNodes) visit(child);
    }
  };
  for (const node of fragment.childNodes) visit(node);
}

/** Parses package HTML and CSS, then checks every static resource URL without fetching or executing it. */
export function validateNativeCardFrontendMarkup(
  files: readonly NativeCardPackageFile[],
): NativeCardIssue[] {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const issues: NativeCardIssue[] = [];
  for (const file of files) {
    const rule = getNativeCardPackageFileRule(file.path);
    if (rule?.schema !== "html" && rule?.schema !== "css") continue;
    const source = decodeUtf8(file.path, file.content, issues);
    if (source === undefined) continue;
    if (rule.schema === "html") collectHtmlIssues(file.path, source, fileMap, issues);
    else validateCss(file.path, file.path, source, fileMap, issues, "stylesheet");
  }
  return issues;
}
