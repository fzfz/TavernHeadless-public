import { z } from "zod";

const pathSchema = z.string().min(1);

export const storageConfigSchema = z
  .object({
    dataRoot: pathSchema,
    roleAssetMaxUploadBytes: z.number().int().positive(),
    databaseFile: pathSchema,
    roleAssetsDir: pathSchema,
    roleAssetStagingDir: pathSchema,
    chatTransferArtifactDir: pathSchema,
    backupArtifactDir: pathSchema,
  })
  .strict();

export const resolvedStorageConfigSchema = storageConfigSchema
  .omit({ databaseFile: true })
  .extend({
    databasePath: pathSchema,
  });

export type ResolvedStorageConfig = z.infer<typeof resolvedStorageConfigSchema>;
