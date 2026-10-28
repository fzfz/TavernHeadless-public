import { z } from "zod";

export const ciRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  path: z.string(),
  event: z.string(),
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
  head_branch: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  head_repository: z.object({ full_name: z.string() }),
});
export const runsResponseSchema = z.object({
  workflow_runs: z.array(ciRunSchema),
});
export const releaseEventSchema = z.object({
  workflow_run: ciRunSchema.optional(),
});
export type CiRun = z.infer<typeof ciRunSchema>;
export interface VerifiedRelease {
  commit: string;
  branch: string;
  workflow: string;
  workflowRunId: number;
  conclusion: "success";
}
