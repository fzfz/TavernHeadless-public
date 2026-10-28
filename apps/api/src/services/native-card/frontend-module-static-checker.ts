import { posix } from "node:path";
import ts from "typescript";
import { apiErrorMessages } from "@tavern/shared";
import type { NativeCardFileRules, NativeCardIssue, NativeCardPackageFile } from "@tavern/shared";

type FrontendModuleApi = NativeCardFileRules["frontendModuleApi"];
type ApiMethod = FrontendModuleApi["methods"][string][string];
type ParsedModule = { path: string; source: ts.SourceFile; content: string; exports: Set<string> };

const moduleIssueCode = "NATIVE_CARD_FRONTEND_MODULE_INVALID";

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node));
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))) return node.text;
  return undefined;
}

function positionIssue(path: string, source: ts.SourceFile, node: ts.Node | undefined, expected: string, start?: number): NativeCardIssue {
  const position = source.getLineAndCharacterOfPosition(node?.getStart(source) ?? start ?? 0);
  const message = apiErrorMessages.NATIVE_CARD_FRONTEND_MODULE_INVALID;
  return {
    code: moduleIssueCode,
    path,
    line: position.line + 1,
    column: position.character + 1,
    message,
    action: message,
    expected,
  };
}

function modifiers(statement: ts.Statement): readonly ts.Modifier[] {
  return ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
}

function exportedNames(source: ts.SourceFile): Set<string> {
  const result = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && modifiers(statement).some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) result.add(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name && modifiers(statement).some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) result.add(statement.name.text);
    if (ts.isVariableStatement(statement) && modifiers(statement).some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) result.add(declaration.name.text);
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) result.add(element.name.text);
    }
  }
  return result;
}

function importIssues(
  module: ParsedModule,
  declaration: ts.ImportDeclaration,
  files: ReadonlyMap<string, Uint8Array>,
  modules: ReadonlyMap<string, ParsedModule>,
  api: FrontendModuleApi,
): NativeCardIssue[] {
  const issues: NativeCardIssue[] = [];
  const fail = (expected: string) => issues.push(positionIssue(module.path, module.source, declaration, expected));
  const specifier = ts.isStringLiteralLike(declaration.moduleSpecifier) ? declaration.moduleSpecifier.text : "";
  if (api.imports.relativeOnly && !(specifier.startsWith("./") || specifier.startsWith("../"))) {
    fail("Browser module imports must use a relative package path.");
    return issues;
  }
  if (specifier.includes("\\") || specifier.includes("?") || specifier.includes("#")) {
    fail("Browser module imports must use a plain package-relative file path.");
    return issues;
  }
  const extension = api.imports.extensions.find((candidate) => specifier.endsWith(candidate));
  if (!extension) {
    fail(`Browser module import paths must end in one of: ${api.imports.extensions.join(", ")}.`);
    return issues;
  }
  const target = posix.normalize(posix.join(posix.dirname(module.path), specifier));
  if (target === ".." || target.startsWith("../") || target.startsWith("/")) {
    fail("Browser module imports must remain inside the role package.");
    return issues;
  }
  if (!files.has(target)) {
    fail("Browser module imports must point to an existing package file.");
    return issues;
  }
  const clause = declaration.importClause;
  if (!clause) {
    fail("Side-effect-only imports are not part of the role package module contract.");
    return issues;
  }
  if (extension === ".json") {
    const attributes = declaration.attributes?.elements ?? declaration.assertClause?.elements ?? [];
    const jsonAttribute = attributes.find((attribute) => propertyName(attribute.name) === "type")?.value;
    if (clause.name === undefined || clause.namedBindings !== undefined || !jsonAttribute || !ts.isStringLiteralLike(jsonAttribute) || jsonAttribute.text !== "json") {
      fail("Package JSON imports must use a default binding and a type=json import attribute.");
    }
    return issues;
  }
  if (!target.startsWith("frontend/")) {
    fail("Browser JavaScript may import only modules under frontend/.");
    return issues;
  }
  const targetModule = modules.get(target);
  if (!targetModule) {
    fail("Browser JavaScript imports must point to a parsed frontend/*.js module.");
    return issues;
  }
  if (clause.name !== undefined || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    fail("Frontend JavaScript imports must use explicit named exports.");
    return issues;
  }
  for (const element of clause.namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (!targetModule.exports.has(importedName)) {
      issues.push(positionIssue(module.path, module.source, element, `The imported frontend module does not export ${importedName}.`));
    }
  }
  return issues;
}

