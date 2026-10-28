import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const exec = promisify(execFile);
const directories: string[] = [];
const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: "Docs test",
  GIT_AUTHOR_EMAIL: "docs@example.com",
  GIT_COMMITTER_NAME: "Docs test",
  GIT_COMMITTER_EMAIL: "docs@example.com",
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "docs-publication-"));
  directories.push(directory);
  const artifact = join(directory, "artifact"),
    checkout = join(directory, "checkout"),
    remote = join(directory, "remote.git");
  await mkdir(join(artifact, "agent"), { recursive: true });
  await writeFile(join(artifact, "index.html"), "<h1>Documentation</h1>");
  await writeFile(
    join(artifact, "agent/latest.json"),
    JSON.stringify({ commit: "a".repeat(40) }),
  );
  await writeFile(join(directory, "private-source.ts"), "private source");
  await exec("git", ["init", "--bare", remote]);
  await exec("git", ["init", "-b", "main", checkout]);
  await exec("git", ["-C", checkout, "remote", "add", "origin", remote]);
  await writeFile(join(checkout, "stale.html"), "old page");
  await exec("git", ["-C", checkout, "add", "--all"]);
  await exec("git", ["-C", checkout, "commit", "-m", "initial"], {
    env: identity,
  });
  await exec("git", ["-C", checkout, "push", "origin", "main"]);
  const publish = () =>
    exec(
      "bash",
      [
        resolve("scripts/publish-docs.sh"),
        artifact,
        checkout,
        "a".repeat(40),
        "main",
      ],
      { env: identity },
    );
  return { artifact, checkout, remote, publish };
}
describe("static documentation publication", () => {
  it("publishes build output, removes stale pages and preserves git metadata", async () => {
    const f = await fixture();
    await f.publish();
    expect(await readFile(join(f.checkout, "index.html"), "utf8")).toContain(
      "Documentation",
    );
    await access(join(f.checkout, ".git"));
    await access(join(f.checkout, ".nojekyll"));
    await expect(access(join(f.checkout, "stale.html"))).rejects.toThrow();
    const { stdout } = await exec("git", [
      "--git-dir",
      f.remote,
      "ls-tree",
      "-r",
      "--name-only",
      "main",
    ]);
    expect(stdout.trim().split("\n")).toEqual([
      ".nojekyll",
      "agent/latest.json",
      "index.html",
    ]);
  });
  it("keeps the same commit for unchanged output", async () => {
    const f = await fixture();
    await f.publish();
    const before = await exec("git", ["-C", f.checkout, "rev-parse", "HEAD"]);
    expect((await f.publish()).stdout).toContain("unchanged");
    expect(
      (await exec("git", ["-C", f.checkout, "rev-parse", "HEAD"])).stdout,
    ).toBe(before.stdout);
  });
  it.each(["index.html", "agent/latest.json"])(
    "rejects missing %s before changing checkout",
    async (file) => {
      const f = await fixture();
      await rm(join(f.artifact, file));
      await expect(f.publish()).rejects.toThrow();
      expect(await readFile(join(f.checkout, "stale.html"), "utf8")).toBe(
        "old page",
      );
    },
  );
  it("rejects a destination without git metadata", async () => {
    const f = await fixture();
    await rm(join(f.checkout, ".git"), { recursive: true });
    await expect(f.publish()).rejects.toThrow();
    expect(await readFile(join(f.checkout, "stale.html"), "utf8")).toBe(
      "old page",
    );
  });
  it("reports a rejected push", async () => {
    const f = await fixture();
    await writeFile(
      join(f.remote, "hooks/pre-receive"),
      "#!/bin/sh\nexit 1\n",
      { mode: 0o755 },
    );
    await expect(f.publish()).rejects.toThrow();
    expect(
      (
        await exec("git", [
          "--git-dir",
          f.remote,
          "ls-tree",
          "--name-only",
          "main",
        ])
      ).stdout.trim(),
    ).toBe("stale.html");
  });
});
