import ts from "typescript";

import config from "./state-source-config.json" with { type: "json" };

export interface SourceStateLocation {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface SourceStateField extends SourceStateLocation {
  pointer: string;
}

export interface SourceStateUnresolved extends SourceStateLocation {
  id: string;
  kind: string;
}

export interface SourceStateInventory {
  fields: SourceStateField[];
  unresolved: SourceStateUnresolved[];
}

export function extractSourceStateFields(
  text: string,
  symbol: string,
): SourceStateInventory {
  const source = ts.createSourceFile(
    config.sourceFileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const fields: SourceStateField[] = [];
  const unresolved: SourceStateUnresolved[] = [];
  const declarations: ts.VariableDeclaration[] = [];
  const bindings = new Map<ts.Node, Map<string, ts.Node[]>>();
  const active = new Set<ts.VariableDeclaration>();
  const scopeOf = (node: ts.Node): ts.Node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (
        ts.isSourceFile(parent) ||
        ts.isBlock(parent) ||
        ts.isModuleBlock(parent) ||
        ts.isFunctionLike(parent) ||
        ts.isForStatement(parent) ||
        ts.isForInStatement(parent) ||
        ts.isForOfStatement(parent) ||
        ts.isCaseBlock(parent)
      )
        return parent;
    }
    return source;
  };
  const register = (node: ts.Node, name: ts.Identifier): void => {
    const scope = scopeOf(node);
    let names = bindings.get(scope);
    if (!names) {
      names = new Map();
      bindings.set(scope, names);
    }
    const named = names.get(name.text) ?? [];
    named.push(node);
    names.set(name.text, named);
  };
  const registerName = (node: ts.Node, name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) register(node, name);
    else
      for (const element of name.elements) {
        if (!ts.isOmittedExpression(element))
          registerName(element, element.name);
      }
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node);
      registerName(node, node.name);
    } else if (ts.isParameter(node)) registerName(node, node.name);
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      register(node, node.name);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node))
      register(node, node.name);
    else if (ts.isImportClause(node) && node.name) register(node, node.name);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const resolve = (name: ts.Identifier): ts.Node[] | undefined => {
    for (let node: ts.Node | undefined = name; node; node = node.parent) {
      const found = bindings.get(node)?.get(name.text);
      if (found) return found;
    }
    return undefined;
  };
  const isZodNamespace = (expression: ts.Expression): boolean => {
    if (!ts.isIdentifier(expression)) return false;
    const named = resolve(expression);
    if (!named) return expression.text === config.zodNamespace;
    if (named.length !== 1) return false;
    const binding = named[0]!;
    if (
      ts.isImportSpecifier(binding) &&
      (binding.propertyName ?? binding.name).text !== config.zodNamespace
    )
      return false;
    if (
      !ts.isImportSpecifier(binding) &&
      !ts.isNamespaceImport(binding) &&
      !ts.isImportClause(binding)
    )
      return false;
    for (let node: ts.Node | undefined = binding; node; node = node.parent) {
      if (ts.isImportDeclaration(node))
        return (
          ts.isStringLiteral(node.moduleSpecifier) &&
          config.zodModules.includes(node.moduleSpecifier.text)
        );
    }
    return false;
  };
  const location = (node: ts.Node): SourceStateLocation => {
    const start = node.getStart(source);
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    return { start, end: node.getEnd(), line: line + 1, column: character + 1 };
  };
  const report = (kind: string, node: ts.Node): void => {
    const position = location(node);
    if (
      unresolved.some(
        (item) =>
          item.kind === kind &&
          item.start === position.start &&
          item.end === position.end,
      )
    )
      return;
    unresolved.push({
      id: `${config.diagnosticIdPrefix}${unresolved.length + 1}`,
      kind,
      ...position,
    });
  };
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      expression = expression.expression;
    return expression;
  };
  const withReference = (
    name: ts.Identifier,
    consume: (expression: ts.Expression) => void,
  ): void => {
    const named = resolve(name);
    if (!named || named.length === 0) {
      report(config.diagnostics.externalSymbol, name);
      return;
    }
    if (named.length !== 1) {
      report(config.diagnostics.ambiguousSymbol, name);
      return;
    }
    const declaration = named[0]!;
    if (!ts.isVariableDeclaration(declaration)) {
      report(config.diagnostics.externalSymbol, name);
      return;
    }
    if (active.has(declaration)) {
      report(config.diagnostics.circularReference, name);
      return;
    }
    if (!declaration.initializer) {
      report(config.diagnostics.uninitializedSymbol, name);
      return;
    }
    active.add(declaration);
    consume(declaration.initializer);
    active.delete(declaration);
  };
  const propertyName = (name: ts.PropertyName): string | undefined => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name)
    )
      return name.text;
    if (
      ts.isComputedPropertyName(name) &&
      (ts.isStringLiteral(name.expression) ||
        ts.isNumericLiteral(name.expression))
    )
      return name.expression.text;
    return undefined;
  };
  const visitShape = (
    input: ts.Expression,
    pointer: string,
    enumerate: boolean,
  ): void => {
    const expression = unwrap(input);
    if (ts.isIdentifier(expression)) {
      withReference(expression, (value) =>
        visitShape(value, pointer, enumerate),
      );
      return;
    }
    if (!ts.isObjectLiteralExpression(expression)) {
      report(
        ts.isPropertyAccessExpression(expression)
          ? config.diagnostics.externalSymbol
          : config.diagnostics.unsupportedExpression,
        expression,
      );
      return;
    }
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        report(config.diagnostics.spread, property);
        continue;
      }
      const key = propertyName(property.name);
      if (key === undefined) {
        report(config.diagnostics.dynamicKey, property.name);
        continue;
      }
      const child = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (enumerate)
        fields.push({ pointer: child, ...location(property.name) });
      if (ts.isPropertyAssignment(property))
        visit(property.initializer, child, enumerate);
      else if (ts.isShorthandPropertyAssignment(property))
        visit(property.name, child, enumerate);
      else report(config.diagnostics.unsupportedProperty, property);
    }
  };
  const visitContainer = (input: ts.Expression, pointer: string): void => {
    const expression = unwrap(input);
    if (ts.isIdentifier(expression)) {
      withReference(expression, (value) => visitContainer(value, pointer));
    } else if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element))
          report(config.diagnostics.spread, element);
        else visitContainer(element, pointer);
      }
    } else visit(expression, pointer, false);
  };
  const visit = (
    input: ts.Expression,
    pointer: string,
    enumerate = true,
  ): void => {
    const expression = unwrap(input);
    if (ts.isIdentifier(expression)) {
      withReference(expression, (value) => visit(value, pointer, enumerate));
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      report(config.diagnostics.externalSymbol, expression);
      return;
    }
    if (!ts.isCallExpression(expression)) {
      report(config.diagnostics.unsupportedExpression, expression);
      return;
    }
    const method = expression.expression;
    if (!ts.isPropertyAccessExpression(method)) {
      report(config.diagnostics.factoryCall, expression);
      return;
    }
    const receiver = method.expression;
    const direct = isZodNamespace(receiver);
    const coerced =
      ts.isPropertyAccessExpression(receiver) &&
      isZodNamespace(receiver.expression) &&
      receiver.name.text === config.coerceNamespace;
    if (coerced) report(config.coerceNamespace, receiver.name);
    if (!direct && !coerced) {
      if (method.name.text === config.arrayMethod) {
        visit(receiver, pointer, false);
        return;
      }
      if (config.sourceOperations.includes(method.name.text))
        report(method.name.text, method.name);
      else if (!config.wrappers.includes(method.name.text)) {
        report(config.diagnostics.factoryCall, expression);
        return;
      }
      visit(receiver, pointer, enumerate);
      return;
    }
    if (method.name.text === config.arrayMethod) {
      const element = expression.arguments[0];
      if (element) visit(element, pointer, false);
      else report(config.diagnostics.unsupportedExpression, expression);
      return;
    }
    if (config.schemaContainers.includes(method.name.text)) {
      if (!expression.arguments.length)
        report(config.diagnostics.unsupportedExpression, expression);
      else
        for (const argument of expression.arguments)
          visitContainer(argument, pointer);
      return;
    }
    if (config.leafConstructors.includes(method.name.text)) return;
    if (method.name.text !== config.objectConstructor) {
      report(config.diagnostics.factoryCall, expression);
      return;
    }
    const shape = expression.arguments[0];
    if (shape) visitShape(shape, pointer, enumerate);
    else report(config.diagnostics.unsupportedExpression, expression);
  };
  const named = declarations.filter(
    (declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === symbol,
  );
  const topLevel = named.filter(
    (declaration) => scopeOf(declaration) === source,
  );
  const candidates = topLevel.length > 0 ? topLevel : named;
  if (candidates.length === 0) {
    const external = bindings.get(source)?.get(symbol);
    if (external?.length)
      external.forEach((binding) =>
        report(
          config.diagnostics.externalSymbol,
          ts.isImportSpecifier(binding) || ts.isNamespaceImport(binding)
            ? binding.name
            : binding,
        ),
      );
    else
      unresolved.push({
        id: `${config.diagnosticIdPrefix}1`,
        kind: config.diagnostics.missingSymbol,
        start: 0,
        end: 0,
        line: 1,
        column: 1,
      });
  } else if (candidates.length > 1) {
    candidates.forEach((declaration) =>
      report(config.diagnostics.ambiguousSymbol, declaration.name),
    );
  } else {
    const declaration = candidates[0]!;
    if (declaration.initializer) {
      active.add(declaration);
      visit(declaration.initializer, "");
      active.delete(declaration);
    } else report(config.diagnostics.uninitializedSymbol, declaration.name);
  }
  unresolved.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  unresolved.forEach((item, index) => {
    item.id = `${config.diagnosticIdPrefix}${index + 1}`;
  });
  return { fields, unresolved };
}
