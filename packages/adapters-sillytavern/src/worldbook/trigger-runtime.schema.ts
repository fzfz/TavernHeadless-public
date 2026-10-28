import { z } from 'zod';
import { promptRunIntentSchema } from '@tavern/shared';

export const worldbookRunIntentSchema = promptRunIntentSchema;

export const worldbookTriggerExtensionsSchema = z.object({
  probability: z.number().finite().min(0).max(100).optional(),
  useProbability: z.boolean().optional(),
  group: z.string().optional(),
  group_override: z.boolean().optional(),
  group_weight: z.number().finite().nonnegative().nullable().optional(),
  triggers: z.array(worldbookRunIntentSchema).optional(),
  delay: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export type WorldbookTriggerExtensions = z.infer<typeof worldbookTriggerExtensionsSchema>;
