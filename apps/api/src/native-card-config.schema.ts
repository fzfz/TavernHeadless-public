import { z } from "zod";

export const nativeCardConfigSchema = z
  .object({
    storageRoot: z.string().min(1),
    importStagingRoot: z.string().min(1),
    buildRoot: z.string().min(1),
    maxUploadBytes: z.number().int().positive(),
    maxExpandedBytes: z.number().int().positive(),
    maxFileCount: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxPathBytes: z.number().int().positive(),
    importTtlMs: z.number().int().positive(),
    buildTtlMs: z.number().int().positive(),
  })
  .strict();
export type NativeCardConfig = z.infer<typeof nativeCardConfigSchema>;
