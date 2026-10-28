import { readFileSync } from "node:fs";
import {
  nativeModuleRuntimeConfigSchema,
  type NativeModuleRuntimeConfig,
} from "./native-module-runtime-config.schema.js";

export function loadNativeModuleRuntimeConfig(): NativeModuleRuntimeConfig {
  const source = readFileSync(
    new URL("../../../config/native-card-module-runtime.json", import.meta.url),
    "utf8",
  );
  return nativeModuleRuntimeConfigSchema.parse(JSON.parse(source));
}
