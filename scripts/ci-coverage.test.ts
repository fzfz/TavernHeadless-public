import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const { parse } = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
)("yaml");
type Step = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
};
type Job = {
  name: string;
  if: string;
  needs: string | string[];
  steps: Step[];
  outputs?: Record<string, string>;
  strategy?: { "fail-fast": boolean; matrix: { slice: number[] } };
};
type TestReport = {
  numTotalTests: number;
  testResults: { assertionResults: { fullName: string; status: string }[] }[];
};
const workflow = parse(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
) as { jobs: Record<string, Job> };
const directories: string[] = [];
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== "NODE_V8_COVERAGE" && !key.startsWith("VITEST"),
  ),
);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ci-coverage-"));
  directories.push(directory);
  return directory;
}

function step(job: string, name: string) {
  const result = workflow.jobs[job]?.steps.find(
    (candidate) => candidate.name === name,
  );
  expect(result, `${job} must expose the ${name} step`).toBeDefined();
  return result!;
}

function runStep(name: string, directory: string, env: Record<string, string>) {
  const command = step("coverage", name).run;
  expect(command).toBeTypeOf("string");
  return spawnSync("bash", ["-e", "-o", "pipefail", "-c", command!], {
    cwd: directory,
    env: { ...childEnv, ...env },
    encoding: "utf8",
  });
}

function reportSet(names: readonly string[]) {
  const directory = fixture();
  mkdirSync(join(directory, ".vitest-reports"));
  for (const name of names)
    writeFileSync(join(directory, ".vitest-reports", name), "{}");
  return directory;
}

function vitestFixture() {
  const directory = fixture();
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(directory, "node_modules"),
    "dir",
  );
  mkdirSync(join(directory, "src"));
  writeFileSync(
    join(directory, "vitest.config.mjs"),
    `export default { test: { coverage: { provider: "v8", include: ["src/*.mjs"], exclude: ["src/excluded.mjs"] } } };\n`,
  );
  writeFileSync(
    join(directory, "src/source.mjs"),
    `export function label(value) { if (value === 1) return "one"; if (value === 2) return "two"; return "other"; }\n`,
  );
  writeFileSync(
    join(directory, "src/untested.mjs"),
    `export function untested(value) { return value ? 1 : 2; }\n`,
  );
  writeFileSync(
    join(directory, "src/excluded.mjs"),
    `export const excluded = 42;\n`,
  );
  for (const [index, expected] of [
    "one",
    "two",
    "other",
    "other",
    "other",
    "other",
  ].entries()) {
    writeFileSync(
      join(directory, `${index + 1}.test.mjs`),
      `import { test, expect } from "vitest"; import { label } from "./src/source.mjs"; test("case ${index + 1}", () => expect(label(${index + 1})).toBe("${expected}"));\n`,
    );
  }
  return directory;
}

function vitestArgs(job: string, name: string) {
  const tokens = step(job, name)
    .run!.replace(/\$\{\{\s*matrix.slice\s*\}\}/g, "SLICE")
    .replace(/\$\{\{\s*strategy.job-total\s*\}\}/g, "6")
    .split(/\s+/);
  expect(tokens.splice(0, 3)).toEqual(["pnpm", "exec", "vitest"]);
  return tokens;
}

function runVitest(directory: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      ...args,
    ],
    { cwd: directory, env: childEnv, encoding: "utf8" },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

