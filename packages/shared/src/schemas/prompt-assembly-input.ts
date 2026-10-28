import { z } from "zod";

export const promptAssemblyCurrentMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
    sourceId: z.string().min(1).optional(),
    floorNo: z.number().int().nullable().optional(),
  })
  .strict();

export const promptAssemblyConversationSchema = z
  .object({
    currentMessages: z.array(promptAssemblyCurrentMessageSchema),
    stateData: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const promptAssemblyVariableContextSchema = z
  .object({
    sessionId: z.string().min(1),
    branchId: z.string().optional(),
    floorId: z.string().optional(),
    pageId: z.string().optional(),
    statData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const promptAssemblyInputSchema = z
  .object({
    conversation: promptAssemblyConversationSchema.optional(),
    variableContext: promptAssemblyVariableContextSchema.optional(),
  })
  .strict();

export type PromptAssemblyCurrentMessage = z.infer<
  typeof promptAssemblyCurrentMessageSchema
>;
export type PromptAssemblyConversation = z.infer<
  typeof promptAssemblyConversationSchema
>;
export type PromptAssemblyVariableContext = z.infer<
  typeof promptAssemblyVariableContextSchema
>;
export type PromptAssemblyInput = z.infer<typeof promptAssemblyInputSchema>;
