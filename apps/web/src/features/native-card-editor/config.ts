import { z } from "zod";
import uiConfig from "../../config/native-card-editor.json";

export type NativeCardEditorLabel = keyof typeof uiConfig.labels;
export type NativeCardEditorConfig = typeof uiConfig;

export const nativeCardEditorConfigSchema = z
  .object({
    path: z.string().startsWith("/"),
    entryLabel: z.string().min(1),
    labels: z.record(z.string(), z.string().min(1)),
    fileTreeGroups: z.array(
      z.object({ key: z.string().min(1), pathPrefix: z.string() }).strict(),
    ).min(1),
    chapters: z.array(
      z
        .object({
          key: z.string().min(1),
          labelKey: z.string().min(1),
          icon: z.string().min(1),
          defaultPath: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const nativeCardEditorConfig = nativeCardEditorConfigSchema.parse(uiConfig);
