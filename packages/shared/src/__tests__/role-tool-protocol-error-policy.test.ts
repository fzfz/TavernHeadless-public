import { expect, it } from "vitest";
import { roleToolProtocolErrorPolicySchema } from "../schemas/role-tool-protocol-errors.js";

it.each([
  {
    httpStatuses: [],
    rules: [
      { codes: ["unsupported_parameter"], parameterPatterns: ["^tools$"] },
    ],
  },
  {
    httpStatuses: [500],
    rules: [
      { codes: ["unsupported_parameter"], parameterPatterns: ["^tools$"] },
    ],
  },
  {
    httpStatuses: [400],
    rules: [{ codes: [], parameterPatterns: ["^tools$"] }],
  },
  {
    httpStatuses: [400],
    rules: [{ codes: ["unsupported_parameter"], parameterPatterns: ["["] }],
  },
  {
    httpStatuses: [400],
    rules: [
      { codes: ["unsupported_parameter"], parameterPatterns: ["^tools$"] },
    ],
    fallback: true,
  },
])("rejects invalid provider error policy %j", (policy) => {
  expect(roleToolProtocolErrorPolicySchema.safeParse(policy).success).toBe(
    false,
  );
});
