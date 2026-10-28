import { z } from "zod";
export const roleAcceptanceConfigSchema = z
  .object({
    dataRoot: z.string().min(1),
    fixturesRoot: z.string().min(1),
    credentialsFile: z.string().min(1),
    masterKeyFile: z.string().min(1),
    resultFile: z.string().min(1),
    apiPort: z.number().int().min(1024).max(65535),
    adminPort: z.number().int().min(1024).max(65535),
    userPort: z.number().int().min(1024).max(65535),
  })
  .strict();
export const roleAcceptanceCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url(),
    narratorModel: z.string().min(1),
    updaterModel: z.string().min(1),
  })
  .strict();
export const roleAcceptanceBindingsSchema = z
  .object({
    roles: z.array(
      z.object({
        id: z.string(),
        directory: z.string(),
        preset: z.string(),
        promptBundle: z.string().optional(),
      }),
    ),
    presetPromptOrderCharacterId: z.number().int(),
    performers: z.array(
      z.object({ name: z.string(), description: z.string() }),
    ),
    disabledSlots: z.array(z.enum(["director", "verifier", "memory"])),
    maxOutputTokens: z.number().int().positive(),
    modelTimeoutMs: z.number().int().positive(),
  })
  .strict();
