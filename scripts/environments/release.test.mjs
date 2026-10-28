import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadEnvironment, sourceRoot } from "./config.mjs";
import { backupEnvironment } from "./data.mjs";
import {
  activatePreparedRelease,
  archiveRelease,
  beginOperation,
  buildRelease,
  deployRelease,
  inventoryDirectory,
  prepareRelease,
  rollbackRelease,
  runCommand,
  verifyReleaseRuntime,
} from "./release.mjs";

function setDirectoryMetadata(directory) {
  if (process.platform === "darwin")
    execFileSync("/usr/bin/xattr", [
      "-w",
      "com.tavern.release-test",
      "host directory metadata",
      directory,
    ]);
}

async function releaseFixture(
  sandboxRoot,
  { abi = process.versions.modules } = {},
) {
  const env = await loadEnvironment("staging", { sandboxRoot });
  env.sourceRoot = join(sandboxRoot, "source");
  await mkdir(env.sourceRoot);

  await writeFile(
    join(env.sourceRoot, ".gitignore"),
    "build/\ndata/\nlogs/\nreleases/\ncurrent\nrun/\nconfig/application.env\nconfig/secrets.env\n",
  );
  await writeFile(join(env.sourceRoot, "version.txt"), "old");
  const git = (args) =>
    execFileSync("git", args, {
      cwd: env.sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = () => {
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "fixture",
    ]);
    return git(["rev-parse", "HEAD"]);
  };
  git(["init"]);
  const previousCommit = commit();
  await writeFile(join(env.sourceRoot, "version.txt"), "target");
  const targetCommit = commit();
  git(["worktree", "add", "--detach", env.root, previousCommit]);
  const payload = join(sandboxRoot, "payload"),
    artifact = join(sandboxRoot, "artifact");
  const contents = {
    "api/package.json":
      '{"name":"release-fixture","type":"module","version":"1.0.0","dependencies":{}}',
    "api/dist/index.js":
      'throw new Error("entry is not started by deployment");',
    "api/dist/app.js":
      'export function buildApp(){throw new Error("deployment must not initialize application data")}',
    "api/dist/db/environment-command.js": `import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';const value=key=>process.argv[process.argv.indexOf(key)+1];const state=JSON.parse(readFileSync(value('--database'),'utf8'));if(process.argv[2]==='backup')copyFileSync(value('--database'),value('--target'));writeFileSync(value('--output'),JSON.stringify({ready:state.ready,appliedMigrationSequence:state.sequence,expectedMigrationSequence:[],integrity:{ok:true},foreignKeys:{ok:true},fileReferences:{ok:true,checked:0,issues:[]},profileSecrets:{ok:true,checked:0,issues:[]},tableRowCounts:{fixture:1}}));process.exitCode=state.ready?0:3;`,
    "api/dist/services/role-runtime/native-module-worker.mjs": await readFile(
      join(
        sourceRoot,
        "apps/api/src/services/role-runtime/native-module-worker.mjs",
      ),
      "utf8",
    ),
    "web/index.html": "<html>management</html>",
    "user-web/index.html": "<html>user</html>",
    "studio/index.html": "<html>studio</html>",
  };
  for (const [path, content] of Object.entries(contents)) {
    await mkdir(dirname(join(payload, path)), { recursive: true });
    await writeFile(join(payload, path), content);
  }
  const shared = join(payload, "api/node_modules/@tavern/shared");
  await mkdir(shared, { recursive: true });
  await cp(join(sourceRoot, "packages/shared/dist"), join(shared, "dist"), {
    recursive: true,
  });
  await cp(
    join(sourceRoot, "packages/shared/package.json"),
    join(shared, "package.json"),
  );
  await cp(
    await realpath(join(sourceRoot, "node_modules/zod")),
    join(payload, "api/node_modules/zod"),
    { recursive: true },
  );
  await mkdir(join(payload, "user-web/config"), { recursive: true });
  await cp(
    join(sourceRoot, "apps/user-web/public/config/runtime-policy.json"),
    join(payload, "user-web/config/runtime-policy.json"),
  );
  const manifest = {
    version: 1,
    release: "fixture-2",
    ref: "v2",
    commit: targetCommit,
    platform: { os: process.platform, arch: process.arch, abi },
    migrationSequence: [],
    files: await inventoryDirectory(payload),
  };
  const text = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(payload, "manifest.json"), text);
  setDirectoryMetadata(payload);
  await archiveRelease(
    env,
    { payload, manifest, destination: artifact },
    { work: join(sandboxRoot, "fixture-archive") },
  );
  await mkdir(env.paths.data);
  await writeFile(
    env.paths.database,
    JSON.stringify({ ready: true, sequence: [] }),
  );
  env.tools.pnpm.path = join(sandboxRoot, "package-manager-must-not-run");
  return { env, artifact, payload, previousCommit, targetCommit };
}

