import type { RoleDisplaySnapshot } from "@tavern/shared";
import type { TransportClient } from "../client/transport.js";
import {
  readArray,
  readBoolean,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type ReplyCandidate = {
  floorId: string;
  pageId: string | null;
  text: string;
  createdAt: number;
};
export type ReplyCandidatesList = {
  sessionId: string;
  branchId: string;
  floorNo: number;
  activeFloorId: string | null;
  canActivate: boolean;
  items: ReplyCandidate[];
};
export type ActivateReplyCandidateOptions = {
  sessionId: string;
  branchId: string;
  floorId: string;
  expectedSnapshotId: string | null;
  operationId: string;
};
export type ReplyCandidateActivation = {
  activeFloorId: string | null;
  current: RoleDisplaySnapshot | null;
};
export type ReplyCandidatesResource = {
  list(options: { floorId: string }): Promise<ReplyCandidatesList>;
  activate(
    options: ActivateReplyCandidateOptions,
  ): Promise<ReplyCandidateActivation>;
};
export function createReplyCandidatesResource(
  client: TransportClient,
): ReplyCandidatesResource {
  return {
    async list(options) {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/floors/${encodeURIComponent(options.floorId)}/reply-candidates`,
        { method: "GET" },
      );
      const data = readRecord(readRecord(response.body)?.data);
      if (!data)
        throw new Error("Reply candidates returned an invalid payload");
      return {
        sessionId: readString(data.session_id),
        branchId: readString(data.branch_id),
        floorNo: readNumber(data.floor_no),
        activeFloorId: readNullableString(data.active_floor_id),
        canActivate: readBoolean(data.can_activate),
        items: readArray(data.items).map((value) => {
          const item = readRecord(value);
          return {
            floorId: readString(item?.floor_id),
            pageId: readNullableString(item?.page_id),
            text: readString(item?.text),
            createdAt: readNumber(item?.created_at),
          };
        }),
      };
    },
    async activate(options) {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/reply-candidates/activate`,
        {
          method: "POST",
          body: {
            branch_id: options.branchId,
            floor_id: options.floorId,
            expected_snapshot_id: options.expectedSnapshotId,
            operation_id: options.operationId,
          },
        },
      );
      const data = readRecord(readRecord(response.body)?.data);
      if (!data)
        throw new Error(
          "Reply candidate activation returned an invalid payload",
        );
      return {
        activeFloorId: readNullableString(data.active_floor_id),
        current: readRecord(data.current) as RoleDisplaySnapshot | null,
      };
    },
  };
}
