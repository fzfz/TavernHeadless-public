import type {
  FloorRecord,
  PageRecord,
  SessionBranchSummary,
} from "@tavern/sdk";
import type {
  RoleDisplaySnapshot,
  RoleMessage,
  RoleRuntimeTransport,
} from "@tavern/shared";

export type ChatMessageTarget = {
  floorId: string;
  messageId: string;
  expectedRevisionNo?: number;
};
export type ChatMessageRevision = {
  revisionNo: number;
  content: string;
  hidden: boolean;
};
export type ChatAction =
  | ({ kind: "edit"; text: string } & ChatMessageTarget)
  | ({
      kind: "delete" | "regenerate" | "continue" | "branch";
    } & ChatMessageTarget)
  | { kind: "candidate"; floorId: string; candidateFloorId: string };

export type ChatFloorContext = {
  floor: FloorRecord;
  pages: PageRecord[];
  messagePages: Record<string, string>;
  canEdit: boolean;
  canDelete: boolean;
  canGenerate: boolean;
  reason: string;
  candidates: {
    activeFloorId: string | null;
    canActivate: boolean;
    items: {
      floorId: string;
      pageId: string | null;
      text: string;
      createdAt: number;
    }[];
  };
};

export type ChatActionResult = {
  current: RoleDisplaySnapshot;
  branchId?: string;
};
export type ChatTransport = RoleRuntimeTransport & {
  stop(): Promise<void>;
  reconcile(): Promise<{
    current: RoleDisplaySnapshot;
    busy: boolean;
    response?: "saved" | "failed" | "unaccepted";
    input?: string;
    retryAction?: ChatAction;
    resolvedEditMessageId?: string;
    branchId?: string;
  }>;
  getFloorContext(floorId: string): Promise<ChatFloorContext>;
  getMessageRevision(
    messageId: string,
    floorId: string,
  ): Promise<ChatMessageRevision>;
  performAction(
    action: ChatAction,
    current: RoleDisplaySnapshot,
  ): Promise<ChatActionResult>;
  listBranches(): Promise<SessionBranchSummary[]>;
};

export type ChatState = {
  busy: boolean;
  stopping: boolean;
  unknown: boolean;
  draft: string;
  pendingInput: string | null;
  pendingMain: { input: string; text: string; floorId: string } | null;
  editing: boolean;
  notice: string;
};

export type ChatWidgetMessage = RoleMessage;
