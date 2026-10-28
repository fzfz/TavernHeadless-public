import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import Ajv from "ajv";
import ts from "typescript";
import config from "../config/page-macro-bindings.json" with { type: "json" };
import macroConfig from "../config/page-macros.json" with { type: "json" };
import requestSchema from "./page-macro-bindings.schema.json" with { type: "json" };
import { readTaskContext, taskRepositoryRoot } from "./task-context.ts";
import { withDerivedTask } from "./task-derivation.ts";
import { prepareTarget } from "./package-target.ts";
import { listFiles } from "./index.ts";
import { replaceFileContents } from "./atomic-write.ts";
import { buildPageMacros } from "./build-page-macros.ts";
import {
  analyzePageMacros,
  validatePageMacroBindings,
  pageMacroRegistry,
  type PageMacroBinding,
  type PageMacroCard,
  type PageMacroConditions,
} from "./page-macros.ts";
import {
  getNativeCardPackageFileRule,
  nativeCardFileRules,
} from "../../../../packages/shared/src/native-card-package.ts";
import { nativeCardFrontendManifestSchema } from "../../../../packages/shared/src/schemas/native-card-package/schema.ts";
import { validateNativeCardFrontendModules } from "../../../../apps/api/src/services/native-card/frontend-module-static-checker.ts";
import { validateNativeCardFrontendMarkup } from "../../../../apps/api/src/services/native-card/frontend-markup-checker.ts";

type SourcePosition = { pointer: string; start: number; end: number };
type BindingRequest = {
  id: string;
  source: SourcePosition;
  htmlFile: string;
  template: string;
  location?: { before: string; after: string };
  conditions?: PageMacroConditions;
  stateSchemaFile?: string;
};
type Installation = {
  originalScript: string;
  sources: Array<Omit<BindingRequest, "template" | "conditions">>;
};
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  content?: HtmlNode;
  parentNode?: HtmlNode;
  sourceCodeLocation?: { startOffset: number; endOffset: number };
};
const requireApi = createRequire(
  join(taskRepositoryRoot, "apps/api/package.json"),
);
const { parseFragment } = requireApi("parse5") as {
  parseFragment(
    html: string,
    options?: { sourceCodeLocationInfo: boolean },
  ): HtmlNode;
};
const validateRequest = new Ajv({
  strict: false,
  allErrors: true,
}).compile<BindingRequest>(requestSchema);
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const diagnostic = (
  key: keyof typeof config.diagnostics,
  values: Record<string, unknown> = {},
) =>
  config.diagnostics[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name]),
  );

function sourceAt(source: unknown, pointer: string): unknown {
  let value = source;
  for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function extractCard(source: unknown): PageMacroCard {
  const cardSource = sourceAt(source, "/data") ?? source;
  const result: Record<string, unknown> = {};
  const paths = pageMacroRegistry.macros
    .flatMap((definition) => [definition.cardPath, definition.alternatePath])
    .filter((path): path is string[] => path !== undefined);
  for (const path of paths) {
    const value = sourceAt(
      cardSource,
      "/" +
        path
          .map((key) => key.replaceAll("~", "~0").replaceAll("/", "~1"))
          .join("/"),
    );
    if (value === undefined) continue;
    let target = result;
    for (const key of path.slice(0, -1))
      target = (target[key] ??= {}) as Record<string, unknown>;
    target[path.at(-1)!] = value;
  }
  return result as unknown as PageMacroCard;
}

function descendants(node: HtmlNode): HtmlNode[] {
  return [
    node,
    ...(node.childNodes ?? []).flatMap(descendants),
    ...(node.content ? descendants(node.content) : []),
  ];
}

function visibleText(node: HtmlNode): boolean {
  if (node.nodeName !== "#text") return false;
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (
      ["script", "style", "textarea", "title", "template"].includes(
        parent.tagName ?? "",
      ) ||
      (parent.namespaceURI &&
        parent.namespaceURI !== "http://www.w3.org/1999/xhtml")
    )
      return false;
  }
  return true;
}

