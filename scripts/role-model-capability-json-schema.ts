import { roleModelCapabilitiesGrantJsonSchema } from "../packages/shared/src/schemas/role-model-capabilities.js";

const grantJsonSchema = Object.fromEntries(
  Object.entries(roleModelCapabilitiesGrantJsonSchema).filter(
    ([key]) => key !== "$schema",
  ),
);

/** Replace Zod's opaque effect schema with the canonical Draft-07 grant schema. */
export function replaceRoleModelCapabilityJsonSchemas(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(replaceRoleModelCapabilityJsonSchemas);
  if (value === null || typeof value !== "object") return value;

  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      replaceRoleModelCapabilityJsonSchemas(child),
    ]),
  ) as Record<string, unknown>;
  const properties = result.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    const schemaProperties = properties as Record<string, unknown>;
    if (Object.hasOwn(schemaProperties, "model_capabilities")) {
      schemaProperties.model_capabilities = {
        anyOf: [grantJsonSchema, { type: "null" }],
      };
    }
  }
  return result;
}
