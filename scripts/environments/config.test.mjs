import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { loadEnvironment, sourceRoot, assertOwnedPath } from "./config.mjs";

test("三环境以批准的端口和隔离根目录解析同一目录布局", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-config-"));
  try {
    const dev = await loadEnvironment("dev", { sandboxRoot });
    const staging = await loadEnvironment("staging", { sandboxRoot });
    const prod = await loadEnvironment("prod", { sandboxRoot });
    assert.equal(dev.ports.frontends.web.http, 24000);
    assert.equal(staging.ports.frontends.web.http, 24100);
    assert.equal(prod.ports.api, 24210);
    assert.equal(
      dev.paths.database,
      join(sandboxRoot, "dev/data/tavern-headless.db"),
    );
    assert.equal(
      staging.paths.database,
      join(sandboxRoot, "staging/data/tavern-headless.db"),
    );
    assert.equal(prod.paths.backups, join(sandboxRoot, "prod/backups"));
    assert.equal(prod.mode, "release");
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("verification sandboxes isolate every port from the configured runtime environments", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-verification-ports-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  for (const [name, environment] of Object.entries(config.environments))
    environment.root = join(directory, "runtime", name);
  const configPath = join(directory, "environments.json");
  await writeFile(configPath, JSON.stringify(config));
  const cases = [
    {
      name: "dev",
      runtime: [4010, 4000, 4020, 4001, 4021, 4002, 4022],
      sandbox: [24010, 24000, 24020, 24001, 24021, 24002, 24022],
    },
    {
      name: "staging",
      runtime: [4110, 4100, 4120, 4101, 4121, 4102, 4122],
      sandbox: [24110, 24100, 24120, 24101, 24121, 24102, 24122],
    },
    {
      name: "prod",
      runtime: [4210, 4200, 4220, 4201, 4221, 4202, 4222],
      sandbox: [24210, 24200, 24220, 24201, 24221, 24202, 24222],
    },
  ];
  const ports = (env) => [
    env.ports.api,
    ...Object.values(env.ports.frontends).flatMap(({ http, dev }) => [
      http,
      dev,
    ]),
  ];
  for (const item of cases) {
    const runtime = await loadEnvironment(item.name, { configPath });
    const sandbox = await loadEnvironment(item.name, {
      configPath,
      sandboxRoot: join(directory, "sandbox"),
    });
    assert.deepEqual(ports(runtime), item.runtime);
    assert.deepEqual(ports(sandbox), item.sandbox);
    assert.equal(runtime.runtimeEnv.PORT, String(item.runtime[0]));
    assert.equal(sandbox.runtimeEnv.PORT, String(item.sandbox[0]));
    assert.equal(runtime.root, join(directory, "runtime", item.name));
    assert.equal(sandbox.root, join(directory, "sandbox", item.name));
  }
});

test("gateway defaults expose LAN frontends while application listeners remain internal", async (t) => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-gateway-defaults-"));
  t.after(() => rm(sandboxRoot, { recursive: true, force: true }));
  for (const name of ["dev", "staging", "prod"]) {
    const env = await loadEnvironment(name, { sandboxRoot });
    assert.equal(env.hostname, "192.0.2.31");
    assert.equal(env.gatewayListenHost, "0.0.0.0");
    assert.deepEqual(env.hostAliases, [
      "127.0.0.1",
      "localhost",
      "tavern.local",
    ]);
    assert.equal(env.listenHost, "127.0.0.1");
    assert.equal(env.runtimeEnv.HOST, "127.0.0.1");
  }
});