function replaceTemplate(
  html: string,
  request: BindingRequest,
  alreadyBound: boolean,
) {
  const nodes = descendants(
    parseFragment(html, { sourceCodeLocationInfo: true }),
  );
  const marker = nodes.filter((node) =>
    node.attrs?.some(
      (attr) =>
        attr.name === config.layout.attribute && attr.value === request.id,
    ),
  );
  if (alreadyBound) {
    if (marker.length !== 1)
      throw new Error(
        diagnostic("location", {
          file: request.htmlFile,
          count: marker.length,
        }),
      );
    return html;
  }
  if (marker.length)
    throw new Error(diagnostic("collision", { id: request.id }));
  const before = request.location?.before ?? "",
    after = request.location?.after ?? "";
  const needle = before + request.template + after;
  const matches: number[] = [];
  for (
    let offset = html.indexOf(needle);
    offset >= 0;
    offset = html.indexOf(needle, offset + 1)
  )
    matches.push(offset + before.length);
  if (matches.length !== 1)
    throw new Error(
      diagnostic("location", { file: request.htmlFile, count: matches.length }),
    );
  const start = matches[0]!,
    end = start + request.template.length;
  const textNode = nodes.find(
    (node) =>
      visibleText(node) &&
      node.sourceCodeLocation &&
      node.sourceCodeLocation.startOffset <= start &&
      node.sourceCodeLocation.endOffset >= end,
  );
  if (!textNode?.sourceCodeLocation)
    throw new Error(diagnostic("text", { file: request.htmlFile }));
  const nodeStart = textNode.sourceCodeLocation.startOffset,
    nodeEnd = textNode.sourceCodeLocation.endOffset;
  if (
    textTemplate(html.slice(nodeStart, nodeEnd)) !==
    textTemplate(html.slice(nodeStart, start)) +
      textTemplate(request.template) +
      textTemplate(html.slice(end, nodeEnd))
  )
    throw new Error(diagnostic("boundary", { file: request.htmlFile }));
  return (
    html.slice(0, start) +
    `<${config.layout.tag} ${config.layout.attribute}="${request.id}"></${config.layout.tag}>` +
    html.slice(end)
  );
}

function textTemplate(template: string): string {
  return descendants(parseFragment(template))
    .filter((node) => node.nodeName === "#text")
    .map((node) => node.value ?? "")
    .join("");
}

function readBindings(content: string | undefined): PageMacroBinding[] {
  if (!content) return [];
  const source = ts.createSourceFile(
    config.paths.bindings,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === config.exports.bindings &&
        declaration.initializer
      )
        return JSON.parse(
          declaration.initializer.getText(source),
        ) as PageMacroBinding[];
    }
  }
  throw new Error(diagnostic("generated", { file: config.paths.bindings }));
}

function relativeImport(from: string, to: string) {
  const value = posix.relative(posix.dirname(from), to);
  return value.startsWith(".") ? value : "./" + value;
}

function schemaBranches(
  value: unknown,
  root: unknown,
  visited = new Set<unknown>(),
): Record<string, unknown>[] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    visited.has(value)
  )
    return [];
  visited.add(value);
  const schema = value as Record<string, unknown>;
  const branches = [schema];
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/"))
    branches.push(
      ...schemaBranches(sourceAt(root, schema.$ref.slice(1)), root, visited),
    );
  for (const key of ["allOf", "anyOf", "oneOf"])
    if (Array.isArray(schema[key]))
      for (const item of schema[key])
        branches.push(...schemaBranches(item, root, visited));
  return branches;
}

