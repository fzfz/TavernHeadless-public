import { z } from "zod";

export const nativeModuleRuntimeConfigSchema = z
  .object({
    timeoutMs: z.number().int().min(50).max(10_000),
    maxBufferBytes: z.number().int().min(1_024).max(16_777_216),
    maxInputBytes: z.number().int().min(1_024).max(33_554_432),
    maxModuleBytes: z.number().int().min(1_024).max(16_777_216),
    maxModuleFiles: z.number().int().min(1).max(4_096),
    maxConcurrentWorkers: z.number().int().min(1).max(32),
    maxOldGenerationSizeMb: z.number().int().min(32).max(512),
    evaluationTimeoutMs: z.number().int().min(50).max(10_000),
  })
  .strict();

export type NativeModuleRuntimeConfig = z.infer<
  typeof nativeModuleRuntimeConfigSchema
>;