test("gateway schema requires explicit listeners and literal host aliases", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-gateway-schema-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  original.defaults.gatewayListenHost = "0.0.0.0";
  original.defaults.hostAliases = ["127.0.0.1", "localhost", "tavern.local"];
  const configPath = join(directory, "environments.json");
  const cases = [
    ...["gatewayListenHost", "hostAliases"].map((field) => ({
      name: `missing ${field}`,
      change: (config) => {
        delete config.defaults[field];
      },
      matches: (error) =>
        error.keyword === "required" && error.params.missingProperty === field,
    })),
    {
      name: "public application listener",
      change: (config) => {
        config.defaults.listenHost = "0.0.0.0";
      },
      matches: (error) => error.instancePath === "/defaults/listenHost",
    },
    ...[
      "bad; return 200;",
      "local\nhost",
      "*.local",
      "~.*",
      "$hostname",
      "_",
      "",
      "foo..local",
      "localhost:4000",
    ].map((alias) => ({
      name: `invalid alias ${JSON.stringify(alias)}`,
      change: (config) => {
        config.defaults.hostAliases = [alias];
      },
      matches: (error) => error.instancePath === "/defaults/hostAliases/0",
    })),
    {
      name: "duplicate aliases",
      change: (config) => {
        config.defaults.hostAliases = ["localhost", "localhost"];
      },
      matches: (error) =>
        error.instancePath === "/defaults/hostAliases" &&
        error.keyword === "uniqueItems",
    },
  ];
  for (const item of cases)
    await t.test(item.name, async () => {
      const config = structuredClone(original);
      item.change(config);
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(loadEnvironment("dev", { configPath }), (error) => {
        assert.equal(error.exitCode, 2);
        assert.ok(error.details.errors.some(item.matches), error.message);
        return true;
      });
    });
});

test("environments configure independent session cookies for LAN HTTP", async (t) => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-session-cookies-"));
  t.after(() => rm(sandboxRoot, { recursive: true, force: true }));
  for (const name of ["dev", "staging", "prod"]) {
    const env = await loadEnvironment(name, { sandboxRoot });
    assert.equal(env.sessionCookieName, `tavern_${name}_session`);
    assert.equal(env.sessionCookieSecure, false);
    assert.equal(
      env.runtimeEnv.USER_SESSION_COOKIE_NAME,
      `tavern_${name}_session`,
    );
    assert.equal(env.runtimeEnv.USER_SESSION_COOKIE_SECURE, "false");
    assert.ok(env.managedVariables.includes("USER_SESSION_COOKIE_NAME"));
    assert.ok(env.managedVariables.includes("USER_SESSION_COOKIE_SECURE"));
  }
});

test("session cookie configuration rejects shared names and malformed values", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "tavern-session-cookie-schema-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  for (const [name, env] of Object.entries(original.environments)) {
    env.sessionCookieName = `tavern_${name}_session`;
    env.sessionCookieSecure = false;
  }
  const configPath = join(directory, "environments.json");
  for (const item of [
    {
      name: "shared cookie name",
      change: (config) => {
        config.environments.prod.sessionCookieName =
          config.environments.dev.sessionCookieName;
      },
      field: "environments.prod.sessionCookieName",
    },
    {
      name: "invalid cookie name",
      change: (config) => {
        config.environments.prod.sessionCookieName = "session; Path=/";
      },
      field: "environments.prod.sessionCookieName",
    },
    {
      name: "invalid cookie security flag",
      change: (config) => {
        config.environments.prod.sessionCookieSecure = "false";
      },
      field: "environments.prod.sessionCookieSecure",
    },
    ...["sessionCookieName", "sessionCookieSecure"].map((field) => ({
      name: `missing ${field}`,
      change: (config) => {
        delete config.environments.prod[field];
      },
      field: `environments.prod.${field}`,
    })),
  ])
    await t.test(item.name, async () => {
      const config = structuredClone(original);
      item.change(config);
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(loadEnvironment("prod", { configPath }), (error) => {
        assert.equal(error.exitCode, 2);
        assert.ok(error.message.includes(item.field), error.message);
        return true;
      });
    });
});

