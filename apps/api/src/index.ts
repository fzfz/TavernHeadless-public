import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { prepareStorageDirectories } from "./storage-config.js";
import { configureDebugFromEnv } from "./debug/configure-debug.js";

const config = loadConfig();
const host = process.env.HOST;
if (!host) throw new Error("HOST is required. Start the API with scripts/environments/cli.mjs start --env <environment>.");
prepareStorageDirectories(config.storage);

configureDebugFromEnv({ logDir: process.env.TAVERN_LOG_DIR });

const { app } = await buildApp({
  databasePath: config.databasePath,
  userSessionCookie: config.userSessionCookie,
  modelCallRecording: config.modelCallRecording,
  storage: config.storage,
  orchestration: config.orchestration,
  llmProfileApiMode: config.llmProfileApiMode,
  enableWebSocket: config.enableWebSocket,
  chatHistoryMaxFloors: config.chatHistoryMaxFloors,
  enableMemory: config.enableMemory,
  memoryInjectionDecay: config.memoryInjectionDecay,
  memoryMaintenance: config.memoryMaintenance,
  runtimeMaintenance: config.runtimeMaintenance,
  enableMemoryConsolidation: config.enableMemoryConsolidation,
  enableAsyncMemoryIngest: config.enableAsyncMemoryIngest,
  enableMacroCompaction: config.enableMacroCompaction,
  enableDualSummaryInjection: config.enableDualSummaryInjection,
  enableDeferredIrreversibleTools: config.enableDeferredIrreversibleTools,
  deferredIrreversibleMcpTools: config.deferredIrreversibleMcpTools,
  memoryWorker: config.memoryWorker,
  enableAgentRuntimeWorker: config.enableAgentRuntimeWorker,
  agentRuntimeWorker: config.agentRuntimeWorker,
  enableNodeGraphWorker: config.enableNodeGraphWorker,
  nodeGraphWorker: config.nodeGraphWorker,
  llmDefaultTimeoutMs: config.llmDefaultTimeoutMs,
  chatTransferArtifactDir: config.chatTransferArtifactDir,
  chatImportMaxBytes: config.chatImportMaxBytes,
  chatExportSyncMaxMessages: config.chatExportSyncMaxMessages,
  chatExportArtifactTtlMs: config.chatExportArtifactTtlMs,
  enableBackupWorker: config.enableBackupWorker,
  backupWorker: config.backupWorker,
  backupArtifactDir: config.backupArtifactDir,
  backupImportMaxBytes: config.backupImportMaxBytes,
  backupExportArtifactTtlMs: config.backupExportArtifactTtlMs,
  turnCommitMaxRetries: config.turnCommitMaxRetries,
  turnCommitRetryBaseDelayMs: config.turnCommitRetryBaseDelayMs,
  generationQueueMode: config.generationQueueMode,
  generationQueueTimeoutMs: config.generationQueueTimeoutMs,
  enableSseChat: config.enableSseChat,
  enablePromptDryRun: config.enablePromptDryRun,
  accountMode: config.accountMode,
  auth: config.auth,
  cors: config.cors,
  enableMcp: config.enableMcp,
  enableUnsafeScriptHandler: config.enableUnsafeScriptHandler,
  enableClientData: config.enableClientData,
  clientData: config.clientData,
  // 生产/开发服务启用内置资产幂等 seed（SC2-11）；测试默认不启用。
  seedBuiltinAssets: true,
});

app
  .listen({ port: config.port, host })
  .then(() => {
    app.log.info(`API listening on :${config.port}`);
    if (config.orchestration) {
      app.log.info(
        `Chat routes enabled (model: ${config.orchestration.defaultModel.modelId})`,
      );
    } else {
      app.log.info("Chat routes disabled (set LLM_API_KEY to enable)");
    }
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down API server`);

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  });
}
