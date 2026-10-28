import { zodSchema } from "ai";
import type { z } from "zod";

type JsonSchema = Awaited<ReturnType<typeof zodSchema>["jsonSchema"]>;

const patternFormats = new Set(["starts_with", "ends_with", "includes"]);

function normalizeJsonSchema(
  schema: JsonSchema | boolean,
  insideUnion = false,
): void {
  if (typeof schema === "boolean") return;

  if (schema.format && patternFormats.has(schema.format)) {
    const constraints = [schema, ...(schema.allOf ?? [])];
    if (
      !constraints.some(
        (constraint) =>
          typeof constraint !== "boolean" &&
          typeof constraint.pattern === "string",
      )
    ) {
      throw new Error(
        `Cannot export ${schema.format} without an equivalent JSON Schema pattern.`,
      );
    }
    delete schema.format;
  }

  if (insideUnion && schema.additionalProperties === false) {
    const allowedNames: Array<JsonSchema | boolean> = [];
    const names = Object.keys(schema.properties ?? {});
    if (names.length > 0) allowedNames.push({ enum: names });
    for (const pattern of Object.keys(schema.patternProperties ?? {})) {
      allowedNames.push({ type: "string", pattern });
    }
    const propertyNames =
      allowedNames.length === 0 ? false : { anyOf: allowedNames };
    schema.propertyNames =
      schema.propertyNames === undefined
        ? propertyNames
        : { allOf: [schema.propertyNames, propertyNames] };
    delete schema.additionalProperties;
  }

  for (const children of [
    schema.properties,
    schema.patternProperties,
    schema.definitions,
  ]) {
    for (const child of Object.values(children ?? {})) {
      normalizeJsonSchema(child, insideUnion);
    }
  }
  schema.allOf?.forEach((child) => normalizeJsonSchema(child, insideUnion));
  for (const children of [schema.anyOf, schema.oneOf]) {
    children?.forEach((child) => normalizeJsonSchema(child, true));
  }
  for (const child of [
    schema.additionalProperties,
    schema.additionalItems,
    schema.contains,
    schema.propertyNames,
    schema.not,
    schema.if,
    schema.then,
    schema.else,
    ...(Array.isArray(schema.items) ? schema.items : [schema.items]),
  ]) {
    if (child !== undefined) normalizeJsonSchema(child, insideUnion);
  }
}

export async function exportJsonSchema(schema: z.ZodType) {
  const jsonSchema = await zodSchema(schema).jsonSchema;
  normalizeJsonSchema(jsonSchema);
  return jsonSchema;
}
