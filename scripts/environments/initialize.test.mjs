import { createServer } from "node:net";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { loadEnvironment } from "./config.mjs";
import { initializeEnvironment } from "./initialize.mjs";

const execute = promisify(execFile);

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "tavern-initialize-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const source = join(base, "source");
  for (const relative of [
    "config/environments/application.env.example",
    "config/environments/secrets.env.example",
    "apps/user-web/public/config/runtime-policy.json",
  ]) {
    await mkdir(dirname(join(source, relative)), { recursive: true });
    await cp(join(repository, relative), join(source, relative));
  }
  await mkdir(join(source, "packages/shared"), { recursive: true });
  await symlink(
    join(repository, "packages/shared/dist"),
    join(source, "packages/shared/dist"),
  );
  await execute("git", ["init", "--quiet", source]);
  await execute("git", ["-C", source, "add", "."]);
  await execute("git", [
    "-C",
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const env = await loadEnvironment("dev", {
    sandboxRoot: join(base, "environments"),
  });
  env.sourceRoot = source;
  for (const name of ["node", "pnpm", "nginx"]) {
    const path = join(base, name);
    await writeFile(
      path,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(env.tools[name].version + "\n")});\n`,
    );
    await chmod(path, 0o700);
    env.tools[name].path = path;
  }
  return { env, base };
}

test("initialization refuses an environment whose API port belongs to another process", async (t) => {
  const { env } = await fixture(t);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  env.ports.api = server.address().port;
  try {
    await assert.rejects(
      initializeEnvironment(env),
      (error) => error.exitCode === 4,
    );
    await assert.rejects(access(env.root));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("initialization creates its worktree and preserves application configuration, secrets and data on retry", async (t) => {
  const { env } = await fixture(t);
  await assert.rejects(access(env.root));
  const first = await initializeEnvironment(env);
  assert.equal(first.state, "stopped");
  await access(join(env.root, ".git"));
  const application = "AUTH_MODE=none\nENABLE_WEBSOCKET=false\n";
  const secrets = "AUTH_API_KEYS=private-initialization-key\n";
  const dataPath = join(env.paths.data, "retained-data");
  await writeFile(env.paths.applicationEnv, application);
  await writeFile(env.paths.secretsEnv, secrets, { mode: 0o600 });
  await writeFile(dataPath, "persistent data");
  const second = await initializeEnvironment(env);
  assert.deepEqual(second.created, []);
  assert.equal(await readFile(env.paths.applicationEnv, "utf8"), application);
  assert.equal(await readFile(env.paths.secretsEnv, "utf8"), secrets);
  assert.equal((await stat(env.paths.secretsEnv)).mode & 0o777, 0o600);
  assert.equal(await readFile(dataPath, "utf8"), "persistent data");
});

test("initialization refuses an unapproved tool version before creating its worktree", async (t) => {
  const { env } = await fixture(t);
  await writeFile(
    env.tools.nginx.path,
    `#!${process.execPath}\nprocess.stdout.write('999.0.0\\n');\n`,
  );
  await assert.rejects(
    initializeEnvironment(env),
    (error) => error.exitCode === 3 && /nginx/.test(error.message),
  );
  await assert.rejects(access(env.root));
});