function memberChain(expression: ts.Expression): { root: ts.Identifier; parts: string[]; dynamic: boolean } | undefined {
  if (ts.isIdentifier(expression)) return { root: expression, parts: [], dynamic: false };
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = memberChain(expression.expression);
    return parent ? { ...parent, parts: [...parent.parts, expression.name.text] } : undefined;
  }
  if (ts.isElementAccessExpression(expression)) {
    const parent = memberChain(expression.expression);
    if (!parent) return undefined;
    const argument = expression.argumentExpression;
    if (!argument || (!ts.isStringLiteralLike(argument) && !ts.isNumericLiteral(argument))) return { ...parent, dynamic: true };
    return { ...parent, parts: [...parent.parts, argument.text] };
  }
  if (ts.isParenthesizedExpression(expression)) return memberChain(expression.expression);
  return undefined;
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);
}

function addApiBindings(
  module: ParsedModule,
  checker: ts.TypeChecker,
  entryPath: string,
  api: FrontendModuleApi,
): Set<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  const add = (identifier: ts.Identifier) => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol) symbols.add(symbol);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.parent && ts.isFunctionLike(node.parent)) {
      if (module.path !== entryPath && ts.isIdentifier(node.name) && node.name.text === "api") add(node.name);
      if (module.path === entryPath && ts.isFunctionDeclaration(node.parent) && node.parent.name?.text === api.entryExport) {
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (ts.isBindingElement(element) && !element.dotDotDotToken) {
              const field = propertyName(element.propertyName) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
              if (field && api.contextFields.includes(field)) for (const identifier of bindingNames(element.name)) add(identifier);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module.source);
  return symbols;
}

function apiAccessIssues(
  module: ParsedModule,
  checker: ts.TypeChecker,
  apiSymbols: ReadonlySet<ts.Symbol>,
  api: FrontendModuleApi,
): NativeCardIssue[] {
  const issues: NativeCardIssue[] = [];
  const namespaces = api.methods;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isDeclarationName(node) && apiSymbols.has(checker.getSymbolAtLocation(node)!)) {
      const parent = node.parent;
      const isMemberReceiver = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
      if (!isMemberReceiver) issues.push(positionIssue(module.path, module.source, node, "Use role API methods directly through api.namespace.method(...); do not pass or alias the API object."));
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)) {
      const chain = memberChain(node);
      if (chain && apiSymbols.has(checker.getSymbolAtLocation(chain.root)!)) {
        if (chain.dynamic) {
          issues.push(positionIssue(module.path, module.source, node, "Choose API namespace and method names with static property names."));
        } else if (chain.parts.length === 1) {
          if (!Object.hasOwn(namespaces, chain.parts[0]!)) issues.push(positionIssue(module.path, module.source, node, `The API does not expose namespace ${chain.parts[0]}.`));
          else if (!(ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) || node.parent.expression !== node) issues.push(positionIssue(module.path, module.source, node, "Call a documented API method directly instead of saving an API namespace reference."));
        } else if (chain.parts.length >= 2) {
          const namespace = chain.parts[0]!;
          const method = chain.parts[1]!;
          const available = namespaces[namespace as keyof typeof namespaces] as Record<string, ApiMethod> | undefined;
          const contract = available?.[method];
          if (!contract) {
            issues.push(positionIssue(module.path, module.source, node, `The role API does not expose ${namespace}.${method}().`));
          } else if (chain.parts.length === 2 && ts.isCallExpression(node.parent) && node.parent.expression === node) {
            const call = node.parent;
            if (call.arguments.some(ts.isSpreadElement) || call.arguments.length < contract.minArguments || call.arguments.length > contract.maxArguments) {
              issues.push(positionIssue(module.path, module.source, call, `${namespace}.${method}() accepts ${contract.minArguments === contract.maxArguments ? contract.minArguments : `${contract.minArguments} to ${contract.maxArguments}`} argument(s).`));
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module.source);
  return issues;
}

function layoutAccessIssues(
  module: ParsedModule,
  checker: ts.TypeChecker,
  apiSymbols: ReadonlySet<ts.Symbol>,
  api: FrontendModuleApi,
): NativeCardIssue[] {
  const layouts = new Set<ts.Symbol>();
  const reassigned = new Set<ts.Symbol>();
  const issues: NativeCardIssue[] = [];
  const findAssignments = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol) reassigned.add(symbol);
    }
    ts.forEachChild(node, findAssignments);
  };
  findAssignments(module.source);
  const isLayout = (expression: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(expression)) return isLayout(expression.expression);
    if (ts.isIdentifier(expression)) return layouts.has(checker.getSymbolAtLocation(expression)!);
    if (!ts.isCallExpression(expression)) return false;
    const chain = memberChain(expression.expression);
    return !!chain && !chain.dynamic && apiSymbols.has(checker.getSymbolAtLocation(chain.root)!) &&
      chain.parts.length === 2 && chain.parts[0] === "ui" && chain.parts[1] === "register";
  };
  let changed = true;
  while (changed) {
    changed = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isLayout(node.initializer)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !reassigned.has(symbol) && !layouts.has(symbol)) { layouts.add(symbol); changed = true; }
      }
      ts.forEachChild(node, collect);
    };
    collect(module.source);
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isLayout(node.expression)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text :
        node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
      const contract = name === undefined ? undefined : api.layoutMethods[name];
      if (!contract) {
        const detail = name === undefined ? "The layout method name is dynamic; use a static method name." : `The layout does not expose ${name}(); choose a documented layout method.`;
        issues.push(positionIssue(module.path, module.source, node, `${detail} Available methods: ${Object.keys(api.layoutMethods).join(", ")}.`));
      } else {
        let receiver: ts.Expression = node;
        while (ts.isParenthesizedExpression(receiver.parent)) receiver = receiver.parent;
        const call = receiver.parent;
        if (!ts.isCallExpression(call) || call.expression !== receiver) {
          ts.forEachChild(node, visit);
          return;
        }
        if (call.arguments.some(ts.isSpreadElement)) {
          issues.push(positionIssue(module.path, module.source, call, `layout.${name}() uses spread arguments; pass each argument explicitly.`));
        } else if (call.arguments.length < contract.minArguments || call.arguments.length > contract.maxArguments) {
          issues.push(positionIssue(module.path, module.source, call, `layout.${name}() received ${call.arguments.length} arguments; pass ${contract.minArguments === contract.maxArguments ? contract.minArguments : `${contract.minArguments} to ${contract.maxArguments}`} argument(s).`));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module.source);
  return issues;
}

