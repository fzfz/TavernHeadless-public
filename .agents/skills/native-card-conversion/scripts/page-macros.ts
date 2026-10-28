import configuration from "../config/page-macros.json";
import moment from "moment";
import seedrandom from "seedrandom";
import Bowser from "bowser";

export type PageMacroPath = readonly (string | number)[];
export interface PageMacroConditions {
  card?: "package-card";
  session?: "single-character";
  variables?: Record<string, PageMacroPath>;
  messages?: "saved-visible-active";
}
export interface PageMacroBinding {
  id: string;
  template: string;
  conditions?: PageMacroConditions;
}
export interface PageMacroCard {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mes_example?: string;
  creator_notes?: string;
  character_version?: string;
  first_mes?: string;
  alternate_greetings?: readonly string[];
  extensions?: { depth_prompt?: { prompt?: string } };
}
export interface PageMacroState {
  branchId: string;
  variables: Record<string, unknown>;
}
export interface PageMacroMessage {
  role: "user" | "assistant" | "agent";
  text: string;
}
export interface PageMacroValues {
  performerName?: string | (() => unknown);
  card?: PageMacroCard | (() => unknown);
  state?: PageMacroState | (() => PageMacroState);
  messages?: readonly PageMacroMessage[];
  now?: () => Date;
  random?: () => number;
  userAgent?: string;
  onDiagnostic?: (diagnostic: PageMacroDiagnostic) => void;
}
export interface PageMacroDependencies {
  performerName: boolean;
  card: boolean;
  state: boolean;
  messages: boolean;
  clock: boolean;
  random: boolean;
  userAgent: boolean;
}
export interface PageMacroDiagnostic {
  code:
    | "UNKNOWN_MACRO"
    | "INVALID_SYNTAX"
    | "INVALID_ARGUMENTS"
    | "HOST_CAPABILITY_REQUIRED"
    | "PURPOSE_REQUIRED"
    | "VARIABLE_BINDING_REQUIRED"
    | "DATA_NOT_FOUND"
    | "CARD_REFERENCE_CYCLE"
    | "INVALID_VALUE"
    | "INVALID_BINDING";
  macro: string;
  message: string;
  start: number;
  end: number;
  bindingId?: string;
  dataKey?: string;
  fieldChain?: readonly string[];
}
export class PageMacroError extends Error {
  constructor(public readonly diagnostic: PageMacroDiagnostic) {
    super(diagnostic.message);
    this.name = "PageMacroError";
  }
}
interface MacroDefinition {
  name: string;
  aliases: string[];
  parameters: {
    name: string;
    optional: boolean;
    type: string;
    default?: string;
  }[];
  list: boolean;
  scoped?: boolean;
  strictArgs?: boolean;
  handler: string | null;
  condition: {
    card?: string;
    session?: string;
    variables?: boolean;
    messages?: string;
  } | null;
  dependencies: (keyof PageMacroDependencies)[];
  purpose: string;
  diagnostic: string | null;
  cardPath?: string[];
  alternatePath?: string[];
  trim?: boolean;
  expand?: boolean;
  role?: PageMacroMessage["role"] | null;
  format?: string;
  formulaPattern?: string;
}
interface MacroRegistry {
  version: number;
  syntax: typeof configuration.syntax;
  dataKeys: typeof configuration.dataKeys;
  diagnostics: typeof configuration.diagnostics;
  macros: MacroDefinition[];
  legacyForms: {
    name: string;
    equivalent: string;
    pattern?: string;
    argumentGroup?: number;
  }[];
}
export const pageMacroRegistry: MacroRegistry = configuration as MacroRegistry;
const definitions = new Map<string, MacroDefinition>();
for (const definition of pageMacroRegistry.macros) {
  for (const name of [definition.name, ...definition.aliases])
    definitions.set(name.toLowerCase(), definition);
}
for (const form of pageMacroRegistry.legacyForms) {
  if (!form.pattern)
    definitions.set(
      form.name.toLowerCase(),
      definitions.get(form.equivalent.toLowerCase())!,
    );
}
interface TextNode {
  kind: "text";
  text: string;
  start: number;
  end: number;
}
export interface PageMacroCall {
  kind: "macro";
  name: string;
  args: string[];
  argumentOffsets: number[];
  start: number;
  end: number;
  raw: string;
  preserveWhitespace: boolean;
  closing: boolean;
  body?: PageMacroNode[];
}
export type PageMacroNode = TextNode | PageMacroCall;
export interface ParsedPageMacros {
  template: string;
  nodes: PageMacroNode[];
}
export interface PageMacroAnalysis {
  macros: string[];
  dependencies: PageMacroDependencies;
  diagnostics: PageMacroDiagnostic[];
  statePaths: PageMacroPath[];
}
export interface PageMacroAnalysisOptions {
  conditions?: PageMacroConditions;
  card?: PageMacroCard;
}
type DiagnosticTemplate = keyof typeof configuration.diagnostics;
function issue(
  code: PageMacroDiagnostic["code"],
  call: Pick<PageMacroCall, "name" | "start" | "end">,
  key: DiagnosticTemplate,
  reason = "",
  extra: Partial<PageMacroDiagnostic> = {},
): PageMacroDiagnostic {
  const message = pageMacroRegistry.diagnostics[key].replace(
    /\{(macro|reason|dataKey)\}/g,
    (_, name: string) =>
      name === "macro"
        ? call.name
        : name === "reason"
          ? reason
          : (extra.dataKey ?? ""),
  );
  return {
    code,
    macro: call.name,
    start: call.start,
    end: call.end,
    message,
    ...extra,
  };
}
function fail(diagnostic: PageMacroDiagnostic): never {
  throw new PageMacroError(diagnostic);
}
function splitArguments(
  text: string,
  offset: number,
  split: boolean,
): { args: string[]; offsets: number[] } {
  const args: string[] = [],
    offsets: number[] = [];
  let depth = 0,
    start = 0;
  for (let index = 0; index <= text.length; index++) {
    if (text.startsWith("{{", index)) {
      depth++;
      index++;
      continue;
    }
    if (text.startsWith("}}", index)) {
      depth--;
      index++;
      continue;
    }
    if (
      index === text.length ||
      (split &&
        depth === 0 &&
        text.startsWith(pageMacroRegistry.syntax.argumentSeparator, index))
    ) {
      const raw = text.slice(start, index);
      args.push(raw.trim());
      offsets.push(offset + start + raw.length - raw.trimStart().length);
      if (index < text.length)
        index += pageMacroRegistry.syntax.argumentSeparator.length - 1;
      start = index + 1;
    }
  }
  return { args, offsets };
}
function variableShorthand(text: string): {
  name: string;
  variable: string;
  prefix: string;
} | null {
  for (const [prefix, name] of [
    [pageMacroRegistry.syntax.localPrefix, pageMacroRegistry.syntax.localMacro],
    [
      pageMacroRegistry.syntax.globalPrefix,
      pageMacroRegistry.syntax.globalMacro,
    ],
  ] as const) {
    if (!text.startsWith(prefix)) continue;
    const match = new RegExp(
      "^(" + pageMacroRegistry.syntax.variable + ")$",
    ).exec(text.slice(prefix.length));
    if (match) return { name, variable: match[1]!, prefix };
  }
  return null;
}

