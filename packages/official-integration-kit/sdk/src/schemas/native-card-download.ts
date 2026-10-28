import { z } from "zod";

export const nativeCardDownloadArtifactSchema = z.object({
  blob: z.instanceof(Blob),
  fileName: z.string().min(1).nullable(),
});

export type NativeCardDownloadArtifact = z.infer<
  typeof nativeCardDownloadArtifactSchema
>;
