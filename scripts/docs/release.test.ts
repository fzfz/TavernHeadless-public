import { describe, expect, it, vi } from "vitest";
import { siteConfig } from "./site-config";
import { verifyRelease, loadCiRuns } from "./release";
import type { CiRun } from "./release.schema";
const commit = "a".repeat(40);
const run: CiRun = {
  id: 123,
  name: "CI",
  path: ".github/workflows/ci.yml",
  event: "push",
  head_sha: commit,
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  head_repository: { full_name: "fzfz/TavernHeadless" },
};
describe("Pages publication requires matching CI evidence", () => {
  it("accepts successful CI for the exact checkout", () => {
    expect(verifyRelease(siteConfig, commit, "main", [run])).toEqual({
      commit,
      branch: "main",
      workflow: "CI",
      workflowRunId: 123,
      conclusion: "success",
    });
  });
  it.each([
    { ...run, head_sha: "b".repeat(40) },
    { ...run, head_branch: "dev" },
    { ...run, conclusion: "failure" },
    { ...run, conclusion: null },
    { ...run, status: "in_progress" },
    { ...run, event: "pull_request" },
    { ...run, path: ".github/workflows/other.yml" },
    { ...run, head_repository: { full_name: "upstream/TavernHeadless" } },
  ])("rejects mismatched or incomplete CI evidence", (candidate) => {
    expect(() =>
      verifyRelease(siteConfig, commit, "main", [candidate]),
    ).toThrow();
  });
  it("rejects absent CI and a different target branch", () => {
    expect(() => verifyRelease(siteConfig, commit, "main", [])).toThrow();
    expect(() => verifyRelease(siteConfig, commit, "dev", [run])).toThrow();
  });
  it("selects a successful matching run among unrelated runs", () => {
    expect(
      verifyRelease(siteConfig, commit, "main", [
        { ...run, conclusion: "failure" },
        run,
      ]).workflowRunId,
    ).toBe(123);
  });
});

describe("manual publication CI lookup", () => {
  it("requests the exact repository and commit and verifies returned evidence", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ workflow_runs: [run] })),
      );
    const runs = await loadCiRuns(
      siteConfig,
      commit,
      "main",
      "test-token",
      request,
    );
    const url = new URL(String(request.mock.calls[0]![0]));
    expect(url.pathname).toBe(
      "/repos/fzfz/TavernHeadless/actions/workflows/ci.yml/runs",
    );
    expect(url.searchParams.get("head_sha")).toBe(commit);
    expect(verifyRelease(siteConfig, commit, "main", runs).workflowRunId).toBe(
      123,
    );
  });
  it.each([403, 500])("rejects HTTP %s", async (status) => {
    await expect(
      loadCiRuns(
        siteConfig,
        commit,
        "main",
        "token",
        vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })),
      ),
    ).rejects.toThrow(`HTTP ${status}`);
  });
  it("propagates network failure", async () => {
    await expect(
      loadCiRuns(
        siteConfig,
        commit,
        "main",
        "token",
        vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
      ),
    ).rejects.toThrow("offline");
  });
  it.each([
    "not-json",
    JSON.stringify({ workflow_runs: [{}] }),
    JSON.stringify({}),
  ])("rejects malformed response %s", async (body) => {
    await expect(
      loadCiRuns(
        siteConfig,
        commit,
        "main",
        "token",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      ),
    ).rejects.toThrow();
  });
  it("prevents publication when no CI evidence exists", async () => {
    const runs = await loadCiRuns(
      siteConfig,
      commit,
      "main",
      "token",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ workflow_runs: [] }))),
    );
    expect(() => verifyRelease(siteConfig, commit, "main", runs)).toThrow(
      "尚无成功",
    );
  });
});