async function releaseRuntimeFixture(sandboxRoot) {
  const { env, payload } = await releaseFixture(sandboxRoot);
  const apiDirectory = join(payload, "api");
  const dependencyDirectory = join(
    apiDirectory,
    "node_modules/@fixture/subpath-only",
  );
  await mkdir(dependencyDirectory, { recursive: true });
  await writeFile(
    join(apiDirectory, "package.json"),
    JSON.stringify({
      name: "release-fixture",
      type: "module",
      dependencies: { "@fixture/subpath-only": "1.0.0" },
    }),
  );
  await writeFile(
    join(dependencyDirectory, "package.json"),
    JSON.stringify({
      name: "@fixture/subpath-only",
      version: "1.0.0",
      type: "module",
      exports: { "./client/index.js": "./client.js" },
    }),
  );
  await writeFile(
    join(dependencyDirectory, "client.js"),
    "export const ready = true;",
  );
  await writeFile(
    join(apiDirectory, "dist/app.js"),
    'import {ready} from "@fixture/subpath-only/client/index.js"; if (!ready) throw new Error("Dependency entry failed"); export function buildApp() {}',
  );
  return {
    env,
    dependencyDirectory,
    prepared: {
      releaseDirectory: payload,
      apiDirectory,
      manifest: JSON.parse(
        await readFile(join(payload, "manifest.json"), "utf8"),
      ),
    },
    operation: { work: join(sandboxRoot, "runtime-check") },
  };
}

async function releaseArchiveFixture(sandboxRoot) {
  const env = await loadEnvironment("dev", { sandboxRoot });
  const payload = join(sandboxRoot, "payload");
  await mkdir(payload);
  await writeFile(join(payload, "entry.txt"), "release contents");
  const manifest = {
    version: 1,
    release: "fixture-archive",
    ref: "v1",
    commit: "a".repeat(40),
    migrationSequence: [],
    files: await inventoryDirectory(payload),
  };
  await writeFile(join(payload, "manifest.json"), JSON.stringify(manifest));
  return {
    env,
    payload,
    manifest,
    destination: join(env.paths.artifacts, manifest.release),
    operation: { work: join(sandboxRoot, "archive-check") },
  };
}