function macroIdentifier(text: string): RegExpExecArray | null {
  const match = new RegExp(
    "^(" + pageMacroRegistry.syntax.identifier + ")",
  ).exec(text);
  if (!match) return null;
  const rest = text.slice(match[0].length);
  return rest === "" ||
    /^\s/.test(rest) ||
    rest.startsWith(pageMacroRegistry.syntax.argumentSeparator) ||
    rest.startsWith(pageMacroRegistry.syntax.legacyArgumentSeparator)
    ? match
    : null;
}

function header(raw: string, start: number): PageMacroCall {
  const inner = raw.slice(2, -2),
    left = inner.length - inner.trimStart().length;
  let text = inner.trimStart(),
    cursor = start + 2 + left;
  let closing = false,
    preserveWhitespace = false;
  while (
    text.startsWith(pageMacroRegistry.syntax.preserveWhitespace) ||
    (text.startsWith(pageMacroRegistry.syntax.closing) &&
      !macroIdentifier(text))
  ) {
    const flag = text.startsWith(pageMacroRegistry.syntax.preserveWhitespace)
      ? pageMacroRegistry.syntax.preserveWhitespace
      : pageMacroRegistry.syntax.closing;
    if (flag === pageMacroRegistry.syntax.closing) closing = true;
    else preserveWhitespace = true;
    text = text.slice(flag.length).trimStart();
    cursor = start + 2 + inner.length - text.length;
  }
  const call: PageMacroCall = {
    kind: "macro",
    name: "",
    args: [],
    argumentOffsets: [],
    start,
    end: start + raw.length,
    raw,
    preserveWhitespace,
    closing,
  };
  const shorthand = variableShorthand(text.trimEnd());
  if (shorthand) {
    call.name = shorthand.name;
    call.args = [shorthand.variable];
    call.argumentOffsets = [cursor + shorthand.prefix.length];
    return call;
  }
  const match = macroIdentifier(text);
  if (!match)
    fail(
      issue(
        "INVALID_SYNTAX",
        { ...call, name: text },
        "syntax",
        "请输入宏名及有效参数",
      ),
    );
  call.name = match[1]!;
  let rest = text.slice(match[0].length);
  cursor += match[0].length;
  const spaces = rest.length - rest.trimStart().length;
  rest = rest.trimStart();
  cursor += spaces;
  if (rest.length) {
    let split = false;
    if (rest.startsWith(pageMacroRegistry.syntax.argumentSeparator)) {
      split = true;
      rest = rest.slice(pageMacroRegistry.syntax.argumentSeparator.length);
      cursor += pageMacroRegistry.syntax.argumentSeparator.length;
    } else if (
      rest.startsWith(pageMacroRegistry.syntax.legacyArgumentSeparator)
    ) {
      rest = rest.slice(
        pageMacroRegistry.syntax.legacyArgumentSeparator.length,
      );
      cursor += pageMacroRegistry.syntax.legacyArgumentSeparator.length;
    } else if (spaces === 0)
      fail(
        issue("INVALID_SYNTAX", call, "syntax", "宏名与参数之间需要空格或冒号"),
      );
    const parsed = splitArguments(rest, cursor, split);
    call.args = parsed.args;
    call.argumentOffsets = parsed.offsets;
  }
  return call;
}
function canScope(call: PageMacroCall): boolean {
  const definition = definitions.get(call.name.toLowerCase());
  if (!definition) return true;
  const count = call.args.length + 1;
  return (
    (definition.scoped ?? !definition.list) &&
    count >= definition.parameters.filter((item) => !item.optional).length &&
    count <= definition.parameters.length
  );
}
function parse(template: string, offset = 0): PageMacroNode[] {
  const flat: PageMacroNode[] = [];
  let index = 0,
    textStart = 0;
  const flush = () => {
    if (textStart < index)
      flat.push({
        kind: "text",
        text: template.slice(textStart, index),
        start: offset + textStart,
        end: offset + index,
      });
  };
  while (index < template.length) {
    const legacy = pageMacroRegistry.legacyForms
      .map((form) => ({
        form,
        match: form.pattern
          ? new RegExp(form.pattern, "i").exec(template.slice(index))
          : null,
      }))
      .find((item) => item.match);
    if (legacy?.match) {
      flush();
      const raw = legacy.match[0],
        args = legacy.form.argumentGroup
          ? [legacy.match[legacy.form.argumentGroup]!]
          : [];
      flat.push({
        kind: "macro",
        name: legacy.form.equivalent,
        args,
        argumentOffsets: args.map(() => offset + index),
        start: offset + index,
        end: offset + index + raw.length,
        raw,
        preserveWhitespace: false,
        closing: false,
      });
      index += raw.length;
      textStart = index;
      continue;
    }
    if (!template.startsWith("{{", index)) {
      index++;
      continue;
    }
    flush();
    const start = index;
    index += 2;
    let depth = 1;
    while (index < template.length && depth) {
      if (template.startsWith("{{", index)) {
        depth++;
        index += 2;
      } else if (template.startsWith("}}", index)) {
        depth--;
        index += 2;
      } else index++;
    }
    if (depth)
      fail(
        issue(
          "INVALID_SYNTAX",
          {
            name: template.slice(start + 2),
            start: offset + start,
            end: offset + index,
          },
          "syntax",
          "缺少结束括号 }}",
        ),
      );
    flat.push(header(template.slice(start, index), offset + start));
    textStart = index;
  }
  flush();
  const group = (items: PageMacroNode[]): PageMacroNode[] => {
    const nodes: PageMacroNode[] = [];
    for (let position = 0; position < items.length; position++) {
      const node = items[position]!;
      if (node.kind === "text") {
        nodes.push(node);
        continue;
      }
      if (node.closing)
        fail(issue("INVALID_SYNTAX", node, "syntax", "结束宏缺少对应的开始宏"));
      let close = -1;
      if (canScope(node)) {
        let depth = 1;
        for (let search = position + 1; search < items.length; search++) {
          const candidate = items[search]!;
          if (
            candidate.kind !== "macro" ||
            (definitions.get(candidate.name.toLowerCase())?.name ??
              candidate.name.toLowerCase()) !==
              (definitions.get(node.name.toLowerCase())?.name ??
                node.name.toLowerCase())
          )
            continue;
          if (candidate.closing) depth--;
          else if (canScope(candidate)) depth++;
          if (depth === 0) {
            close = search;
            break;
          }
        }
      }
      if (close >= 0) {
        const closing = items[close]!;
        node.body = group(items.slice(position + 1, close));
        node.end = closing.end;
        node.raw = template.slice(node.start - offset, node.end - offset);
        position = close;
      } else if (
        definitions.get(node.name.toLowerCase())?.handler === "if" &&
        node.args.length < 2
      ) {
        fail(
          issue(
            "INVALID_SYNTAX",
            node,
            "syntax",
            "if 需要正文参数或对应的 /if 结束宏",
          ),
        );
      }
      nodes.push(node);
    }
    return nodes;
  };
  return group(flat);
}
export function parsePageMacros(template: string): ParsedPageMacros {
  return { template, nodes: parse(template) };
}
function requirements(
  call: PageMacroCall,
  conditions: PageMacroConditions = {},
): PageMacroDiagnostic[] {
  const definition = definitions.get(call.name.toLowerCase());
  if (!definition) return [issue("UNKNOWN_MACRO", call, "unknown")];
  if (!definition.handler)
    return [
      {
        code: "HOST_CAPABILITY_REQUIRED",
        macro: call.name,
        message: definition.diagnostic!,
        start: call.start,
        end: call.end,
      },
    ];
  const result: PageMacroDiagnostic[] = [];
  const count = call.args.length + (call.body ? 1 : 0);
  const required = definition.parameters.filter(
    (item) => !item.optional,
  ).length;
  if (
    definition.strictArgs !== false &&
    (count < required ||
      (!definition.list && count > definition.parameters.length))
  )
    result.push(
      issue(
        "INVALID_ARGUMENTS",
        call,
        "arguments",
        "需要 " +
          required +
          " 至 " +
          (definition.list ? "任意多个" : definition.parameters.length) +
          " 个参数",
      ),
    );
  definition.parameters.forEach((parameter, index) => {
    const value = call.args[index];
    if (
      definition.strictArgs !== false &&
      parameter.type === "integer" &&
      value !== undefined &&
      !value.includes("{{") &&
      !new RegExp(pageMacroRegistry.syntax.integer).test(value.trim())
    )
      result.push(
        issue(
          "INVALID_ARGUMENTS",
          call,
          "arguments",
          parameter.name + " 需要整数",
        ),
      );
  });
  const condition = definition.condition;
  if (
    (condition?.card && conditions.card !== condition.card) ||
    (condition?.session && conditions.session !== condition.session) ||
    (condition?.messages && conditions.messages !== condition.messages)
  )
    result.push(
      issue("PURPOSE_REQUIRED", call, "condition", definition.purpose),
    );
  if (condition?.variables) {
    const variable = call.args[0] ?? "";
    if (
      !variable.includes("{{") &&
      (!Object.hasOwn(conditions.variables ?? {}, variable) ||
        !conditions.variables?.[variable]?.length)
    )
      result.push(
        issue("VARIABLE_BINDING_REQUIRED", call, "variable", variable),
      );
    else if (
      variable.includes("{{") &&
      !Object.keys(conditions.variables ?? {}).length
    )
      result.push(
        issue("VARIABLE_BINDING_REQUIRED", call, "variable", variable),
      );
  }
  return result;
}
function emptyDependencies(): PageMacroDependencies {
  return {
    performerName: false,
    card: false,
    state: false,
    messages: false,
    clock: false,
    random: false,
    userAgent: false,
  };
}
function readPath(
  root: unknown,
  path: PageMacroPath,
): { exists: boolean; value: unknown } {
  let value = root;
  for (const key of path) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return { exists: false, value: undefined };
    value = (value as Record<string | number, unknown>)[key];
  }
  return { exists: true, value };
}
function cardFields(
  definition: MacroDefinition,
  card: PageMacroCard,
  call: PageMacroCall,
): { path: string; text: string }[] {
  if (!definition.cardPath) return [];
  const field = (path: PageMacroPath): { path: string; text: string } => {
    const result = readPath(card, path);
    return {
      path: path.join("."),
      text: typeof result.value === "string" ? result.value : "",
    };
  };
  if (!definition.alternatePath) return [field(definition.cardPath)];
  const index = call.args[0] ?? definition.parameters[0]!.default!;
  if (index.includes("{{")) {
    const alternatives = readPath(card, definition.alternatePath).value;
    return [
      field(definition.cardPath),
      ...(Array.isArray(alternatives)
        ? alternatives.map((_text, index) =>
            field([...definition.alternatePath!, index]),
          )
        : []),
    ];
  }
  const number = Number(index);
  return [
    field(
      number === 0
        ? definition.cardPath
        : [...definition.alternatePath, number - 1],
    ),
  ];
}

