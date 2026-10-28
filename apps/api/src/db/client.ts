import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

const DEFAULT_DATABASE_PATH = "data/tavern-headless.db";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;
export type DbExecutor = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type DatabaseConnection = {
  db: AppDb;
  close: () => void;
};

export function createDatabase(
  databasePath = process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH,
  options: Pick<Database.Options, "readonly" | "fileMustExist"> = {},
): DatabaseConnection {
  const resolvedPath =
    databasePath === ":memory:" ? databasePath : resolve(databasePath);
  if (
    resolvedPath !== ":memory:" &&
    !options.readonly &&
    !options.fileMustExist
  )
    mkdirSync(dirname(resolvedPath), { recursive: true });
  const sqlite = new Database(resolvedPath, options);
  try {
    if (resolvedPath !== ":memory:" && !options.readonly)
      sqlite.pragma("journal_mode = WAL");
    sqlite.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
    sqlite.pragma("foreign_keys = ON");
    return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
