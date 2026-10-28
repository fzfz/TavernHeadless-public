import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID as accountId } from "../src/accounts/constants.js";
import { buildTestApp } from "./helpers/create-test-db.js";
import { runtimeJobs } from "../src/db/schema.js";
import {
  createTestProject,
  createTestWorkspace,
} from "../src/__tests__/helpers/workspace-project.js";

function createClient(app: FastifyInstance): TavernClient {
  return createTavernClient({
    baseUrl: "http://tavern-integration.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        payload: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
}

async function expectApiCode(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected API error ${code}`);
}

describe("project Agent management through the official SDK and Fastify", () => {
  let app: FastifyInstance;
  let client: TavernClient;
  let database: Awaited<ReturnType<typeof buildTestApp>>["database"];

  beforeEach(async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    database = built.database;
    client = createClient(app);
  });

  afterEach(async () => {
    await app?.close();
  });

  it("creates and edits scoped Agent types and bindings without clearing omitted policy", async () => {
    const project = createTestProject(database, {
      accountId,
      id: "proj_agent_client_main",
    });
    const agentType = await client.workspaces.agentTypes.create(
      project.workspaceId,
      {
        key: "integration.project.agent",
        name: "Integration Agent",
        scopeKind: "project",
        defaults: {
          toolPolicyId: "policy_default",
          grants: { allowed_output_targets: ["derived_output"] },
          eventSubscriptions: [{ type: "floor.committed" }],
        },
      },
    );
    expect(agentType).toMatchObject({
      workspaceId: project.workspaceId,
      scopeKind: "project",
      defaults: { toolPolicyId: "policy_default" },
    });
    expect(
      await client.workspaces.agentTypes.get(project.workspaceId, agentType.id),
    ).toEqual(agentType);
    expect(
      (await client.workspaces.agentTypes.list(project.workspaceId)).map(
        ({ id }) => id,
      ),
    ).toContain(agentType.id);

    const renamedType = await client.workspaces.agentTypes.update(
      project.workspaceId,
      agentType.id,
      { name: "Updated Integration Agent" },
    );
    expect(renamedType.name).toBe("Updated Integration Agent");

    const binding = await client.projects.agentBindings.create(
      project.projectId,
      {
        agentTypeId: agentType.id,
        scopeKind: "project",
        toolPolicyId: "policy_binding",
        grants: { allowed_output_targets: ["derived_output"] },
      },
    );
    expect(binding).toMatchObject({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      agentTypeId: agentType.id,
      scopeKind: "project",
      toolPolicyId: "policy_binding",
    });
    expect(
      await client.projects.agentBindings.get(project.projectId, binding.id),
    ).toEqual(binding);
    expect(
      (await client.projects.agentBindings.list(project.projectId)).map(
        ({ id }) => id,
      ),
    ).toContain(binding.id);

    const editedBinding = await client.projects.agentBindings.update(
      project.projectId,
      binding.id,
      { metadata: { editor: "admin" } },
    );
    expect(editedBinding).toMatchObject({
      toolPolicyId: "policy_binding",
      metadata: { editor: "admin" },
      scopeKind: "project",
    });
    const explicitlyClearedPolicy = await client.projects.agentBindings.update(
      project.projectId,
      binding.id,
      { toolPolicyId: null },
    );
    expect(explicitlyClearedPolicy.toolPolicyId).toBeNull();

    const otherWorkspace = createTestWorkspace(database, {
      accountId,
      id: "ws_agent_client_other",
      name: "Other agent workspace",
    });
    const otherProject = createTestProject(database, {
      accountId,
      workspaceId: otherWorkspace.workspaceId,
      id: "proj_agent_client_other",
    });
    await expectApiCode(
      () =>
        client.projects.agentBindings.create(otherProject.projectId, {
          agentTypeId: agentType.id,
        }),
      "agent_type_workspace_mismatch",
    );
    await expectApiCode(
      () =>
        client.projects.agentBindings.create(project.projectId, {
          agentTypeId: agentType.id,
          scopeKind: "session",
        }),
      "agent_type_workspace_mismatch",
    );
  });

  it("queues a custom manual run, reads it, rejects disabled runs, and cancels it", async () => {
    const project = createTestProject(database, {
      accountId,
      id: "proj_agent_jobs_client",
    });
    const agentType = await client.workspaces.agentTypes.create(
      project.workspaceId,
      {
        key: "integration.manual.agent",
        name: "Manual Agent",
        scopeKind: "project",
        defaults: {
          grants: { allowed_output_targets: ["derived_output"] },
        },
      },
    );
    const binding = await client.projects.agentBindings.create(
      project.projectId,
      { agentTypeId: agentType.id, scopeKind: "project" },
    );

    await client.projects.agentBindings.disable(project.projectId, binding.id);
    await expectApiCode(
      () =>
        client.projects.agentBindings.run(project.projectId, binding.id, {
          triggerReason: "disabled-test",
          dryRun: false,
          inputJson: { must_not_queue: true },
        }),
      "binding_disabled",
    );
    expect(
      database
        .select()
        .from(runtimeJobs)
        .where(eq(runtimeJobs.projectId, project.projectId))
        .all(),
    ).toEqual([]);

    await client.projects.agentBindings.enable(project.projectId, binding.id);
    const queued = await client.projects.agentBindings.run(
      project.projectId,
      binding.id,
      {
        triggerReason: "manual-ui-test",
        dryRun: false,
        inputJson: { request: "review selected project items", attempt: 2 },
      },
    );
    expect(queued).toMatchObject({ created: true, agentBindingId: binding.id });

    const persisted = database
      .select()
      .from(runtimeJobs)
      .where(eq(runtimeJobs.id, queued.jobId))
      .get();
    expect(JSON.parse(persisted?.payloadJson ?? "{}")).toMatchObject({
      dryRun: false,
      inputJson: { request: "review selected project items", attempt: 2 },
      triggerReason: "manual-ui-test",
    });

    const listed = await client.projects.agentJobs.list(project.projectId, {
      status: "pending",
      limit: 20,
      offset: 0,
    });
    expect(listed.total).toBe(1);
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: queued.jobId,
        status: "pending",
        agentBindingId: binding.id,
        agentTypeId: agentType.id,
        dryRun: false,
      }),
    ]);
    expect(
      await client.projects.agentJobs.get(project.projectId, queued.jobId),
    ).toEqual(listed.items[0]);

    const cancelled = await client.projects.agentJobs.cancel(
      project.projectId,
      queued.jobId,
    );
    expect(cancelled).toMatchObject({ id: queued.jobId, status: "cancelled" });
    expect(
      await client.projects.agentJobs.list(project.projectId, {
        status: "cancelled",
      }),
    ).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: queued.jobId })],
    });
    await expectApiCode(
      () => client.projects.agentJobs.get(project.projectId, "missing-job"),
      "project_agent_job_not_found",
    );
    const otherProject = createTestProject(database, {
      accountId,
      workspaceId: project.workspaceId,
      id: "proj_agent_jobs_other",
    });
    await expectApiCode(
      () => client.projects.agentJobs.get(otherProject.projectId, queued.jobId),
      "project_agent_job_project_mismatch",
    );
  });
});
