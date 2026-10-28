import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { SimpleTokenCounter, type TurnOrchestrator } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { registerChatRoutes } from "../src/routes/chat";
import { ChatService } from "../src/services/chat/chat-service";
import { createTestDatabase, type DatabaseConnection } from "./helpers/create-test-db.js";
import {
  floors,
  messagePages,
  messages,
  presets,
  sessions,
  worldbookEntries,
  worldbooks,
} from "../src/db/schema";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";
import { SessionBranchRegistryService } from "../src/services/variables/host/session-branch-registry-service.js";

const DEPTH_ENTRIES = [
  { uid: 101, role: 0, depth: 0, order: 10, content: "DEPTH_0_SYSTEM" },
  { uid: 102, role: 1, depth: 0, order: 20, content: "DEPTH_0_USER" },
  { uid: 103, role: 2, depth: 0, order: 30, content: "DEPTH_0_ASSISTANT" },
  { uid: 104, role: 1, depth: 1, order: 40, content: "DEPTH_1_USER" },
] as const;

const PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Identity Context",
      role: "system",
      content: "扮演{{char}}。用户{{user}}的人设：{{persona}}",
    },
    { identifier: "chatHistory", name: "Chat History", marker: true },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
      ],
    },
  ],
  openai_max_context: 4096,
  openai_max_tokens: 512,
  temperature: 0.7,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "",
  assistant_prefill: "",
  wi_format: "{0}",
  names_behavior: 1,
  stream_openai: true,
};

const USER_PERSONA = {
  name: "顾闻溪",
  description:
    "顾闻溪，女性，29岁，旧城档案馆的纸本文献修复师。她做事细致克制，熟悉河岸旧桥的档案，正在陪同沈砚舟寻找一张失落的测绘图。",
};

