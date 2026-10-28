import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mvuMigrationSchema, roleStateProfileSchema } from "@tavern/shared";
import {
  RoleImportService,
  parseRoleVariablesYaml,
} from "../role-import-service.js";

const root = resolve(
  import.meta.dirname,
  "../../../../../../fixtures/role-apps",
);
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("role import YAML parsing", () => {
  it("parses nested mappings and arrays without changing performer macros or date strings", () => {
    expect(
      parseRoleVariablesYaml(
        'world:\n  date: 2025-04-04\noptions: [a, b]\nname: "{{user}}"',
      ),
    ).toEqual({
      world: { date: "2025-04-04" },
      options: ["a", "b"],
      name: "{{user}}",
    });
  });
  it.each(["", "null", "[]", "- a", "hello", "42", "true"])(
    "rejects non-object initial variables: %j",
    (text) => {
      expect(() => parseRoleVariablesYaml(text)).toThrow(
        expect.objectContaining({ code: "ROLE_IMPORT_INITIAL_INVALID" }),
      );
    },
  );
  it.each(["a: [", "a: 1\na: 2"])(
    "retains YAML parse errors and their source locations",
    (text) => {
      try {
        parseRoleVariablesYaml(text);
        throw new Error("expected parse failure");
      } catch (error) {
        expect(error).toMatchObject({
          code: "ROLE_IMPORT_YAML_INVALID",
          cause: { name: "YAMLParseError", linePos: expect.any(Array) },
        });
      }
    },
  );
  it.each(["linqian", "gushengman"])(
    "prepares all %s openings from the complete role fixture",
    async (role) => {
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
      ]) {
        if (path)
          files[path] = await readFile(resolve(directory, path), "utf8");
      }
      snapshot.extensions ??= {};
      snapshot.extensions.tavern_headless ??= {};
      snapshot.extensions.tavern_headless.stateUpdate = { profile, files };
      const migration = mvuMigrationSchema.parse(
        await json(resolve(root, "migrations/mvu-agent-migration.json")),
      )[role]!;
      const input = {
        snapshot,
        migration,
        metadata: await json(resolve(directory, "openings.json")),
      };
      const original = JSON.stringify(input);
      const result = new RoleImportService().prepareCharacter(input);
      expect(result.openings.items).toHaveLength(
        1 + snapshot.alternateGreetings.length,
      );
      expect(
        result.openings.items.every(
          (item) => Object.keys(item.variables).length > 0,
        ),
      ).toBe(true);
      expect(
        result.openings.items.find(
          (item) => item.id === result.openings.defaultOpeningId,
        ),
      ).toBeDefined();
      expect(
        result.snapshot.extensions.tavern_headless.stateUpdate.files[
          "migrated-variable-rules.json"
        ],
      ).toBeDefined();
      if (role === "linqian") {
        const book = result.snapshot.characterBook;
        const entries = Array.isArray(book.entries)
          ? book.entries
          : Object.values(book.entries);
        const legacy = entries.find(
          (entry) => (entry.uid ?? entry.id) === 112,
        )!;
        expect(legacy.disable).toBe(true);
        expect(legacy.enabled).toBe(false);
        expect(
          entries
            .filter(
              (entry) => entry.enabled !== false && entry.disable !== true,
            )
            .some((entry) =>
              entry.content.includes("status_current_variables"),
            ),
        ).toBe(false);
        const agentRules = JSON.parse(
          result.snapshot.extensions.tavern_headless.stateUpdate.files[
            "migrated-variable-rules.json"
          ]!,
        );
        expect(agentRules.entries).toContainEqual(
          expect.objectContaining({
            sourceEntryId: 115,
            content: expect.stringContaining("变量更新规则"),
          }),
        );
        const rules = JSON.parse(
          result.snapshot.extensions.tavern_headless.stateUpdate.files[
            "update-rules.json"
          ]!,
        );
        expect(
          rules.entries.some(
            (entry: { sourceId: number }) => entry.sourceId === 112,
          ),
        ).toBe(false);
        expect(
          result.snapshot.extensions.tavern_headless.stateUpdate.profile
            .ruleFiles,
        ).toContain("migrated-variable-rules.json");
      }
      expect(JSON.stringify(input)).toBe(original);
    },
  );
});
