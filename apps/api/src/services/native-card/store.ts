import { lstat, mkdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { roleAssetPathSchema } from "@tavern/shared";
import type { NativeCardConfig } from "../../native-card-config.schema.js";
import type { NativeCardPackageFile } from "@tavern/shared";

export type NativeCardStoreArea = "cards" | "imports" | "builds";

export class NativeCardStoreWriteError extends Error {
  constructor(
    cause: unknown,
    readonly cleanupCause: unknown,
  ) {
    super("Native card staging cleanup failed after a file write error.", { cause });
    this.name = "NativeCardStoreWriteError";
  }

  get cleanupFailed(): boolean {
    return this.cleanupCause !== undefined;
  }
}

export class NativeCardStore {
  constructor(private readonly config: NativeCardConfig) {}

  root(area: NativeCardStoreArea): string {
    if (area === "cards") return this.config.storageRoot;
    if (area === "imports") return this.config.importStagingRoot;
    return this.config.buildRoot;
  }

  path(area: NativeCardStoreArea, storageKey: string, filePath?: string): string {
    roleAssetPathSchema.parse(storageKey);
    if (filePath !== undefined) roleAssetPathSchema.parse(filePath);
    const root = resolve(this.root(area));
    const target = resolve(root, storageKey, ...(filePath ? [filePath] : []));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error("Native card storage key leaves its configured root.");
    }
    return target;
  }

  async writeDirectory(area: NativeCardStoreArea, storageKey: string, files: readonly NativeCardPackageFile[]): Promise<void> {
    const target = this.path(area, storageKey);
    const stagingKey = `.staging/${randomUUID()}`;
    const staging = this.path(area, stagingKey);
    await mkdir(dirname(staging), { recursive: true });
    await mkdir(staging, { recursive: false });
    try {
      for (const file of files) {
        const path = this.path(area, stagingKey, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content, { flag: "wx" });
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(staging, target);
    } catch (error) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch (cleanupCause) {
        throw new NativeCardStoreWriteError(error, cleanupCause);
      }
      throw error;
    }
  }

  async read(area: NativeCardStoreArea, storageKey: string, filePath: string): Promise<Buffer> {
    this.path(area, storageKey, filePath);
    const root = await realpath(this.root(area));
    const requestedDirectory = resolve(root, storageKey);
    const directory = await realpath(requestedDirectory);
    if (directory !== root && !directory.startsWith(`${root}${sep}`)) throw new Error("Native card directory leaves its configured root.");
    const requestedTarget = resolve(requestedDirectory, filePath);
    let cursor = root;
    const components = [...storageKey.split("/"), ...filePath.split("/")];
    for (const [index, component] of components.entries()) {
      cursor = resolve(cursor, component);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("Native card storage cannot contain symbolic links.");
      if (index < components.length - 1 && !stat.isDirectory()) throw new Error("Native card storage parent entries must be directories.");
    }
    const target = await realpath(requestedTarget);
    if (!target.startsWith(`${directory}${sep}`)) throw new Error("Native card file leaves its immutable revision directory.");
    if (!(await lstat(requestedTarget)).isFile()) throw new Error("Native card package entries must be regular files.");
    return readFile(target);
  }

  async readDirectory(area: NativeCardStoreArea, storageKey: string, filePaths: readonly string[]): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const filePath of filePaths) files.set(filePath, await this.read(area, storageKey, filePath));
    return files;
  }

  async remove(area: NativeCardStoreArea, storageKey: string): Promise<void> {
    const root = resolve(this.root(area));
    await rm(this.path(area, storageKey), { recursive: true, force: true });
    let parent = dirname(this.path(area, storageKey));
    while (parent !== root && parent.startsWith(`${root}${sep}`)) {
      try { await rmdir(parent); }
      catch { break; }
      parent = dirname(parent);
    }
  }
}
