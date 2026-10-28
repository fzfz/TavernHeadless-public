import { posix } from "node:path";
import ts from "typescript";
import { apiErrorMessages } from "@tavern/shared";
import type {
  NativeCardFileRules,
  NativeCardIssue,
  NativeCardPackageFile,
} from "@tavern/shared";

type BackendModuleApi = NativeCardFileRules["backendModuleApi"];
type ModuleExportContract = BackendModuleApi["exports"][number];

const moduleApiIssueCode = "NATIVE_CARD_MODULE_INVALID";

function positionIssue(
  path: string,
  sourceFile: ts.SourceFile,
  node: ts.Node | number | undefined,
  expected: string,
): NativeCardIssue {
  const offset = typeof node === "number" ? node : node?.getStart(sourceFile) ?? 0;
  const position = sourceFile.getLineAndCharacterOfPosition(offset);
  const message = apiErrorMessages.NATIVE_CARD_MODULE_INVALID;
  return {
    code: moduleApiIssueCode,
    path,
    line: position.line + 1,
    column: position.character + 1,
    message,
    action: message,
    expected,
  };
}

function contractForPath(
  path: string,
  api: BackendModuleApi,
): ModuleExportContract | undefined {
  return api.exports.find((contract) => path.startsWith(contract.directory) && path.endsWith(".js"));
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function unparenthesize(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    ((ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node) ||
    ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (parent.kind === ts.SyntaxKind.ImportAttribute && "name" in parent && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isExportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  );
}

function bindingContains(name: ts.Identifier | ts.ObjectBindingPattern | ts.ArrayBindingPattern, identifierName: string): boolean {
  if (ts.isIdentifier(name) && name.text === identifierName) return true;
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some((element) => ts.isBindingElement(element) && bindingContains(element.name, identifierName));
  }
  return false;
}

function resolveValueSymbol(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
}

function hasLocalBinding(symbol: ts.Symbol | undefined, identifier: ts.Identifier): boolean {
  return symbol?.declarations?.some((declaration) => {
    if (
      ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) ||
      ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration) ||
      ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration) ||
      ts.isBindingElement(declaration)
    ) return declaration.name !== undefined && bindingContains(declaration.name, identifier.text);
    if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportSpecifier(declaration)) {
      return declaration.name !== undefined && declaration.name.text === identifier.text;
    }
    if (ts.isCatchClause(declaration) && declaration.variableDeclaration) {
      return bindingContains(declaration.variableDeclaration.name, identifier.text);
    }
    return false;
  }) ?? false;
}

function createProgramForSource(path: string, source: ts.SourceFile, content: string): ts.Program {
  const fileName = `/native-card/${path}`;
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noLib: true,
    noResolve: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (requested, languageVersion) =>
    requested === fileName ? source : undefined;
  host.fileExists = (requested) => requested === fileName;
  host.readFile = (requested) => requested === fileName ? content : undefined;
  return ts.createProgram([fileName], options, host);
}

