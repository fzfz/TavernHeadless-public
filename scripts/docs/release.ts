import { runsResponseSchema } from "./release.schema";
import type { SiteConfig } from "./site-config";
import type { CiRun, VerifiedRelease } from "./release.schema";

export function verifyRelease(
  config: SiteConfig,
  commit: string,
  branch: string,
  runs: CiRun[],
): VerifiedRelease {
  if (branch !== config.publishBranch)
    throw new Error("发布分支不匹配；请在配置的发布分支运行工作流。");
  const run = runs.find(
    (candidate) =>
      candidate.head_sha === commit &&
      candidate.head_branch === branch &&
      candidate.head_repository.full_name === config.repository &&
      candidate.path === ".github/workflows/ci.yml" &&
      candidate.event === "push" &&
      candidate.status === "completed" &&
      candidate.conclusion === "success",
  );
  if (!run)
    throw new Error(
      "目标提交尚无成功的本仓库 CI；请等待该提交的 CI 通过后再发布。",
    );
  return {
    commit,
    branch,
    workflow: run.name,
    workflowRunId: run.id,
    conclusion: "success",
  };
}

export async function loadCiRuns(
  config: SiteConfig,
  commit: string,
  branch: string,
  token: string,
  request: typeof fetch = fetch,
): Promise<CiRun[]> {
  const url = new URL(
    `https://api.github.com/repos/${config.repository}/actions/workflows/ci.yml/runs`,
  );
  url.search = new URLSearchParams({
    head_sha: commit,
    branch,
    event: "push",
    status: "success",
    per_page: "100",
  }).toString();
  const response = await request(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok)
    throw new Error(
      `读取 CI 结果失败：HTTP ${response.status}；请检查工作流令牌权限后重试。`,
    );
  return runsResponseSchema.parse(await response.json()).workflow_runs;
}