function schemaHasPath(
  root: unknown,
  path: readonly (string | number)[],
): boolean {
  let schemas: unknown[] = [root];
  for (const segment of path) {
    schemas = schemas
      .flatMap((value) => schemaBranches(value, root))
      .flatMap((schema) => {
        if (typeof segment === "number") {
          const item = Array.isArray(schema.prefixItems)
            ? schema.prefixItems[segment]
            : undefined;
          return item !== undefined
            ? [item]
            : schema.items &&
                typeof schema.items === "object" &&
                !Array.isArray(schema.items)
              ? [schema.items]
              : [];
        }
        const properties = schema.properties;
        return properties &&
          typeof properties === "object" &&
          Object.hasOwn(properties, segment)
          ? [(properties as Record<string, unknown>)[segment]]
          : [];
      });
    if (!schemas.length) return false;
  }
  return true;
}

function generatedEntry(
  originalScript: string,
  originalContent: string,
  bindings: PageMacroBinding[],
  card?: PageMacroCard,
): string {
  const source = ts.createSourceFile(
    originalScript,
    originalContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const mounts = source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text ===
        nativeCardFileRules.frontendModuleApi.entryExport,
  );
  const mount = mounts[0];
  if (
    mounts.length !== 1 ||
    !mount?.body ||
    !mount.parameters[0] ||
    !ts.isObjectBindingPattern(mount.parameters[0].name)
  )
    throw new Error(diagnostic("entry", { file: originalScript }));
  const apiElement = mount.parameters[0].name.elements.find(
    (element) =>
      (element.propertyName?.getText(source) ??
        element.name.getText(source)) === "api",
  );
  if (!apiElement || !ts.isIdentifier(apiElement.name))
    throw new Error(diagnostic("entry", { file: originalScript }));
  const api = apiElement.name.text;
  const identifiers = new Set<string>();
  const layoutIds = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "register" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "ui"
    ) {
      const id = node.arguments[0];
      if (
        id &&
        (ts.isStringLiteral(id) || ts.isNoSubstitutionTemplateLiteral(id))
      )
        layoutIds.add(id.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  let layoutId = config.layout.id;
  for (let suffix = 1; layoutIds.has(layoutId); suffix++)
    layoutId = config.layout.id + suffix;
  const fresh = (prefix: string) => {
    let name = prefix;
    for (let index = 1; identifiers.has(name); index++) name = prefix + index;
    identifiers.add(name);
    return name;
  };
  const publicMount = fresh("mountPageMacroText"),
    importedBindings = fresh("macroBindings"),
    layout = fresh("macroLayout");
  const statements = source.statements
    .filter((statement) => statement !== mount)
    .map((statement) => {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const value = statement.moduleSpecifier.text;
        if (value.startsWith("."))
          return statement
            .getText(source)
            .replace(
              statement.moduleSpecifier.getText(source),
              JSON.stringify(
                relativeImport(
                  config.paths.entry,
                  posix.normalize(
                    posix.join(posix.dirname(originalScript), value),
                  ),
                ),
              ),
            );
      }
      return statement.getText(source);
    });
  const dependencies = bindings.map(
    (binding) =>
      analyzePageMacros(binding.template, {
        conditions: binding.conditions,
        card,
      }).dependencies,
  );
  const uses = (key: keyof (typeof dependencies)[number]) =>
    dependencies.some((dependency) => dependency[key]);
  const values: string[] = [];
  if (uses("performerName"))
    values.push(
      `performerName: () => ${api}.data.get(${JSON.stringify(macroConfig.dataKeys.performerName)})`,
    );
  if (uses("card"))
    values.push(
      `card: () => ${api}.data.get(${JSON.stringify(macroConfig.dataKeys.card)})`,
    );
  if (uses("state"))
    values.push(
      `state: () => ${api}.variables.get(${JSON.stringify(macroConfig.dataKeys.state)})`,
    );
  const options = [
    `bindings: ${importedBindings}`,
    `values: {${values.join(", ")}}`,
    `render: (id, text) => ${layout}.update({ [id]: { text } })`,
  ];
  if (uses("state"))
    options.push(
      `watchState: (listener) => ${api}.variables.watch(${JSON.stringify(macroConfig.dataKeys.state)}, (state) => listener(state))`,
    );
  if (uses("messages")) {
    options.push(`readMessages: async (branchId) => {
      const floors = [];
      let cursor;
      do {
        const page = await ${api}.messages.listFloors({ branchId, ...(cursor ? { cursor } : {}) });
        floors.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const messages = [];
      for (const floor of floors.reverse()) messages.push(...await ${api}.messages.getFloor({ branchId, floorId: floor.floorId }));
      return messages;
    }`);
    options.push(
      `watchMessages: (listener) => ${api}.variables.onTurnCommitted(() => listener())`,
    );
  }
  const elements = Object.fromEntries(
    bindings.map((binding) => [
      binding.id,
      {
        selector: `[${config.layout.attribute}="${binding.id}"]`,
        kind: "text",
      },
    ]),
  );
  return [
    `import { mountPageMacros as ${publicMount} } from ${JSON.stringify(relativeImport(config.paths.entry, config.paths.runtime))};`,
    `import { ${config.exports.bindings} as ${importedBindings} } from ${JSON.stringify(relativeImport(config.paths.entry, config.paths.bindings))};`,
    ...statements,
    `export async function mount({ api: ${api} }) {`,
    `  await (${mount.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : ""}() => ${mount.body.getText(source)})();`,
    `  const ${layout} = ${api}.ui.register(${JSON.stringify(layoutId)}, { elements: ${JSON.stringify(elements)} });`,
    `  await ${publicMount}({ ${options.join(", ")} });`,
    "}",
    "",
  ].join("\n");
}

