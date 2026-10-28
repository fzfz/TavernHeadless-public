import { z } from "zod";

export const llmProfileProviders = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "xai",
  "openai-compatible",
] as const;

export const llmProfileConfigSnapshotSchema = z
  .object({
    preset_name: z.string().trim().min(1),
    provider: z.enum(llmProfileProviders),
    model_id: z.string().trim().min(1),
    base_url: z.string().trim().min(1).nullable(),
  })
  .strict();

export const llmProfileConfigSnapshotJsonSchema = {
  type: "object",
  required: ["preset_name", "provider", "model_id", "base_url"],
  properties: {
    preset_name: { type: "string", minLength: 1 },
    provider: { type: "string", enum: [...llmProfileProviders] },
    model_id: { type: "string", minLength: 1 },
    base_url: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
  },
  additionalProperties: false,
} as const;

export type LlmProfileConfigSnapshot = z.infer<
  typeof llmProfileConfigSnapshotSchema
>;
