import { readFile, readdir, stat } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { assertOwnedPath } from "./config.mjs";
import { EnvironmentError } from "./errors.mjs";
import {
  assertNotAborted,
  beginOperation,
  getCurrentRelease,
  prepareRelease,
  runCommand,
  verifyReleaseRuntime,
  writeJson,
} from "./release.mjs";

const acceptance = JSON.parse(
  await readFile(new URL("./acceptance.json", import.meta.url), "utf8"),
);

async function runCheck(env, operation, checks, id, file, args, options = {}) {
  const evidencePath = join(operation.work, `${id.replaceAll(":", "-")}.log`);
  try {
    await runCommand(env, file, args, {
      cwd: env.sourceRoot,
      logPath: evidencePath,
      ...options,
    });
    checks.push({ id, status: "passed", evidencePath });
  } catch (error) {
    checks.push({ id, status: "failed", evidencePath, error: error.message });
    if (error.exitCode === 130) throw error;
  }
}

async function verifyUnit(env, operation, checks) {
  const environmentTests = (
    await readdir(join(env.sourceRoot, "scripts/environments"))
  )
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join(env.sourceRoot, "scripts/environments", name));
  if (!environmentTests.length)
    throw new EnvironmentError(
      "环境测试文件缺失，请恢复 scripts/environments 中的测试文件。",
      3,
    );
  await runCheck(
    env,
    operation,
    checks,
    "unit:environments",
    env.tools.node.path,
    ["--test", ...environmentTests],
  );
  for (const [index, file] of acceptance.unitTests.entries())
    await runCheck(
      env,
      operation,
      checks,
      `unit:native-${index + 1}`,
      env.tools.node.path,
      ["--test", join(env.sourceRoot, file)],
    );
}

async function probeEntries(env, operation, checks) {
  for (const frontend of env.frontends) {
    const port = env.ports.frontends[frontend].http;
    const specifications = [
      { id: "nginx", path: "/healthz", status: 204 },
      {
        id: "health",
        path: "/api/health",
        status: 200,
        json: { ok: true, service: "@tavern/api", database: "ready" },
      },
      { id: "page", path: "/", status: 200, html: true },
      ...env.publicFiles[frontend].map((file) => ({
        id: "config-" + file,
        path: "/config/" + file,
        status: 200,
        json: true,
        expectedFile: join(env.paths.publicConfig, frontend, file),
      })),
      {
        id: "missing-asset",
        path: "/assets/__environment-verification-missing__.js",
        status: 404,
      },
    ];
    if (frontend === "studio")
      specifications.push({
        id: "route",
        path: "/editor/verification",
        status: 200,
        html: true,
      });
    for (const specification of specifications) {
      assertNotAborted(env.signal);
      const id = `probe:${frontend}:${specification.id}`;
      const evidencePath = join(
        operation.work,
        id.replaceAll(":", "-") + ".json",
      );
      try {
        const response = await fetch(
          `http://${env.listenHost}:${port}${specification.path}`,
          {
            headers: { host: env.hostname },
            signal: AbortSignal.any([
              AbortSignal.timeout((env.timeouts.probeSeconds ?? 5) * 1000),
              ...(env.signal ? [env.signal] : []),
            ]),
            redirect: "error",
          },
        );
        const body = await response.text();
        let passed = response.status === specification.status;
        let actual;
        if (specification.json) {
          actual = JSON.parse(body);
          passed &&=
            typeof actual === "object" &&
            actual !== null &&
            !Array.isArray(actual);
          if (specification.json !== true)
            passed &&= Object.entries(specification.json).every(
              ([key, value]) => actual[key] === value,
            );
          if (specification.expectedFile)
            passed &&= isDeepStrictEqual(
              actual,
              JSON.parse(await readFile(specification.expectedFile, "utf8")),
            );
        }
        if (specification.html)
          passed &&=
            response.headers.get("content-type")?.includes("text/html") &&
            /<html[ >]/i.test(body);
        if (specification.html && passed) {
          const origin = `http://${env.hostname}:${port}`;
          let assetIndex = 0;
          for (const match of body.matchAll(
            /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/gi,
          )) {
            const asset = new URL(match[1], origin);
            if (
              asset.origin === origin &&
              (/[.](?:css|js|mjs|ts)$/.test(asset.pathname) ||
                asset.pathname === "/@vite/client")
            ) {
              specifications.push({
                id: specification.id + "-asset-" + ++assetIndex,
                path: asset.pathname + asset.search,
                status: 200,
                asset: true,
              });
            }
          }
        }
        if (specification.asset)
          passed &&=
            body.length > 0 &&
            !response.headers.get("content-type")?.includes("text/html");
        await writeJson(evidencePath, {
          frontend,
          path: specification.path,
          expectedStatus: specification.status,
          actualStatus: response.status,
          passed,
          ...(specification.json && specification.id === "health"
            ? { actual }
            : {}),
        });
        checks.push({ id, status: passed ? "passed" : "failed", evidencePath });
      } catch (error) {
        await writeJson(evidencePath, {
          frontend,
          path: specification.path,
          passed: false,
          error: error.message,
        });
        checks.push({ id, status: "failed", evidencePath });
      }
    }
  }
}

