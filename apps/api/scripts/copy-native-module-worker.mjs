import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(
  new URL("../src/services/role-runtime/native-module-worker.mjs", import.meta.url),
);
const targetPath = fileURLToPath(
  new URL("../dist/services/role-runtime/native-module-worker.mjs", import.meta.url),
);

await mkdir(dirname(targetPath), { recursive: true });
await copyFile(sourcePath, targetPath);
