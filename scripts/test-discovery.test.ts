import nativeEnvironments from "../config/environments.example.json" with { type: "json" };
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== "NODE_V8_COVERAGE" && !key.startsWith("VITEST"),
  ),
);
const layout = nativeEnvironments.defaults.layout;
const runtimeDirectories = [
  layout.data,
  layout.releases,
  layout.current,
  layout.buildWork,
  layout.artifacts,
  layout.run,
  layout.processLogs,
  layout.operations,
  layout.backups,
];
const directories: string[] = [];

function write(directory: string, path: string, content: string) {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "test-discovery-")),
  );
  directories.push(directory);
  symlinkSync(
    join(root, "node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  write(directory, "package.json", JSON.stringify({ type: "module" }));
  for (const path of [
    "vitest.config.ts",
    ".agents/skills/native-card-conversion/scripts/runtime.json",
    "config/environments.example.json",
  ]) {
    write(directory, path, readFileSync(join(root, path), "utf8"));
  }
  const test =
    'import { test, expect } from "vitest"; test("source", () => expect(1).toBe(1));';
  write(
    directory,
    "packages/example/src/source.mjs",
    'export function label(value) { return value ? "one" : "other"; }\n',
  );
  write(
    directory,
    "packages/example/src/untested.mjs",
    "export function untested(value) { return value ? 1 : 2; }\n",
  );
  write(
    directory,
    "packages/example/src/Fixture.vue",
    '<script setup>const message = "fixture";</script>\n<template><p>{{ message }}</p></template>\n',
  );
  write(
    directory,
    "packages/example/src/source.test.mjs",
    'import { test, expect } from "vitest"; import { label } from "./source.mjs"; import Component from "./Fixture.vue"; test("source and Vue component", () => { expect(label(1)).toBe("one"); expect(Component.render).toBeTypeOf("function"); });\n',
  );
  for (const path of runtimeDirectories) {
    write(directory, `${path}/copy.test.mjs`, test);
    write(
      directory,
      `${path}/copy.mjs`,
      "export function runtimeCopy() { return 42; }\n",
    );
    write(directory, `packages/example/${path}/source.test.mjs`, test);
    write(
      directory,
      `packages/example/${path}/source.mjs`,
      "export function nestedSource() { return 42; }\n",
    );
  }
  return directory;
}

function vitest(directory: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      ...args,
      "--config",
      join(directory, "vitest.config.ts"),
      "--root",
      directory,
    ],
    { cwd: directory, env: childEnv, encoding: "utf8" },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("root Vitest discovery", () => {
  it("compiles a Vue component with the existing client transform", () => {
    vitest(fixture(), [
      "run",
      "packages/example/src/source.test.mjs",
      "--maxWorkers=1",
      "--reporter=dot",
    ]);
  });

  it("covers source files and retains untested source while excluding runtime copies", () => {
    const directory = fixture();
    vitest(directory, [
      "run",
      "--coverage",
      "--coverage.reporter=json-summary",
      "--maxWorkers=2",
      "--reporter=dot",
    ]);
    const summary = JSON.parse(
      readFileSync(join(directory, "coverage/coverage-summary.json"), "utf8"),
    ) as Record<string, { lines: { covered: number } }>;
    const files = Object.keys(summary)
      .filter((file) => file !== "total")
      .map((file) => relative(directory, file));
    expect(files.sort()).toEqual(
      [
        "packages/example/src/Fixture.vue",
        "packages/example/src/source.mjs",
        "packages/example/src/untested.mjs",
        ...runtimeDirectories.map(
          (path) => `packages/example/${path}/source.mjs`,
        ),
      ].sort(),
    );
    expect(
      summary[join(directory, "packages/example/src/source.mjs")].lines.covered,
    ).toBeGreaterThan(0);
    expect(
      summary[join(directory, "packages/example/src/untested.mjs")].lines
        .covered,
    ).toBe(0);
  });

  it("discovers source tests while excluding runtime copies at the repository root", () => {
    const directory = fixture();
    vitest(directory, ["list", "--filesOnly", "--json=discovered.json"]);
    const files = JSON.parse(
      readFileSync(join(directory, "discovered.json"), "utf8"),
    ) as { file: string }[];
    expect(files.map(({ file }) => relative(directory, file)).sort()).toEqual(
      [
        "packages/example/src/source.test.mjs",
        ...runtimeDirectories.map(
          (path) => `packages/example/${path}/source.test.mjs`,
        ),
      ].sort(),
    );
  });
});
