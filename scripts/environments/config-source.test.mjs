import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadEnvironment, sourceRoot } from "./config.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tavern-config-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "source");
  for (const file of [
    "config/environments.example.json",
    "config/environments.schema.json",
    "apps/api/config/storage.json",
    "apps/api/config/native-card.json",
    "package.json",
  ]) {
    await mkdir(dirname(join(repository, file)), { recursive: true });
    await cp(join(sourceRoot, file), join(repository, file));
  }
  return { repository, sandboxRoot: join(root, "sandbox") };
}

test("a fresh checkout verifies in a sandbox without private host configuration", async (t) => {
  const { repository, sandboxRoot } = await fixture(t);
  const env = await loadEnvironment("dev", {
    sourceRoot: repository,
    sandboxRoot,
  });
  assert.equal(env.root, join(sandboxRoot, "dev"));
  assert.equal(env.ports.api, 24010);
});

test("sandbox operations reject the private runtime directories while using public parameters", async (t) => {
  const { repository, sandboxRoot } = await fixture(t);
  const configuration = JSON.parse(
    await readFile(
      join(repository, "config/environments.example.json"),
      "utf8",
    ),
  );
  for (const [name, environment] of Object.entries(
    configuration.environments,
  )) {
    environment.root = join(dirname(repository), "runtime", name);
    environment.hostname = "private-host.invalid";
  }
  await writeFile(
    join(repository, "config/environments.json"),
    JSON.stringify(configuration),
  );
  for (const name of ["staging", "prod"]) {
    for (const target of [
      configuration.environments[name].root,
      join(configuration.environments[name].root, "sandbox"),
    ]) {
      await assert.rejects(
        loadEnvironment("dev", { sourceRoot: repository, sandboxRoot: target }),
        /隔离|冲突|重叠/,
      );
    }
  }
  const env = await loadEnvironment("dev", {
    sourceRoot: repository,
    sandboxRoot,
  });
  assert.equal(env.hostname, "192.0.2.31");
});

test("linked worktrees protect runtime directories declared by the primary worktree", async (t) => {
  const { repository, sandboxRoot } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const linked = join(dirname(repository), "linked");
  git("worktree", "add", "--detach", linked, "HEAD");
  const configuration = JSON.parse(
    await readFile(
      join(repository, "config/environments.example.json"),
      "utf8",
    ),
  );
  for (const [name, environment] of Object.entries(
    configuration.environments,
  )) {
    environment.root = join(dirname(repository), "runtime", name);
  }
  await writeFile(
    join(repository, "config/environments.json"),
    JSON.stringify(configuration),
  );
  await assert.rejects(
    loadEnvironment("dev", {
      sourceRoot: linked,
      sandboxRoot: configuration.environments.prod.root,
    }),
    /重叠/,
  );
  const env = await loadEnvironment("dev", { sourceRoot: linked, sandboxRoot });
  assert.equal(env.root, join(sandboxRoot, "dev"));
});

test("runtime configuration is required and never falls back to example roots", async (t) => {
  const { repository } = await fixture(t);
  await assert.rejects(
    loadEnvironment("dev", { sourceRoot: repository }),
    (error) => {
      assert.equal(error.exitCode, 3);
      assert.match(error.message, /environments\.example\.json/);
      assert.match(error.message, /environments\.json/);
      return true;
    },
  );
  const configuration = JSON.parse(
    await readFile(
      join(repository, "config/environments.example.json"),
      "utf8",
    ),
  );
  configuration.environments.dev.root = repository;
  await writeFile(
    join(repository, "config/environments.json"),
    JSON.stringify(configuration),
  );
  const env = await loadEnvironment("dev", { sourceRoot: repository });
  assert.equal(env.root, repository);
});
