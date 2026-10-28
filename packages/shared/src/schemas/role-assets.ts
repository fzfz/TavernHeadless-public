import { z } from "zod";

export const roleAssetPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[\\:\u0000]/.test(value) &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Use a relative package path with named directory segments.",
  );

export const roleStorageKeySchema = roleAssetPathSchema.refine(
  (value) => !value.includes("/"),
  "Use a single identifier without directory separators.",
);

export const roleFileSchema = z
  .object({
    path: roleAssetPathSchema,
    content: z.instanceof(Uint8Array),
  })
  .strict();

export const roleFileSetSchema = z
  .array(roleFileSchema)
  .min(1)
  .refine(
    (files) => new Set(files.map((file) => file.path)).size === files.length,
    "Provide each package path once.",
  );

export const roleAssetPurposeSchema = z.enum([
  "manifest",
  "template",
  "browser_script",
  "server_script",
  "media",
  "data",
]);

export const roleAssetFileSchema = z
  .object({
    name: roleAssetPathSchema,
    mime: z.string().min(1),
    base64: z
      .string()
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    purpose: roleAssetPurposeSchema,
  })
  .strict();

export const createRoleAssetsSchema = z
  .object({
    character_id: z.string().min(1),
    files: z
      .array(roleAssetFileSchema)
      .min(1)
      .refine(
        (files) =>
          new Set(files.map((file) => file.name)).size === files.length,
        "Provide each resource path once.",
      ),
  })
  .strict();

export type RoleFile = z.infer<typeof roleFileSchema>;
export type RoleAssetFile = z.infer<typeof roleAssetFileSchema>;
export type CreateRoleAssets = z.infer<typeof createRoleAssetsSchema>;

export type RoleRuntimeManifest = {
  apiVersion: 1;
  html: string;
  css: string;
  script: string;
  floorHtml?: string;
  assets: Record<
    string,
    { kind: "image" | "audio"; file: string; label: string; tags: string[] }
  >;
  data: Record<string, unknown>;
};

export const roleAssetUploadResultSchema = z
  .object({
    data: z
      .object({
        version_id: roleStorageKeySchema,
        count: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export const roleAssetVersionParamsSchema = z
  .object({ versionId: roleStorageKeySchema })
  .strict();