test("release archive rejects invalid tar output before publishing its destination", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-archive-validation-"),
  );
  try {
    const fixture = await releaseArchiveFixture(sandboxRoot);
    const tar = execFileSync("which", ["tar"], { encoding: "utf8" }).trim();
    const commands = join(sandboxRoot, "commands");
    await mkdir(commands);
    await writeFile(
      join(commands, "tar"),
      `#!${process.execPath}
const {writeFileSync}=require("node:fs"),{spawnSync}=require("node:child_process"),{join}=require("node:path");
const args=process.argv.slice(2);
writeFileSync(join(args[args.indexOf("-C")+1],"unlisted.txt"),"unexpected archive file");
const child=spawnSync(${JSON.stringify(tar)},args,{stdio:"inherit"});
process.exit(child.status??1);
`,
      { mode: 0o700 },
    );
    fixture.env.hostEnv = {
      ...fixture.env.hostEnv,
      PATH: `${commands}:${fixture.env.hostEnv.PATH}`,
    };
    await assert.rejects(
      archiveRelease(fixture.env, fixture, fixture.operation),
      (error) => error.exitCode === 5 && error.details.path === "unlisted.txt",
    );
    await assert.rejects(realpath(fixture.destination), { code: "ENOENT" });
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test(
  "release archive excludes macOS extended attributes",
  { skip: process.platform !== "darwin" },
  async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-archive-xattr-"));
    try {
      const fixture = await releaseArchiveFixture(sandboxRoot);
      execFileSync("/usr/bin/xattr", [
        "-w",
        "com.tavern.release-test",
        "host metadata",
        join(fixture.payload, "entry.txt"),
      ]);
      const hostArtifact = join(sandboxRoot, "host-metadata");
      await mkdir(hostArtifact);
      await cp(
        join(fixture.payload, "manifest.json"),
        join(hostArtifact, "manifest.json"),
      );
      execFileSync(
        "tar",
        [
          "-czf",
          join(hostArtifact, "release.tar.gz"),
          "-C",
          fixture.payload,
          ".",
        ],
        { env: { ...fixture.env.hostEnv, COPYFILE_DISABLE: "1" } },
      );
      await assert.rejects(
        prepareRelease(fixture.env, {
          release: fixture.manifest.release,
          artifact: hostArtifact,
        }),
        (error) =>
          error.exitCode === 5 && String(error.details.key).includes(".xattr."),
      );
      setDirectoryMetadata(fixture.payload);
      await archiveRelease(fixture.env, fixture, fixture.operation);
      const prepared = await prepareRelease(fixture.env, {
        release: fixture.manifest.release,
        artifact: fixture.destination,
      });
      assert.equal(
        await readFile(join(prepared.releaseDirectory, "entry.txt"), "utf8"),
        "release contents",
      );
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  },
);

test("release runtime loads dependencies through application subpaths", async (t) => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-runtime-subpath-"));
  try {
    const { env, prepared, operation } =
      await releaseRuntimeFixture(sandboxRoot);
    const platform = await verifyReleaseRuntime(env, prepared, operation).catch(
      async (error) => {
        t.diagnostic(await readFile(error.details.logPath, "utf8"));
        throw error;
      },
    );
    assert.equal(platform.abi, process.versions.modules);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("production deployment requires staging acceptance before changing a release pointer", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-deploy-approval-"));
  try {
    const env = await loadEnvironment("prod", { sandboxRoot });
    await assert.rejects(
      deployRelease(env, { release: "fixture-1" }),
      (error) => error.exitCode === 3,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("an interruption after the source switch restores the original Git commit with the aborted signal", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-source-abort-"));
  try {
    const { env, artifact, previousCommit } = await releaseFixture(sandboxRoot);
    const controller = new AbortController();
    const interrupted = { ...env, signal: controller.signal };
    const prepared = await prepareRelease(interrupted, {
      release: "fixture-2",
      artifact,
    });
    const operation = await beginOperation(interrupted, "activation-test");
    const stage = operation.stage;
    operation.stage = async (name, action) => {
      const result = await stage(name, action);
      if (name === "switch-source-commit") controller.abort();
      return result;
    };
    await assert.rejects(
      activatePreparedRelease(interrupted, prepared, operation),
      (error) => error.exitCode === 130,
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("aborting an external build command stops that command and reports interruption", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-command-abort-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    const controller = new AbortController();
    const command = runCommand(
      { ...env, signal: controller.signal },
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { logPath: join(sandboxRoot, "command.log") },
    );
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(command, (error) => error.exitCode === 130);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("aborting a build command also stops its child process that ignores graceful termination", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-command-group-"));
  let childPid;
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    env.timeouts = { ...env.timeouts, stopSeconds: 1 };
    const controller = new AbortController(),
      pidFile = join(sandboxRoot, "child.json");
    const childSource =
      "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);";
    const source = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:child.pid})));setInterval(()=>{},1000);`;
    const command = runCommand(
      { ...env, signal: controller.signal },
      process.execPath,
      ["-e", source],
      { logPath: join(sandboxRoot, "command.log") },
    );
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      try {
        childPid = JSON.parse(await readFile(pidFile, "utf8")).pid;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(childPid);
    controller.abort();
    await assert.rejects(command, (error) => error.exitCode === 130);
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error.code === "ESRCH",
    );
  } finally {
    if (childPid) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch (error) {
        assert.equal(error.code, "ESRCH");
      }
    }
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("release runtime loads application subpaths when an unused package root is absent", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-runtime-unused-root-"),
  );
  try {
    const { env, prepared, operation, dependencyDirectory } =
      await releaseRuntimeFixture(sandboxRoot);
    const manifestPath = join(dependencyDirectory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.exports["."] = "./absent-root.js";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await verifyReleaseRuntime(env, prepared, operation);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("release runtime accepts package links that remain inside the archive", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-runtime-internal-link-"),
  );
  try {
    const { env, prepared, operation, dependencyDirectory } =
      await releaseRuntimeFixture(sandboxRoot);
    const target = join(
      prepared.apiDirectory,
      "node_modules/.pnpm/subpath-only",
    );
    await cp(dependencyDirectory, target, { recursive: true });
    await rm(dependencyDirectory, { recursive: true });
    await symlink(target, dependencyDirectory);
    await verifyReleaseRuntime(env, prepared, operation);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

for (const missing of ["directory", "package.json"]) {
  test(`release runtime rejects a missing dependency ${missing}`, async () => {
    const sandboxRoot = await mkdtemp(
      join(tmpdir(), "tavern-runtime-missing-"),
    );
    try {
      const { env, prepared, operation, dependencyDirectory } =
        await releaseRuntimeFixture(sandboxRoot);
      await rm(
        missing === "directory"
          ? dependencyDirectory
          : join(dependencyDirectory, "package.json"),
        { recursive: true },
      );
      await assert.rejects(
        verifyReleaseRuntime(env, prepared, operation),
        (error) => error.exitCode === 5,
      );
      assert.match(
        await readFile(join(operation.work, "runtime-api.log"), "utf8"),
        /ENOENT.*@fixture[/\\]subpath-only/,
      );
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });
}

for (const outside of ["directory", "package.json"]) {
  test(`release runtime rejects a dependency ${outside} outside the archive`, async () => {
    const sandboxRoot = await mkdtemp(
      join(tmpdir(), "tavern-runtime-outside-"),
    );
    try {
      const { env, prepared, operation, dependencyDirectory } =
        await releaseRuntimeFixture(sandboxRoot);
      const source =
        outside === "directory"
          ? dependencyDirectory
          : join(dependencyDirectory, "package.json");
      const target = join(sandboxRoot, `external-${outside}`);
      await cp(source, target, { recursive: true });
      await rm(source, { recursive: true });
      await symlink(target, source);
      await assert.rejects(
        verifyReleaseRuntime(env, prepared, operation),
        (error) => error.exitCode === 5,
      );
      assert.match(
        await readFile(join(operation.work, "runtime-api.log"), "utf8"),
        /Dependency outside archive: @fixture\/subpath-only/,
      );
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });
}

test("release runtime rejects a missing dependency entry used by the application", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-runtime-entry-"));
  try {
    const { env, prepared, operation, dependencyDirectory } =
      await releaseRuntimeFixture(sandboxRoot);
    await rm(join(dependencyDirectory, "client.js"));
    await assert.rejects(
      verifyReleaseRuntime(env, prepared, operation),
      (error) => error.exitCode === 5,
    );
    assert.match(
      await readFile(join(operation.work, "runtime-api.log"), "utf8"),
      /Cannot find module '.*subpath-only\/client\.js'/,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("build requires the installation approval for its exact clean tag before running package commands", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-build-approval-"));
  try {
    const env = await loadEnvironment("dev", { sandboxRoot });
    env.sourceRoot = join(sandboxRoot, "source");
    await mkdir(env.sourceRoot);
    await writeFile(
      join(env.sourceRoot, "package.json"),
      '{"name":"fixture","version":"1.0.0","packageManager":"pnpm@10.34.5"}\n',
    );
    await writeFile(
      join(env.sourceRoot, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
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
      ["tag", "v1"],
    ])
      execFileSync("git", args, { cwd: env.sourceRoot, stdio: "pipe" });
    await assert.rejects(
      buildRelease(env, { ref: "v1", release: "fixture-1" }),
      (error) => error.exitCode === 3,
    );
    assert.equal(
      await import("node:fs/promises").then((fs) =>
        fs.access(join(env.sourceRoot, "node_modules")).then(
          () => true,
          () => false,
        ),
      ),
      false,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("prepares the original archive in an isolated environment and detects changed release bytes", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-release-"));
  try {
    const env = await loadEnvironment("staging", { sandboxRoot });
    const artifact = join(sandboxRoot, "artifact");
    const payload = join(sandboxRoot, "payload");
    await mkdir(join(payload, "api"), { recursive: true });
    const content =
      '{"name":"release-fixture","version":"1.0.0","type":"module"}\n';
    await writeFile(join(payload, "api/package.json"), content);
    const manifest = {
      version: 1,
      release: "fixture-1",
      ref: "v1",
      commit: "a".repeat(40),
      platform: {
        os: process.platform,
        arch: process.arch,
        abi: process.versions.modules,
      },
      migrationSequence: [],
      files: [
        {
          path: "api/package.json",
          type: "file",
          bytes: Buffer.byteLength(content),
        },
      ],
    };
    const text = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(join(payload, "manifest.json"), text);
    setDirectoryMetadata(payload);
    await archiveRelease(
      env,
      { payload, manifest, destination: artifact },
      { work: join(sandboxRoot, "archive") },
    );
    const prepared = await prepareRelease(env, {
      release: "fixture-1",
      artifact,
    });
    assert.equal(
      prepared.apiDirectory,
      join(env.paths.releases, "fixture-1/api"),
    );
    assert.equal(
      await readFile(join(prepared.apiDirectory, "package.json"), "utf8"),
      content,
    );
    assert.deepEqual(
      await readFile(join(env.paths.artifacts, "fixture-1/release.tar.gz")),
      await readFile(join(artifact, "release.tar.gz")),
    );
    await writeFile(
      join(prepared.apiDirectory, "package.json"),
      content.replace("1.0.0", "9.0.0"),
    );
    await assert.rejects(
      prepareRelease(env, { release: "fixture-1", artifact }),
      (error) => error.exitCode === 5,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("deployment loads an isolated runtime and switches only its worktree and current pointer", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-deploy-complete-"));
  try {
    const { env, artifact, targetCommit } = await releaseFixture(sandboxRoot);
    const before = await readFile(env.paths.database);
    const result = await deployRelease(env, { release: "fixture-2", artifact });
    assert.equal(result.stopped, true);
    assert.equal(result.commit, targetCommit);
    assert.equal(
      await readFile(join(env.paths.current, "manifest.json"), "utf8")
        .then(JSON.parse)
        .then((value) => value.release),
      "fixture-2",
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      targetCommit,
    );
    assert.deepEqual(await readFile(env.paths.database), before);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("deployment rejects an incompatible native ABI before changing its source or current pointer", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-deploy-abi-"));
  try {
    const { env, artifact, previousCommit } = await releaseFixture(
      sandboxRoot,
      { abi: "0" },
    );
    await assert.rejects(
      deployRelease(env, { release: "fixture-2", artifact }),
      (error) => error.exitCode === 5,
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("deployment rejects missing runtime dependencies before accessing the target database", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-deploy-dependency-"),
  );
  try {
    const { env, payload, previousCommit } = await releaseFixture(sandboxRoot);
    const manifestPath = join(payload, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      join(payload, "api/package.json"),
      JSON.stringify({
        name: "release-fixture",
        type: "module",
        version: "1.0.0",
        dependencies: { "@fixture/missing": "1.0.0" },
      }),
    );
    for (const entry of ["app.js", "db/environment-command.js"])
      await writeFile(
        join(payload, "api/dist", entry),
        'import "@fixture/missing";',
      );
    await rm(manifestPath);
    manifest.files = await inventoryDirectory(payload);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const artifact = join(sandboxRoot, "missing-dependency-artifact");
    await archiveRelease(
      env,
      { payload, manifest, destination: artifact },
      { work: join(sandboxRoot, "archive") },
    );
    const before = await readFile(env.paths.database);
    await assert.rejects(
      deployRelease(env, { release: manifest.release, artifact }),
      (error) => error.exitCode === 5,
    );
    assert.deepEqual(await readFile(env.paths.database), before);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
    await assert.rejects(readFile(join(env.paths.current, "manifest.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("application rollback validates the matching snapshot and keeps current data unchanged", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-rollback-complete-"),
  );
  try {
    const { env, artifact, payload, previousCommit } =
      await releaseFixture(sandboxRoot);
    const olderArtifact = join(sandboxRoot, "older-artifact");
    const older = {
      ...JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8")),
      release: "fixture-1",
      ref: "v1",
      commit: previousCommit,
    };
    await writeFile(join(payload, "manifest.json"), JSON.stringify(older));
    await archiveRelease(
      env,
      { payload, manifest: older, destination: olderArtifact },
      { work: join(sandboxRoot, "older-archive") },
    );
    await prepareRelease(env, {
      release: "fixture-1",
      artifact: olderArtifact,
    });
    await deployRelease(env, { release: "fixture-2", artifact });
    const before = await readFile(env.paths.database);
    await backupEnvironment(env, { backup: "before-rollback" });
    const compatibility = join(sandboxRoot, "compatibility.json");
    await writeFile(
      compatibility,
      JSON.stringify({
        fromRelease: "fixture-2",
        release: "fixture-1",
        migrationSequence: [],
        readWrite: "passed",
        backup: "before-rollback",
      }),
    );
    await writeFile(
      join(env.paths.data, "changed-after-backup.txt"),
      "new data",
    );
    await assert.rejects(
      rollbackRelease(env, {
        release: "fixture-1",
        compatibility,
        backup: "before-rollback",
      }),
      (error) => error.exitCode === 3,
    );
    await rm(join(env.paths.data, "changed-after-backup.txt"));
    const result = await rollbackRelease(env, {
      release: "fixture-1",
      compatibility,
      backup: "before-rollback",
    });
    assert.equal(result.release, "fixture-1");
    assert.equal(result.stopped, true);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
    assert.deepEqual(await readFile(env.paths.database), before);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("archive preparation preserves long package paths and internal symbolic and hard links", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-archive-links-"));
  try {
    const env = await loadEnvironment("staging", { sandboxRoot });
    const artifact = join(sandboxRoot, "artifact"),
      payload = join(sandboxRoot, "payload");
    const longPath = `api/node_modules/.pnpm/${"dependency-".repeat(20)}/node_modules/dependency/index.js`;
    await mkdir(dirname(join(payload, longPath)), { recursive: true });
    await writeFile(join(payload, longPath), "export default 1;\n");
    await mkdir(join(payload, "api/node_modules/package"), { recursive: true });
    await link(
      join(payload, longPath),
      join(payload, "api/node_modules/package/index.js"),
    );
    await symlink(
      longPath.slice("api/node_modules/".length).replace(/\/index.js$/, ""),
      join(payload, "api/node_modules/dependency"),
    );
    await mkdir(join(payload, "empty-directory"));
    const manifest = {
      version: 1,
      release: "links",
      ref: "v1",
      commit: "a".repeat(40),
      migrationSequence: [],
      files: await inventoryDirectory(payload),
    };
    await writeFile(join(payload, "manifest.json"), JSON.stringify(manifest));
    await archiveRelease(
      env,
      { payload, manifest, destination: artifact },
      { work: join(sandboxRoot, "archive-check") },
    );
    const result = await prepareRelease(env, { release: "links", artifact });
    assert.equal(
      await readFile(
        join(result.releaseDirectory, "api/node_modules/dependency/index.js"),
        "utf8",
      ),
      "export default 1;\n",
    );
    assert.equal(
      await readFile(
        join(result.releaseDirectory, "api/node_modules/package/index.js"),
        "utf8",
      ),
      "export default 1;\n",
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("a current pointer replacement failure restores the previous public configuration and source commit", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-deploy-recovery-"));
  let pointerDirectory;
  try {
    const { env, artifact, previousCommit } = await releaseFixture(sandboxRoot);
    pointerDirectory = join(env.root, "pointer");
    env.paths.current = join(pointerDirectory, "current");
    await mkdir(pointerDirectory);
    await mkdir(env.paths.publicConfig, { recursive: true });
    await writeFile(
      join(env.paths.publicConfig, "previous.json"),
      '{"previous":true}\n',
    );
    await chmod(pointerDirectory, 0o500);
    await assert.rejects(
      deployRelease(env, { release: "fixture-2", artifact }),
      (error) => error.exitCode === 5,
    );
    assert.equal(
      await readFile(join(env.paths.publicConfig, "previous.json"), "utf8"),
      '{"previous":true}\n',
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
  } finally {
    if (pointerDirectory) await chmod(pointerDirectory, 0o700);
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

for (const kind of ["symlink", "hardlink"])
  test(`archive ${kind} cannot write through a target outside the release directory`, async () => {
    const sandboxRoot = await mkdtemp(
      join(tmpdir(), `tavern-archive-${kind}-`),
    );
    try {
      const env = await loadEnvironment("staging", { sandboxRoot });
      const artifact = join(sandboxRoot, "artifact"),
        outside = join(sandboxRoot, "outside");
      await mkdir(artifact);
      await mkdir(outside);
      const protectedFile = join(outside, "protected.txt");
      await writeFile(protectedFile, "original");
      const manifest = {
        version: 1,
        release: "malformed",
        ref: "v1",
        commit: "a".repeat(40),
        migrationSequence: [],
        files:
          kind === "symlink"
            ? [
                { path: "escape", type: "symlink", target: outside },
                { path: "escape/protected.txt", type: "file", bytes: 7 },
              ]
            : [{ path: "linked.txt", type: "file", bytes: 8 }],
      };
      await writeFile(
        join(artifact, "manifest.json"),
        JSON.stringify(manifest),
      );
      execFileSync("python3", [
        "-c",
        `import io,json,tarfile,sys\narchive,manifest_path,target,kind=sys.argv[1:]\nwith tarfile.open(archive,'w:gz') as tar:\n data=open(manifest_path,'rb').read();entry=tarfile.TarInfo('manifest.json');entry.size=len(data);tar.addfile(entry,io.BytesIO(data))\n entry=tarfile.TarInfo('escape' if kind=='symlink' else 'linked.txt');entry.type=tarfile.SYMTYPE if kind=='symlink' else tarfile.LNKTYPE;entry.linkname=target;tar.addfile(entry)\n if kind=='symlink':\n  entry=tarfile.TarInfo('escape/protected.txt');entry.size=7;tar.addfile(entry,io.BytesIO(b'changed'))\n`,
        join(artifact, "release.tar.gz"),
        join(artifact, "manifest.json"),
        kind === "symlink" ? outside : protectedFile,
        kind,
      ]);
      await assert.rejects(
        prepareRelease(env, { release: "malformed", artifact }),
        (error) => error.exitCode === 5,
      );
      assert.equal(await readFile(protectedFile, "utf8"), "original");
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

test("a Git command interrupted after HEAD changes restores the original commit", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-git-command-abort-"),
  );
  let watcher;
  try {
    const { env, artifact, previousCommit, targetCommit } =
      await releaseFixture(sandboxRoot);
    const hooks = join(sandboxRoot, "hooks");
    await mkdir(hooks);
    const hook = join(hooks, "post-checkout");
    await writeFile(
      hook,
      `#!/bin/sh\nif [ "$2" = "${targetCommit}" ]; then\n  printf switched > "${join(hooks, "switched")}"\n  while :; do sleep 1; done\nfi\n`,
    );
    await chmod(hook, 0o700);
    execFileSync("git", ["config", "core.hooksPath", hooks], {
      cwd: env.root,
      stdio: "pipe",
    });
    const controller = new AbortController();
    watcher = watch(hooks, (_, filename) => {
      if (filename === "switched") controller.abort();
    });
    const interrupted = { ...env, signal: controller.signal };
    const prepared = await prepareRelease(interrupted, {
      release: "fixture-2",
      artifact,
    });
    const operation = await beginOperation(
      interrupted,
      "activation-command-test",
    );
    await assert.rejects(
      activatePreparedRelease(interrupted, prepared, operation),
      (error) => error.exitCode === 130,
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: env.root,
        encoding: "utf8",
      }).trim(),
      previousCommit,
    );
  } finally {
    watcher?.close();
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("native CI requires installation approval before the job can prepare any tools", async () => {
  const { parse } = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )("yaml");
  const workflow = parse(
    await readFile(
      new URL(
        "../../.github/workflows/native-environments.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), [
    "workflow_dispatch",
    "workflow_call",
  ]);
  assert.deepEqual(
    workflow.on.workflow_call.inputs,
    workflow.on.workflow_dispatch.inputs,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.installation_approved.default,
    false,
  );
  assert.equal(
    workflow.jobs.native.if,
    "github.event_name == 'workflow_dispatch' && inputs.installation_approved == true",
  );
  const caller = parse(
    await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  const job = caller.jobs.native;
  assert.equal(
    caller.on.workflow_dispatch.inputs.installation_approved.default,
    false,
  );
  assert.equal(
    job.if,
    "github.event_name == 'workflow_dispatch' && inputs.installation_approved == true",
  );
  assert.equal(job.uses, "./.github/workflows/native-environments.yml");
  assert.deepEqual(job.with, {
    release_ref: "${{ inputs.release_ref }}",
    release_id: "${{ inputs.release_id }}",
    installation_approved: "${{ inputs.installation_approved }}",
  });
  assert.deepEqual(job.permissions, { contents: "read" });
});

test("CI prepares isolated runtime paths in runner steps", async () => {
  const { parse } = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )("yaml");
  const native = parse(
    await readFile(
      new URL(
        "../../.github/workflows/native-environments.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ci = parse(
    await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  const root = await mkdtemp(join(tmpdir(), "tavern-ci paths-"));
  try {
    for (const [job, stepName, expected] of [
      [
        native.jobs.native,
        "Prepare native sandbox",
        { NATIVE_SANDBOX: join(root, "tavern-native-environments") },
      ],
      [
        ci.jobs["api-smoke"],
        "Prepare isolated database paths",
        {
          DATA_DIR: join(root, "tavern-api-smoke"),
          DATABASE_URL: join(root, "tavern-api-smoke/tavern-headless.db"),
          TAVERN_LOG_DIR: join(root, "tavern-api-smoke/logs"),
        },
      ],
    ]) {
      for (const value of Object.values(job.env ?? {}))
        assert.doesNotMatch(String(value), /\$\{\{\s*runner\./);
      const preparation = job.steps.find((step) => step.name === stepName);
      assert.ok(preparation?.run);
      const environmentFile = join(root, stepName + ".env");
      execFileSync("bash", ["-e", "-c", preparation.run], {
        env: { ...process.env, RUNNER_TEMP: root, GITHUB_ENV: environmentFile },
      });
      const actual = Object.fromEntries(
        (await readFile(environmentFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => [
            line.slice(0, line.indexOf("=")),
            line.slice(line.indexOf("=") + 1),
          ]),
      );
      assert.deepEqual(actual, expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
