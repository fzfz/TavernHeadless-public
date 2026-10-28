import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";

describe("API database preflight", () => {
  it.each(["backup", "chat-transfer"])(
    "starts the disabled %s worker without reading a root dotenv file",
    (worker) => {
      const directory = mkdtempSync(
        join(tmpdir(), "tavern-worker-environment-"),
      );
      const source = fileURLToPath(new URL("../../", import.meta.url));
      const target = join(directory, "apps/api/src");
      mkdirSync(target, { recursive: true });
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      for (const name of readdirSync(source)) {
        if (name === worker + "-worker.ts")
          copyFileSync(join(source, name), join(target, name));
        else symlinkSync(join(source, name), join(target, name));
      }
      symlinkSync(
        fileURLToPath(new URL("../../../../../node_modules", import.meta.url)),
        join(directory, "node_modules"),
      );
      symlinkSync(
        fileURLToPath(new URL("../../../node_modules", import.meta.url)),
        join(directory, "apps/api/node_modules"),
      );
      writeFileSync(
        join(directory, ".env"),
        "PORT=invalid-root-port\nENABLE_BACKUP_WORKER=true\nENABLE_CHAT_TRANSFER_WORKER=true\nDATABASE_URL=wrong-database.sqlite\nAPP_SECRETS_MASTER_KEY=root-file-secret\n",
      );
      try {
        const result = spawnSync(
          process.execPath,
          [
            "--conditions=development",
            "--import",
            "tsx",
            join(target, worker + "-worker.ts"),
          ],
          {
            cwd: directory,
            env: { PATH: dirname(process.execPath) + ":/usr/bin:/bin" },
            encoding: "utf8",
            timeout: 15000,
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("worker is disabled");
        expect(existsSync(join(directory, "wrong-database.sqlite"))).toBe(
          false,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30000,
  );

  it.each(["backup", "chat-transfer"])(
    "rejects an uninitialized database in the standalone %s worker",
    (worker) => {
      const directory = mkdtempSync(join(tmpdir(), "tavern-worker-preflight-"));
      try {
        const result = spawnSync(
          process.execPath,
          [
            "--conditions=development",
            "--import",
            "tsx",
            fileURLToPath(
              new URL(`../../${worker}-worker.ts`, import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              DATA_DIR: directory,
              DATABASE_URL: join(directory, "database.sqlite"),
              AUTH_MODE: "off",
              ENABLE_BACKUP_WORKER: "true",
              ENABLE_CHAT_TRANSFER_WORKER: "true",
            },
            encoding: "utf8",
            timeout: 15000,
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Database startup precheck failed");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30000,
  );

  it("rejects an empty database before starting application services", async () => {
    await expect(
      buildApp({ databasePath: ":memory:", logger: false }),
    ).rejects.toThrow("Database startup precheck failed");
  });
});
