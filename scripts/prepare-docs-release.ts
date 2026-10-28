import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { siteConfig, assertSiteEnvironment } from "./docs/site-config";
import { releaseEventSchema } from "./docs/release.schema";
import { verifyRelease, loadCiRuns } from "./docs/release";

async function main(): Promise<void> {
  assertSiteEnvironment(process.env);
  if (process.env.GITHUB_REPOSITORY !== siteConfig.repository)
    throw new Error("工作流仓库与站点配置不一致。");
  const output = process.env.GITHUB_OUTPUT;
  const environment = process.env.GITHUB_ENV;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!output || !environment || !eventPath)
    throw new Error("请在 GitHub Actions 中运行发布检查。");
  const event = releaseEventSchema.parse(
    JSON.parse(await readFile(eventPath, "utf8")),
  );
  const automated = process.env.GITHUB_EVENT_NAME === "workflow_run";
  if (!automated && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("当前事件不支持文档发布。");
  const branch = automated
    ? event.workflow_run?.head_branch
    : process.env.GITHUB_REF_NAME;
  if (branch !== siteConfig.publishBranch) {
    await appendFile(output, "publish=false\n");
    return;
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  let runs;
  if (automated) {
    runs = event.workflow_run ? [event.workflow_run] : [];
  } else {
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error("缺少 GH_TOKEN；请为发布检查提供工作流令牌。");
    runs = await loadCiRuns(siteConfig, commit, branch, token);
  }
  const release = verifyRelease(siteConfig, commit, branch, runs);
  const values = {
    AGENT_REPOSITORY: siteConfig.repository,
    AGENT_PUBLIC_SITE_URL: siteConfig.siteUrl,
    AGENT_BASE_PATH: siteConfig.basePath,
    AGENT_HEAD_SHA: release.commit,
    AGENT_HEAD_BRANCH: release.branch,
    AGENT_WORKFLOW_NAME: release.workflow,
    AGENT_WORKFLOW_RUN_ID: String(release.workflowRunId),
    AGENT_CONCLUSION: release.conclusion,
  };
  await appendFile(
    environment,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  await appendFile(
    output,
    `publish=true\npublication_repository=${siteConfig.publicationRepository}\npublication_branch=${siteConfig.publicationBranch}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
