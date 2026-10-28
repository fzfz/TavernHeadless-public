import { z } from "zod";
export const roleUserWebConfigSchema = z
  .object({ apiBaseUrl: z.union([z.string().url(), z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/)]), adminBaseUrl: z.string().url() })
  .strict();
export const roleFormalSessionMetadataSchema = z
  .object({ role_release_id: z.string().min(1) })
  .passthrough();
export type RoleUserWebConfig = z.infer<typeof roleUserWebConfigSchema>;
export const roleAdminWebConfigSchema = z
  .object({ userWebBaseUrl: z.string().url() })
  .strict();
