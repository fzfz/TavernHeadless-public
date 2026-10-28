import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RoleFileStore } from "./role-file-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "role-files-"));
  roots.push(root);
  return {
    root,
    store: new RoleFileStore({
      roleAssetsDir: join(root, "assets"),
      roleAssetStagingDir: join(root, "staging"),
    }),
  };
}

describe("versioned role files", () => {
  it("stages and commits a complete version without exposing staging files through version reads", async () => {
    const { store } = await createStore();
    await store.stage("import-1", [
      { path: "media/a.txt", content: Buffer.from("first version") },
    ]);
    await expect(
      store.read("account-1", "version-1", "media/a.txt"),
    ).rejects.toThrow();
    await store.commit("import-1", "account-1", "version-1");
    expect(
      (await store.read("account-1", "version-1", "media/a.txt")).toString(),
    ).toBe("first version");
    await expect(
      store.read("account-2", "version-1", "media/a.txt"),
    ).rejects.toThrow();
  });

  it.each([
    "../outside.txt",
    "/outside.txt",
    "media/../../outside",
    "media\\outside",
    "./file",
    "media//file",
  ])("rejects noncanonical package path %s", async (path) => {
    const { store } = await createStore();
    await expect(
      store.stage("import-1", [{ path, content: Buffer.from("content") }]),
    ).rejects.toThrow();
  });

  it("preserves immutable versions when a second import targets the same version", async () => {
    const { store } = await createStore();
    await store.stage("import-1", [
      { path: "file.txt", content: Buffer.from("original") },
    ]);
    await store.commit("import-1", "account", "version");
    await store.stage("import-2", [
      { path: "file.txt", content: Buffer.from("replacement") },
    ]);
    await expect(
      store.commit("import-2", "account", "version"),
    ).rejects.toThrow();
    expect(
      (await store.read("account", "version", "file.txt")).toString(),
    ).toBe("original");
  });

  it("rejects empty imports and duplicate paths before creating staging files", async () => {
    const { store } = await createStore();
    await expect(store.stage("import-1", [])).rejects.toThrow();
    const file = { path: "file.txt", content: Buffer.from("content") };
    await expect(store.stage("import-1", [file, file])).rejects.toThrow();
    await store.stage("import-1", [file]);
  });

  it("cleans its staging directory after a file write fails", async () => {
    const { root, store } = await createStore();
    await expect(
      store.stage("broken", [
        { path: "file", content: Buffer.from("file") },
        { path: "file/child", content: Buffer.from("child") },
      ]),
    ).rejects.toThrow();
    await expect(access(join(root, "staging/broken"))).rejects.toThrow();
    await store.stage("broken", [
      { path: "file", content: Buffer.from("retry") },
    ]);
  });

  it("rejects a restored file symlink that leaves its resource version", async () => {
    const { root, store } = await createStore();
    await mkdir(join(root, "assets/account/version"), { recursive: true });
    await writeFile(join(root, "outside"), "private");
    await symlink(
      join(root, "outside"),
      join(root, "assets/account/version/link"),
    );
    await expect(store.read("account", "version", "link")).rejects.toThrow();
  });

  it("removes only the specified uncommitted version during rollback", async () => {
    const { store } = await createStore();
    for (const id of ["one", "two"]) {
      await store.stage(id, [{ path: "file", content: Buffer.from(id) }]);
      await store.commit(id, "account", id);
    }
    await store.removeVersion("account", "one");
    await expect(store.read("account", "one", "file")).rejects.toThrow();
    expect((await store.read("account", "two", "file")).toString()).toBe("two");
  });
});
