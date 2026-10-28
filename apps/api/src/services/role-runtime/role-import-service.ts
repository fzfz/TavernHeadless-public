import { parse } from "yaml";
import { roleCharacterPreparationSchema } from "@tavern/shared";
import {
  RoleImportError,
  importOpenings,
  migrateMvuToAgent,
  readMvuInitialVariables,
} from "@tavern/adapters-sillytavern";

export function parseRoleVariablesYaml(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parse(text);
  } catch (cause) {
    throw new RoleImportError("ROLE_IMPORT_YAML_INVALID", undefined, cause);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RoleImportError("ROLE_IMPORT_INITIAL_INVALID");
  return value as Record<string, unknown>;
}

export class RoleImportService {
  prepareCharacter(input: unknown) {
    const { snapshot, metadata, migration } =
      roleCharacterPreparationSchema.parse(input);
    const initial = readMvuInitialVariables(
      snapshot.characterBook,
      migration,
      parseRoleVariablesYaml,
    );
    const openings = importOpenings(snapshot, metadata, initial, {
      parseYaml: parseRoleVariablesYaml,
    });
    const migrated = migrateMvuToAgent(
      snapshot,
      snapshot.characterBook,
      migration,
    );
    migrated.snapshot.characterBook = migrated.worldbook;
    migrated.snapshot.extensions.tavern_headless.openings = openings;
    return { snapshot: migrated.snapshot, openings, initial };
  }
}