function implicitConditionMacro(condition: string): string | null {
  const optionalMacro = definitions
    .get(condition.toLowerCase())
    ?.parameters.every((item) => item.optional);
  return variableShorthand(condition) || optionalMacro
    ? "{{" + condition + "}}"
    : null;
}

export function analyzePageMacros(
  template: string,
  options: PageMacroAnalysisOptions = {},
): PageMacroAnalysis {
  const analysis: PageMacroAnalysis = {
    macros: [],
    dependencies: emptyDependencies(),
    diagnostics: [],
    statePaths: [],
  };
  const visit = (nodes: PageMacroNode[], fieldChain: string[] = []): void => {
    for (const node of nodes) {
      if (node.kind === "text") continue;
      const definition = definitions.get(node.name.toLowerCase());
      if (!analysis.macros.includes(definition?.name ?? node.name))
        analysis.macros.push(definition?.name ?? node.name);
      for (const dependency of definition?.dependencies ?? [])
        analysis.dependencies[dependency] = true;
      analysis.diagnostics.push(...requirements(node, options.conditions));
      if (definition?.condition?.variables) {
        const name = node.args[0] ?? "";
        const paths = name.includes("{{")
          ? Object.values(options.conditions?.variables ?? {})
          : options.conditions?.variables?.[name]
            ? [options.conditions.variables[name]!]
            : [];
        for (const path of paths) {
          if (
            !analysis.statePaths.some(
              (existing) =>
                existing.length === path.length &&
                existing.every((part, index) => part === path[index]),
            )
          )
            analysis.statePaths.push(path);
        }
      }
      node.args.forEach((arg, index) =>
        visit(parse(arg, node.argumentOffsets[index]), fieldChain),
      );
      if (node.body) visit(node.body, fieldChain);
      if (
        definition?.handler === "card" &&
        definition.expand !== false &&
        options.card
      ) {
        for (const field of cardFields(definition, options.card, node)) {
          const chain = [...fieldChain, field.path];
          if (fieldChain.includes(field.path)) {
            analysis.diagnostics.push(
              issue("CARD_REFERENCE_CYCLE", node, "cycle", chain.join(" → "), {
                fieldChain: chain,
              }),
            );
          } else {
            visit(parse(field.text, node.start), chain);
          }
        }
      }
      if (definition?.handler === "if") {
        const condition = (node.args[0] ?? "").replace(/^\s*!\s*/, "");
        const implicit = implicitConditionMacro(condition);
        if (implicit)
          visit(parse(implicit, node.argumentOffsets[0]), fieldChain);
      }
    }
  };
  try {
    visit(parse(template));
  } catch (error) {
    if (!(error instanceof PageMacroError)) throw error;
    analysis.diagnostics.push(error.diagnostic);
  }
  return analysis;
}
export function validatePageMacroBindings(
  bindings: readonly PageMacroBinding[],
  options: { card?: PageMacroCard } = {},
): PageMacroDiagnostic[] {
  const diagnostics: PageMacroDiagnostic[] = [],
    ids = new Set<string>();
  for (const binding of bindings) {
    if (!binding.id || ids.has(binding.id))
      diagnostics.push({
        code: "INVALID_BINDING",
        macro: "",
        message: pageMacroRegistry.diagnostics.invalidBinding,
        start: 0,
        end: binding.template.length,
        bindingId: binding.id,
      });
    ids.add(binding.id);
    diagnostics.push(
      ...analyzePageMacros(binding.template, {
        conditions: binding.conditions,
        card: options.card,
      }).diagnostics.map((diagnostic) => ({
        ...diagnostic,
        bindingId: binding.id,
      })),
    );
  }
  return diagnostics;
}
function trimScoped(text: string): string {
  const lines = text.split("\n"),
    first = lines.find((line) => line.trim() !== "");
  const indentation = first?.match(/^[ \t]*/)?.[0].length ?? 0;
  return lines
    .map((line) =>
      (line.match(/^[ \t]*/)?.[0].length ?? 0) >= indentation
        ? line.slice(indentation)
        : line.trimStart(),
    )
    .join("\n")
    .trim();
}
interface EvaluationContext {
  values: PageMacroValues;
  conditions: PageMacroConditions;
  fieldChain: string[];
}
interface MessageReadRequest {
  call: PageMacroCall;
}
type MacroEvaluation = Generator<
  MessageReadRequest,
  string,
  readonly PageMacroMessage[]
