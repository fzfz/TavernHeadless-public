export type RoleResourceImportAction =
  | { type: "json-file" }
  | { type: "none" };

export function roleResourceImportAction(kind: string): RoleResourceImportAction {
  if (kind === "character" || kind === "model" || kind === "persona")
    return { type: "none" };
  return { type: "json-file" };
}
