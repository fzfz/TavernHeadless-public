import { z } from "zod";

export const PRESET_EDITOR_SOURCE_ROLES = ["model"] as const;

export const presetEditorSourceRoleSchema = z.enum(PRESET_EDITOR_SOURCE_ROLES);

export const presetEditorEntryMetadataJsonSchema = {
  type: "object",
  properties: {
    is_original: { type: "boolean" },
    source_role: { type: "string", enum: PRESET_EDITOR_SOURCE_ROLES },
  },
} as const;

export const presetEditorEntryMetadataSchema = z.object({
  is_original: z.boolean().optional(),
  source_role: presetEditorSourceRoleSchema.optional(),
});

export type PresetEditorSourceRole = z.infer<typeof presetEditorSourceRoleSchema>;
export type PresetEditorEntryMetadata = z.infer<typeof presetEditorEntryMetadataSchema>;