function jsonFile<T>(directory: string, name: string): T {
  return JSON.parse(readFileSync(join(directory, name), "utf8")) as T;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("CI coverage reports", () => {
  const complete = [
    "blob-1-6.json",
    "blob-2-6.json",
    "blob-3-6.json",
    "blob-4-6.json",
    "blob-5-6.json",
    "blob-6-6.json",
  ];

  it.each([
    ["complete", complete, "6", 0],
    ["missing", complete.slice(0, 5), "6", 1],
    ["empty", [], "6", 1],
    ["extra", [...complete, "blob-7-6.json"], "6", 1],
    ["wrong index", [...complete.slice(0, 5), "blob-7-6.json"], "6", 1],
    [
      "wrong denominator",
      complete.map((name) => name.replace("-6.json", "-5.json")),
      "6",
      1,
    ],
    ["wrong count", complete, "5", 1],
    ["missing count", complete, "", 1],
    ["fractional count", complete, "1.5", 1],
    ["zero count", complete, "0", 1],
  ] as const)(
    "handles the %s report set before merging",
    (_label, names, count, status) => {
      const result = runStep("Verify complete report set", reportSet(names), {
        COVERAGE_SHARD_COUNT: count,
      });
      expect(result.status, result.stderr).toBe(status);
    },
  );

  it.each(["success", "failure", "cancelled", "skipped"])(
    "propagates the %s coverage slice result",
    (result) => {
      const aggregate = workflow.jobs.coverage;
      expect(aggregate.needs).toBe("coverage-slices");
      expect(aggregate.if).toContain("always()");
      expect(aggregate.steps[0]).toBe(
        step("coverage", "Require every coverage slice"),
      );
      expect(aggregate.steps[0].env?.SLICE_RESULT).toBe(
        "${{ needs.coverage-slices.result }}",
      );
      expect(
        runStep("Require every coverage slice", fixture(), {
          SLICE_RESULT: result,
        }).status,
      ).toBe(result === "success" ? 0 : 1);
    },
  );

  it("keeps six independent slices and transfers every report across retries", () => {
    const slices = workflow.jobs["coverage-slices"];
    expect(slices.strategy).toEqual({
      "fail-fast": false,
      matrix: { slice: [1, 2, 3, 4, 5, 6] },
    });
    expect(slices.outputs?.shard_count).toBe("${{ strategy.job-total }}");
    expect(
      step("coverage", "Verify complete report set").env?.COVERAGE_SHARD_COUNT,
    ).toBe("${{ needs.coverage-slices.outputs.shard_count }}");
    expect(step("coverage-slices", "Collect coverage slice").run).toContain(
      "--shard=${{ matrix.slice }}/${{ strategy.job-total }}",
    );
    expect(step("coverage-slices", "Save coverage slice").with).toMatchObject({
      name: "coverage-blob-${{ matrix.slice }}",
      path: ".vitest-reports/blob-${{ matrix.slice }}-${{ strategy.job-total }}.json",
      overwrite: true,
      "include-hidden-files": true,
      "if-no-files-found": "error",
    });
    expect(step("coverage", "Download coverage slices").with).toMatchObject({
      pattern: "coverage-blob-*",
      path: ".vitest-reports",
      "merge-multiple": true,
    });
    expect(step("coverage", "Save coverage summary").with).toMatchObject({
      path: "coverage/coverage-summary.json",
      overwrite: true,
      "if-no-files-found": "error",
    });
  });

  it("merges all six slices with the full run's test results and coverage scope", () => {
    const directory = vitestFixture();
    const sliceArgs = vitestArgs("coverage-slices", "Collect coverage slice");
    const full = runVitest(directory, [
      ...sliceArgs.filter(
        (arg) => !arg.startsWith("--shard=") && arg !== "--reporter=blob",
      ),
      "--coverage.reporter=json-summary",
      "--coverage.reportsDirectory=full",
      "--reporter=json",
      "--outputFile.json=full-tests.json",
    ]);
    expect(full.status, full.output).toBe(0);
    for (const index of workflow.jobs["coverage-slices"].strategy!.matrix
      .slice) {
      const slice = runVitest(
        directory,
        sliceArgs.map((arg) => arg.replace("SLICE", String(index))),
      );
      expect(slice.status, slice.output).toBe(0);
    }
    expect(
      runStep("Verify complete report set", directory, {
        COVERAGE_SHARD_COUNT: "6",
      }).status,
    ).toBe(0);
    const merge = runVitest(directory, [
      ...vitestArgs("coverage", "Merge coverage"),
      "--coverage.reporter=json",
      "--coverage.reportsDirectory=merged",
      "--reporter=json",
      "--outputFile.json=merged-tests.json",
    ]);
    expect(merge.status, merge.output).toBe(0);
    const fullReport = jsonFile<TestReport>(directory, "full-tests.json");
    const mergedReport = jsonFile<TestReport>(directory, "merged-tests.json");
    const assertions = (report: TestReport) =>
      report.testResults
        .flatMap((file) => file.assertionResults)
        .map(({ fullName, status }) => ({ fullName, status }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    expect(fullReport.numTotalTests).toBe(6);
    expect(mergedReport.numTotalTests).toBe(6);
    expect(assertions(mergedReport)).toEqual(assertions(fullReport));
    const fullCoverage = jsonFile<Record<string, unknown>>(
      directory,
      "full/coverage-final.json",
    );
    expect(jsonFile(directory, "merged/coverage-final.json")).toEqual(
      fullCoverage,
    );
    expect(
      Object.keys(fullCoverage)
        .map((name) => name.split("/").at(-1))
        .sort(),
    ).toEqual(["source.mjs", "untested.mjs"]);
    const summary = jsonFile<Record<string, { lines: { covered: number } }>>(
      directory,
      "merged/coverage-summary.json",
    );
    const untested = Object.keys(fullCoverage).find((name) =>
      name.endsWith("/src/untested.mjs"),
    )!;
    expect(summary[untested].lines.covered).toBe(0);
  }, 30_000);

  it("preserves a failed assertion through blob collection and merge", () => {
    const directory = vitestFixture();
    writeFileSync(
      join(directory, "failure.test.mjs"),
      `import { test, expect } from "vitest"; test("failing assertion", () => expect(1).toBe(2));\n`,
    );
    const failed = runVitest(directory, [
      ...vitestArgs("coverage-slices", "Collect coverage slice").filter(
        (arg) => !arg.startsWith("--shard="),
      ),
      "failure.test.mjs",
    ]);
    expect(failed.status, failed.output).toBe(1);
    const merge = runVitest(
      directory,
      vitestArgs("coverage", "Merge coverage"),
    );
    expect(merge.status, merge.output).toBe(1);
    expect(merge.output).toContain("failing assertion");
  });
});