>;

function* evaluateNodes(
  nodes: PageMacroNode[],
  context: EvaluationContext,
): MacroEvaluation {
  let output = "",
    trimNext = false;
  for (const node of nodes) {
    if (
      node.kind === "macro" &&
      !node.body &&
      definitions.get(node.name.toLowerCase())?.handler === "trim"
    ) {
      yield* evaluateCall(node, context);
      output = output.replace(/\n*$/, "");
      trimNext = true;
      continue;
    }
    let value =
      node.kind === "text" ? node.text : yield* evaluateCall(node, context);
    if (trimNext) {
      value = value.replace(/^\n*/, "");
      if (value !== "") trimNext = false;
    }
    output += value;
  }
  return output;
}
function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}
function readData<T>(
  value: T | (() => unknown) | undefined,
  call: PageMacroCall,
  dataKey: string,
): unknown {
  try {
    return typeof value === "function" ? (value as () => unknown)() : value;
  } catch (error) {
    if (errorCode(error) === "DATA_NOT_FOUND")
      fail(issue("DATA_NOT_FOUND", call, "missing", "", { dataKey }));
    throw error;
  }
}

function warn(
  call: PageMacroCall,
  context: EvaluationContext,
  reason: string,
): void {
  const diagnostic = issue("INVALID_VALUE", call, "invalid", reason);
  if (context.values.onDiagnostic) context.values.onDiagnostic(diagnostic);
  else console.warn(diagnostic.message);
}
function randomValue(
  context: EvaluationContext,
  fallback: () => number,
  call: PageMacroCall,
): number {
  const value = (context.values.random ?? fallback)();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    fail(issue("INVALID_VALUE", call, "invalid", "随机值需要位于 [0, 1)"));
  return value;
}
function randomList(text: string): string[] {
  if (text.includes(pageMacroRegistry.syntax.argumentSeparator))
    return text
      .split(pageMacroRegistry.syntax.argumentSeparator)
      .map((value) => value.trim());
  const values: string[] = [];
  let value = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\" && text[index + 1] === ",") {
      value += ",";
      index++;
    } else if (text[index] === ",") {
      values.push(value.trim());
      value = "";
    } else value += text[index];
  }
  values.push(value.trim());
  return values;
}