test("environments share one LAN hostname with isolated ports and process identities", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-shared-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  for (const environment of Object.values(config.environments))
    environment.hostname = "192.0.2.31";
  const configPath = join(directory, "environments.json");
  await writeFile(configPath, JSON.stringify(config));
  const environments = await Promise.all(
    ["dev", "staging", "prod"].map((name) =>
      loadEnvironment(name, {
        configPath,
        sandboxRoot: join(directory, "sandbox"),
      }),
    ),
  );
  assert.deepEqual(
    environments.map((env) => env.hostname),
    ["192.0.2.31", "192.0.2.31", "192.0.2.31"],
  );
  assert.deepEqual(
    environments.map((env) => env.ports.frontends.web.http),
    [24000, 24100, 24200],
  );
  assert.deepEqual(
    environments.map((env) => env.processPrefix),
    ["tavern:dev", "tavern:staging", "tavern:prod"],
  );
  for (const env of environments)
    assert.equal(env.runtimeEnv.HOST, "127.0.0.1");
});

test("拒绝环境根目录嵌套，阻止运行数据跨环境归属", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-invalid-config-"));
  try {
    const config = JSON.parse(
      await readFile(
        join(sourceRoot, "config/environments.example.json"),
        "utf8",
      ),
    );
    config.environments.prod.root = join(config.environments.dev.root, "data");
    const configPath = join(directory, "environments.json");
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(
      loadEnvironment("prod", { configPath }),
      /根目录.*重叠/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝符号链接把运行文件导向环境之外", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-path-"));
  try {
    await mkdir(join(directory, "owned"));
    await mkdir(join(directory, "foreign"));
    await symlink(join(directory, "foreign"), join(directory, "owned/data"));
    await assert.rejects(
      assertOwnedPath(
        join(directory, "owned"),
        join(directory, "owned/data/new.db"),
      ),
      /环境目录/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝数据库及实际存储目录通过符号链接指向其他环境", async (context) => {
  const storage = JSON.parse(
    await readFile(join(sourceRoot, "apps/api/config/storage.json"), "utf8"),
  );
  const nativeCard = JSON.parse(
    await readFile(
      join(sourceRoot, "apps/api/config/native-card.json"),
      "utf8",
    ),
  );
  const cases = [
    { name: "database", path: storage.databaseFile, file: true },
    { name: "database-wal", path: storage.databaseFile + "-wal", file: true },
    { name: "database-shm", path: storage.databaseFile + "-shm", file: true },
    ...[
      "roleAssetsDir",
      "roleAssetStagingDir",
      "chatTransferArtifactDir",
      "backupArtifactDir",
    ].map((name) => ({ name, path: storage[name], file: false })),
    ...["storageRoot", "importStagingRoot", "buildRoot"].map((name) => ({
      name: "nativeCard." + name,
      path: nativeCard[name],
      file: false,
    })),
  ];
  for (const item of cases.flatMap((entry) => [
    { ...entry, targetExists: true },
    { ...entry, targetExists: false },
  ])) {
    await context.test(
      item.name + (item.targetExists ? ":existing" : ":missing"),
      async () => {
        const sandboxRoot = await mkdtemp(
          join(tmpdir(), "tavern-storage-link-"),
        );
        try {
          const target = join(sandboxRoot, "prod/data", item.path);
          const link = join(sandboxRoot, "dev/data", item.path);
          await mkdir(dirname(link), { recursive: true });
          if (item.targetExists) {
            if (item.file) {
              await mkdir(dirname(target), { recursive: true });
              await writeFile(target, "foreign environment data");
            } else await mkdir(target, { recursive: true });
          }
          await symlink(target, link);
          await assert.rejects(
            loadEnvironment("dev", { sandboxRoot }),
            /环境目录/,
          );
        } finally {
          await rm(sandboxRoot, { recursive: true, force: true });
        }
      },
    );
  }
});

test("按物理目录解析目标尚不存在的相对符号链接", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-relative-storage-link-"),
  );
  try {
    await mkdir(join(sandboxRoot, "dev/data"), { recursive: true });
    await mkdir(join(sandboxRoot, "prod/data/anchor"), { recursive: true });
    await symlink(
      join(sandboxRoot, "prod/data/anchor"),
      join(sandboxRoot, "dev/data/indirect"),
    );
    await symlink(
      "indirect/../foreign.db",
      join(sandboxRoot, "dev/data/tavern-headless.db"),
    );
    await assert.rejects(loadEnvironment("dev", { sandboxRoot }), /环境目录/);
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("业务调试变量传入运行环境，受管理变量仍由环境管理器提供", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-debug-config-"));
  try {
    const configDirectory = join(sandboxRoot, "dev/config");
    await mkdir(configDirectory, { recursive: true });
    const applicationPath = join(configDirectory, "application.env");
    await writeFile(applicationPath, "TAVERN_DEBUG=prompt,chat\n");
    const env = await loadEnvironment("dev", { sandboxRoot });
    assert.equal(env.runtimeEnv.TAVERN_DEBUG, "prompt,chat");
    assert.equal(env.runtimeEnv.TAVERN_ENVIRONMENT, "dev");
    assert.equal(
      env.runtimeEnv.TAVERN_LOG_DIR,
      join(env.paths.processLogs, "debug"),
    );
    for (const variable of ["TAVERN_LOG_DIR", "TAVERN_ENVIRONMENT"]) {
      await writeFile(applicationPath, variable + "=application-override\n");
      await assert.rejects(
        loadEnvironment("dev", { sandboxRoot }),
        new RegExp(variable),
      );
    }
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("业务配置来自环境文件，主机变量不能覆盖密钥和数据路径", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "tavern-env-"));
  const previous = process.env.AUTH_API_KEYS;
  process.env.AUTH_API_KEYS = "host-secret";
  try {
    const configDirectory = join(sandboxRoot, "dev/config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "application.env"),
      "AUTH_MODE=api_key\nENABLE_PROMPT_DRY_RUN=true\n",
    );
    await writeFile(
      join(configDirectory, "secrets.env"),
      "AUTH_API_KEYS=dev-secret\n",
      { mode: 0o600 },
    );
    const env = await loadEnvironment("dev", { sandboxRoot });
    assert.equal(env.runtimeEnv.AUTH_API_KEYS, "dev-secret");
    assert.equal(env.runtimeEnv.AUTH_MODE, "api_key");
    assert.deepEqual(env.secretValues, ["dev-secret"]);
    await writeFile(
      join(configDirectory, "secrets.env"),
      "AUTH_API_KEYS=one-secret,two-secret\n",
    );
    const multiple = await loadEnvironment("dev", { sandboxRoot });
    assert.ok(multiple.secretValues.includes("one-secret"));
    assert.ok(multiple.secretValues.includes("two-secret"));
    await writeFile(
      join(configDirectory, "application.env"),
      "DATA_DIR=/tmp/foreign\n",
    );
    await assert.rejects(loadEnvironment("dev", { sandboxRoot }), /DATA_DIR/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_API_KEYS;
    else process.env.AUTH_API_KEYS = previous;
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("验证端口唯一性、主机名格式和测试目录边界", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-config-validation-"));
  try {
    const config = JSON.parse(
      await readFile(
        join(sourceRoot, "config/environments.example.json"),
        "utf8",
      ),
    );
    const configPath = join(directory, "environments.json");
    config.environments.prod.ports.api = config.environments.dev.ports.api;
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(loadEnvironment("prod", { configPath }), /端口/);
    config.environments.prod.ports.api = 4210;
    config.environments.prod.hostname = "prod; malicious";
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(
      loadEnvironment("prod", { configPath }),
      /hostname|主机名/,
    );
    await assert.rejects(
      loadEnvironment("dev", { sandboxRoot: join(sourceRoot, "sandbox") }),
      /验证目录/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝备份目录通过符号链接与运行数据共用位置", async () => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-overlapping-paths-"),
  );
  try {
    await mkdir(join(sandboxRoot, "dev/data"), { recursive: true });
    await symlink(
      join(sandboxRoot, "dev/data"),
      join(sandboxRoot, "dev/backups"),
    );
    await assert.rejects(
      loadEnvironment("dev", { sandboxRoot }),
      /目录职责重叠/,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("公开配置文件名由客户端契约提供，环境配置拒绝另行声明", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "tavern-public-path-contract-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  config.defaults.publicFiles = {
    web: ["renamed.json"],
    "user-web": ["application.json", "runtime-policy.json"],
    studio: [],
  };
  const configPath = join(directory, "environments.json");
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(loadEnvironment("dev", { configPath }), (error) => {
    assert.ok(error.message.includes(configPath));
    assert.match(error.message, /defaults.publicFiles/);
    assert.match(error.message, /renamed.json/);
    return true;
  });
});

test("配置诊断指出冲突字段、当前值和修正文件", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tavern-config-diagnostics-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = JSON.parse(
    await readFile(
      join(sourceRoot, "config/environments.example.json"),
      "utf8",
    ),
  );
  const cases = [
    {
      name: "目录职责重叠",
      change: (config) => {
        config.defaults.layout.backups = "data";
      },
      fragments: ["defaults.layout.data", "defaults.layout.backups", "data"],
    },
    {
      name: "越界目录",
      change: (config) => {
        config.defaults.layout.backups = "data/../backups";
      },
      fragments: ["defaults.layout.backups", "data/../backups"],
    },
    {
      name: "重复进程标识",
      change: (config) => {
        config.environments.prod.processPrefix =
          config.environments.dev.processPrefix;
      },
      fragments: [
        "environments.prod.processPrefix",
        "environments.dev.processPrefix",
        original.environments.dev.processPrefix,
      ],
    },
    {
      name: "环境根目录重叠",
      change: (config) => {
        config.environments.prod.root = join(
          config.environments.dev.root,
          "nested",
        );
      },
      fragments: [
        "environments.prod.root",
        "environments.dev.root",
        join(original.environments.dev.root, "nested"),
      ],
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const config = structuredClone(original);
      item.change(config);
      const configPath = join(directory, item.name + ".json");
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(loadEnvironment("dev", { configPath }), (error) => {
        for (const fragment of [...item.fragments, configPath, "请修改"])
          assert.ok(
            error.message.includes(fragment),
            error.message + " 缺少 " + fragment,
          );
        return true;
      });
    });
  }
});

test("验证目录错误指出输入值、冲突目录和可用参数示例", async () => {
  for (const sandboxRoot of ["relative-sandbox", join(sourceRoot, "sandbox")]) {
    await assert.rejects(loadEnvironment("dev", { sandboxRoot }), (error) => {
      assert.ok(error.message.includes(sandboxRoot));
      assert.match(error.message, /--sandbox/);
      assert.match(
        error.message,
        /示例：node scripts\/environments\/cli.mjs verify/,
      );
      if (sandboxRoot.startsWith("/")) {
        assert.ok(error.message.includes(sourceRoot));
        assert.match(error.message, /sourceRoot/);
      }
      return true;
    });
  }
});

test("越界存储符号链接诊断指出配置字段和实际路径", async (t) => {
  const sandboxRoot = await mkdtemp(
    join(tmpdir(), "tavern-storage-diagnostics-"),
  );
  t.after(() => rm(sandboxRoot, { recursive: true, force: true }));
  const configPath = join(sourceRoot, "apps/api/config/storage.json");
  const storage = JSON.parse(await readFile(configPath, "utf8"));
  const link = join(sandboxRoot, "dev/data", storage.roleAssetsDir);
  await mkdir(dirname(link), { recursive: true });
  await symlink(join(sandboxRoot, "prod/data/assets"), link);
  await assert.rejects(loadEnvironment("dev", { sandboxRoot }), (error) => {
    for (const fragment of [
      configPath,
      "roleAssetsDir",
      storage.roleAssetsDir,
      link,
      "请修改",
    ])
      assert.ok(
        error.message.includes(fragment),
        error.message + " 缺少 " + fragment,
      );
    return true;
  });
});
