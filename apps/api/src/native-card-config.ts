import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nativeCardConfigSchema,
  type NativeCardConfig,
} from "./native-card-config.schema.js";

export function loadNativeCardConfig(dataRoot: string): NativeCardConfig {
  const config = nativeCardConfigSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../config/native-card.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  return {
    ...config,
    storageRoot: resolve(dataRoot, config.storageRoot),
    importStagingRoot: resolve(dataRoot, config.importStagingRoot),
    buildRoot: resolve(dataRoot, config.buildRoot),
  };
}
