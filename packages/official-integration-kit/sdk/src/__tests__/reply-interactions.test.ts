import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });

describe("SDK reply interactions", () => {
  it("lists and activates a committed candidate with a stable operation id", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          session_id: "s",
          branch_id: "side",
          floor_no: 1,
          active_floor_id: "b",
          can_activate: true,
          items: [
            {
              floor_id: "a",
              page_id: "page-a",
              text: "候选正文",
              created_at: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(json({ active_floor_id: "a", current: null }));
    const client = createTavernClient({
      baseUrl: "http://example.test",
      fetchImpl,
    });
    expect(await client.replyCandidates.list({ floorId: "b" })).toEqual({
      sessionId: "s",
      branchId: "side",
      floorNo: 1,
      activeFloorId: "b",
      canActivate: true,
      items: [
        { floorId: "a", pageId: "page-a", text: "候选正文", createdAt: 1 },
      ],
    });
    expect(
      await client.replyCandidates.activate({
        sessionId: "s",
        branchId: "side",
        floorId: "a",
        expectedSnapshotId: null,
        operationId: "choose-a",
      }),
    ).toEqual({ activeFloorId: "a", current: null });
    expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toEqual({
      branch_id: "side",
      floor_id: "a",
      expected_snapshot_id: null,
      operation_id: "choose-a",
    });
  });
  it("deletes a committed message through the revision endpoint and maps saved completion", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        target_kind: "message",
        target_id: "message",
        session_id: "s",
        branch_id: "main",
        floor_id: "f",
        page_id: "p",
        message_id: "message",
        current_content: "原文",
        current_hidden: true,
        operation_id: "delete-this-message",
        applied_revision_no: 2,
        current_token_count: 1,
        latest_revision_no: 2,
        items: [],
      }),
    );
    const client = createTavernClient({
      baseUrl: "http://example.test",
      fetchImpl,
    });
    const result = await client.messages.createManualRevision({
      messageId: "message",
      action: "delete",
      expectedLatestRevisionNo: 1,
      operationId: "delete-this-message",
    });
    expect(result.currentHidden).toBe(true);
    expect(result.operationId).toBe("delete-this-message");
    expect(result.appliedRevisionNo).toBe(2);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toEqual({
      action: "delete",
      expected_latest_revision_no: 1,
      operation_id: "delete-this-message",
    });
  });
});
