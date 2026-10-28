import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  roleUserWebConfigSchema,
  roleAdminWebConfigSchema,
} from "../../packages/shared/dist/schemas/role-user-web.js";
import { resourcePolicy } from "../../packages/shared/dist/generated/role-runtime-validators.js";
import { loadEnvironment } from "./config.mjs";
import { writePublicConfiguration } from "./public-config.mjs";
import { generateNginxConfig } from "./nginx.mjs";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "tavern-public-config-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const env = await loadEnvironment("dev", {
    sandboxRoot: join(base, "environments"),
  });
  const source = join(base, "source");
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  await mkdir(join(source, "packages/shared"), { recursive: true });
  await symlink(
    join(repository, "packages/shared/dist"),
    join(source, "packages/shared/dist"),
  );
  const policy = join(
    source,
    "apps/user-web/public/config/runtime-policy.json",
  );
  await mkdir(join(source, "apps/user-web/public/config"), { recursive: true });
  await cp(
    join(repository, "apps/user-web/public/config/runtime-policy.json"),
    policy,
  );
  env.sourceRoot = source;
  env.secretValues = ["private-public-config-key"];
  env.runtimeEnv.AUTH_API_KEYS = env.secretValues[0];
  return { env, policy };
}

test("public configuration contains approved fields and matches frontend consumer schemas", async (t) => {
  const { env } = await fixture(t);
  const paths = await writePublicConfiguration(env);
  assert.equal(paths.length, 3);
  const nginx = generateNginxConfig(env);
  for (const [frontend, filenames] of Object.entries(env.publicFiles)) {
    for (const filename of filenames) {
      const output = join(env.paths.publicConfig, frontend, filename);
      assert.ok(paths.includes(output));
      assert.ok(nginx.includes(`location = /config/${filename} {`));
      assert.ok(nginx.includes(`alias "${output}";`));
    }
  }
  const read = async (relative) =>
    JSON.parse(await readFile(join(env.paths.publicConfig, relative), "utf8"));
  const admin = roleAdminWebConfigSchema.parse(
    await read("web/role-apps.json"),
  );
  const user = roleUserWebConfigSchema.parse(
    await read("user-web/application.json"),
  );
  assert.equal(
    admin.userWebBaseUrl,
    `http://${env.hostname}:${env.ports.frontends["user-web"].http}`,
  );
  assert.equal(
    user.adminBaseUrl,
    `http://${env.hostname}:${env.ports.frontends.web.http}`,
  );
  assert.equal(user.apiBaseUrl, "/api");
  assert.equal(
    resourcePolicy(await read("user-web/runtime-policy.json")),
    true,
  );
  for (const path of paths)
    assert.doesNotMatch(
      await readFile(path, "utf8"),
      /AUTH_API_KEYS|private-public-config-key/,
    );
});

test("public configuration rejects runtime policy fields that the frontend schema does not allow", async (t) => {
  const { env, policy } = await fixture(t);
  const value = JSON.parse(await readFile(policy, "utf8"));
  value.AUTH_API_KEYS = env.secretValues[0];
  await writeFile(policy, JSON.stringify(value));
  await assert.rejects(writePublicConfiguration(env), (error) => {
    assert.equal(error.exitCode, 2);
    assert.ok(error.message.includes(policy));
    assert.match(error.message, /AUTH_API_KEYS/);
    assert.match(error.message, /源配置/);
    assert.match(error.message, /重新生成/);
    return true;
  });
});

test("release configuration keeps artifact contracts and policy after development sources change", async (t) => {
  const { env, policy } = await fixture(t);
  env.mode = "release";
  const releaseDirectory = join(env.paths.releases, "release-fixture");
  const shared = join(releaseDirectory, "api/node_modules/@tavern/shared");
  await mkdir(shared, { recursive: true });
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  await cp(join(repository, "packages/shared/dist"), join(shared, "dist"), {
    recursive: true,
  });
  await cp(
    join(repository, "packages/shared/package.json"),
    join(shared, "package.json"),
  );
  await cp(
    await realpath(join(repository, "node_modules/zod")),
    join(releaseDirectory, "api/node_modules/zod"),
    { recursive: true },
  );
  await mkdir(join(releaseDirectory, "user-web/config"), { recursive: true });
  await cp(
    policy,
    join(releaseDirectory, "user-web/config/runtime-policy.json"),
  );
  const expectedPolicy = JSON.parse(await readFile(policy, "utf8"));
  await writeFile(policy, "{}");
  await rm(join(env.sourceRoot, "packages/shared/dist"));
  await writePublicConfiguration(env, { releaseDirectory });
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(env.paths.publicConfig, "user-web/runtime-policy.json"),
        "utf8",
      ),
    ),
    expectedPolicy,
  );
  await symlink(releaseDirectory, env.paths.current);
  await writePublicConfiguration(env);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(env.paths.publicConfig, "user-web/runtime-policy.json"),
        "utf8",
      ),
    ),
    expectedPolicy,
  );
  const artifactPolicy = join(
    releaseDirectory,
    "user-web/config/runtime-policy.json",
  );
  await writeFile(
    artifactPolicy,
    JSON.stringify({ ...expectedPolicy, unexpectedField: true }),
  );
  await assert.rejects(
    writePublicConfiguration(env, { releaseDirectory }),
    (error) => {
      assert.equal(error.exitCode, 2);
      assert.ok(error.message.includes(artifactPolicy));
      assert.ok(error.message.includes(policy));
      assert.match(error.message, /unexpectedField/);
      assert.match(error.message, /重新构建新发布归档/);
      return true;
    },
  );
});

test("invalid runtime policy JSON identifies the input file and regeneration action", async (t) => {
  const { env, policy } = await fixture(t);
  await writeFile(policy, "{");
  await assert.rejects(writePublicConfiguration(env), (error) => {
    assert.equal(error.exitCode, 2);
    assert.ok(error.message.includes(policy));
    assert.match(error.message, /JSON/);
    assert.match(error.message, /重新生成/);
    return true;
  });
});
