import { z } from "zod";
export const presetStreamingSchema = z
  .object({
    startMarkers: z.array(z.string().min(1)).min(1),
    startMarkerLineBreak: z.boolean().optional(),
    hiddenBlocks: z.array(
      z
        .object({
          start: z.string().min(1),
          startSuffix: z.string().min(1).optional(),
          end: z.string().min(1),
          removeFollowingWhitespace: z.boolean().optional(),
        })
        .strict(),
    ),
    removedTokens: z.array(z.string().min(1)),
  })
  .strict();
export const presetOutputSchema = z
  .object({
    version: z.literal(1),
    delivery: z.enum(["complete", "streaming"]),
    streaming: presetStreamingSchema.optional(),
    rules: z
      .array(
        z
          .object({
            sourceRuleId: z.string().min(1),
            pattern: z.string(),
            flags: z.string(),
            replacement: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine((p) => p.delivery !== "streaming" || !!p.streaming);
export const roleTextEventSchema = z
  .object({ text: z.string(), phase: z.enum(["streaming", "completed"]) })
  .strict();
export const roleMessagesQuerySchema = z
  .object({
    branch_id: z.string().min(1),
    floor_id: z.string().min(1),
  })
  .strict();
export type PresetOutput = z.infer<typeof presetOutputSchema>;

export const roleMessagesSchema = z.array(
  z
    .object({
      id: z.string(),
      role: z.string(),
      content: z.string(),
      source: z.string().nullable(),
    })
    .strict(),
);

export type RoleProjectedTextEvent = z.infer<typeof roleTextEventSchema>;
