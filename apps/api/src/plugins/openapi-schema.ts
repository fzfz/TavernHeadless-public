import { cloneOpenApiDocument } from "./openapi-i18n.js";

type ObjectNode = Record<string, unknown>;
type Visitor = (node: ObjectNode, path: string) => void;

function readObject(value: unknown): ObjectNode | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectNode)
    : undefined;
}

function visitMap(
  value: unknown,
  path: string,
  visit: Visitor,
  skipExtensions = false,
): void {
  for (const [name, child] of Object.entries(readObject(value) ?? {})) {
    if (skipExtensions && name.startsWith("x-")) continue;
    const node = readObject(child);
    if (node) visit(node, `${path}/${name}`);
  }
}

function visitArray(value: unknown, path: string, visit: Visitor): void {
  if (!Array.isArray(value)) return;
  value.forEach((child, index) => {
    const node = readObject(child);
    if (node) visit(node, `${path}/${index}`);
  });
}

function finitePropertyNames(value: unknown, path: string): string[] {
  const names = readObject(value);
  if (names) {
    const keys = Object.keys(names);
    if (
      keys.every((key) => key === "enum" || key === "type") &&
      (names.type === undefined || names.type === "string") &&
      Array.isArray(names.enum) &&
      names.enum.every((name): name is string => typeof name === "string")
    ) {
      return names.enum;
    }
    if (keys.length === 1 && Array.isArray(names.anyOf)) {
      return [
        ...new Set(
          names.anyOf.flatMap((branch, index) =>
            finitePropertyNames(branch, `${path}/anyOf/${index}`),
          ),
        ),
      ];
    }
  }
  throw new Error(
    `Cannot convert ${path} to OpenAPI 3.0.3 without changing property-name constraints.`,
  );
}

function convertExclusiveLimits(schema: ObjectNode): void {
  for (const [inclusiveKey, exclusiveKey] of [
    ["minimum", "exclusiveMinimum"],
    ["maximum", "exclusiveMaximum"],
  ] as const) {
    const exclusive = schema[exclusiveKey];
    if (typeof exclusive !== "number") continue;
    const inclusive = schema[inclusiveKey];
    const exclusiveIsStricter =
      typeof inclusive !== "number" ||
      (inclusiveKey === "minimum"
        ? exclusive >= inclusive
        : exclusive <= inclusive);
    if (exclusiveIsStricter) {
      schema[inclusiveKey] = exclusive;
      schema[exclusiveKey] = true;
    } else {
      delete schema[exclusiveKey];
    }
  }
}

function conditionalBranch(value: unknown, path: string): ObjectNode {
  if (value === undefined || value === true) return {};
  if (value === false) return { not: {} };
  const schema = readObject(value);
  if (schema) return schema;
  throw new Error(
    `Cannot convert ${path} to OpenAPI 3.0.3: expected a schema object or boolean.`,
  );
}

function convertConditional(schema: ObjectNode, path: string): void {
  if (
    schema.if !== undefined &&
    (schema.then !== undefined || schema.else !== undefined)
  ) {
    const condition = conditionalBranch(schema.if, `${path}/if`);
    const thenBranch = conditionalBranch(schema.then, `${path}/then`);
    const elseBranch = conditionalBranch(schema.else, `${path}/else`);
    const allOf = schema.allOf;
    if (allOf !== undefined && !Array.isArray(allOf)) {
      throw new Error(
        `Cannot convert ${path}/allOf to OpenAPI 3.0.3: expected a schema array.`,
      );
    }
    schema.allOf = [
      ...(allOf ?? []),
      {
        anyOf: [
          { allOf: [condition, thenBranch] },
          { allOf: [{ not: condition }, elseBranch] },
        ],
      },
    ];
  }
  delete schema.if;
  delete schema.then;
  delete schema.else;
}

