import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { main as markdownlint } from "markdownlint-cli2";

const runFile = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function identity(issue) {
  return JSON.stringify([
    issue.file,
    issue.rule,
    issue.sourceLine,
    issue.detail,
    issue.context,
    issue.range,
  ]);
}

function validateBaseline(baseline) {
  if (
    baseline.formatVersion !== 1 ||
    !Array.isArray(baseline.issues) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(baseline.approval?.date) ||
    typeof baseline.approval?.commit !== "string" ||
    !Number.isInteger(baseline.approval?.issues) ||
    !Number.isInteger(baseline.approval?.files)
  ) {
    throw new Error(
      "Invalid baseline metadata. Restore the approved baseline JSON.",
    );
  }
  const identities = new Set();
  let count = 0;
  for (const [index, issue] of baseline.issues.entries()) {
    if (
      typeof issue.file !== "string" ||
      path.isAbsolute(issue.file) ||
      issue.file.split("/").includes("..") ||
      !/^MD\d{3}$/.test(issue.rule) ||
      typeof issue.sourceLine !== "string" ||
      !(issue.detail === null || typeof issue.detail === "string") ||
      !(issue.context === null || typeof issue.context === "string") ||
      !(
        issue.range === null ||
        (Array.isArray(issue.range) &&
          issue.range.length === 2 &&
          issue.range.every((value) => Number.isInteger(value) && value > 0))
      ) ||
      !Number.isInteger(issue.count) ||
      issue.count < 1 ||
      identities.has(identity(issue))
    ) {
      throw new Error(
        `Invalid baseline entry ${index + 1}. Restore the approved entry or remove a repaired entry.`,
      );
    }
    identities.add(identity(issue));
    count += issue.count;
  }
  if (
    count > baseline.approval.issues ||
    new Set(baseline.issues.map((issue) => issue.file)).size >
      baseline.approval.files
  ) {
    throw new Error(
      "Baseline exceeds the approved issue or file count. Restore the approved baseline JSON.",
    );
  }
}

async function check({ root, baseline: baselinePath, report: reportPath }) {
  if (baselinePath === reportPath) {
    throw new Error(
      "The report path must differ from the baseline path. Use --report /tmp/docs-lint-report.json.",
    );
  }
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  validateBaseline(baseline);
  const remaining = new Map(
    baseline.issues.map((issue) => [identity(issue), { ...issue }]),
  );
  const { stdout } = await runFile(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "*.md",
    ],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  const files = [...new Set(stdout.split("\0").filter(Boolean))].filter(
    (file) => !file.split("/").includes("node_modules"),
  );
  const sources = new Map();
  for (const file of files) {
    try {
      sources.set(
        file,
        (await readFile(path.join(root, file), "utf8")).split(/\r?\n/),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let results = [];
  if (sources.size > 0) {
    await markdownlint({
      directory: root,
      argv: [...sources.keys()].map(
        (file) => `./${file.replace(/([[\]{}()*?\\!+@])/g, "\\$1")}`,
      ),
      noGlobs: true,
      optionsOverride: {
        fix: false,
        outputFormatters: [
          [
            ({ results: findings }) => {
              results = findings;
            },
          ],
        ],
      },
    });
  }
  const existing = [];
  const added = [];
  for (const result of results) {
    const issue = {
      file: result.fileName,
      rule: result.ruleNames[0],
      sourceLine: sources.get(result.fileName)[result.lineNumber - 1],
      detail: result.errorDetail,
      context: result.errorContext,
      range: result.errorRange,
    };
    const allowance = remaining.get(identity(issue));
    const target = allowance?.count > 0 ? existing : added;
    if (target === existing) allowance.count--;
    target.push({ ...issue, lineNumber: result.lineNumber });
  }
  const stale = [...remaining.values()].filter((issue) => issue.count > 0);
  const summary = {
    filesChecked: sources.size,
    approvedIssues: baseline.issues.reduce(
      (sum, issue) => sum + issue.count,
      0,
    ),
    existingIssues: existing.length,
    newIssues: added.length,
    staleIssues: stale.reduce((sum, issue) => sum + issue.count, 0),
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        approval: baseline.approval,
        summary,
        existing,
        new: added,
        stale,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `docs:lint: ${summary.existingIssues} existing, ${summary.newIssues} new, ${summary.staleIssues} stale. Report: ${reportPath}\n`,
  );
  if (summary.staleIssues > 0) {
    process.stderr.write(
      "Remove the repaired entries from the approved baseline, then rerun pnpm docs:lint.\n",
    );
  }
  return summary.newIssues > 0 || summary.staleIssues > 0 ? 1 : 0;
}

try {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      root: { type: "string", default: repositoryRoot },
      baseline: { type: "string" },
      report: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout
      .write(`Check repository Markdown against the approved issue baseline.
Usage: node scripts/docs-lint.mjs [options]
  --root <string>      Optional repository path; defaults to this script's repository.
  --baseline <string>  Optional JSON path; defaults to <root>/docs/provenance/markdownlint-baseline.json.
  --report <string>    Optional JSON output path; defaults to a unique OS temporary directory.
  --help, -h          Show this help.
Example: pnpm docs:lint --report /tmp/docs-lint-report.json
Exit codes: 0 = baseline matched; 1 = new or stale issues; 2 = input or tool failure.
`);
  } else {
    const root = path.resolve(values.root);
    const baseline = path.resolve(
      values.baseline ??
        path.join(root, "docs/provenance/markdownlint-baseline.json"),
    );
    const report = values.report
      ? path.resolve(values.report)
      : path.join(
          await mkdtemp(path.join(tmpdir(), "tavern-docs-lint-")),
          "report.json",
        );
    process.exitCode = await check({ root, baseline, report });
  }
} catch (error) {
  process.stderr.write(
    `docs:lint failed: ${error.message}\nRun node scripts/docs-lint.mjs --help for usage.\n`,
  );
  process.exitCode = 2;
}
