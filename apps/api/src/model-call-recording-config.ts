import { readFileSync } from "node:fs";

import {
  modelCallRecordingConfigSchema,
  type ModelCallRecordingConfig,
} from "./model-call-recording.schema.js";

export function loadModelCallRecordingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ModelCallRecordingConfig {
  const defaults = modelCallRecordingConfigSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../config/model-call-recording.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  return modelCallRecordingConfigSchema.parse({
    maxRetries:
      environment.MODEL_CALL_MAX_RETRIES === undefined
        ? defaults.maxRetries
        : Number(environment.MODEL_CALL_MAX_RETRIES),
    baseDelayMs:
      environment.MODEL_CALL_RETRY_BASE_DELAY_MS === undefined
        ? defaults.baseDelayMs
        : Number(environment.MODEL_CALL_RETRY_BASE_DELAY_MS),
    maxDelayMs:
      environment.MODEL_CALL_RETRY_MAX_DELAY_MS === undefined
        ? defaults.maxDelayMs
        : Number(environment.MODEL_CALL_RETRY_MAX_DELAY_MS),
    streamSaveIntervalMs:
      environment.MODEL_CALL_STREAM_SAVE_INTERVAL_MS === undefined
        ? defaults.streamSaveIntervalMs
        : Number(environment.MODEL_CALL_STREAM_SAVE_INTERVAL_MS),
  });
}
