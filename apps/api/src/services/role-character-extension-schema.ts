import { z } from "zod";

import type { StMacroJsonValue } from "./st-macros/index.js";

export const stMacroJsonValueSchema: z.ZodType<StMacroJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(stMacroJsonValueSchema),
    z.record(z.string(), stMacroJsonValueSchema),
  ]),
);

export const roleOpeningItemSchema = z
  .object({
    id: z.string().min(1),
    displayText: z.string(),
    variables: z.record(z.string(), stMacroJsonValueSchema),
  })
  .passthrough();

export const roleOpeningsSchema = z
  .object({
    items: z.array(roleOpeningItemSchema),
  })
  .passthrough();

export { rolePromptControllerConfigSchema, roleCharacterBookSchema, rolePromptControllerResultSchema, type RolePromptControllerConfig } from "@tavern/shared";