function convertSchema(schema: ObjectNode, path: string): void {
  convertExclusiveLimits(schema);
  convertConditional(schema, path);
  if (schema.propertyNames !== undefined) {
    const names = readObject(schema.propertyNames);
    if (!(names?.type === "string" && Object.keys(names).length === 1)) {
      const allowedNames = finitePropertyNames(
        schema.propertyNames,
        `${path}/propertyNames`,
      );
      if (schema.patternProperties !== undefined || schema.$ref !== undefined) {
        throw new Error(
          `Cannot convert ${path}/propertyNames with patternProperties or $ref to OpenAPI 3.0.3.`,
        );
      }
      const properties = readObject(schema.properties) ?? {};
      const additionalProperties = schema.additionalProperties;
      schema.properties = Object.fromEntries(
        allowedNames.flatMap((name) => {
          if (Object.hasOwn(properties, name))
            return [[name, properties[name]]];
          if (additionalProperties === false) return [];
          return [[name, readObject(additionalProperties) ?? {}]];
        }),
      );
      schema.additionalProperties = false;
    }
    delete schema.propertyNames;
  }

  visitMap(schema.properties, `${path}/properties`, convertSchema);
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    visitArray(schema[keyword], `${path}/${keyword}`, convertSchema);
  }
  for (const keyword of ["items", "additionalProperties", "not"]) {
    const child = readObject(schema[keyword]);
    if (child) convertSchema(child, `${path}/${keyword}`);
  }
}

function visitContent(container: ObjectNode, path: string): void {
  visitMap(container.content, `${path}/content`, (media, mediaPath) => {
    const schema = readObject(media.schema);
    if (schema) convertSchema(schema, `${mediaPath}/schema`);
    visitMap(
      media.encoding,
      `${mediaPath}/encoding`,
      (encoding, encodingPath) => {
        visitMap(encoding.headers, `${encodingPath}/headers`, visitParameter);
      },
    );
  });
}

function visitParameter(parameter: ObjectNode, path: string): void {
  const schema = readObject(parameter.schema);
  if (schema) convertSchema(schema, `${path}/schema`);
  visitContent(parameter, path);
}

function visitResponse(response: ObjectNode, path: string): void {
  visitContent(response, path);
  visitMap(response.headers, `${path}/headers`, visitParameter);
}

function visitCallback(callback: ObjectNode, path: string): void {
  visitMap(callback, path, visitPathItem, true);
}

function visitPathItem(pathItem: ObjectNode, path: string): void {
  visitArray(pathItem.parameters, `${path}/parameters`, visitParameter);
  for (const method of [
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
  ]) {
    const operation = readObject(pathItem[method]);
    if (!operation) continue;
    const operationPath = `${path}/${method}`;
    visitArray(
      operation.parameters,
      `${operationPath}/parameters`,
      visitParameter,
    );
    const body = readObject(operation.requestBody);
    if (body) visitContent(body, `${operationPath}/requestBody`);
    visitMap(
      operation.responses,
      `${operationPath}/responses`,
      visitResponse,
      true,
    );
    visitMap(operation.callbacks, `${operationPath}/callbacks`, visitCallback);
  }
}

export function convertOpenApi30Document<T>(document: T): T {
  const converted = cloneOpenApiDocument(document);
  const root = readObject(converted);
  if (!root)
    throw new Error("OpenAPI 3.0.3 conversion requires a document object.");
  const components = readObject(root.components);
  if (components) {
    visitMap(components.schemas, "#/components/schemas", convertSchema);
    visitMap(components.parameters, "#/components/parameters", visitParameter);
    visitMap(components.headers, "#/components/headers", visitParameter);
    visitMap(
      components.requestBodies,
      "#/components/requestBodies",
      visitContent,
    );
    visitMap(components.responses, "#/components/responses", visitResponse);
    visitMap(components.callbacks, "#/components/callbacks", visitCallback);
  }
  visitMap(root.paths, "#/paths", visitPathItem, true);
  return converted;
}
