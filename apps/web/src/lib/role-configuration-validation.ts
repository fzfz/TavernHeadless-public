import { createRoleReleaseBodySchema } from "@tavern/shared";
import labels from "../config/role-apps.json";
export function roleConfigurationIssues(input: unknown) {
  const result = createRoleReleaseBodySchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const fields = labels.validationFields as Record<string, string>;
    const pairedWorldbook =
      issue.code === "custom" &&
      issue.path.some(
        (part) => part === "worldbook_id" || part === "worldbook_version_id",
      );
    const path = pairedWorldbook
      ? `${fields.worldbook_id} / ${fields.worldbook_version_id}`
      : issue.path
          .map((part) => {
            if (typeof part === "number") return String(part + 1);
            return typeof part === "string"
              ? (fields[part] ?? part)
              : String(part);
          })
          .join(" · ");
    return { path, message: issue.message };
  });
}