describe("POST /sessions/:id/respond/dry-run depth worldbook roles", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;
  let sessionId: string;
  let mockExecuteTurn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    database = createTestDatabase(":memory:");
    sessionId = nanoid();
    const now = Date.now();

    const mockOrchestrator = {
      executeTurn: vi.fn(async () => {
        throw new Error("dry-run must not call the turn orchestrator");
      }),
    };
    mockExecuteTurn = mockOrchestrator.executeTurn;
    const chatService = new ChatService(
      database.db,
      mockOrchestrator as unknown as TurnOrchestrator,
      new SimpleTokenCounter(),
    );

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Depth role dry-run",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      promptMode: "native",
      createdAt: now,
      updatedAt: now,
    });
    new SessionBranchRegistryService(database.db).ensure({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      createdAt: now,
      updatedAt: now,
    });

    const earlierFloorId = nanoid();
    const laterFloorId = nanoid();
    await database.db.insert(floors).values([
      {
        id: earlierFloorId,
        sessionId,
        floorNo: 0,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: laterFloorId,
        sessionId,
        floorNo: 1,
        branchId: "main",
        parentFloorId: earlierFloorId,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ]);

    const historyMessages = [
      {
        floorId: earlierFloorId,
        pageId: nanoid(),
        pageKind: "input" as const,
        role: "user" as const,
        content: "我在旧桥档案里找到了半张测绘图。",
        createdAt: now,
      },
      {
        floorId: laterFloorId,
        pageId: nanoid(),
        pageKind: "output" as const,
        role: "assistant" as const,
        content: "我会陪你沿河岸去找图纸的另一半。",
        createdAt: now + 1,
      },
    ];
    for (const [messageSeq, entry] of historyMessages.entries()) {
      await database.db.insert(messagePages).values({
        id: entry.pageId,
        floorId: entry.floorId,
        pageNo: 0,
        pageKind: entry.pageKind,
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
      });
      await database.db.insert(messages).values({
        id: nanoid(),
        pageId: entry.pageId,
        seq: messageSeq,
        role: entry.role,
        content: entry.content,
        contentFormat: "text",
        tokenCount: 1,
        isHidden: false,
        source: "api",
        createdAt: entry.createdAt,
      });
    }

    const presetId = nanoid();
    const worldbookId = nanoid();
    await database.db.insert(presets).values({
      id: presetId,
      name: "Depth role acceptance preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Depth role acceptance worldbook",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({ scanDepth: 3 }),
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(worldbookEntries).values(
      DEPTH_ENTRIES.map((entry) => ({
        id: nanoid(),
        worldbookId,
        uid: entry.uid,
        comment: entry.content,
        content: entry.content,
        keysJson: "[]",
        keysSecondaryJson: "[]",
        selective: false,
        selectiveLogic: 0,
        constant: true,
        position: 4,
        order: entry.order,
        depth: entry.depth,
        role: entry.role,
        disable: false,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        characterSnapshotJson: JSON.stringify({
          name: "沈砚舟",
          description: "沈砚舟，男性，31岁，河道测绘员，沉稳而敏锐。",
          characterBook: {
            entries: [
              {
                uid: 201,
                key: [],
                keysecondary: [],
                selective: false,
                constant: true,
                content: "DEPTH_2_DEFAULT_ROLE",
                position: 4,
                order: 50,
                depth: 2,
              },
            ],
          },
        }),
        userSnapshotJson: JSON.stringify(USER_PERSONA),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app, database.db);
    await registerChatRoutes(app, chatService, {
      enablePromptDryRun: true,
      enableSseChat: false,
    });
  });

  afterEach(async () => {
    if (app) await app.close();
    database.close();
    vi.restoreAllMocks();
  });

  it("preserves depth roles, same-depth order, default role, and named conversation order", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/respond/dry-run`,
      payload: {
        message: "我们现在沿河岸寻找另一半测绘图，对吗？",
        budget: { max_input_tokens: 4096, reserved_completion_tokens: 512 },
        debug_options: { include_worldbook_matches: true },
      },
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data as {
      messages: Array<{ role: string; content: string }>;
      token_estimate: number;
      available_for_reply: number;
      assembly: {
        worldbook_matches: Array<{
          uid: number;
          content_preview: string;
          insertion: { position: string; depth?: number; role?: string };
        }>;
      };
      runtime_trace: {
        worldbook: {
          matches: Array<{
            uid: number;
            insertion: { depth?: number; role?: string };
          }>;
        };
      };
    };
    const worldbookMatches = data.assembly.worldbook_matches;

    expect(
      data.messages.find((message) => message.role === "system")?.content,
    ).toContain(`${USER_PERSONA.name}的人设：${USER_PERSONA.description}`);
    expect(data.runtime_trace.worldbook.matches).toEqual(worldbookMatches);
    expect(data.token_estimate + data.available_for_reply).toBe(4608);
    expect(
      worldbookMatches.map((match) => [match.uid, match.content_preview]),
    ).toEqual([
      [104, "DEPTH_1_USER"],
      [103, "DEPTH_0_ASSISTANT"],
      [102, "DEPTH_0_USER"],
      [101, "DEPTH_0_SYSTEM"],
      [201, "DEPTH_2_DEFAULT_ROLE"],
    ]);
    expect(
      worldbookMatches.map((match) => [match.uid, match.insertion]),
    ).toEqual([
      [104, { position: "at_depth", depth: 1, role: "user" }],
      [103, { position: "at_depth", depth: 0, role: "assistant" }],
      [102, { position: "at_depth", depth: 0, role: "user" }],
      [101, { position: "at_depth", depth: 0, role: "system" }],
      [201, { position: "at_depth", depth: 2, role: "system" }],
    ]);

    const contentIndex = (needle: string) =>
      data.messages.findIndex((message) => message.content.includes(needle));
    const depthZeroMessages = data.messages.filter((message) =>
      message.content.includes("DEPTH_0_"),
    );
    expect(depthZeroMessages).toEqual([
      { role: "assistant", content: "DEPTH_0_ASSISTANT" },
      { role: "user", content: "DEPTH_0_USER" },
      { role: "system", content: "DEPTH_0_SYSTEM" },
    ]);
    expect(
      data.messages.find((message) => message.content.includes("DEPTH_1_USER"))
        ?.role,
    ).toBe("user");
    expect(
      data.messages.find((message) =>
        message.content.includes("DEPTH_2_DEFAULT_ROLE"),
      )?.role,
    ).toBe("system");
    const historicalUserIndex = contentIndex(
      "顾闻溪: 我在旧桥档案里找到了半张测绘图。",
    );
    const historicalAssistantIndex = contentIndex(
      "沈砚舟: 我会陪你沿河岸去找图纸的另一半。",
    );
    const currentUserIndex = contentIndex(
      "顾闻溪: 我们现在沿河岸寻找另一半测绘图，对吗？",
    );
    expect(data.messages[historicalUserIndex]?.role).toBe("user");
    expect(data.messages[historicalAssistantIndex]?.role).toBe("assistant");
    expect(data.messages[currentUserIndex]?.role).toBe("user");
    expect(historicalUserIndex).toBeGreaterThanOrEqual(0);
    expect(historicalAssistantIndex).toBeGreaterThan(historicalUserIndex);
    expect(currentUserIndex).toBeGreaterThan(historicalAssistantIndex);
    expect(contentIndex("DEPTH_2_DEFAULT_ROLE")).toBeLessThan(
      historicalAssistantIndex,
    );
    expect(contentIndex("DEPTH_1_USER")).toBeGreaterThan(
      historicalAssistantIndex,
    );
    expect(contentIndex("DEPTH_1_USER")).toBe(currentUserIndex);
    expect(
      data.messages[currentUserIndex]!.content.indexOf("DEPTH_1_USER"),
    ).toBeLessThan(
      data.messages[currentUserIndex]!.content.indexOf(
        "顾闻溪: 我们现在沿河岸寻找另一半测绘图，对吗？",
      ),
    );
    expect(contentIndex("DEPTH_0_USER")).toBeGreaterThan(currentUserIndex);
    expect(mockExecuteTurn).not.toHaveBeenCalled();
  });
});
