import { z } from "zod";

export const nativeCardAcceptanceConfigSchema = z
  .object({
    apiPort: z.number().int().min(1024).max(65535),
    providerPort: z.number().int().min(1024).max(65535),
    webOrigin: z.string().url(),
    userWebOrigin: z.string().url(),
    dataDirectory: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    narration: z.array(z.string().min(1)).min(2),
    updatedState: z
      .object({
        location: z.string(),
        hour: z.number().int(),
        trust: z.number().int(),
      })
      .strict(),
    persona: z
      .object({ name: z.string().min(1), description: z.string().min(1) })
      .strict(),
    userMessage: z.string().min(1),
    preset: z.object({ name: z.string().min(1) }).passthrough(),
  })
  .strict();