/** Validates frontend JavaScript structure and direct calls to the configured browser API without executing package code. */
export function validateNativeCardFrontendModules(
  files: readonly NativeCardPackageFile[],
  entryPath: string | undefined,
  api: FrontendModuleApi,
): NativeCardIssue[] {
  if (!entryPath) return [];
  const allFiles = new Map(files.map((file) => [file.path, file.content]));
  const modules = new Map<string, ParsedModule>();
  const issues: NativeCardIssue[] = [];
  for (const file of files.filter((item) => item.path.startsWith("frontend/") && item.path.endsWith(".js"))) {
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
      const source = ts.createSourceFile(file.path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      modules.set(file.path, { path: file.path, source, content, exports: exportedNames(source) });
      for (const diagnostic of (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics) {
        issues.push(positionIssue(file.path, source, undefined, `JavaScript syntax is invalid: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`, diagnostic.start));
      }
    } catch {
      const source = ts.createSourceFile(file.path, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      issues.push(positionIssue(file.path, source, undefined, "Frontend JavaScript modules must use valid UTF-8."));
    }
  }
  const entry = modules.get(entryPath);
  if (!entry) {
    const source = ts.createSourceFile(entryPath, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    issues.push(positionIssue(entryPath, source, undefined, "The frontend entry must be a declared frontend/*.js file."));
    return issues;
  }

  const entryFunctions: ts.FunctionDeclaration[] = [];
  for (const statement of entry.source.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && modifiers(statement).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      entryFunctions.push(statement);
      continue;
    }
    if (modifiers(statement).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      issues.push(positionIssue(entryPath, entry.source, statement, `The frontend entry must export only the named ${api.entryExport}() function.`));
    }
  }
  const entryFunction = entryFunctions.find((item) => item.name?.text === api.entryExport && item.body);
  if (!entryFunction || entryFunctions.length !== 1) {
    issues.push(positionIssue(entryPath, entry.source, entryFunctions[0], `The frontend entry must export exactly one named ${api.entryExport}() function.`));
  } else {
    const parameter = entryFunction.parameters[0];
    if (entryFunction.parameters.length !== 1 || !parameter || !ts.isObjectBindingPattern(parameter.name) || parameter.initializer || parameter.questionToken || parameter.dotDotDotToken) {
      issues.push(positionIssue(entryPath, entry.source, entryFunction, `${api.entryExport} must accept one required object parameter such as { api }.`));
    } else {
      const fields = new Set<string>();
      for (const element of parameter.name.elements) {
        if (!ts.isBindingElement(element) || element.dotDotDotToken) {
          issues.push(positionIssue(entryPath, entry.source, element, "The mount context cannot use a rest binding."));
          continue;
        }
        const name = propertyName(element.propertyName) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
        if (!name || !api.contextFields.includes(name)) issues.push(positionIssue(entryPath, entry.source, element, `The mount context exposes only: ${api.contextFields.join(", ")}.`));
        else fields.add(name);
      }
      for (const field of api.contextFields) if (!fields.has(field)) issues.push(positionIssue(entryPath, entry.source, parameter, `The ${api.entryExport} context must bind ${field}.`));
    }
  }
  if (entry.exports.size !== 1 || !entry.exports.has(api.entryExport)) {
    issues.push(positionIssue(entryPath, entry.source, entryFunction, `Export only ${api.entryExport}() from the frontend entry module.`));
  }

  for (const module of modules.values()) {
    for (const statement of module.source.statements) {
      if (ts.isImportDeclaration(statement)) issues.push(...importIssues(module, statement, allFiles, modules, api));
      if (ts.isExportAssignment(statement)) issues.push(positionIssue(module.path, module.source, statement, "Default exports are not part of the frontend module contract."));
      if (ts.isFunctionDeclaration(statement) && modifiers(statement).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        issues.push(positionIssue(module.path, module.source, statement, "Frontend modules must use named exports."));
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        issues.push(positionIssue(module.path, module.source, statement, "Frontend modules cannot re-export symbols from other files."));
      }
    }
    const visitDynamicImports = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) issues.push(positionIssue(module.path, module.source, node, "Dynamic import() cannot be checked against the package's declared modules."));
      ts.forEachChild(node, visitDynamicImports);
    };
    visitDynamicImports(module.source);
  }

  const virtualSources = new Map([...modules.values()].map((module) => [`/native-card/${module.path}`, module.source]));
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (fileName) => virtualSources.get(fileName);
  host.fileExists = (fileName) => virtualSources.has(fileName);
  const program = ts.createProgram([...virtualSources.keys()], options, host);
  const checker = program.getTypeChecker();
  for (const module of modules.values()) {
    const apiSymbols = addApiBindings(module, checker, entryPath, api);
    issues.push(...apiAccessIssues(module, checker, apiSymbols, api));
    issues.push(...layoutAccessIssues(module, checker, apiSymbols, api));
  }
  return issues;
}