function importContractIssues(
  path: string,
  sourceFile: ts.SourceFile,
  declaration: ts.ImportDeclaration,
  files: ReadonlyMap<string, Uint8Array>,
  contracts: ReadonlyMap<string, ModuleExportContract>,
  api: BackendModuleApi,
): NativeCardIssue[] {
  const issues: NativeCardIssue[] = [];
  const specifier = ts.isStringLiteralLike(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : "";
  const fail = (expected: string): void => {
    issues.push(positionIssue(path, sourceFile, declaration, expected));
  };

  if (api.imports.relativeOnly && !(specifier.startsWith("./") || specifier.startsWith("../"))) {
    fail("Imports must use a relative path to a file in the same role package.");
    return issues;
  }
  if (specifier.includes("\\") || specifier.includes("?") || specifier.includes("#")) {
    fail("Import paths must use a plain package-relative URL path.");
    return issues;
  }
  const extension = api.imports.extensions.find((candidate) => specifier.endsWith(candidate));
  if (!extension) {
    fail(`Import paths must end in one of: ${api.imports.extensions.join(", ")}.`);
    return issues;
  }
  const targetPath = posix.normalize(posix.join(posix.dirname(path), specifier));
  if (targetPath === ".." || targetPath.startsWith("../") || targetPath.startsWith("/")) {
    fail("The relative import must remain inside the role package.");
    return issues;
  }
  if (targetPath === "manifest.json" || !files.has(targetPath)) {
    fail("The relative import must point to a declared package file.");
    return issues;
  }
  const clause = declaration.importClause;
  if (!clause) {
    fail("Side-effect-only imports are not part of the role module API.");
    return issues;
  }
  if (extension === ".json") {
    const attributes = declaration.attributes?.elements ?? declaration.assertClause?.elements ?? [];
    const jsonAttribute = attributes.find((attribute) => propertyName(attribute.name) === "type")?.value;
    if (clause.name === undefined || clause.namedBindings !== undefined || !jsonAttribute || !ts.isStringLiteralLike(jsonAttribute) || jsonAttribute.text !== "json") {
      fail("JSON data imports must use a default binding and a type=json import attribute.");
    }
    return issues;
  }

  if (clause.name !== undefined || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    fail("JavaScript module imports must name the module's single documented function export.");
    return issues;
  }
  const targetContract = contracts.get(targetPath);
  if (!targetContract) {
    fail("JavaScript imports must point to a backend module with a documented function export.");
    return issues;
  }
  for (const element of clause.namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedName !== targetContract.name) {
      issues.push(positionIssue(
        path,
        sourceFile,
        element,
        `The target module exports only ${targetContract.name}().`,
      ));
    }
  }
  return issues;
}

function directContextField(
  node: ts.Expression,
  parameterName: string,
): { field?: string; dynamic: boolean } | undefined {
  const expression = unparenthesize(node);
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = unparenthesize(expression.expression);
    if (ts.isIdentifier(owner) && owner.text === parameterName) return { field: expression.name.text, dynamic: false };
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = unparenthesize(expression.expression);
    if (ts.isIdentifier(owner) && owner.text === parameterName) {
      const argument = expression.argumentExpression;
      return {
        field: argument && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined,
        dynamic: !argument || (!ts.isStringLiteralLike(argument) && !ts.isNumericLiteral(argument)),
      };
    }
  }
  return undefined;
}

function destructuredContextFields(
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
  path: string,
  contract: ModuleExportContract,
  addIssue: (issue: NativeCardIssue) => void,
): void {
  if (!ts.isObjectBindingPattern(parameter.name)) return;
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken) {
      addIssue(positionIssue(path, sourceFile, element, "The context parameter cannot expose undeclared fields through a rest binding."));
      continue;
    }
    const name = element.propertyName
      ? propertyName(element.propertyName)
      : ts.isIdentifier(element.name) ? element.name.text : undefined;
    if (name && !contract.contextFields.includes(name)) {
      addIssue(positionIssue(path, sourceFile, element, `The ${contract.name} context does not expose ${name}.`));
    }
  }
}

