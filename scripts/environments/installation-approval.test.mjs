import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadEnvironment } from "./config.mjs";
import { buildRelease } from "./release.mjs";

async function fixture(
  sandboxRoot,
  { allowed = ["better-sqlite3", "esbuild"], workspacePackage } = {},
) {
  const source = join(sandboxRoot, "source");
  await mkdir(join(source, "scripts/environments"), { recursive: true });
  const pkg = {
    name: "approval-fixture",
    version: "1.0.0",
    engines: { node: process.versions.node },
    packageManager: "pnpm@9.15.4",
    scripts: {
      postinstall: "node postinstall.mjs",
      prepare: "node prepare.mjs",
    },
    dependencies: { "better-sqlite3": "12.8.0" },
    devDependencies: { esbuild: "0.28.1" },
  };
  const policy = {
    schemaVersion: 1,
    rootScripts: [
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "prepublish",
    ],
    dependencyScripts: {
      "better-sqlite3": ["install"],
      esbuild: ["postinstall"],
    },
  };
  await writeFile(join(source, "package.json"), JSON.stringify(pkg));
  await writeFile(
    join(source, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\nonlyBuiltDependencies:\n" +
      allowed.map((name) => "  - " + name).join("\n") +
      "\n",
  );
  await writeFile(
    join(source, "scripts/environments/installation-policy.json"),
    JSON.stringify(policy),
  );
  await writeFile(join(source, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  if (workspacePackage) {
    await mkdir(join(source, "apps/lifecycle"), { recursive: true });
    await writeFile(
      join(source, "apps/lifecycle/package.json"),
      JSON.stringify(workspacePackage),
    );
  }
  const git = (args) =>
    execFileSync("git", args, {
      cwd: source,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  for (const args of [
    ["init"],
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "fixture",
    ],
    ["tag", "approved-tag"],
  ])
    git(args);
  return { source, pkg, git, commit: git(["rev-parse", "HEAD"]) };
}

test("the build rejects an approval that omits esbuild's configured postinstall before any installation", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-approval-build-"));
  try {
    const { source, commit } = await fixture(sandboxRoot);
    const env = await loadEnvironment("dev", { sandboxRoot });
    env.sourceRoot = source;
    env.tools.node = {
      ...env.tools.node,
      path: process.execPath,
      version: process.versions.node,
    };
    const pnpm = join(sandboxRoot, "pnpm.mjs");
    await writeFile(
      pnpm,
      `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('9.15.4');else{console.error('installation must not run');process.exitCode=9;}\n`,
    );
    await chmod(pnpm, 0o700);
    env.tools.pnpm = { ...env.tools.pnpm, path: pnpm, version: "9.15.4" };
    const approval = join(sandboxRoot, "approval.json");
    await writeFile(
      approval,
      JSON.stringify({
        approved: true,
        ref: "approved-tag",
        commit,
        nodeVersion: process.versions.node,
        pnpmVersion: "9.15.4",
        lifecycleScripts: [
          "approval-fixture:postinstall",
          "approval-fixture:prepare",
          "better-sqlite3:install",
        ],
      }),
    );
    await assert.rejects(
      buildRelease(env, {
        ref: "approved-tag",
        release: "test-release",
        installationApproval: approval,
      }),
      (error) =>
        error.exitCode === 3 &&
        error.details.required.includes("esbuild:postinstall"),
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("the approval CLI derives both script groups from the tag and defaults to an unapproved draft", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-approval-cli-"));
  try {
    const { source, pkg, commit } = await fixture(sandboxRoot);
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({ ...pkg, scripts: { install: "development-only" } }),
    );
    await writeFile(
      join(source, "scripts/environments/installation-policy.json"),
      JSON.stringify({ rootScripts: ["install"], dependencyScripts: {} }),
    );
    const entry = fileURLToPath(
      new URL("./installation-approval.mjs", import.meta.url),
    );
    const output = join(sandboxRoot, "approval.json");
    const args = [
      entry,
      "--source",
      source,
      "--ref",
      "approved-tag",
      "--output",
      output,
    ];
    execFileSync(process.execPath, args, { stdio: "pipe" });
    const draft = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(draft, {
      approved: false,
      ref: "approved-tag",
      commit,
      nodeVersion: process.versions.node,
      pnpmVersion: "9.15.4",
      lifecycleScripts: [
        "approval-fixture:postinstall",
        "approval-fixture:prepare",
        "better-sqlite3:install",
        "esbuild:postinstall",
      ],
    });
    execFileSync(process.execPath, [...args, "--approved"], { stdio: "pipe" });
    assert.equal(JSON.parse(await readFile(output, "utf8")).approved, true);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("the authorization generator rejects a workspace lifecycle package without its script mapping", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-approval-workspace-"),
  );
  try {
    const { source } = await fixture(sandboxRoot, {
      allowed: ["better-sqlite3", "esbuild", "additional-package"],
    });
    const entry = fileURLToPath(
      new URL("./installation-approval.mjs", import.meta.url),
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            entry,
            "--source",
            source,
            "--ref",
            "approved-tag",
            "--output",
            join(sandboxRoot, "approval.json"),
          ],
          { stdio: "pipe" },
        ),
      (error) =>
        error.status === 3 &&
        error.stderr.toString().includes("onlyBuiltDependencies"),
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("workspace package postinstall requires authorization before invoking installation", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-workspace-approval-"),
  );
  try {
    const { source, commit } = await fixture(sandboxRoot, {
      workspacePackage: {
        name: "workspace-fixture",
        scripts: { postinstall: "node install.mjs" },
      },
    });
    const env = await loadEnvironment("dev", { sandboxRoot });
    env.sourceRoot = source;
    env.tools.node = {
      ...env.tools.node,
      path: process.execPath,
      version: process.versions.node,
    };
    const pnpm = join(sandboxRoot, "pnpm.mjs");
    await writeFile(
      pnpm,
      `#!${process.execPath}\nif(process.argv[2]==='--version')console.log('9.15.4');else process.exitCode=9;\n`,
    );
    await chmod(pnpm, 0o700);
    env.tools.pnpm = { ...env.tools.pnpm, path: pnpm, version: "9.15.4" };
    const approval = join(sandboxRoot, "approval.json");
    await writeFile(
      approval,
      JSON.stringify({
        approved: true,
        ref: "approved-tag",
        commit,
        nodeVersion: process.versions.node,
        pnpmVersion: "9.15.4",
        lifecycleScripts: [
          "approval-fixture:postinstall",
          "approval-fixture:prepare",
          "better-sqlite3:install",
          "esbuild:postinstall",
        ],
      }),
    );
    await assert.rejects(
      buildRelease(env, {
        ref: "approved-tag",
        release: "test-release",
        installationApproval: approval,
      }),
      (error) =>
        error.exitCode === 3 &&
        error.details.required.includes("workspace-fixture:postinstall"),
    );
    const entry = fileURLToPath(
      new URL("./installation-approval.mjs", import.meta.url),
    );
    execFileSync(
      process.execPath,
      [
        entry,
        "--source",
        source,
        "--ref",
        "approved-tag",
        "--output",
        approval,
        "--approved",
      ],
      { stdio: "pipe" },
    );
    assert.ok(
      JSON.parse(await readFile(approval, "utf8")).lifecycleScripts.includes(
        "workspace-fixture:postinstall",
      ),
    );
    await assert.rejects(
      buildRelease(env, {
        ref: "approved-tag",
        release: "authorized-release",
        installationApproval: approval,
      }),
      (error) => error.exitCode === 5 && error.details.args[0] === "install",
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});
