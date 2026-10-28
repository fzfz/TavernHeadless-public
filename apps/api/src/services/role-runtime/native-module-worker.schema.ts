import { z } from "zod";

export const nativeModuleWorkerContractSchema = z.object({
  name: z.string().min(1),
  directory: z.string().min(1),
  contextFields: z.array(z.string().min(1)),
  async: z.boolean(),
}).strict();

export const nativeModuleWorkerModuleSchema = z.object({
  path: z.string().min(1),
  source: z.string(),
  purpose: z.enum(["server_script", "data"]),
}).strict();

export const nativeModuleWorkerRequestSchema = z.object({
  entryPath: z.string().min(1),
  exportName: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
  contract: nativeModuleWorkerContractSchema,
  modules: z.array(nativeModuleWorkerModuleSchema),
  globals: z.array(z.string().min(1)),
  evaluationTimeoutMs: z.number().int().positive(),
}).strict();

export const nativeModuleWorkerResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);

export type NativeModuleWorkerRequest = z.infer<typeof nativeModuleWorkerRequestSchema>;
export type NativeModuleWorkerResponse = z.infer<typeof nativeModuleWorkerResponseSchema>;
