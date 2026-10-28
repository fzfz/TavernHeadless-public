import { z } from 'zod';

export const promptIntentValues = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'] as const;
export const promptRunIntentSchema = z.enum(promptIntentValues);
export type PromptRunIntent = z.infer<typeof promptRunIntentSchema>;
