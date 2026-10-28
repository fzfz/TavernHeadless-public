type JsonObject = Record<string, unknown>;
type DerivedValue = { available: true; value: unknown } | { available: false };

export interface OpeningInitialStateDraft {
  values: JsonObject;
  missingRequired: string[];
}

export function createOpeningInitialState(schema: unknown): OpeningInitialStateDraft | undefined {
  if (!isRecord(schema) || (schema.type !== undefined && schema.type !== "object")) return undefined;
  const result = deriveObject(schema);
  return { values: result.values, missingRequired: result.missingRequired };
}

function deriveValue(schema: JsonObject): DerivedValue {
  if (Object.hasOwn(schema, "default")) return { available: true, value: schema.default };
  if (Object.hasOwn(schema, "const")) return { available: true, value: schema.const };
  if (Array.isArray(schema.enum) && schema.enum.length) return { available: true, value: schema.enum[0] };

  const type = schema.type ?? (isRecord(schema.properties) ? "object" : undefined);
  if (type === "object") {
    if (schema.properties !== undefined && !isRecord(schema.properties)) return { available: false };
    const result = deriveObject(schema);
    return result.missingRequired.length ? { available: false } : { available: true, value: result.values };
  }

  if (type === "string") {
    if (typeof schema.pattern === "string") return { available: false };
    const minimum = typeof schema.minLength === "number" ? Math.max(0, Math.ceil(schema.minLength)) : 0;
    const value = minimum > 0 ? "新变量".repeat(Math.ceil(minimum / 3)).slice(0, minimum) : "";
    return { available: true, value };
  }
  if (type === "boolean") return { available: true, value: false };
  if (type === "null") return { available: true, value: null };
  if (type === "number" || type === "integer") {
    const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
    const exclusiveMinimum = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : undefined;
    const multipleOf = typeof schema.multipleOf === "number" && schema.multipleOf > 0 ? schema.multipleOf : undefined;
    let value = minimum ?? (exclusiveMinimum === undefined ? 0 : exclusiveMinimum + (type === "integer" ? 1 : Number.EPSILON));
    if (type === "integer") value = Math.ceil(value);
    if (multipleOf) value = Math.ceil(value / multipleOf) * multipleOf;
    const exclusiveMaximum = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : undefined;
    const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
    if ((exclusiveMinimum !== undefined && value <= exclusiveMinimum) ||
      (maximum !== undefined && value > maximum) ||
      (exclusiveMaximum !== undefined && value >= exclusiveMaximum)) return { available: false };
    return { available: true, value };
  }
  if (type === "array") {
    const minimum = typeof schema.minItems === "number" ? Math.max(0, Math.ceil(schema.minItems)) : 0;
    if (minimum === 0) return { available: true, value: [] };
    if (!isRecord(schema.items)) return { available: false };
    const item = deriveValue(schema.items);
    if (!item.available || (typeof schema.maxItems === "number" && minimum > schema.maxItems)) return { available: false };
    return { available: true, value: Array.from({ length: minimum }, () => item.value) };
  }
  return { available: false };
}

function deriveObject(schema: JsonObject): { values: JsonObject; missingRequired: string[] } {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const output: JsonObject = {};
  const missingRequired: string[] = [];
  for (const [key, child] of Object.entries(properties)) {
    if (!isRecord(child)) {
      if (required.has(key)) missingRequired.push(key);
      continue;
    }
    const derived = deriveValue(child);
    if (derived.available) output[key] = derived.value;
    else if (required.has(key)) missingRequired.push(key);
  }
  for (const key of required) if (!(key in properties)) missingRequired.push(key);
  return { values: output, missingRequired };
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
