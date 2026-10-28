import { z } from "zod";
import config from "../config/prompt-asset-request-limits.json" with { type: "json" };

export const promptAssetRequestLimitsSchema = z
  .object({
    bodyLimitBytes: z.number().int().positive(),
  })
  .strict();

export const PROMPT_ASSET_REQUEST_LIMITS =
  promptAssetRequestLimitsSchema.parse(config);
