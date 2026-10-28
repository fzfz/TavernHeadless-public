import { createDatabase } from "./db/client.js";
import { assertDatabaseReady } from "./db/migrations.js";
import { loadConfig } from "./config.js";
import { prepareStorageDirectories } from "./storage-config.js";
import { BackupWorker } from "./services/backup-worker.js";

const config = loadConfig();

if (!config.enableBackupWorker) {
  console.info(
    "Backup worker is disabled (set ENABLE_BACKUP_WORKER=true to enable)",
  );
  process.exit(0);
}

prepareStorageDirectories(config.storage);
const database = createDatabase(config.databasePath);
try {
  assertDatabaseReady(database);
} catch (error) {
  database.close();
  throw error;
}
const worker = new BackupWorker(database.db, {
  artifactDir: config.backupArtifactDir,
  pollIntervalMs: config.backupWorker?.pollIntervalMs,
  leaseTtlMs: config.backupWorker?.leaseTtlMs,
  maxConcurrentJobs: config.backupWorker?.maxConcurrentJobs ?? 1,
  retryBaseDelayMs: config.backupWorker?.retryBaseDelayMs,
  maxRetryDelayMs: config.backupWorker?.maxRetryDelayMs,
  candidateScanLimit: config.backupWorker?.candidateScanLimit,
  exportArtifactTtlMs: config.backupExportArtifactTtlMs,
  logger: {
    info(meta, message) {
      console.info(message, meta);
    },
    warn(meta, message) {
      console.warn(message, meta);
    },
    error(meta, message) {
      console.error(message, meta);
    },
  },
});

worker.start();
console.info("Backup worker started");

const shutdown = async (signal: string) => {
  console.info(`Received ${signal}, shutting down backup worker`);
  try {
    await worker.stop();
    database.close();
    process.exit(0);
  } catch (error) {
    console.error("Failed to stop backup worker", error);
    process.exit(1);
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
