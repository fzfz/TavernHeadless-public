import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const nativeCardRuntimeWorldbookBindingSchema = z.object({
  bookId: nonEmpty,
  resourceId: nonEmpty,
  versionId: nonEmpty,
  ordinal: z.number().int().nonnegative(),
  enabled: z.boolean(),
}).strict();

export const nativeCardRuntimeRegexBindingSchema = z.object({
  path: nonEmpty,
  resourceId: nonEmpty,
  versionId: nonEmpty,
  ordinal: z.number().int().nonnegative(),
}).strict();

export const nativeCardRuntimePackageSchema = z.object({
  cardId: nonEmpty,
  revision: z.number().int().positive(),
  packageId: nonEmpty,
  worldbooks: z.array(nativeCardRuntimeWorldbookBindingSchema),
  regexProfiles: z.array(nativeCardRuntimeRegexBindingSchema),
  frontendManifestPath: nonEmpty.nullable(),
}).strict().superRefine((value, context) => {
  const worldbookIds = new Set<string>();
  for (const [index, binding] of value.worldbooks.entries()) {
    if (worldbookIds.has(binding.bookId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["worldbooks", index, "bookId"], message: "Native runtime worldbook ids must be unique." });
    worldbookIds.add(binding.bookId);
  }
  const regexPaths = new Set<string>();
  for (const [index, binding] of value.regexProfiles.entries()) {
    if (regexPaths.has(binding.path)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["regexProfiles", index, "path"], message: "Native runtime regex paths must be unique." });
    regexPaths.add(binding.path);
  }
});

export type NativeCardRuntimePackage = z.infer<typeof nativeCardRuntimePackageSchema>;
export type NativeCardRuntimeWorldbookBinding = z.infer<typeof nativeCardRuntimeWorldbookBindingSchema>;
export type NativeCardRuntimeRegexBinding = z.infer<typeof nativeCardRuntimeRegexBindingSchema>;
