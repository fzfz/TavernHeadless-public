import { expect, it, vi } from "vitest";
import type { FloorRecord, TavernClient } from "@tavern/sdk";
import {
  listGenerationDetailFloors,
  loadGenerationDetailFloor,
} from "./generation-detail-snapshot.js";

const floor = (floorNo: number, id = `floor-${floorNo}`): FloorRecord => ({
  branchId: `branch-${floorNo % 2}`,
  createdAt: floorNo,
  floorNo,
  id,
  parentFloorId: null,
  sessionId: "session-1",
  state: floorNo === 0 ? "committed" : "failed",
  supersededAt: null,
  supersededByFloorId: null,
  tokenIn: floorNo,
  tokenOut: floorNo + 1,
  updatedAt: floorNo,
});

it("loads every session floor, including opening and non-committed states, in prototype order", async () => {
  const records = [floor(0), floor(2), floor(1), floor(3)];
  const floorsList = vi.fn(
    async ({ offset, limit }: { offset: number; limit: number }) =>
      records.slice(offset, offset + limit),
  );
  const client = {
    floors: { list: floorsList },
  } as unknown as TavernClient;

  const result = await listGenerationDetailFloors(client, "session-1", 2);

  expect(floorsList.mock.calls.map(([query]) => query)).toEqual([
    {
      sessionId: "session-1",
      limit: 2,
      offset: 0,
      sortBy: "floor_no",
      sortOrder: "desc",
    },
    {
      sessionId: "session-1",
      limit: 2,
      offset: 2,
      sortBy: "floor_no",
      sortOrder: "desc",
    },
    {
      sessionId: "session-1",
      limit: 2,
      offset: 4,
      sortBy: "floor_no",
      sortOrder: "desc",
    },
  ]);
  expect(result.map(({ floorNo }) => floorNo)).toEqual([3, 2, 1, 0]);
  expect(result.map(({ state }) => state)).toEqual([
    "failed",
    "failed",
    "failed",
    "committed",
  ]);
});

it("loads every page and hidden message without filtering and preserves full records", async () => {
  const pages = [
    {
      id: "input",
      floorId: "floor-1",
      isActive: true,
      pageKind: "input",
      pageNo: 1,
      version: 3,
      checksum: "input-checksum",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "inactive-input",
      floorId: "floor-1",
      isActive: false,
      pageKind: "input",
      pageNo: 2,
      version: 4,
      checksum: "old-input-checksum",
      createdAt: 3,
      updatedAt: 4,
    },
    {
      id: "inactive-output",
      floorId: "floor-1",
      isActive: false,
      pageKind: "output",
      pageNo: 3,
      version: 5,
      checksum: "output-checksum",
      createdAt: 3,
      updatedAt: 4,
    },
  ];
  const pageList = vi.fn(
    async ({ offset, limit }: { offset: number; limit: number }) =>
      pages.slice(offset, offset + limit),
  );
  const messages = [
    {
      id: "visible-input",
      pageId: "input",
      role: "user",
      seq: 1,
      content: "request",
      contentFormat: "markdown",
      createdAt: 1,
      isHidden: false,
      source: "manual",
      tokenCount: 5,
    },
    {
      id: "hidden-input",
      pageId: "input",
      role: "system",
      seq: 2,
      content: "hidden record",
      contentFormat: "json",
      createdAt: 2,
      isHidden: true,
      source: "runtime",
      tokenCount: 8,
    },
    {
      id: "old-inactive-input",
      pageId: "inactive-input",
      role: "user",
      seq: 1,
      content: "stale prior input",
      contentFormat: "text",
      createdAt: 2,
      isHidden: false,
      source: "manual",
      tokenCount: 18,
    },
    {
      id: "inactive-page-reply",
      pageId: "inactive-output",
      role: "assistant",
      seq: 1,
      content: "saved output",
      contentFormat: "text",
      createdAt: 3,
      isHidden: false,
      source: "model",
      tokenCount: 9,
    },
  ];
  const messageList = vi.fn(
    async ({
      pageId,
      offset,
      limit,
    }: {
      pageId: string;
      offset: number;
      limit: number;
    }) =>
      messages
        .filter((message) => message.pageId === pageId)
        .slice(offset, offset + limit),
  );
  const client = {
    pages: { list: pageList },
    messages: { list: messageList },
  } as unknown as TavernClient;

  const result = await loadGenerationDetailFloor(client, floor(1), 2);

  expect(pageList.mock.calls.map(([query]) => query)).toEqual([
    {
      floorId: "floor-1",
      limit: 2,
      offset: 0,
      sortBy: "page_no",
      sortOrder: "asc",
    },
    {
      floorId: "floor-1",
      limit: 2,
      offset: 2,
      sortBy: "page_no",
      sortOrder: "asc",
    },
  ]);
  expect(messageList).toHaveBeenCalledTimes(4);
  expect(messageList.mock.calls.map(([query]) => query)).toEqual(
    expect.arrayContaining([
      { pageId: "input", limit: 2, offset: 0, sortBy: "seq", sortOrder: "asc" },
      { pageId: "input", limit: 2, offset: 2, sortBy: "seq", sortOrder: "asc" },
      {
        pageId: "inactive-input",
        limit: 2,
        offset: 0,
        sortBy: "seq",
        sortOrder: "asc",
      },
      {
        pageId: "inactive-output",
        limit: 2,
        offset: 0,
        sortBy: "seq",
        sortOrder: "asc",
      },
    ]),
  );
  expect(result?.pages).toEqual([
    expect.objectContaining({
      ...pages[0],
      messages: [
        expect.objectContaining(messages[0]),
        expect.objectContaining(messages[1]),
      ],
    }),
    expect.objectContaining({
      ...pages[1],
      messages: [expect.objectContaining(messages[2])],
    }),
    expect.objectContaining({
      ...pages[2],
      messages: [expect.objectContaining(messages[3])],
    }),
  ]);
  expect(result?.activePages.map((page) => page.id)).toEqual(["input"]);
  expect(result?.messages.map((message) => message.id)).toEqual([
    "visible-input",
  ]);
  expect(
    result?.messages.find((message) => message.role === "user")?.content,
  ).toBe("request");
  expect(
    messageList.mock.calls.every(([query]) => !("isHidden" in query)),
  ).toBe(true);
});

