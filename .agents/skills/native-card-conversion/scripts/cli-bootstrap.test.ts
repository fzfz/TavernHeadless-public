import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { v2Card } from "./source-fixtures.ts";
import { pngCard } from "./source-config.ts";
import {
  testRuntime,
  testResources,
  withTestResources,
} from "./test-resources.ts";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
let isolated: string;
let entry: string;
beforeAll(async () => {
  isolated = await mkdtemp(join(tmpdir(), "card source checkout "));
  for (const path of [
    ".agents/skills/native-card-conversion",
    "apps/api",
    "packages",
    "tsconfig.json",
    "tsconfig.base.json",
    "package.json",
  ]) {
    await cp(join(repository, path), join(isolated, path), {
      recursive: true,
      filter: (source) =>
        !source
          .split("/")
          .some(
            (part) =>
              part === "node_modules" ||
              part.startsWith("dist") ||
              part.endsWith(".tsbuildinfo"),
          ),
    });
  }
  const workspaces = [
    "apps/api",
    "packages/core",
    "packages/shared",
    "packages/adapters-sillytavern",
    "packages/official-integration-kit/sdk",
    "packages/official-integration-kit/client-helpers",
  ];
  const packages = new Map<string, string>();
  for (const workspace of workspaces) {
    const manifest = JSON.parse(
      await readFile(join(isolated, workspace, "package.json"), "utf8"),
    );
    packages.set(manifest.name, join(isolated, workspace));
  }
  async function linkDependencies(source: string, target: string, scope = "") {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) {
      if (name.startsWith("@") && !scope) {
        await linkDependencies(join(source, name), join(target, name), name);
      } else {
        const packageName = scope ? `${scope}/${name}` : name;
        await symlink(
          packages.get(packageName) ?? join(source, name),
          join(target, name),
        );
      }
    }
  }
  for (const workspace of ["", ...workspaces]) {
    await linkDependencies(
      join(repository, workspace, "node_modules"),
      join(isolated, workspace, "node_modules"),
    );
  }
  entry = join(
    isolated,
    ".agents/skills/native-card-conversion/scripts/convert.mjs",
  );
}, testRuntime.integrationTimeoutMs);
afterAll(async () => {
  if (isolated) await rm(isolated, { recursive: true, force: true });
}, testRuntime.cleanupTimeoutMs);

function pngSource(json: string): Buffer {
  const chunk = (type: string, data = Buffer.alloc(0)) => {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    bytes.write(type, 4, "ascii");
    data.copy(bytes, 8);
    return bytes;
  };
  return Buffer.concat([
    Buffer.from(pngCard.signature),
    chunk("IHDR", Buffer.alloc(13)),
    chunk(
      "tEXt",
      Buffer.from("chara\0" + Buffer.from(json).toString("base64")),
    ),
    chunk("IEND"),
  ]);
}

it.each(["repository", "external", "spaces", "caller-config"] as const)(
  "uses isolated source dependencies from %s with relative JSON and PNG inputs",
  withTestResources(async (location) => {
    const caller =
      location === "repository"
        ? join(isolated, "caller")
        : await mkdtemp(
            join(
              tmpdir(),
              location === "spaces" ? "card caller " : "card-caller-",
            ),
          );
    await mkdir(caller, { recursive: true });
    testResources().addDirectory(caller);
    if (location === "caller-config") {
      await writeFile(
        join(caller, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            paths: { "@tavern/shared": ["./caller-shared.ts"] },
          },
        }),
      );
      await writeFile(
        join(caller, "caller-shared.ts"),
        'throw new Error("CALLER_CONFIG_USED");',
      );
    }
    const env = { ...process.env };
    delete env.TSX_TSCONFIG_PATH;
    delete env.NODE_OPTIONS;
    async function cli(...args: string[]) {
      const running = execute(process.execPath, [entry, ...args], {
        cwd: caller,
        env,
        timeout: testRuntime.processTimeoutMs,
        killSignal: "SIGKILL",
      });
      testResources().trackChild(running.child);
      const { stdout, stderr } = await testResources().measure(
        `cli:${args[0]}`,
        () =>
          running.catch(async (error: Error & { stderr?: string }) => {
            if (error.stderr) {
              const reference = JSON.parse(error.stderr);
              if (reference.diagnosticFile)
                throw new Error(
                  await readFile(reference.diagnosticFile, "utf8"),
                  { cause: error },
                );
            }
            throw error;
          }),
      );
      expect(stderr).toBe("");
      const result = JSON.parse(
        await readFile(JSON.parse(stdout).resultFile, "utf8"),
      );
      expect(result, JSON.stringify(result)).toMatchObject({ passed: true });
      return result.data;
    }
    for (const extension of ["json", "png"]) {
      const name = `source.${extension}`;
      const json = JSON.stringify(
        v2Card({
          name: "调用目录角色",
          description: "在码头值班。",
          first_mes: "你好。",
        }),
      );
      await writeFile(
        join(caller, name),
        extension === "json" ? json : pngSource(json),
      );
      const result = await cli("begin", name);
      testResources().addDirectory(dirname(result.taskFile));
      const task = JSON.parse(await readFile(result.taskFile, "utf8"));
      expect(task.originalSourceFile).toBe(await realpath(join(caller, name)));
      expect(
        JSON.parse(await readFile(task.sourceFile, "utf8")).data.name,
      ).toBe("调用目录角色");
      if (location === "caller-config" && extension === "png") {
        await cli(
          "copy",
          result.taskFile,
          "/data/first_mes",
          "openings/default.txt",
        );
        await writeFile(
          join(task.packageDirectory, "openings.json"),
          JSON.stringify({
            defaultOpeningIds: { individual: "default" },
            items: [
              {
                id: "default",
                title: "开场",
                summary: "角色向访客问好。",
                kind: "story",
                audience: "individual",
                textFile: "openings/default.txt",
              },
            ],
          }),
        );
        await mkdir(join(task.packageDirectory, "frontend"), {
          recursive: true,
        });
        for (const [path, content] of Object.entries({
          "manifest.json": JSON.stringify({
            apiVersion: 1,
            html: "frontend/index.html",
            css: "frontend/style.css",
            script: "frontend/main.js",
            assets: {},
            data: {},
          }),
          "index.html": "<main>调用目录角色</main>",
          "style.css": "main { color: black; }",
          "main.js":
            "export function mount({ api }) { api.ui.register('main', { elements: {} }); }",
        }))
          await writeFile(
            join(task.packageDirectory, "frontend", path),
            content,
          );
        await cli(
          "index",
          result.taskFile,
          "--frontend",
          "frontend/manifest.json",
        );
        await cli("validate", result.taskFile);
        const packed = await cli("pack", result.taskFile);
        expect((await readFile(packed.archive)).length).toBeGreaterThan(0);
        const formal = await cli(
          "formal",
          result.taskFile,
          "--archive",
          packed.archive,
        );
        expect(formal).toMatchObject({ passed: true, status: "passed" });
        const readback = JSON.parse(
          await readFile(formal.readbackPath, "utf8"),
        );
        expect(readback.files.length).toBeGreaterThan(0);
        expect(
          readback.files.every((file: { equal: boolean }) => file.equal),
        ).toBe(true);
      }
    }
  }),
  testRuntime.integrationTimeoutMs,
);
