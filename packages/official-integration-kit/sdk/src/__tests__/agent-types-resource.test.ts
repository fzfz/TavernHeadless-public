import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk workspace agent type resource", () => {
  it("lists named workspaces even when they have no projects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "ws_empty",
            account_id: "acc_1",
            name: "Empty Workspace",
            kind: "manual",
            is_default: false,
            status: "active",
            settings: {},
            archived_at: null,
            created_at: 1,
            updated_at: 2,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });
    const items = await client.workspaces.list({ accountId: "acc_1" });
    expect(items).toEqual([
      {
        id: "ws_empty",
        accountId: "acc_1",
        name: "Empty Workspace",
        kind: "manual",
        isDefault: false,
        status: "active",
        settings: {},
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${baseUrl}/workspaces`);
  });

  it("lists and creates workspace agent types with snake_case mapping", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "agt_1",
              workspace_id: "ws_1",
              account_id: "acc_1",
              key: "world.sim",
              name: "World Sim",
              scope_kind: "project",
              status: "active",
              defaults: {
                llm_profile_id: null,
                tool_policy_id: null,
                mcp_bindings: [],
                event_subscriptions: [
                  { type: "floor.committed", filter_json: null },
                ],
                grants: { allowed_output_targets: ["derived_output"] },
                metadata: {},
              },
              created_at: 1,
              updated_at: 2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: "agt_2",
            workspace_id: "ws_1",
            account_id: "acc_1",
            key: "route.agent",
            name: "Route Agent",
            scope_kind: "project",
            status: "active",
            defaults: {
              llm_profile_id: null,
              tool_policy_id: null,
              mcp_bindings: [],
              event_subscriptions: [],
              grants: { allowed_output_targets: ["derived_output"] },
              metadata: {},
            },
            created_at: 3,
            updated_at: 4,
          },
          201,
        ),
      );

    const client = createTavernClient({ baseUrl, fetchImpl });

    const items = await client.workspaces.agentTypes.list("ws_1", {
      accountId: "acc_1",
    });
    expect(items[0]?.scopeKind).toBe("project");
    expect(items[0]?.defaults.eventSubscriptions[0]?.type).toBe(
      "floor.committed",
    );

    const created = await client.workspaces.agentTypes.create(
      "ws_1",
      {
        key: "route.agent",
        name: "Route Agent",
        scopeKind: "project",
        defaults: {
          grants: { allowed_output_targets: ["derived_output"] },
        },
      },
      { accountId: "acc_1" },
    );

    expect(created.id).toBe("agt_2");
    const [, createInit] = fetchImpl.mock.calls[1]!;
    expect(createInit?.body).toBe(
      JSON.stringify({
        key: "route.agent",
        name: "Route Agent",
        scope_kind: "project",
        defaults: {
          grants: { allowed_output_targets: ["derived_output"] },
        },
      }),
    );
  });
});
