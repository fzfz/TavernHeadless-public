import { z } from "zod";
import policyJson from "../config/role-tool-protocol-errors.json" with { type: "json" };

export const roleToolProtocolErrorPolicySchema = z
  .object({
    httpStatuses: z.array(z.number().int().min(400).max(499)).min(1),
    rules: z
      .array(
        z
          .object({
            codes: z.array(z.string().min(1)).min(1),
            parameterPatterns: z
              .array(
                z
                  .string()
                  .min(1)
                  .refine((pattern) => {
                    try {
                      new RegExp(pattern);
                      return true;
                    } catch {
                      return false;
                    }
                  }),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** The structured provider fields used to classify server-owned tool schemas. */
export const roleToolProtocolProviderErrorSchema = z
  .object({
    error: z.object({ code: z.string(), param: z.string() }).passthrough(),
  })
  .passthrough();

export const roleToolProtocolErrorPolicy =
  roleToolProtocolErrorPolicySchema.parse(policyJson);