async function readAcceptanceEvidence(env, options, result, operation) {
  const required = acceptance.stages[env.name]?.required;
  if (!required)
    throw new EnvironmentError(
      "验收环境无效，请选择 dev、staging 或 prod。",
      2,
    );
  let index;
  const indexPath = options.evidence ? resolve(options.evidence) : null;
  try {
    if (indexPath) index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    /* Missing evidence is recorded per required item. */
  }
  const matches = (value) =>
    value?.schemaVersion === 1 &&
    value.environment === env.name &&
    value.release === result.release &&
    value.commit === result.commit;
  const indexValid =
    matches(index) &&
    index.operatorConfirmed === true &&
    Array.isArray(index.checks) &&
    index.checks.every(
      (check) =>
        check &&
        typeof check.id === "string" &&
        typeof check.evidencePath === "string",
    ) &&
    new Set(index.checks.map((check) => check.id)).size === index.checks.length;
  result.operatorConfirmed = Boolean(indexValid);
  result.evidenceIndexPath = indexPath;
  for (const id of required) {
    let evidencePath = join(operation.work, `missing-${id}.json`);
    const entry = indexValid && index.checks.find((check) => check.id === id);
    try {
      if (!entry || typeof entry.evidencePath !== "string")
        throw new Error("证据索引缺少该验收项，请补齐 evidencePath。");
      evidencePath = resolve(dirname(indexPath), entry.evidencePath);
      const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      if (
        !matches(evidence) ||
        evidence.id !== id ||
        !["passed", "failed"].includes(evidence.status)
      )
        throw new Error("证据文件的验收编号、环境、版本或状态不匹配。");
      if (
        !Array.isArray(evidence.commands) ||
        evidence.commands.length === 0 ||
        !evidence.commands.every(
          (command) =>
            typeof command.file === "string" &&
            command.file &&
            Array.isArray(command.args) &&
            command.args.every((argument) => typeof argument === "string"),
        )
      )
        throw new Error("证据文件缺少 commands 命令参数。");
      for (const field of ["preconditions", "expected", "actual"])
        if (
          evidence[field] === undefined ||
          evidence[field] === null ||
          evidence[field] === ""
        )
          throw new Error(`证据文件缺少 ${field}。`);
      if (!Array.isArray(evidence.logs) || evidence.logs.length === 0)
        throw new Error("证据文件缺少 logs 日志路径。");
      for (const path of evidence.logs) {
        if (typeof path !== "string")
          throw new Error("logs 中的路径必须为字符串。");
        if (!(await stat(resolve(dirname(evidencePath), path))).isFile())
          throw new Error("日志路径必须指向普通文件。");
      }
      result.checks.push({ id, status: evidence.status, evidencePath });
    } catch (error) {
      const diagnosticPath = join(operation.work, `missing-${id}.json`);
      await writeJson(diagnosticPath, {
        id,
        expectedEnvironment: env.name,
        release: result.release,
        commit: result.commit,
        evidencePath: entry?.evidencePath ?? null,
        error: error.message,
      });
      result.checks.push({
        id,
        status: "missing",
        evidencePath: diagnosticPath,
      });
    }
  }
}

function checkEnvironment(env) {
  return {
    ...env.hostEnv,
    CI: "true",
    PATH: [
      dirname(env.tools.node.path),
      dirname(env.tools.pnpm.path),
      env.hostEnv.PATH ?? "",
    ].join(delimiter),
  };
}

async function verifyFull(env, options, operation, checks) {
  const projectChecks = JSON.parse(
    await readFile(
      join(env.sourceRoot, "docs/agents/development-checks.json"),
      "utf8",
    ),
  );
  const commands = { ...projectChecks, ...acceptance.fullCommands };
  const selected = options.checks
    ? (Array.isArray(options.checks)
        ? options.checks
        : options.checks.split(",")
      )
        .map((value) => value.trim())
        .filter(Boolean)
    : [...Object.keys(commands), "unit"];
  if (
    !selected.length ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !(id in commands) && id !== "unit")
  )
    throw new EnvironmentError(
      `checks 无效。可用值：${[...Object.keys(commands), "unit"].join("、")}。`,
      2,
    );
  for (const id of selected) {
    if (id === "unit") await verifyUnit(env, operation, checks);
    else {
      await runCheck(
        env,
        operation,
        checks,
        id,
        "/bin/sh",
        ["-c", commands[id]],
        { environment: checkEnvironment(env) },
      );
      if (id === "generated" && checks.at(-1).status === "passed")
        await runCheck(
          env,
          operation,
          checks,
          "generated:tracked-files",
          "git",
          [
            "diff",
            "--exit-code",
            "--",
            "packages/shared/src/generated",
            "apps/api/openapi",
          ],
          { environment: checkEnvironment(env) },
        );
    }
  }
}

