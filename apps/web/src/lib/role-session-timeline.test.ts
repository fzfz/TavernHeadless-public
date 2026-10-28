import type { TimelineFloor, TimelineMessage, TimelinePage } from "@tavern/sdk";
import { describe, expect, it } from "vitest";
import { roleSessionTimelineMessages } from "./role-session-timeline.js";

function message(id: string, role: string, seq: number): TimelineMessage {
  return {
    content: id,
    contentFormat: "text",
    id,
    role,
    seq,
  };
}

function page(
  id: string,
  pageNo: number,
  isActive: boolean,
  messages: TimelineMessage[],
): TimelinePage {
  return {
    id,
    isActive,
    messages,
    pageKind: "mixed",
    pageNo,
    version: 1,
  };
}

function floor(overrides: Partial<TimelineFloor> = {}): TimelineFloor {
  return {
    activePage: null,
    activePages: [],
    createdAt: 0,
    floorNo: 1,
    id: "floor",
    messages: [],
    pageCount: 0,
    pages: [],
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    ...overrides,
  };
}

describe("role session timeline messages", () => {
  it("lists visible messages by page and sequence while skipping inactive pages", () => {
    const result = roleSessionTimelineMessages(
      floor({
        activePages: [
          page("page-2", 2, true, [message("reply", "assistant", 1)]),
          page("page-1", 1, true, [
            message("reply-first", "assistant", 2),
            message("input", "user", 0),
          ]),
        ],
        pages: [page("inactive", 0, false, [message("old", "assistant", 0)])],
      }),
    );

    expect(result.map((item) => item.id)).toEqual([
      "input",
      "reply-first",
      "reply",
    ]);
  });

  it("keeps an empty active-page set empty even when deprecated fields have messages", () => {
    const result = roleSessionTimelineMessages(
      floor({
        pages: [page("inactive", 0, false, [message("old", "assistant", 0)])],
        activePage: page("deprecated", 0, true, [
          message("old", "assistant", 0),
        ]),
        messages: [
          message("later", "assistant", 1),
          message("earlier", "user", 0),
        ],
      }),
    );

    expect(result).toEqual([]);
  });

  it("returns an empty list for a floor with no messages", () => {
    expect(roleSessionTimelineMessages(floor())).toEqual([]);
  });
});
