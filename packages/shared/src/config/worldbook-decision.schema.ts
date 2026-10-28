import { z } from 'zod';

export const worldbookDecisionStageValues = ['trigger', 'delay', 'group', 'probability'] as const;
export const worldbookDecisionOutcomeValues = ['selected', 'excluded'] as const;

export const worldbookDecisionStageSchema = z.enum(worldbookDecisionStageValues);
export const worldbookDecisionOutcomeSchema = z.enum(worldbookDecisionOutcomeValues);

export type WorldbookDecisionStage = z.infer<typeof worldbookDecisionStageSchema>;
export type WorldbookDecisionOutcome = z.infer<typeof worldbookDecisionOutcomeSchema>;
