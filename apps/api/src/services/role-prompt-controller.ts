import { RoleRuntimeError } from "./role-runtime/runtime-error.js";
import type { STWorldBook } from "@tavern/adapters-sillytavern";
import type { SessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  roleCharacterBookSchema,
  rolePromptControllerConfigSchema,
  rolePromptControllerResultSchema,
} from "./role-character-extension-schema.js";

export async function renderRolePromptController(
  character: SessionCharacterSnapshot | undefined,
  variables: Record<string, unknown>,
  loadModule?: (path: string) => Promise<Record<string, unknown>>,
  bookId?: string,
): Promise<SessionCharacterSnapshot | undefined> {
  const raw = character?.extensions?.tavern_headless as
    | Record<string, unknown>
    | undefined;
  if (!raw?.promptController) return character;
  const config = rolePromptControllerConfigSchema.parse(raw.promptController);
  const result = structuredClone(character!);
  if (!result.characterBook)
    throw new Error("ROLE_PROMPT_CONTROLLER_WORLDBOOK_MISSING");
  const parsedBook = roleCharacterBookSchema.safeParse(result.characterBook);
  if (!parsedBook.success)
    throw new Error("ROLE_PROMPT_CONTROLLER_WORLDBOOK_INVALID");
  const book = parsedBook.data;
  result.characterBook = book;
  if (!loadModule) throw new RoleRuntimeError("ROLE_PROMPT_CONTROLLER_LOADER_MISSING");
  const module = await loadModule(config.modulePath);
  if (typeof module.renderController !== "function")
    throw new Error("ROLE_PROMPT_CONTROLLER_EXPORT_MISSING");
  for (const entry of book.entries) {
    const scoped = config.controllerEntries !== undefined;
    const updaterEntry = scoped
      ? config.updaterEntries?.some((ref) => ref.bookId === bookId && ref.entryId === entry.id) === true
      : config.updaterEntryIds?.includes(entry.id) === true;
    const controllerEntry = scoped
      ? config.controllerEntries?.some((ref) => ref.bookId === bookId && ref.entryId === entry.id) === true
      : config.controllerEntryIds?.includes(entry.id) === true;
    if (updaterEntry) entry.enabled = false;
    if (controllerEntry) {
      const rendered = rolePromptControllerResultSchema.safeParse(
        await module.renderController({
          ...(bookId ? { bookId } : {}),
          entryId: entry.id,
          variables: structuredClone(variables[config.variableRoot]),
          characterBook: structuredClone(character!.characterBook),
        }),
      );
      if (!rendered.success)
        throw new Error("ROLE_PROMPT_CONTROLLER_RESULT_INVALID");
      entry.content = rendered.data.text;
    }
    for (const mapping of config.variableMacros)
      entry.content = entry.content.split(mapping.source).join(mapping.target);
  }
  return result;
}

export async function renderBoundWorldbookController(
  character: SessionCharacterSnapshot | undefined,
  variables: Record<string, unknown>,
  worldbook: STWorldBook,
  loadModule?: (path: string) => Promise<Record<string, unknown>>,
  bookId?: string,
): Promise<STWorldBook> {
  const extension = character?.extensions?.tavern_headless as
    | Record<string, unknown>
    | undefined;
  if (!extension?.promptController) return worldbook;
  const controllerBook = {
    name: worldbook.name,
    entries: worldbook.entries.map((entry) => ({
      ...entry,
      id: entry.uid,
      enabled: !entry.disable,
    })),
  };
  const rendered = await renderRolePromptController(
    { ...character!, characterBook: controllerBook },
    variables,
    loadModule,
    bookId,
  );
  const book = roleCharacterBookSchema.parse(rendered!.characterBook);
  return {
    ...worldbook,
    entries: worldbook.entries.map((entry, index) => ({
      ...entry,
      content: book.entries[index]!.content,
      disable: !book.entries[index]!.enabled,
    })),
  };
}