function* evaluateCall(
  call: PageMacroCall,
  context: EvaluationContext,
): MacroEvaluation {
  const problems = requirements(call, context.conditions);
  if (problems.length) fail(problems[0]!);
  const definition = definitions.get(call.name.toLowerCase())!;
  const resolve = function* (
    text: string,
    offset = call.start,
  ): MacroEvaluation {
    return yield* evaluateNodes(parse(text, offset), context);
  };
  if (definition.handler === "if") {
    let condition = call.args[0]!,
      inverted = /^\s*!/.test(condition);
    condition = yield* resolve(condition.replace(/^\s*!\s*/, ""));
    const implicit = implicitConditionMacro(condition);
    if (implicit) condition = yield* resolve(implicit);
    const truth =
      condition !== "" &&
      !["false", "off", "0"].includes(condition.trim().toLowerCase());
    const body = call.body ?? parse(call.args[1]!, call.argumentOffsets[1]);
    const split = body.findIndex(
      (node) =>
        node.kind === "macro" &&
        definitions.get(node.name.toLowerCase())?.handler === "else",
    );
    const chosen = (inverted ? !truth : truth)
      ? body.slice(0, split < 0 ? body.length : split)
      : split < 0
        ? []
        : body.slice(split + 1);
    const result = yield* evaluateNodes(chosen, context);
    return call.preserveWhitespace ? result : trimScoped(result);
  }
  const args: string[] = [];
  for (let index = 0; index < call.args.length; index++)
    args.push(yield* resolve(call.args[index]!, call.argumentOffsets[index]));
  if (call.body) {
    const body = yield* evaluateNodes(call.body, context);
    args.push(call.preserveWhitespace ? body : trimScoped(body));
  }
  for (let index = 0; index < definition.parameters.length; index++) {
    if (
      definition.strictArgs !== false &&
      definition.parameters[index]?.type === "integer" &&
      args[index] !== undefined &&
      !new RegExp(pageMacroRegistry.syntax.integer).test(args[index]!.trim())
    )
      fail(
        issue(
          "INVALID_ARGUMENTS",
          call,
          "arguments",
          definition.parameters[index]!.name + " 需要整数",
        ),
      );
  }
  switch (definition.handler) {
    case "user": {
      const value = readData(
        context.values.performerName,
        call,
        pageMacroRegistry.dataKeys.performerName,
      );
      if (typeof value !== "string")
        fail(
          issue("DATA_NOT_FOUND", call, "missing", "", {
            dataKey: pageMacroRegistry.dataKeys.performerName,
          }),
        );
      return value;
    }
    case "card": {
      const value = readData(
        context.values.card,
        call,
        pageMacroRegistry.dataKeys.card,
      );
      if (!value || typeof value !== "object")
        fail(
          issue("DATA_NOT_FOUND", call, "missing", "", {
            dataKey: pageMacroRegistry.dataKeys.card,
          }),
        );
      const field = cardFields(definition, value as PageMacroCard, {
        ...call,
        args,
      })[0]!;
      if (definition.expand === false) return field.text;
      const chain = [...context.fieldChain, field.path];
      if (context.fieldChain.includes(field.path))
        fail(
          issue("CARD_REFERENCE_CYCLE", call, "cycle", chain.join(" → "), {
            fieldChain: chain,
          }),
        );
      const text = yield* evaluateNodes(
        parse(definition.trim ? field.text.trim() : field.text, call.start),
        {
          ...context,
          fieldChain: chain,
        },
      );
      return text;
    }
    case "getvar":
    case "hasvar": {
      const name = args[0]!,
        path = context.conditions.variables?.[name];
      if (!path?.length)
        fail(issue("VARIABLE_BINDING_REQUIRED", call, "variable", name));
      const state =
        typeof context.values.state === "function"
          ? context.values.state()
          : context.values.state;
      if (!state)
        fail(
          issue("DATA_NOT_FOUND", call, "missing", "", {
            dataKey: pageMacroRegistry.dataKeys.state,
          }),
        );
      const entry = readPath(state.variables, path);
      if (definition.handler === "hasvar")
        return entry.exists ? "true" : "false";
      const value = entry.value;
      const normalized =
        (typeof value === "string" && value.trim() === "") ||
        Number.isNaN(Number(value))
          ? value || ""
          : Number(value);
      return normalized !== null && typeof normalized === "object"
        ? JSON.stringify(normalized)
        : String(normalized ?? "");
    }
    case "space":
    case "newline": {
      const count = Number(args[0] ?? definition.parameters[0]?.default);
      if (!Number.isSafeInteger(count) || count < 0)
        fail(
          issue("INVALID_ARGUMENTS", call, "arguments", "count 需要非负整数"),
        );
      return (definition.handler === "space" ? " " : "\n").repeat(count);
    }
    case "noop":
    case "//":
    case "else":
      return "";
    case "reverse":
      return Array.from(args[0]!).reverse().join("");
    case "trim":
      return call.body ? args.at(-1)! : "";
    case "message": {
      const messages = context.values.messages ?? (yield { call });
      context.values.messages = messages;
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]!;
        if (!definition.role || definition.role === message.role)
          return message.text;
      }
      return "";
    }
    case "random": {
      const list = args.length === 1 ? randomList(args[0]!) : args;
      if (!list.length) return "";
      const rng =
        context.values.random ??
        seedrandom("added entropy.", { entropy: true });
      return list[Math.floor(randomValue(context, rng, call) * list.length)]!;
    }
    case "roll": {
      const formula = /^\d+$/.test(args[0]!) ? "1d" + args[0] : args[0]!;
      const match = new RegExp(definition.formulaPattern!, "i").exec(formula);
      const count = Number(match?.[1] ?? 1),
        sides = Number(match?.[2]),
        modifier = Number(match?.[3] ?? 0);
      if (
        !match ||
        count < 1 ||
        sides < 1 ||
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(sides) ||
        !Number.isSafeInteger(modifier)
      ) {
        warn(
          call,
          context,
          "骰子公式需要 [正整数骰子数]d正整数面数[整数修正值]",
        );
        return "";
      }
      let total = modifier;
      for (let index = 0; index < count; index++)
        total +=
          Math.floor(randomValue(context, Math.random, call) * sides) + 1;
      return String(total);
    }
    case "isMobile": {
      const ua =
        context.values.userAgent ??
        (typeof navigator === "undefined" ? "" : navigator.userAgent);
      const type = Bowser.parse(ua).platform.type;
      return String(type === "mobile" || type === "tablet");
    }
    case "timeDiff": {
      const left = moment(args[0]).locale("en"),
        right = moment(args[1]).locale("en");
      if (!left.isValid() || !right.isValid()) {
        warn(call, context, "日期参数无法解析");
        return "Invalid date";
      }
      return moment.duration(left.diff(right)).locale("en").humanize(true);
    }
    case "time":
    case "date":
    case "weekday":
    case "datetimeformat":
    case "isotime":
    case "isodate": {
      const time = moment((context.values.now ?? (() => new Date()))()).locale(
        "en",
      );
      if (!time.isValid())
        fail(issue("INVALID_VALUE", call, "invalid", "当前时刻无法解析"));
      if (definition.handler === "time") {
        const match = /^UTC([+-]\d+)$/.exec(args[0] ?? "");
        if (match) {
          const offset = Number(match[1]);
          if (!Number.isSafeInteger(offset))
            fail(
              issue("INVALID_VALUE", call, "invalid", "UTC 偏移需要有效整数"),
            );
          const shifted = time.utc().utcOffset(offset);
          if (!shifted.isValid())
            fail(
              issue("INVALID_VALUE", call, "invalid", "UTC 偏移超出日期范围"),
            );
          return shifted.format(definition.format);
        }
        return time.format(definition.format);
      }
      return time.format(
        definition.handler === "datetimeformat" ? args[0] : definition.format,
      );
    }
    default:
      fail(issue("INVALID_VALUE", call, "invalid", "宏求值函数尚未实现"));
  }
}
export function evaluatePageMacros(
  template: string,
  values: PageMacroValues,
  conditions: PageMacroConditions = {},
): string {
  const evaluation = evaluateNodes(parse(template), {
    values: { ...values },
    conditions,
    fieldChain: [],
  });
  const result = evaluation.next();
  if (result.done) return result.value;
  evaluation.return("");
  fail(
    issue("DATA_NOT_FOUND", result.value.call, "missing", "", {
      dataKey: pageMacroRegistry.dataKeys.messages,
    }),
  );
}

