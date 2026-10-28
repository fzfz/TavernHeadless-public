import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../../test/helpers/create-test-db.js";

function migration(name: string) {
  return readFileSync(
    new URL(`../../../drizzle/${name}.sql`, import.meta.url),
    "utf8",
  );
}

it("preserves published release contents and activation when allowing native releases without regex", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = OFF");
    db.exec(migration("0089_role_release"));
    const insert = db.prepare(
      "INSERT INTO role_release VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const id of ["old", "current"]) {
      insert.run(
        id,
        "owner",
        "角色",
        "character",
        `${id}-version`,
        '{"name":"人物"}',
        "preset",
        "preset-v1",
        "regex",
        "regex-v1",
        "book",
        "book-v1",
        "native",
        "[]",
        "persona",
        '{"name":"用户"}',
        "[]",
        100,
      );
    }
    db.exec(migration("0096_role_publication"));
    const before = db
      .prepare("SELECT * FROM role_release ORDER BY rowid")
      .all();
    db.exec(migration("0098_native_card_runtime"));
    expect(
      db.prepare("SELECT * FROM role_release ORDER BY rowid").all(),
    ).toEqual(before);
    expect(
      db.prepare("SELECT id FROM role_release WHERE is_active = 1").get(),
    ).toEqual({ id: "current" });
    db.prepare(
      "UPDATE role_release SET regex_profile_id = NULL, regex_profile_version_id = NULL WHERE id = 'old'",
    ).run();
    expect(
      db
        .prepare("SELECT regex_profile_id FROM role_release WHERE id = 'old'")
        .get(),
    ).toEqual({ regex_profile_id: null });
    expect(() =>
      db
        .prepare("UPDATE role_release SET is_active = 1 WHERE id = 'old'")
        .run(),
    ).toThrow(/UNIQUE/);
  } finally {
    db.close();
  }
});

it("creates native storage and binding tables through the complete migration sequence", () => {
  const database = createTestDatabase(":memory:");
  try {
    const tables = database.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "native_card",
        "native_card_revision",
        "native_card_import",
        "native_card_build",
        "native_card_resource_binding",
        "native_card_publication",
        "native_card_version_binding",
      ]),
    );
    expect(database.db.$client.pragma("foreign_key_check")).toEqual([]);
  } finally {
    database.close();
  }
});
