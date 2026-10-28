import { z } from "zod";

export const regexSourceSchema = z
  .object({
    kind: z.enum(["character", "preset"]),
    name: z.string().min(1),
    ruleId: z.string().min(1),
    index: z.number().int().nonnegative(),
    resourceId: z.string().min(1).optional(),
    versionId: z.string().min(1).optional(),
  })
  .strict();
export type RegexSource = z.infer<typeof regexSourceSchema>;