export interface MountPageMacrosOptions {
  bindings: readonly PageMacroBinding[];
  values: PageMacroValues;
  readMessages?: (branchId: string) => Promise<readonly PageMacroMessage[]>;
  watchState?: (
    listener: (state: PageMacroState) => Promise<void>,
  ) => () => void;
  watchMessages?: (listener: () => Promise<void>) => () => void;
  render: (id: string, text: string) => void;
}
export interface MountedPageMacros {
  dispose(): void;
  refresh(): Promise<void>;
}
function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameData(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

export async function mountPageMacros(
  options: MountPageMacrosOptions,
): Promise<MountedPageMacros> {
  let disposed = false,
    initializing = true;
  const stops: (() => void)[] = [];
  let current: PageMacroState | undefined;
  const values: PageMacroValues = { ...options.values };
  const cacheFixed = <T>(
    input: T | (() => unknown) | undefined,
  ): T | (() => unknown) | undefined => {
    if (typeof input !== "function") return input;
    let loaded = false,
      cached: unknown;
    return () => {
      if (!loaded) {
        cached = (input as () => unknown)();
        loaded = true;
      }
      return cached;
    };
  };
  values.performerName = cacheFixed(options.values.performerName);
  values.card = cacheFixed(options.values.card);
  let card: PageMacroCard | undefined;
  if (
    options.bindings.some(
      (binding) =>
        analyzePageMacros(binding.template, { conditions: binding.conditions })
          .dependencies.card,
    )
  ) {
    try {
      const loaded =
        typeof values.card === "function" ? values.card() : values.card;
      if (loaded && typeof loaded === "object") card = loaded as PageMacroCard;
    } catch (error) {
      values.card = () => {
        throw error;
      };
    }
  }
  const entries = options.bindings.map((binding) => {
    const analysis = analyzePageMacros(binding.template, {
      conditions: binding.conditions,
      card,
    });
    return {
      binding,
      sequence: 0,
      dependencies: analysis.dependencies,
      statePaths: analysis.statePaths,
    };
  });
  const state = () =>
    current ??
    (typeof values.state === "function" ? values.state() : values.state);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const entry of entries) entry.sequence++;
    for (const stop of stops.splice(0)) stop();
  };
  const run = async (entry: (typeof entries)[number]): Promise<void> => {
    if (disposed) return;
    const sequence = ++entry.sequence;
    let branchId: string | undefined;
    const obsolete = () =>
      disposed ||
      sequence !== entry.sequence ||
      (entry.dependencies.messages && state()?.branchId !== branchId);
    try {
      const snapshot = entry.dependencies.state ? state() : undefined;
      branchId = snapshot?.branchId;
      const selectedValues: PageMacroValues = { ...values, state: snapshot };
      const evaluation = evaluateNodes(parse(entry.binding.template), {
        values: selectedValues,
        conditions: entry.binding.conditions ?? {},
        fieldChain: [],
      });
      let result = evaluation.next();
      while (!result.done) {
        if (!snapshot || !options.readMessages)
          fail(
            issue("DATA_NOT_FOUND", result.value.call, "missing", "", {
              dataKey:
                pageMacroRegistry.dataKeys.state +
                ".branchId/" +
                pageMacroRegistry.dataKeys.messages,
            }),
          );
        const messages = await options.readMessages(snapshot.branchId);
        if (obsolete()) {
          evaluation.return("");
          return;
        }
        result = evaluation.next(messages);
      }
      if (obsolete()) return;
      options.render(entry.binding.id, result.value);
    } catch (error) {
      if (obsolete()) return;
      if (errorCode(error) === "VIEW_DISPOSED") {
        dispose();
        return;
      }
      options.render(entry.binding.id, entry.binding.template);
      if (error instanceof PageMacroError)
        throw new PageMacroError({
          ...error.diagnostic,
          bindingId: entry.binding.id,
        });
      throw error;
    }
  };
  const update = async (selected: typeof entries): Promise<void> => {
    const results = await Promise.allSettled(selected.map(run));
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) throw failed.reason;
  };
  try {
    const hasState = entries.some((entry) => entry.dependencies.state);
    const hasMessages = entries.some((entry) => entry.dependencies.messages);
    if (hasState && options.watchState)
      stops.push(
        options.watchState(async (snapshot) => {
          const previous = state();
          current = snapshot;
          if (!initializing && !disposed)
            await update(
              entries.filter(
                (entry) =>
                  entry.dependencies.state &&
                  (previous?.branchId !== snapshot.branchId ||
                    entry.statePaths.some((path) => {
                      const before = readPath(previous?.variables, path),
                        after = readPath(snapshot.variables, path);
                      return (
                        before.exists !== after.exists ||
                        !sameData(before.value, after.value)
                      );
                    })),
              ),
            );
        }),
      );
    if (hasMessages && options.watchMessages)
      stops.push(
        options.watchMessages(async () => {
          if (!initializing && !disposed)
            await update(
              entries.filter((entry) => entry.dependencies.messages),
            );
        }),
      );
    initializing = false;
    await update(entries);
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose, refresh: () => update(entries) };
}
