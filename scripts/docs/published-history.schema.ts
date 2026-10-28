import { z } from "zod";

export const historyItemSchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  publishedAt: z.string().datetime(),
  breaking: z.boolean(),
  manifest: z.string().min(1),
});
export const historySchema = z.object({
  retention: z.number().int().positive(),
  items: z.array(historyItemSchema),
});
export const manifestSourceSchema = z.object({
  source: z.object({ repo: z.string(), commit: z.string() }),
  compareBase: z
    .object({ commit: z.string().regex(/^[a-f0-9]{40}$/) })
    .optional(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type HistoryDocument = z.infer<typeof historySchema>;
export interface PublishedHistorySnapshot {
  compareBaseCommit: string | null;
  items: HistoryItem[];
  manifestContents: Map<string, string>;
  state: "first-publication" | "existing-publication";
}