async function verifyBusinessFixtures(env, operation, checks) {
  for (const path of acceptance.businessFixtures) {
    const exists = await stat(join(env.sourceRoot, path)).then(
      (value) => value.isFile(),
      () => false,
    );
    if (!exists)
      throw new EnvironmentError(
        `业务验收夹具缺失：${path}。请恢复该测试文件后重试。`,
        3,
      );
  }
  await runCheck(
    env,
    operation,
    checks,
    "business:fixtures",
    env.tools.pnpm.path,
    ["exec", "vitest", "run", ...acceptance.businessFixtures, "--reporter=dot"],
    { environment: checkEnvironment(env) },
  );
}

async function verifyRelease(env, options, result, operation) {
  if (!options.release)
    throw new EnvironmentError("发布产物验证需要 --release <releaseId>。", 3);
  const prepared = await prepareRelease(env, {
    release: options.release,
    artifact: options.artifact,
    operationId: operation.operationId,
  });
  result.commit = prepared.manifest.commit;
  result.artifactPath = prepared.archivePath;
  const evidencePath = join(operation.work, "release-runtime.json");
  const platform = await verifyReleaseRuntime(env, prepared, operation, {
    apiHealth: true,
  });
  await writeJson(evidencePath, {
    release: prepared.release,
    commit: result.commit,
    archivePath: prepared.archivePath,
    platform,
    frontends: env.frontends,
  });
  result.checks.push({ id: "release:runtime", status: "passed", evidencePath });
}

async function bindAcceptanceRelease(env, options, result, operation) {
  if (env.mode !== "release") return;
  const active = await getCurrentRelease(env);
  if (!active || active.release !== options.release)
    throw new EnvironmentError(
      "当前发布版本与 --release 不一致，请部署并启动目标版本后重试。",
      3,
    );
  const prepared = await prepareRelease(env, {
    release: options.release,
    operationId: operation.operationId,
  });
  if (
    resolve(active.directory) !== resolve(prepared.releaseDirectory) ||
    active.commit !== prepared.manifest.commit
  )
    throw new EnvironmentError(
      "current 的发布清单与原始归档不一致，请重新部署目标产物。",
      3,
    );
  result.commit = active.commit;
  result.artifactPath = prepared.archivePath;
}

export async function verifyEnvironment(env, options = {}) {
  env = { ...env, signal: options.signal ?? env.signal };
  assertNotAborted(env.signal);
  const { suite = "unit" } = options;
  if (!["unit", "release", "acceptance", "full"].includes(suite))
    throw new EnvironmentError(
      "请选择 unit、release、acceptance 或 full 验证范围。",
      2,
    );
  if (options.checks && suite !== "full")
    throw new EnvironmentError("checks 仅适用于 full 范围。", 2);
  if (env.mode === "release" && !options.release)
    throw new EnvironmentError("发布环境验证需要 --release <releaseId>。", 3);
  const operation = await beginOperation(env, "verify", options.operationId);
  const outputDirectory = options.outputDirectory
    ? await assertOwnedPath(env.root, resolve(options.outputDirectory))
    : operation.work;
  const evidencePath = join(
    outputDirectory,
    suite === "acceptance"
      ? `${env.name}-acceptance.json`
      : "verification.json",
  );
  const result = {
    schemaVersion: 1,
    environment: env.name,
    release: options.release ?? null,
    commit: null,
    status: "running",
    suite,
    checks: [],
    startedAt: operation.startedAt,
    operationId: operation.operationId,
    artifactPath: null,
    ...(options.checks
      ? {
          selectedChecks: Array.isArray(options.checks)
            ? options.checks
            : options.checks.split(",").map((value) => value.trim()),
        }
      : {}),
  };
  let failure;
  try {
    result.commit = await runCommand(env, "git", ["rev-parse", "HEAD"], {
      cwd: env.sourceRoot,
      logPath: join(operation.work, "source.log"),
    });
    if (suite === "unit") await verifyUnit(env, operation, result.checks);
    else if (suite === "full")
      await verifyFull(env, options, operation, result.checks);
    else if (suite === "release")
      await verifyRelease(env, options, result, operation);
    else {
      await bindAcceptanceRelease(env, options, result, operation);
      await probeEntries(env, operation, result.checks);
      await readAcceptanceEvidence(env, options, result, operation);
      await verifyBusinessFixtures(env, operation, result.checks);
    }
  } catch (error) {
    failure = error;
    const diagnosticPath = join(operation.work, "failure.json");
    await writeJson(diagnosticPath, { error: error.message });
    result.checks.push({
      id: "verification",
      status: error.exitCode === 3 ? "missing" : "failed",
      evidencePath: diagnosticPath,
    });
  }
  result.status = result.checks.some((check) => check.status === "failed")
    ? "failed"
    : result.checks.some((check) => check.status === "missing")
      ? "incomplete"
      : "passed";
  result.finishedAt = new Date().toISOString();
  await writeJson(evidencePath, result);
  if (result.status !== "passed")
    throw new EnvironmentError(
      "验证未通过，请查看结果文件和逐项证据。",
      [2, 130].includes(failure?.exitCode)
        ? failure.exitCode
        : result.status === "incomplete"
          ? 3
          : 7,
      { evidencePath, ...(failure ? { reason: failure.message } : {}) },
    );
  return { ...result, evidencePath };
}
