import type { RoleStateRepairResult } from "./role-state-repair.js";
import type { RoleDisplaySnapshot } from "./role-state.js";
import type { RoleDelivery } from "./role-view.js";

export type RoleRuntimePolicy = {
  overscanFloors: number;
  historyCache: { maxEntries: number; maxBytes: number };
  settledStreamCache: { maxEntries: number; maxBytes: number };
  diagnosticsCache: { maxEntries: number; maxBytes: number };
};
export type RoleFloorPointer = {
  floorId: string;
  floorNo: number;
  state: "draft" | "generating" | "committed" | "failed";
};
export type RoleFloorQuery = {
  branchId: string;
  floorId: string;
};
export type RoleFloorPage = {
  items: RoleFloorPointer[];
  nextCursor: string | null;
};
export type RoleFloorListQuery = {
  branchId: string;
  cursor?: string;
  limit?: number;
};
export type RoleSnapshotPointer = {
  snapshotId: string;
  floorId: string | null;
  attemptId: string | null;
};
export type RoleSnapshotPage = {
  items: RoleSnapshotPointer[];
  nextCursor: string | null;
};
export type RoleSnapshotListQuery = {
  branchId: string;
  cursor?: string;
  limit?: number;
};
export type RoleTextEvent = {
  sessionId: string;
  branchId: string;
  floorId: string;
  attemptId: string;
  streamId: string;
  runId: string | null;
  jobId: string | null;
  messageId: string | null;
  revision: number;
  type: "snapshot" | "start" | "update" | "end" | "error" | "cancelled";
  status: "streaming" | "completed" | "failed" | "cancelled";
  text: string;
  error: { code: string; message: string } | null;
};
export type RoleMessage = {
  id: string;
  role: "user" | "assistant" | "agent";
  text: string;
  floorId: string;
  streamId: string;
  status: "completed";
};
export type RoleTurnCommit = {
  eventId: string;
  sessionId: string;
  branchId: string;
  kind: "generated" | "retried" | "regenerated";
  previousCurrentSnapshotId: string;
  before: RoleDisplaySnapshot;
  after: RoleDisplaySnapshot;
};
export type RoleEnvelope =
  | { type: "text"; data: RoleTextEvent }
  | { type: "commit"; data: RoleTurnCommit }
  | { type: "current"; data: RoleDisplaySnapshot }
  | { type: "completed"; data: { snapshotId: string } }
  | { type: "error"; data: { code: string; message: string } };
export type RoleRuntimeSession = {
  characterId: string;
  sessionId: string;
  branchId: string;
  versionId: string;
  name: string;
  initial: RoleDisplaySnapshot;
  current: RoleDisplaySnapshot;
  messages: RoleMessage[];
  delivery: RoleDelivery;
  processing: {
    pendingMain: { floorId: string; input: string; text: string } | null;
    pendingFollowups: boolean;
  };
  capabilities: { send: boolean; history: boolean; customFloors: boolean };
};
export type RoleStateRestoreOptions = {
  branchId: string;
  expectedSnapshotId: string;
};
export type RoleStateRecalculateOptions = RoleStateRestoreOptions & {
  floorId: string;
};
export type RoleRuntimeTransport = {
  loadSession(): Promise<RoleRuntimeSession>;
  getCurrentSnapshot(): Promise<RoleDisplaySnapshot>;
  recalculateLatest(
    options: RoleStateRecalculateOptions & { operationId: string },
  ): Promise<RoleStateRepairResult>;
  restoreMissing(
    options: RoleStateRestoreOptions & { operationId: string },
  ): Promise<RoleStateRepairResult>;
  subscribeState(options: {
    branchId: string;
    onCurrent: (snapshot: RoleDisplaySnapshot) => void;
    onError: (error: Error) => void;
  }): () => void;
  getSnapshot(snapshotId: string): Promise<RoleDisplaySnapshot>;
  getMessages(query: RoleFloorQuery): Promise<RoleMessage[]>;
  listFloors(query: RoleFloorListQuery): Promise<RoleFloorPage>;
  listSnapshots(query: RoleSnapshotListQuery): Promise<RoleSnapshotPage>;
  send(options: {
    text: string;
    current: RoleDisplaySnapshot;
    route: string;
    testHeaders: Record<string, string>;
    emit: (event: RoleEnvelope) => void;
  }): Promise<unknown>;
  dispose(): void;
};
export type RoleRuntimeHost = {
  recalculateLatest(
    options: RoleStateRecalculateOptions,
  ): Promise<RoleStateRepairResult>;
  restoreMissing(
    options: RoleStateRestoreOptions,
  ): Promise<RoleStateRepairResult>;
  get(scope: "current" | "view"): RoleDisplaySnapshot;
  watch(
    scope: "current" | "view",
    callback: (record: RoleDisplaySnapshot) => void,
  ): () => void;
  onTurnCommitted(callback: (event: RoleTurnCommit) => void): () => void;
  onTextStream(
    callback: (event: RoleTextEvent) => void,
    filter?: { floorId?: string; streamId?: string },
  ): () => void;
  getSnapshot(snapshotId: string): Promise<RoleDisplaySnapshot>;
  getMessages(query: RoleFloorQuery): Promise<RoleMessage[]>;
  listFloors(query: RoleFloorListQuery): Promise<RoleFloorPage>;
  listSnapshots(query: RoleSnapshotListQuery): Promise<RoleSnapshotPage>;
  select(snapshotId: string): Promise<{ snapshotId: string }>;
  latest(): Promise<{ snapshotId: string }>;
  send(params: { text: string }): Promise<{ snapshotId: string }>;
  setDraft(text: string): Promise<null>;
  mountChat(container: HTMLElement): { destroy(): void };
  report(error: Error): void;
  dispose(): void;
};
export type RoleRuntimeOptions = {
  root: HTMLElement;
  delivery: RoleDelivery;
  host: RoleRuntimeHost;
  policy: RoleRuntimePolicy;
  errors?: Record<string, unknown>;
  validate: (name: string, value: unknown) => boolean;
};
export type RoleSessionControllerOptions = {
  session: RoleRuntimeSession;
  transport: RoleRuntimeTransport;
  policy: RoleRuntimePolicy;
  errors: Record<string, unknown>;
  onState?: (state: {
    busy: boolean;
    current: RoleDisplaySnapshot;
    view: RoleDisplaySnapshot;
    following: boolean;
  }) => void;
  onReport?: (error: Error) => void;
};
