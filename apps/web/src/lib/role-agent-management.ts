import type { TavernClient } from "@tavern/sdk";
import type {
  AgentForm,
  AgentScopeKind,
  AgentTypeRecord,
  ProjectAgentBindingRecord,
} from "./role-agent-management.schema.js";

export function blankAgentForm(scopeKind: AgentScopeKind): AgentForm {
  return {
    key: "",
    name: "",
    scopeKind,
    llmProfileId: "",
    mcpIds: "",
    eventTypes: "",
    outputTargets: "",
    reads: "",
    metadata: "{}",
  };
}

export function bindingFormForType(type: AgentTypeRecord): AgentForm {
  return blankAgentForm(type.scopeKind);
}

const joined = (items: string[]) => items.join(", ");
const csv = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function agentFormFromRecord(
  record: AgentTypeRecord | ProjectAgentBindingRecord,
): AgentForm {
  const config = "defaults" in record ? record.defaults : record;
  return {
    key: "key" in record ? record.key : "",
    name: "name" in record ? record.name : "",
    scopeKind: record.scopeKind,
    llmProfileId: config.llmProfileId ?? "",
    mcpIds: joined(config.mcpBindings.map((entry) => entry.mcpServerId)),
    eventTypes: joined(config.eventSubscriptions.map((entry) => entry.type)),
    outputTargets: joined(
      Array.isArray(config.grants.allowed_output_targets)
        ? (config.grants.allowed_output_targets as string[])
        : [],
    ),
    reads: joined(
      Array.isArray(config.grants.reads)
        ? (config.grants.reads as string[])
        : [],
    ),
    metadata: JSON.stringify(config.metadata, null, 2),
  };
}

export function agentConfiguration(
  form: AgentForm,
  original?: AgentTypeRecord["defaults"] | ProjectAgentBindingRecord,
) {
  const metadata: unknown = JSON.parse(form.metadata || "{}");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new SyntaxError("metadata");
  return {
    mcpBindings: csv(form.mcpIds).map((id) => {
      const existing = original?.mcpBindings.find(
        (entry) => entry.mcpServerId === id,
      );
      return existing
        ? {
            mcpServerId: id,
            ...(existing.allowedTools
              ? { allowedTools: existing.allowedTools }
              : {}),
            configOverrideJson: existing.configOverrideJson,
          }
        : { mcpServerId: id };
    }),
    eventSubscriptions: csv(form.eventTypes).map((type) => {
      const existing = original?.eventSubscriptions.find(
        (entry) => entry.type === type,
      );
      return existing ? { type, filterJson: existing.filterJson } : { type };
    }),
    grants: {
      ...original?.grants,
      allowed_output_targets: csv(form.outputTargets),
      reads: csv(form.reads),
    },
    metadata: metadata as Record<string, unknown>,
  };
}

export function createAgentManagement(client: TavernClient) {
  return {
    createType(workspaceId: string, form: AgentForm) {
      return client.workspaces.agentTypes.create(workspaceId, {
        key: form.key.trim(),
        name: form.name.trim(),
        scopeKind: form.scopeKind,
        defaults: {
          llmProfileId: form.llmProfileId || null,
          ...agentConfiguration(form),
        },
      });
    },
    updateType(workspaceId: string, record: AgentTypeRecord, form: AgentForm) {
      return client.workspaces.agentTypes.update(workspaceId, record.id, {
        name: form.name.trim(),
        defaults: {
          ...record.defaults,
          llmProfileId: form.llmProfileId || null,
          ...agentConfiguration(form, record.defaults),
        },
      });
    },
    toggleType(workspaceId: string, record: AgentTypeRecord) {
      return record.status === "active"
        ? client.workspaces.agentTypes.disable(workspaceId, record.id)
        : client.workspaces.agentTypes.enable(workspaceId, record.id);
    },
    createBinding(projectId: string, agentTypeId: string, form: AgentForm) {
      return client.projects.agentBindings.create(projectId, {
        agentTypeId,
        scopeKind: form.scopeKind,
        llmProfileId: form.llmProfileId || null,
        ...agentConfiguration(form),
      });
    },
    updateBinding(
      projectId: string,
      record: ProjectAgentBindingRecord,
      form: AgentForm,
    ) {
      return client.projects.agentBindings.update(projectId, record.id, {
        scopeKind: form.scopeKind,
        llmProfileId: form.llmProfileId || null,
        toolPolicyId: record.toolPolicyId,
        ...agentConfiguration(form, record),
      });
    },
    toggleBinding(projectId: string, record: ProjectAgentBindingRecord) {
      return record.status === "enabled"
        ? client.projects.agentBindings.disable(projectId, record.id)
        : client.projects.agentBindings.enable(projectId, record.id);
    },
    runBinding(projectId: string, record: ProjectAgentBindingRecord) {
      if (record.status !== "enabled") throw new Error("binding_disabled");
      return client.projects.agentBindings.run(projectId, record.id, {
        triggerReason: "manual",
        dryRun: false,
        inputJson: {},
      });
    },
  };
}
