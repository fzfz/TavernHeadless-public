import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionCharacterSnapshot } from "../../lib/character-snapshot.js";
import { rolePromptControllerConfigSchema } from "../role-character-extension-schema.js";
import { parseWorldBook } from "../../../../../packages/adapters-sillytavern/src/parsers/worldbook-parser.js";
import {
  renderRolePromptController as renderSourceController,
  renderBoundWorldbookController as renderSourceWorldbook,
} from "../role-prompt-controller.js";

const directories: string[] = [];
const loadModule = (path: string) => import(pathToFileURL(path).href);
const renderRolePromptController = (character: SessionCharacterSnapshot | undefined, variables: Record<string, unknown>) => renderSourceController(character, variables, loadModule);
const renderBoundWorldbookController = (character: SessionCharacterSnapshot | undefined, variables: Record<string, unknown>, worldbook: Parameters<typeof renderSourceWorldbook>[2]) => renderSourceWorldbook(character, variables, worldbook, loadModule);
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, {recursive:true,force:true}); });

describe("renderRolePromptController", () => {
  it("renders controller entries, disables updater entries and preserves source inputs", async () => {
    const character = roleCharacter(`
      export async function renderController(input) {
        input.variables.hp = 99;
        input.characterBook.entries[0].content = "mutated";
        return {
          text: "rendered:" + input.entryId + ":" + input.variables.hp + ":SOURCE_MACRO",
          referencedEntryIds: [2]
        };
      }
    `);
    const variables = { stat_data: { hp: 3 } };
    const originalCharacter = structuredClone(character);
    const originalVariables = structuredClone(variables);

    const result = await renderRolePromptController(character, variables);
    const entries = getEntries(result);

    expect(entries).toEqual([
      expect.objectContaining({
        id: 1,
        enabled: true,
        content: "rendered:1:99:TARGET_MACRO",
      }),
      expect.objectContaining({ id: 2, enabled: false, content: "updater" }),
      expect.objectContaining({
        id: 3,
        enabled: true,
        content: "plain TARGET_MACRO",
      }),
    ]);
    expect(character).toEqual(originalCharacter);
    expect(variables).toEqual(originalVariables);
  });

  it("returns the source snapshot when no prompt controller is configured", async () => {
    const character: SessionCharacterSnapshot = {
      name: "Character",
      characterBook: { entries: [] },
    };

    await expect(renderRolePromptController(character, {})).resolves.toBe(
      character,
    );
  });

  it("requires the configured file loader for a controller", async () => {
    const character = roleCharacter("export function renderController(){return {text:'ok'}}");
    await expect(renderSourceController(character, {})).rejects.toMatchObject({code:'ROLE_PROMPT_CONTROLLER_LOADER_MISSING'});
  });

  it("rejects a controller module without renderController", async () => {
    const character = roleCharacter("export const other = true;");

    await expect(
      renderRolePromptController(character, { stat_data: {} }),
    ).rejects.toThrow("ROLE_PROMPT_CONTROLLER_EXPORT_MISSING");
  });

  it("rejects a configured controller when the character has no worldbook", async () => {
    const character = roleCharacter(
      "export function renderController() { return { text: 'ok' }; }",
    );
    delete character.characterBook;

    await expect(
      renderRolePromptController(character, { stat_data: {} }),
    ).rejects.toThrow("ROLE_PROMPT_CONTROLLER_WORLDBOOK_MISSING");
  });

  it("rejects a configured controller when the worldbook shape is invalid", async () => {
    const character = roleCharacter(
      "export function renderController() { return { text: 'ok' }; }",
    );
    character.characterBook = { entries: [{ id: 1 }] };

    await expect(
      renderRolePromptController(character, { stat_data: {} }),
    ).rejects.toThrow("ROLE_PROMPT_CONTROLLER_WORLDBOOK_INVALID");
  });

  it("rejects an invalid controller result", async () => {
    const character = roleCharacter(
      "export function renderController() { return { text: 42 }; }",
    );

    await expect(
      renderRolePromptController(character, { stat_data: {} }),
    ).rejects.toThrow("ROLE_PROMPT_CONTROLLER_RESULT_INVALID");
  });

  it("rejects duplicate entry ids in the controller schema", () => {
    expect(() =>
      rolePromptControllerConfigSchema.parse({
        modulePath: "controller.js",
        controllerEntryIds: [1, 1],
        updaterEntryIds: [],
        variableRoot: "stat_data",
        variableMacros: [],
      }),
    ).toThrow("Entry ids must be unique");
  });
});

function roleCharacter(moduleSource: string): SessionCharacterSnapshot {
  const directory=mkdtempSync(join(tmpdir(),'role-controller-'));directories.push(directory);
  const modulePath=join(directory,'controller.mjs');writeFileSync(modulePath,moduleSource);
  return {
    name: "Character",
    characterBook: {
      entries: [
        { id: 1, enabled: true, content: "controller" },
        { id: 2, enabled: true, content: "updater" },
        { id: 3, enabled: true, content: "plain SOURCE_MACRO" },
      ],
    },
    extensions: {
      tavern_headless: {
        promptController: {
          modulePath,
          controllerEntryIds: [1],
          updaterEntryIds: [2],
          variableRoot: "stat_data",
          variableMacros: [{ source: "SOURCE_MACRO", target: "TARGET_MACRO" }],
        },
      },
    },
  };
}

function getEntries(character: SessionCharacterSnapshot | undefined) {
  return (
    character?.characterBook as {
      entries: Array<{ id: number; enabled: boolean; content: string }>;
    }
  ).entries;
}

describe("bound worldbook controller", () => {
  it("renders the bound book without restoring an embedded book or changing stored inputs", async () => {
    const character = roleCharacter(
      'export function renderController({variables}) { return {text: "hp=" + variables.hp}; }',
    );
    delete character.characterBook;
    const book = parseWorldBook({
      name: "Book",
      entries: [
        { uid: 1, content: "controller" },
        { uid: 2, content: "updater" },
        { uid: 3, content: "SOURCE_MACRO" },
      ],
    });
    const original = structuredClone(book);
    const result = await renderBoundWorldbookController(
      character,
      { stat_data: { hp: 4 } },
      book,
    );
    expect(result.entries[0]!.content).toBe("hp=4");
    expect(result.entries[1]!.disable).toBe(true);
    expect(result.entries[2]!.content).toBe("TARGET_MACRO");
    expect(book).toEqual(original);
    expect(character.characterBook).toBeUndefined();
  });
  it("keeps ordinary books unchanged", async () => {
    const book = parseWorldBook({ entries: [] });
    expect(await renderBoundWorldbookController({ name: "C" }, {}, book)).toBe(
      book,
    );
  });
  it("propagates invalid controller output", async () => {
    const character = roleCharacter(
      "export function renderController() { return {}; }",
    );
    delete character.characterBook;
    await expect(
      renderBoundWorldbookController(
        character,
        {},
        parseWorldBook({ entries: [{ uid: 1 }] }),
      ),
    ).rejects.toThrow("ROLE_PROMPT_CONTROLLER_RESULT_INVALID");
  });
});
