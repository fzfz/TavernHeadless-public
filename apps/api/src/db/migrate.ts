import { createDatabase } from "./client.js";
import { migrateDatabase } from "./migrations.js";
import {
  loadStorageConfig,
  prepareStorageDirectories,
} from "../storage-config.js";

const storage = loadStorageConfig();
prepareStorageDirectories(storage);
const connection = createDatabase(storage.databasePath);
try {
  migrateDatabase(connection);
} finally {
  connection.close();
}

console.log(`Migrations applied: ${storage.databasePath}`);