export async function bindPageMacros(taskFile: string, requestFile: string) {
  const task = await readTaskContext(taskFile);
  const value: unknown = JSON.parse(await readFile(requestFile, "utf8"));
  if (!validateRequest(value))
    throw new Error(diagnostic("request") + " " + json(validateRequest.errors));
  const request: BindingRequest = {
    ...value,
    source: {
      pointer: value.source.pointer,
      start: value.source.start,
      end: value.source.end,
    },
  };
  const sourceContents = await readFile(task.sourceFile);
  const source: unknown = JSON.parse(sourceContents.toString("utf8"));
  const sourceText = sourceAt(source, request.source.pointer);
  if (
    typeof sourceText !== "string" ||
    !Number.isSafeInteger(request.source.start) ||
    !Number.isSafeInteger(request.source.end) ||
    request.source.start > request.source.end ||
    request.source.end > sourceText.length ||
    sourceText.slice(request.source.start, request.source.end) !==
      request.template
  )
    throw new Error(diagnostic("source", { pointer: request.source.pointer }));
  const originalFiles = await listFiles(task.packageDirectory);
  const files = new Map(
    originalFiles.map((file) => [
      file.path,
      Buffer.from(file.content).toString("utf8"),
    ]),
  );
  const get = (path: string) => {
    const file = files.get(path);
    if (file === undefined) throw new Error(diagnostic("path", { file: path }));
    return file;
  };
  const manifest = nativeCardFrontendManifestSchema.parse(
    JSON.parse(get(config.paths.frontendManifest)),
  );
  if (manifest.html !== request.htmlFile)
    throw new Error(diagnostic("html", { file: request.htmlFile }));
  const prior = files.get(config.paths.installation);
  const installation: Installation = prior
    ? (JSON.parse(prior) as Installation)
    : { originalScript: manifest.script, sources: [] };
  if (!prior)
    for (const path of [
      config.paths.runtime,
      config.paths.bindings,
      config.paths.entry,
    ])
      if (files.has(path))
        throw new Error(diagnostic("generated", { file: path }));
  const originalIssues = validateNativeCardFrontendModules(
    originalFiles,
    installation.originalScript,
    nativeCardFileRules.frontendModuleApi,
  );
  if (originalIssues.length) return { passed: false, issues: originalIssues };
  const previous = installation.sources.find((item) => item.id === request.id);
  if (
    previous &&
    (previous.htmlFile !== request.htmlFile ||
      JSON.stringify(previous.source) !== JSON.stringify(request.source))
  )
    throw new Error(diagnostic("collision", { id: request.id }));
  const bindings = readBindings(files.get(config.paths.bindings));
  const binding: PageMacroBinding = {
    id: request.id,
    template: textTemplate(request.template),
    ...(request.conditions ? { conditions: request.conditions } : {}),
  };
  const index = bindings.findIndex((item) => item.id === request.id);
  if (index >= 0) bindings[index] = binding;
  else bindings.push(binding);
  for (const item of bindings) {
    const variables = item.conditions?.variables;
    if (!variables || !Object.keys(variables).length) continue;
    const metadata =
      item.id === request.id
        ? request
        : installation.sources.find((entry) => entry.id === item.id);
    const schemaFile =
      metadata?.stateSchemaFile ??
      nativeCardFileRules.creationTemplates.find(
        (template) => template.id === "stateSchema",
      )!.pathTemplate;
    const schema: unknown = JSON.parse(get(schemaFile));
    for (const [name, path] of Object.entries(variables))
      if (!schemaHasPath(schema, path))
        throw new Error(
          diagnostic("schema", {
            name,
            path: JSON.stringify(path),
            file: schemaFile,
          }),
        );
  }
  const card = extractCard(source);
  const macroIssues = validatePageMacroBindings(bindings, { card });
  const usesCard = bindings.some(
    (item) =>
      analyzePageMacros(item.template, { conditions: item.conditions, card })
        .dependencies.card,
  );
  if (macroIssues.length)
    return {
      passed: false,
      issues: macroIssues.map((issue) => ({
        ...issue,
        file: request.htmlFile,
        source: request.source,
      })),
    };
  const html = replaceTemplate(get(request.htmlFile), request, !!previous);
  const { template: _template, conditions: _conditions, ...metadata } = request;
  if (previous)
    installation.sources[installation.sources.indexOf(previous)] = metadata;
  else installation.sources.push(metadata);
  const outputs = new Map<string, string>([
    [request.htmlFile, html],
    [config.paths.runtime, await buildPageMacros()],
    [
      config.paths.bindings,
      `export const ${config.exports.bindings} = ${json(bindings).trimEnd()};\n`,
    ],
    [
      config.paths.entry,
      generatedEntry(
        installation.originalScript,
        get(installation.originalScript),
        bindings,
        card,
      ),
    ],
    [config.paths.installation, json(installation)],
    [
      config.paths.frontendManifest,
      json({
        ...manifest,
        script: config.paths.entry,
        data: {
          ...manifest.data,
          ...(usesCard
            ? { [macroConfig.dataKeys.card]: config.paths.card }
            : {}),
        },
      }),
    ],
  ]);
  if (usesCard) {
    if (
      !prior &&
      (files.has(config.paths.card) || manifest.data[macroConfig.dataKeys.card])
    )
      throw new Error(diagnostic("generated", { file: config.paths.card }));
    outputs.set(config.paths.card, json(card));
  }
  for (const path of outputs.keys())
    if (!getNativeCardPackageFileRule(path))
      throw new Error(diagnostic("path", { file: path }));
  const staged = new Map(
    originalFiles.map((file) => [file.path, file.content]),
  );
  for (const [path, content] of outputs) staged.set(path, Buffer.from(content));
  const stagedFiles = [...staged].map(([path, content]) => ({ path, content }));
  const issues = [
    ...validateNativeCardFrontendModules(
      stagedFiles,
      config.paths.entry,
      nativeCardFileRules.frontendModuleApi,
    ),
    ...validateNativeCardFrontendMarkup(stagedFiles),
  ];
  if (issues.length) return { passed: false, issues };
  return withDerivedTask(taskFile, async ({ taskFile: derivedTaskFile }) => {
    for (const [path, contents] of outputs) {
      const target = await prepareTarget(derivedTaskFile, path);
      await replaceFileContents(
        target.targetFile,
        contents,
        diagnostic("path", { file: path }),
        target.root,
      );
    }
    return {
      passed: true as const,
      files: [...outputs.keys()],
      bindingId: request.id,
      source: request.source,
    };
  });
}
