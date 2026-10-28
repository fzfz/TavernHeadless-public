import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { snapshotToStCharacterCard } from "@tavern/adapters-sillytavern";
import {
  mvuMigrationSchema,
  roleStateProfileSchema,
  rolePromptControllerConfigSchema,
} from "@tavern/shared";

const root = resolve(import.meta.dirname, "../../../../fixtures/role-apps");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
export async function roleFixture(role: string) {
  const directory = resolve(root, role);
  const snapshot = await json(resolve(directory, "snapshot.json"));
  const profile = roleStateProfileSchema.parse(
    await json(resolve(directory, "live-model.json")),
  );
  const files: Record<string, string> = {};
  for (const path of [
    profile.stateSchemaFile,
    ...(profile.ruleFiles ?? []),
    profile.deriveScript,
    profile.validateScript,
    ...(profile.moduleFiles ?? []),
  ])
    if (path) files[path] = await readFile(resolve(directory, path), "utf8");
  const binding = (await json(resolve(root, "bindings.json"))).roles.find(
    (item: { id: string }) => item.id === role,
  );
  if (binding.promptBundle) {
    const bundle = await json(resolve(directory, binding.promptBundle));
    const controller = rolePromptControllerConfigSchema.parse({
      modulePath: bundle.controllerModule,
      controllerEntryIds: bundle.controllerEntryIds,
      updaterEntryIds: bundle.updaterEntryIds,
      variableRoot: bundle.variableRoot,
      variableMacros: bundle.variableMacros,
    });
    snapshot.extensions ??= {};
    snapshot.extensions.tavern_headless ??= {};
    snapshot.extensions.tavern_headless.promptController = controller;
    profile.moduleFiles = [
      ...new Set([...(profile.moduleFiles ?? []), controller.modulePath]),
    ];
    files[controller.modulePath] = await readFile(
      resolve(directory, controller.modulePath),
      "utf8",
    );
  }
  const migration = mvuMigrationSchema.parse(
    await json(resolve(root, "migrations/mvu-agent-migration.json")),
  )[role]!;
  return {
    source: snapshot,
    payload: {
      payload: snapshotToStCharacterCard(snapshot),
      create_session: false,
      role_migration: {
        stateUpdate: { profile, files },
        migration,
        metadata: await json(resolve(directory, "openings.json")),
      },
    },
  };
}
