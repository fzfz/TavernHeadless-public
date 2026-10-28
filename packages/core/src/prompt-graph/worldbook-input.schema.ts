import { z } from 'zod';

export const promptGraphWorldbookEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  position: z.enum(['before', 'after', 'an_top', 'an_bottom', 'em_top', 'em_bottom', 'depth', 'outlet']).optional(),
  role: z.enum(['system', 'user', 'assistant']).optional(),
  depth: z.number().optional(),
  outletName: z.string().optional(),
  ignoreBudget: z.boolean().optional(),
}).strict();

export type PromptGraphWorldbookEntry = z.infer<typeof promptGraphWorldbookEntrySchema>;
