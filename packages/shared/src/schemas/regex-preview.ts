export const regexPreviewBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "scripts", "placement", "channel"],
  properties: {
    text: { type: "string" },
    scripts: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    placement: { type: "integer", enum: [1, 2] },
    channel: { type: "string", enum: ["persist", "prompt", "display", "edit"] },
    depth: { type: "integer", minimum: 0 },
    variables: { type: "object", additionalProperties: true },
  },
} as const;
export interface RegexPreviewBody {
  text: string;
  scripts: unknown[];
  placement: 1 | 2;
  channel: "persist" | "prompt" | "display" | "edit";
  depth?: number;
  variables?: Record<string, unknown>;
}

export const regexPreviewResultSchema = z.object({
  text: z.string(),
  candidate_rule_names: z.array(z.string()),
  matched_rule_names: z.array(z.string()),
  skipped_rules: z.array(z.object({ rule_name: z.string(), reason: z.string() })),
});
export type RegexPreviewResult = z.infer<typeof regexPreviewResultSchema>;

export const regexPreviewResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "text",
        "candidate_rule_names",
        "matched_rule_names",
        "skipped_rules",
      ],
      properties: {
        text: { type: "string" },
        candidate_rule_names: { type: "array", items: { type: "string" } },
        matched_rule_names: { type: "array", items: { type: "string" } },
        skipped_rules: {
          type: "array",
          items: {
            type: "object",
            required: ["rule_name", "reason"],
            properties: {
              rule_name: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
import { z } from "zod";
