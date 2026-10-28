import {
  buildApp,
  type BuildAppOptions,
  type BuildAppResult,
} from "../../src/app.js";
import {
  createDatabase,
  type DatabaseConnection,
} from "../../src/db/client.js";
import { migrateDatabase } from "../../src/db/migrations.js";

export type {
  AppDb,
  DatabaseConnection,
  DbExecutor,
} from "../../src/db/client.js";
export type { BuildAppOptions, BuildAppResult } from "../../src/app.js";

export function createTestDatabase(
  databasePath = ":memory:",
  migrationsPath?: string,
): DatabaseConnection {
  const connection = createDatabase(databasePath);
  try {
    migrateDatabase(connection, migrationsPath);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export async function buildTestApp(
  options: BuildAppOptions = {},
): Promise<BuildAppResult> {
  const connection =
    options.databaseConnection ?? createTestDatabase(options.databasePath);
  try {
    return await buildApp({ ...options, databaseConnection: connection });
  } catch (error) {
    if (connection.db.$client.open) connection.close();
    throw error;
  }
}
