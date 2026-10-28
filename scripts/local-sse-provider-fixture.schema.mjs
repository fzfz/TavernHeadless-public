import { z } from "zod";

const localSseProviderFixtureBaseSchema = z
  .object({
    port: z.number().int().min(0).max(65535),
    modelId: z.string().min(1),
    firstChunkDelayMs: z.number().int().min(0).max(120_000).default(20_000),
    chunkDelayMs: z.number().int().min(0).max(120_000).default(20_000),
    chunks: z.array(z.string().min(1)).min(2),
  })
  .strict();

export const localSseProviderFixtureOptionsSchema =
  localSseProviderFixtureBaseSchema;

export const localSseProviderFixtureConfigSchema =
  localSseProviderFixtureBaseSchema.extend({
    port: z.number().int().min(1024).max(65535),
  });

export const localSseProviderFixtureFailureRequestSchema = z
  .object({
    count: z.number().int().min(1).max(10).default(1),
  })
  .strict();
