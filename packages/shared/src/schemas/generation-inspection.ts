import { z } from "zod";
import config from "../config/generation-inspection.json" with { type: "json" };
const section = z
  .object({
    key: z.string(),
    label: z.string(),
    path: z.string().startsWith("/"),
    list: z.boolean().optional(),
    committed: z.boolean().optional(),
  })
  .strict();
export const generationInspectionConfigSchema = z
  .object({
    floor: z.array(section),
    page: z.array(section),
    message: z.array(section),
    promptFields: z.record(z.string(), z.string()),
    ui: z.record(z.string(), z.string()),
  })
  .strict();
export const generationInspectionConfig =
  generationInspectionConfigSchema.parse(config);
export const generationInspectionSectionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();
export type GenerationInspectionSection = z.infer<
  typeof generationInspectionSectionSchema
>;
export const generationInspectionListSchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())),
    meta: z
      .object({ has_more: z.boolean().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const generationInspectionFloorSchema = z
  .object({
    id: z.string().min(1),
    session_id: z.string().min(1),
    state: z.enum(["draft", "generating", "committed", "failed"]),
  })
  .passthrough();
export const generationInspectionPageSchema = z
  .object({ id: z.string().min(1), page_no: z.number().int() })
  .passthrough();
export const generationInspectionMessageSchema = z
  .object({ id: z.string().min(1), seq: z.number().int() })
  .passthrough();
