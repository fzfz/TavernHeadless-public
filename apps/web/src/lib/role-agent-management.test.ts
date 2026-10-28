import { describe, expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import {
  agentConfiguration,
  agentFormFromRecord,
  bindingFormForType,
  blankAgentForm,
  createAgentManagement,
} from "./role-agent-management.js";
import type {
  AgentTypeRecord,
  ProjectAgentBindingRecord,
} from "./role-agent-management.schema.js";

const defaults = {
  llmProfileId: null,
  toolPolicyId: "policy",
  mcpBindings: [
    { mcpServerId: "mcp-a", allowedTools: ["read"], configOverrideJson: null },
  ],
  eventSubscriptions: [
    { type: "floor.committed", filterJson: { kind: "story" } },
  ],
  grants: { retained: true },
  metadata: { initial: true },
};
const type = {
  id: "type-1",
  workspaceId: "workspace-1",
  accountId: "account-1",
  key: "world.sim",
  name: "World",
  scopeKind: "project",
  status: "active",
  defaults,
  createdAt: 1,
  updatedAt: 1,
} as AgentTypeRecord;
const binding = {
  id: "binding-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  accountId: "account-1",
  agentTypeId: "type-1",
  status: "enabled",
  scopeKind: "project",
  ...defaults,
  createdAt: 1,
  updatedAt: 1,
} as ProjectAgentBindingRecord;
function setup() {
  const agentTypes = {
    create: vi.fn(),
    update: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
  };
  const agentBindings = {
    create: vi.fn(),
    update: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    run: vi.fn(),
  };
  return {
    command: createAgentManagement({
      workspaces: { agentTypes },
      projects: { agentBindings },
    } as unknown as TavernClient),
    agentTypes,
    agentBindings,
  };
}
describe("role agent management commands", () => {
  it("creates types and bindings in the selected scopes", async () => {
    const { command, agentTypes, agentBindings } = setup();
    const form = {
      ...blankAgentForm("project"),
      key: "world.sim",
      name: "World",
      mcpIds: "mcp-a, mcp-b",
      eventTypes: "floor.committed",
      outputTargets: "derived_output",
      metadata: '{"mode":"test"}',
    };
    await command.createType("workspace-1", form);
    expect(agentTypes.create).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        key: "world.sim",
        defaults: expect.objectContaining({
          mcpBindings: [{ mcpServerId: "mcp-a" }, { mcpServerId: "mcp-b" }],
        }),
      }),
    );
    await command.createBinding("project-1", "type-1", form);
    expect(agentBindings.create).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        agentTypeId: "type-1",
        grants: expect.objectContaining({
          allowed_output_targets: ["derived_output"],
        }),
      }),
    );
  });
  it("updates editable fields and keeps unedited nested configuration", async () => {
    const { command, agentTypes, agentBindings } = setup();
    const form = agentFormFromRecord(type);
    await command.updateType("workspace-1", type, { ...form, name: "Revised" });
    expect(agentTypes.update).toHaveBeenCalledWith(
      "workspace-1",
      "type-1",
      expect.objectContaining({
        name: "Revised",
        defaults: expect.objectContaining({
          toolPolicyId: "policy",
          mcpBindings: [
            {
              mcpServerId: "mcp-a",
              allowedTools: ["read"],
              configOverrideJson: null,
            },
          ],
        }),
      }),
    );
    await command.updateBinding(
      "project-1",
      binding,
      agentFormFromRecord(binding),
    );
    expect(agentBindings.update).toHaveBeenCalledWith(
      "project-1",
      "binding-1",
      expect.objectContaining({
        eventSubscriptions: [
          { type: "floor.committed", filterJson: { kind: "story" } },
        ],
        toolPolicyId: "policy",
      }),
    );
  });
  it("uses a non-project type's scope for a new binding", async () => {
    const { command, agentBindings } = setup();
    const floorType = { ...type, scopeKind: "floor" } as AgentTypeRecord;
    const form = bindingFormForType(floorType);
    expect(form.scopeKind).toBe("floor");
    await command.createBinding("project-1", floorType.id, form);
    expect(agentBindings.create).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ scopeKind: "floor" }),
    );
  });
  it("switches both status directions and runs only enabled bindings", async () => {
    const { command, agentTypes, agentBindings } = setup();
    await command.toggleType("workspace-1", type);
    await command.toggleType("workspace-1", { ...type, status: "disabled" });
    await command.toggleBinding("project-1", binding);
    await command.toggleBinding("project-1", {
      ...binding,
      status: "disabled",
    });
    expect(agentTypes.disable).toHaveBeenCalledWith("workspace-1", "type-1");
    expect(agentTypes.enable).toHaveBeenCalledWith("workspace-1", "type-1");
    expect(agentBindings.disable).toHaveBeenCalledWith(
      "project-1",
      "binding-1",
    );
    expect(agentBindings.enable).toHaveBeenCalledWith("project-1", "binding-1");
    await command.runBinding("project-1", binding);
    expect(agentBindings.run).toHaveBeenCalledWith("project-1", "binding-1", {
      triggerReason: "manual",
      dryRun: false,
      inputJson: {},
    });
    expect(() =>
      command.runBinding("project-1", { ...binding, status: "disabled" }),
    ).toThrow();
  });
  it("rejects malformed metadata before mutation", () => {
    const { command, agentTypes } = setup();
    const form = { ...blankAgentForm("floor"), metadata: "[]" };
    expect(() => agentConfiguration(form)).toThrow(SyntaxError);
    expect(() => agentConfiguration({ ...form, metadata: "{" })).toThrow(
      SyntaxError,
    );
    expect(() => command.createType("workspace-1", form)).toThrow(SyntaxError);
    expect(agentTypes.create).not.toHaveBeenCalled();
  });
  it("propagates API failures without reporting a successful command", async () => {
    const { command, agentBindings } = setup();
    const failure = new Error("request failed");
    agentBindings.run.mockRejectedValueOnce(failure);
    await expect(command.runBinding("project-1", binding)).rejects.toBe(
      failure,
    );
  });
});
