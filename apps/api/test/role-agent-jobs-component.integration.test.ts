import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { buildTestApp } from "./helpers/create-test-db.js";
import { createTestProject } from "../src/__tests__/helpers/workspace-project.js";
import RoleAgentJobs from "../../web/src/components/workspace/RoleAgentJobs.vue";
import {
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";
const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
}));
vi.mock("../../web/src/lib/api.js", () => ({
  get apiClient() {
    return bridge.client;
  },
}));
describe("Agent task controls through Vue, SDK and API", () => {
  let app: FastifyInstance, projectId: string, jobId: string;
  let host: ReturnType<typeof mountComponent>;
  beforeEach(async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    const project = createTestProject(built.database, {
      accountId: "default-admin",
      id: "ui-jobs",
    });
    projectId = project.projectId;
    bridge.client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const response = await app.inject({
          method: (init?.method ?? "GET") as "GET" | "POST",
          url: url.pathname + url.search,
          headers: Object.fromEntries(new Headers(init?.headers)),
          payload: init?.body as string | undefined,
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: response.headers as Record<string, string>,
        });
      },
    });
    const type = await bridge.client.workspaces.agentTypes.create(
      project.workspaceId,
      { key: "ui-job", name: "Task test", scopeKind: "project" },
    );
    const binding = await bridge.client.projects.agentBindings.create(
      projectId,
      { agentTypeId: type.id, scopeKind: "project" },
    );
    const result = await bridge.client.projects.agentBindings.run(
      projectId,
      binding.id,
      { dryRun: true, inputJson: { check: "event-to-api" } },
    );
    jobId = result.jobId;
    host = mountComponent(RoleAgentJobs, { projectId, revision: 0 });
    await vi.waitFor(() => expect(host.root.textContent).toContain(jobId));
  });
  afterEach(async () => {
    host?.unmount();
    await app.close();
  });
  it("opens the submitted job and cancels it with persisted status", async () => {
    host
      .all((n) => n.tagName === "BUTTON" && n.textContent === "任务详情")[0]!
      .click();
    await vi.waitFor(() =>
      expect(host.all((n) => n.tagName === "PRE").length).toBe(1),
    );
    expect(host.root.textContent).toContain('"dryRun": true');
    host
      .all((n) => n.tagName === "BUTTON" && n.textContent === "取消任务")[0]!
      .click();
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("cancelled"),
    );
    expect(
      (await bridge.client!.projects.agentJobs.get(projectId, jobId)).status,
    ).toBe("cancelled");
    await settleComponent();
    expect(
      host.all(
        (n) => n.tagName === "BUTTON" && n.textContent === "取消任务",
      )[0]!.props.disabled,
    ).toBe(true);
  });
  it("reports a concurrent cancellation and recovers by refreshing the list", async () => {
    await bridge.client!.projects.agentJobs.cancel(projectId, jobId);
    host
      .all((n) => n.tagName === "BUTTON" && n.textContent === "取消任务")[0]!
      .click();
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("任务状态已变化"),
    );
    host
      .all((n) => n.tagName === "BUTTON" && n.textContent === "刷新任务")[0]!
      .click();
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("cancelled"),
    );
    expect(host.all((n) => n.props.role === "alert")).toHaveLength(0);
  });
});
