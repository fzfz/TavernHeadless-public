import type { TavernClient } from "@tavern/sdk";

export type AgentTypeRecord = Awaited<
  ReturnType<TavernClient["workspaces"]["agentTypes"]["get"]>
>;
export type ProjectAgentBindingRecord = Awaited<
  ReturnType<TavernClient["projects"]["agentBindings"]["get"]>
>;
export type AgentScopeKind = AgentTypeRecord["scopeKind"];
export type WorkspaceRecord = Awaited<
  ReturnType<TavernClient["workspaces"]["list"]>
>[number];

export type AgentForm = {
  key: string;
  name: string;
  scopeKind: AgentScopeKind;
  llmProfileId: string;
  mcpIds: string;
  eventTypes: string;
  outputTargets: string;
  reads: string;
  metadata: string;
};
