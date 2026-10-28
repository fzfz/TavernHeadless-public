import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const command = fileURLToPath(new URL("./docs-lint.mjs", import.meta.url));

async function fixture(t, issues = []) {
  const root = await mkdtemp(path.join(tmpdir(), "tavern-docs-lint-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "--quiet", root]).status, 0);
  const baselinePath = path.join(root, "baseline.json");
  const reportPath = path.join(root, "report.json");
  await writeFile(
    baselinePath,
    JSON.stringify({
      formatVersion: 1,
      approval: { date: "2026-10-27", commit: "fixture", issues: 1, files: 1 },
      issues,
    }),
  );
  const run = async (extraArgs = []) => {
    const result = spawnSync(
      process.execPath,
      [
        command,
        "--root",
        root,
        "--baseline",
        baselinePath,
        "--report",
        reportPath,
        ...extraArgs,
      ],
      { encoding: "utf8" },
    );
    let report;
    try {
      report = JSON.parse(await readFile(reportPath, "utf8"));
    } catch {
      // Assertions include process output when no report was produced.
    }
    return { ...result, report };
  };
  return { root, baselinePath, reportPath, run };
}

const approvedIssue = {
  file: "guide.md",
  rule: "MD047",
  sourceLine: "# Guide",
  detail: null,
  context: null,
  range: [7, 1],
  count: 1,
};

test("approved issues pass and detailed findings are written to the report", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "# Guide");
  const result = await sample.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.summary.existingIssues, 1);
  assert.equal(result.report.summary.newIssues, 0);
  assert.equal(result.report.summary.staleIssues, 0);
  assert.equal(result.report.existing[0].lineNumber, 1);
  assert.ok(result.stdout.includes(sample.reportPath));
  assert.ok(result.stdout.length < 600);
});

test("invalid baseline entries fail before linting and leave the baseline unchanged", async (t) => {
  const sample = await fixture(t, [{ ...approvedIssue, count: -1 }]);
  await writeFile(path.join(sample.root, "guide.md"), "# Guide");
  const before = await readFile(sample.baselinePath, "utf8");
  const result = await sample.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /baseline/i);
  assert.equal(await readFile(sample.baselinePath, "utf8"), before);
});

test("the report cannot overwrite the approved baseline", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "# Guide");
  const before = await readFile(sample.baselinePath, "utf8");
  const result = await sample.run(["--report", sample.baselinePath]);
  assert.equal(result.status, 2);
  assert.equal(await readFile(sample.baselinePath, "utf8"), before);
});

test("a different issue with the same total is reported as new", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "# Other");
  const result = await sample.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.summary.existingIssues, 0);
  assert.equal(result.report.summary.newIssues, 1);
  assert.equal(result.report.summary.staleIssues, 1);
  assert.equal(result.report.new[0].sourceLine, "# Other");
});

test("a new untracked document cannot use another document's allowance", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "# Guide");
  await writeFile(path.join(sample.root, "another.md"), "# Guide");
  const result = await sample.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.summary.existingIssues, 1);
  assert.equal(result.report.summary.newIssues, 1);
  assert.equal(result.report.new[0].file, "another.md");
});

test("a different rule cannot replace an approved issue", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "# Guide\n\n# Other\n");
  const result = await sample.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.summary.newIssues, 1);
  assert.equal(result.report.new[0].rule, "MD025");
  assert.equal(result.report.summary.staleIssues, 1);
});

test("a different error context cannot use an approved issue's allowance", async (t) => {
  const sample = await fixture(t, [
    {
      file: "guide.md",
      rule: "MD034",
      sourceLine: "https://example.com",
      detail: null,
      context: "https://example.com",
      range: [1, 19],
      count: 1,
    },
  ]);
  await writeFile(
    path.join(sample.root, "guide.md"),
    "# Guide\n\nhttps://example.org\n",
  );
  const result = await sample.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.summary.existingIssues, 0);
  assert.equal(result.report.summary.newIssues, 1);
  assert.equal(result.report.summary.staleIssues, 1);
  assert.equal(result.report.new[0].context, "https://example.org");
});

test("an extra occurrence fails even when its fields match an approved occurrence", async (t) => {
  const sourceLine = `${"a ".repeat(40)}a`;
  const sample = await fixture(t, [
    {
      file: "guide.md",
      rule: "MD013",
      sourceLine,
      detail: "Expected: 80; Actual: 81",
      context: null,
      range: [81, 1],
      count: 1,
    },
  ]);
  await writeFile(
    path.join(sample.root, "guide.md"),
    `# Guide\n\n${sourceLine}\n\n${sourceLine}\n`,
  );
  const result = await sample.run();
  assert.equal(result.status, 1);
  assert.equal(result.report.summary.existingIssues, 1);
  assert.equal(result.report.summary.newIssues, 1);
});

test("repaired issues require baseline pruning and fail if reintroduced afterwards", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  const guide = path.join(sample.root, "guide.md");
  await writeFile(guide, "# Guide\n");
  const repaired = await sample.run();
  assert.equal(repaired.status, 1);
  assert.equal(repaired.report.summary.staleIssues, 1);
  assert.equal(repaired.report.stale[0].rule, "MD047");
  assert.match(repaired.stderr, /Remove the repaired entries/);
  const baseline = JSON.parse(await readFile(sample.baselinePath, "utf8"));
  baseline.issues = [];
  await writeFile(sample.baselinePath, JSON.stringify(baseline));
  const pruned = await sample.run();
  assert.equal(pruned.status, 0, pruned.stderr);
  await writeFile(guide, "# Guide");
  const reintroduced = await sample.run();
  assert.equal(reintroduced.status, 1);
  assert.equal(reintroduced.report.summary.newIssues, 1);
  assert.equal(reintroduced.report.summary.staleIssues, 0);
});

test("Git ignores runtime artifacts while staged source documents are checked", async (t) => {
  const sample = await fixture(t);
  await writeFile(path.join(sample.root, ".gitignore"), "*.md\n");
  await writeFile(path.join(sample.root, "artifact.md"), "# Artifact");
  const ignored = await sample.run();
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.equal(ignored.report.summary.filesChecked, 0);
  await writeFile(path.join(sample.root, "source.md"), "# Source");
  assert.equal(
    spawnSync("git", ["add", "--force", "source.md"], { cwd: sample.root })
      .status,
    0,
  );
  const staged = await sample.run();
  assert.equal(staged.status, 1);
  assert.equal(staged.report.summary.filesChecked, 1);
  assert.equal(staged.report.new[0].file, "source.md");
  await writeFile(path.join(sample.root, "source.md"), "# Source\n");
  const workingCopy = await sample.run();
  assert.equal(workingCopy.status, 0, workingCopy.stderr);
});

test("file names with spaces and glob characters are checked literally", async (t) => {
  const sample = await fixture(t);
  await writeFile(path.join(sample.root, "guide [draft].md"), "# Guide");
  const result = await sample.run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.report.summary.newIssues, 1);
  assert.equal(result.report.new[0].file, "guide [draft].md");
});

test("moving an approved issue to another line preserves its allowance", async (t) => {
  const sample = await fixture(t, [approvedIssue]);
  await writeFile(path.join(sample.root, "guide.md"), "\n# Guide");
  const result = await sample.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.existing[0].lineNumber, 2);
});

test("help describes options and exits without reading repository files", () => {
  const result = spawnSync(process.execPath, [command, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--root/);
  assert.match(result.stdout, /--baseline/);
  assert.match(result.stdout, /--report/);
});