it("returns an empty snapshot when a floor has no pages", async () => {
  const pageList = vi.fn(async () => []);
  const messageList = vi.fn(async () => []);
  const client = {
    pages: { list: pageList },
    messages: { list: messageList },
  } as unknown as TavernClient;

  const result = await loadGenerationDetailFloor(client, floor(0), 30);

  expect(result?.pages).toEqual([]);
  expect(result?.messages).toEqual([]);
  expect(pageList).toHaveBeenCalledOnce();
  expect(messageList).not.toHaveBeenCalled();
});

it.each(["pages", "messages"] as const)(
  "propagates a %s listing failure for the parent to present without a partial snapshot",
  async (resource) => {
    const client = {
      pages: {
        list: vi.fn(async () => {
          if (resource === "pages") throw new Error("page list failed");
          return [
            {
              id: "input",
              floorId: "floor-1",
              isActive: true,
              pageKind: "input",
              pageNo: 1,
              version: 1,
              checksum: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ];
        }),
      },
      messages: {
        list: vi.fn(async () => {
          if (resource === "messages") throw new Error("message list failed");
          return [];
        }),
      },
    } as unknown as TavernClient;

    await expect(
      loadGenerationDetailFloor(client, floor(1), 30),
    ).rejects.toThrow(
      resource === "pages" ? "page list failed" : "message list failed",
    );
  },
);

it("stops fetching later pages once a caller marks the selection stale", async () => {
  let current = true;
  const pageList = vi.fn(async () => {
    current = false;
    return Array.from({ length: 2 }, (_, index) => ({
      id: `page-${index}`,
      floorId: "floor-1",
      isActive: true,
      pageKind: "input" as const,
      pageNo: index,
      version: 1,
      checksum: null,
      createdAt: index,
      updatedAt: index,
    }));
  });
  const client = {
    pages: { list: pageList },
    messages: { list: vi.fn(async () => []) },
  } as unknown as TavernClient;

  const result = await loadGenerationDetailFloor(
    client,
    floor(1),
    2,
    () => current,
  );

  expect(result).toBeNull();
  expect(pageList).toHaveBeenCalledOnce();
});