function moduleIssues(
  path: string,
  content: string,
  files: ReadonlyMap<string, Uint8Array>,
  contracts: ReadonlyMap<string, ModuleExportContract>,
  api: BackendModuleApi,
): NativeCardIssue[] {
  const script = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const issues: NativeCardIssue[] = [];
  const fail = (node: ts.Node | undefined, expected: string): void => {
    issues.push(positionIssue(path, script, node, expected));
  };

  const parseDiagnostics = (script as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  for (const diagnostic of parseDiagnostics) {
    const offset = diagnostic.start ?? 0;
    issues.push(positionIssue(
      path,
      script,
      offset,
      `JavaScript syntax is invalid: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    ));
  }
  if (parseDiagnostics.length > 0) return issues;

  const contract = contracts.get(path);
  if (!contract) return [positionIssue(path, script, script.statements[0], "Backend JavaScript files must be located in a configured module directory.")];
  const exportedFunctions: ts.FunctionDeclaration[] = [];
  const modifiersOf = (statement: ts.Statement): readonly ts.Modifier[] =>
    ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
  for (const statement of script.statements) {
    if (ts.isImportDeclaration(statement)) {
      issues.push(...importContractIssues(path, script, statement, files, contracts, api));
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && modifiersOf(statement).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedFunctions.push(statement);
      continue;
    }
    if (modifiersOf(statement).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      fail(statement, `Export only the documented named function ${contract.name}().`);
    }
  }
  const implementation = exportedFunctions.find((declaration) => declaration.name?.text === contract.name && !modifiersOf(declaration).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) && declaration.body);
  if (!implementation || exportedFunctions.length !== 1) {
    fail(exportedFunctions[0] ?? script.statements[0], `Export exactly one named function ${contract.name}().`);
    return issues;
  }
  if (implementation.asteriskToken) fail(implementation, `${contract.name} must be a normal function, not a generator.`);
  if (modifiersOf(implementation).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) && !contract.async) {
    fail(implementation, `${contract.name} is synchronous in this package API.`);
  }
  if (implementation.parameters.length !== 1 || implementation.parameters[0]?.dotDotDotToken || implementation.parameters[0]?.initializer || implementation.parameters[0]?.questionToken) {
    fail(implementation, `${contract.name} must accept one required context parameter.`);
  }
  const parameter = implementation.parameters[0];
  const contextParameter = parameter && ts.isIdentifier(parameter.name) ? parameter.name : undefined;
  if (parameter && ts.isObjectBindingPattern(parameter.name)) destructuredContextFields(parameter, script, path, contract, issues.push.bind(issues));
  else if (!contextParameter) fail(parameter ?? implementation, `${contract.name} context must be an identifier or an object destructuring parameter.`);

  const program = createProgramForSource(path, script, content);
  const checker = program.getTypeChecker();
  const contextSymbol = contextParameter ? resolveValueSymbol(checker, contextParameter) : undefined;
  const allowedGlobals = new Set(api.globals);
  const blockedProperties = new Set(api.blockedProperties);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      fail(node, "Dynamic import() is not part of the role module API.");
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      fail(node, "import.meta is not part of the role module API.");
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) fail(node, "The module execution environment is not part of the role module API.");
    if (ts.isPropertyAccessExpression(node) && blockedProperties.has(node.name.text)) {
      fail(node.name, `Property ${node.name.text} is outside the role module API.`);
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && blockedProperties.has(node.argumentExpression.text)) {
      fail(node.argumentExpression, `Property ${node.argumentExpression.text} is outside the role module API.`);
    }
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const symbol = resolveValueSymbol(checker, node);
      if (contextSymbol && symbol === contextSymbol) {
        const parent = node.parent;
        const property = parent && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
          ? directContextField(parent as ts.Expression, node.text)
          : undefined;
        if (!property) fail(node, "Read the role API through one of the documented top-level context fields.");
        else if (property.dynamic || !property.field || !contract.contextFields.includes(property.field)) {
          fail(parent, property.dynamic
            ? "Context fields must be selected by a static documented field name."
            : `The ${contract.name} context does not expose ${property.field ?? "this field"}.`);
        }
      }
      if (!hasLocalBinding(symbol, node) && !allowedGlobals.has(node.text)) {
        fail(node, `Global ${node.text} is not part of the role module API.`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(script);
  return issues;
}

/** Checks package backend modules from syntax trees without loading or executing their source. */
export function validateNativeCardModules(
  files: readonly NativeCardPackageFile[],
  api: BackendModuleApi,
): NativeCardIssue[] {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const moduleFiles = files.filter((file) => contractForPath(file.path, api));
  const contracts = new Map(moduleFiles.flatMap((file) => {
    const contract = contractForPath(file.path, api);
    return contract ? [[file.path, contract] as const] : [];
  }));
  const issues = moduleFiles.flatMap((file) => {
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
    } catch {
      const message = apiErrorMessages.NATIVE_CARD_MODULE_INVALID;
      return [{ code: moduleApiIssueCode, path: file.path, line: 1, column: 1, message, action: message, expected: "Backend JavaScript modules must use valid UTF-8." } satisfies NativeCardIssue];
    }
    return moduleIssues(file.path, content, fileMap, contracts, api);
  });
  return issues;
}
