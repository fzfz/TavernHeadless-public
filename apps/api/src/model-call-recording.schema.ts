import { z } from "zod";

export const modelCallRecordingConfigSchema = z
  .object({
    maxRetries: z.number().int().nonnegative(),
    baseDelayMs: z.number().int().nonnegative(),
    maxDelayMs: z.number().int().nonnegative(),
    streamSaveIntervalMs: z.number().int().nonnegative(),
  })
  .strict();

export type ModelCallRecordingConfig = z.infer<
  typeof modelCallRecordingConfigSchema
>;
