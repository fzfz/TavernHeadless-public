import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function invoke(
  overrides: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "docs-release-"));
  directories.push(directory);
  const { stdout } = await exec("git", ["rev-parse", "HEAD"]);
  const run = {
    id: 123,
    name: "CI",
    path: ".github/workflows/ci.yml",
    event: "push",
    head_sha: stdout.trim(),
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "fzfz/TavernHeadless" },
    ...overrides,
  };
  const eventPath = join(directory, "event.json"),
    output = join(directory, "output"),
    environment = join(directory, "env");
  await Promise.all([
    writeFile(eventPath, JSON.stringify({ workflow_run: run })),
    writeFile(output, ""),
    writeFile(environment, ""),
  ]);
  const result = await exec(
    process.execPath,
    ["--import", "tsx", resolve("scripts/prepare-docs-release.ts")],
    {
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "workflow_run",
        GITHUB_REPOSITORY: "fzfz/TavernHeadless",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: output,
        GITHUB_ENV: environment,
        ...env,
      },
    },
  );
  return {
    output: await readFile(output, "utf8"),
    environment: await readFile(environment, "utf8"),
    result,
  };
}
describe("release CLI", () => {
  it("exports verified commit and configured site identity", async () => {
    const value = await invoke();
    expect(value.output).toBe(
      "publish=true\npublication_repository=fzfz/TavernHeadless-docs\npublication_branch=main\n",
    );
    expect(value.environment).toContain(
      "AGENT_PUBLIC_SITE_URL=https://fzfz.github.io/TavernHeadless-docs/\n",
    );
    expect(value.environment).toContain("AGENT_CONCLUSION=success\n");
  });
  it("skips a non-publication branch without release metadata", async () => {
    const value = await invoke({ head_branch: "feature" });
    expect(value.output).toBe("publish=false\n");
    expect(value.environment).toBe("");
  });
  it("fails for another repository", async () => {
    await expect(
      invoke({}, { GITHUB_REPOSITORY: "upstream/project" }),
    ).rejects.toThrow();
  });
  it("fails when CI describes another checkout", async () => {
    await expect(invoke({ head_sha: "a".repeat(40) })).rejects.toThrow();
  });
  it("requires a token to verify manual publication", async () => {
    await expect(
      invoke(
        {},
        {
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF_NAME: "main",
          GH_TOKEN: "",
        },
      ),
    ).rejects.toThrow();
  });
  it("rejects unsupported events", async () => {
    await expect(invoke({}, { GITHUB_EVENT_NAME: "push" })).rejects.toThrow();
  });
});
