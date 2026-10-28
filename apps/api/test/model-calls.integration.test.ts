import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildTestApp } from "./helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import {
  accounts,
  floors,
  sessions,
  presets,
  regexProfiles,
  worldbooks,
  worldbookEntries,
} from "../src/db/schema.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("standard model call history routes", () => {
  it.each(
    ["compat_plus", "compat_strict", "native"].flatMap((mode) => [
      { depth: 0, rewrite: false, mode },
      { depth: 2, rewrite: false, mode },
      { depth: 0, rewrite: true, mode },
    ]),
  )(
    "matches dry-run and wire messages with history-only regex $depth rewrite=$rewrite mode=$mode",
    async ({ depth, rewrite, mode }) => {
      const wire: Array<{
        messages: Array<{ role: string; content: string }>;
      }> = [];
      const network = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          wire.push(JSON.parse(await new Request(input, init).text()));
          return new Response(
            JSON.stringify({
              id: "response",
              object: "chat.completion",
              created: 1,
              model: "test",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "reply" },
                  finish_reason: "stop",
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      );
      const built = await buildTestApp({
        databasePath: ":memory:",
        auth: { mode: "off" },
        logger: false,
        enablePromptDryRun: true,
        orchestration: {
          providers: [
            {
              id: "test",
              type: "openai-compatible",
              apiMode: "chat",
              apiKey: "test",
              options: { fetch: network },
            },
          ],
          defaultModel: { providerId: "test", modelId: "test" },
        },
      });
      app = built.app;
      const now = Date.now();
      await built.database.insert(presets).values({
        id: "preset",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        name: "Preset",
        source: "sillytavern",
        createdAt: now,
        updatedAt: now,
        dataJson: JSON.stringify({
          prompts: [
            { identifier: "main", role: "user", content: "utility-before" },
            { identifier: "worldInfoBefore", marker: true },
            { identifier: "chatHistory", marker: true },
            { identifier: "tail", role: "user", content: "utility-after" },
          ],
          prompt_order: [
            {
              character_id: 100001,
              order: [
                { identifier: "main", enabled: true },
                { identifier: "worldInfoBefore", enabled: true },
                { identifier: "chatHistory", enabled: true },
                { identifier: "tail", enabled: true },
              ],
            },
          ],
          names_behavior: 1,
        }),
      });
      await built.database.insert(regexProfiles).values({
        id: "regex",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        name: "Regex",
        source: "sillytavern",
        createdAt: now,
        updatedAt: now,
        dataJson: JSON.stringify([
          {
            id: "wrap",
            scriptName: "Wrap",
            findRegex: "/^([\\s\\S]*)$/",
            replaceString: rewrite
              ? "<latest>rewritten</latest>"
              : "<latest>$1</latest>",
            placement: [1],
            promptOnly: true,
            markdownOnly: false,
            disabled: false,
            minDepth: depth,
            maxDepth: depth,
            substituteRegex: 0,
            trimStrings: [],
          },
        ]),
      });
      await built.database
        .insert(worldbooks)
        .values({
          id: "worldbook",
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          name: "Worldbook",
          source: "sillytavern",
          createdAt: now,
          updatedAt: now,
          dataJson: JSON.stringify({ scanDepth: 1, recursiveScan: false }),
        });
      for (const [uid, key] of [
        [1, "current"],
        [2, "rewritten"],
      ] as const) {
        await built.database
          .insert(worldbookEntries)
          .values({
            id: `entry-${uid}`,
            worldbookId: "worldbook",
            uid,
            comment: key,
            content: `Lore ${uid}`,
            keysJson: JSON.stringify([key]),
            keysSecondaryJson: "[]",
            selective: false,
            selectiveLogic: 0,
            constant: false,
            position: 0,
            order: uid,
            depth: 4,
            role: 0,
            disable: false,
            createdAt: now,
            updatedAt: now,
          });
      }
      const created = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: {
          title: "Persona",
          prompt_mode: mode,
          preset_id: "preset",
          regex_profile_id: "regex",
          worldbook_profile_id: "worldbook",
          user_snapshot: { name: "Pei", description: "male, age 30" },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().data.id;
      const first = await app.inject({
        method: "POST",
        url: `/sessions/${id}/respond`,
        payload: { message: "history", generation_params: { stream: false } },
      });
      expect(first.statusCode, first.body).toBe(200);
      const dry = await app.inject({
        method: "POST",
        url: `/sessions/${id}/respond/dry-run`,
        payload: { message: "current" },
      });
      expect(dry.statusCode, dry.body).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: `/sessions/${id}/respond`,
        payload: { message: "current", generation_params: { stream: false } },
      });
      expect(second.statusCode, second.body).toBe(200);
      expect(network).toHaveBeenCalledTimes(2);
      expect(dry.json().data.messages).toEqual(wire[1]!.messages);
      expect(
        dry.json().data.prompt_snapshot.worldbook_activated_entry_uids,
      ).toEqual([1]);
      const text = wire[1]!.messages.map((m) => m.content).join("\n");
      expect(text).toContain(
        `<latest>${rewrite ? "rewritten" : depth === 0 ? "current" : "history"}</latest>`,
      );
      expect(text).not.toMatch(/<latest>[^<]*utility/);
      expect(text.match(/<latest>/g)).toHaveLength(1);
    },
  );

  it.each(["none", "prepared", "succeeded", "outcome"])(
    "records through the formal generation endpoint with write failure=%s",
    async (failWrite) => {
      const network = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "response",
              object: "chat.completion",
              created: 1,
              model: "test",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "hello" },
                  finish_reason: "stop",
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );
      const built = await buildTestApp({
        databasePath: ":memory:",
        auth: { mode: "off" },
        logger: false,
        orchestration: {
          providers: [
            {
              id: "test",
              type: "openai-compatible",
              apiMode: "chat",
              apiKey: "test-secret",
              options: { fetch: network },
            },
          ],
          defaultModel: { providerId: "test", modelId: "test" },
        },
      });
      app = built.app;
      const created = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { title: "Session" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const sessionId = created.json().data.id;
      if (failWrite === "prepared")
        built.database.$client.exec(
          "CREATE TRIGGER deny_call BEFORE INSERT ON model_call_records BEGIN SELECT RAISE(ABORT, 'call storage unavailable'); END",
        );
      if (failWrite === "succeeded")
        built.database.$client.exec(
          "CREATE TRIGGER deny_call BEFORE UPDATE ON model_call_records WHEN NEW.status = 'succeeded' BEGIN SELECT RAISE(ABORT, 'call storage unavailable'); END",
        );
      if (failWrite === "outcome")
        built.database.$client.exec(
          "CREATE TRIGGER deny_call BEFORE UPDATE ON model_call_records WHEN NEW.turn_commit_status = 'committed' BEGIN SELECT RAISE(ABORT, 'call storage unavailable'); END",
        );
      const response = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/respond`,
        payload: { message: "Hello", generation_params: { stream: false } },
      });
      if (failWrite !== "none") {
        expect(response.statusCode, response.body).toBe(503);
        expect(response.json().error.code).toBe("MODEL_CALL_SAVE_FAILED");
        expect(response.json().error.details.stage).toBe(
          failWrite === "outcome" ? "turn_outcome" : failWrite,
        );
        expect(JSON.stringify(response.json().error.details.error)).toContain(
          "call storage unavailable",
        );
        if (failWrite === "outcome")
          expect(response.json().error.details).toMatchObject({
            call_id: null,
            run_id: expect.any(String),
            floor_id: expect.any(String),
            turn_committed: true,
          });
        else
          expect(response.json().error.details.call_id).toEqual(
            expect.any(String),
          );
        expect(network).toHaveBeenCalledTimes(failWrite === "prepared" ? 0 : 1);
        if (failWrite === "outcome") {
          const floor = built.database
            .select()
            .from(floors)
            .all()
            .find((item) => item.state === "committed");
          expect(floor).toBeDefined();
        }
      } else {
        expect(response.statusCode, response.body).toBe(200);
        expect(network).toHaveBeenCalledTimes(1);
        const history = (
          await app.inject(
            `/floors/${response.json().data.floor_id}/model-calls`,
          )
        ).json();
        expect(history.data).toHaveLength(1);
        expect(history.data[0]).toMatchObject({
          call: {
            status: "succeeded",
            text: "hello",
            slot: "narrator",
            outputPageId: expect.any(String),
            outputMessageId: expect.any(String),
          },
          turnCommitStatus: "committed",
        });
        expect(JSON.stringify(history)).not.toContain("test-secret");
      }
    },
  );

  it("exposes the formal history route and schema and checks floor ownership", async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      logger: false,
    });
    app = built.app;
    await built.database.insert(sessions).values({
      id: "session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      title: "Session",
      createdAt: 1,
      updatedAt: 1,
    });
    await built.database.insert(floors).values({
      id: "floor",
      sessionId: "session",
      floorNo: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const response = await app.inject("/floors/floor/model-calls");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [], nextCursor: null });
    expect((await app.inject("/floors/missing/model-calls")).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject("/floors/floor/model-calls/missing")).statusCode,
    ).toBe(404);
    expect(
      (await app.inject("/floors/floor/model-calls?limit=0")).statusCode,
    ).toBe(400);
    const openapi = (await app.inject("/openapi.json")).json();
    expect(openapi.paths["/floors/{id}/model-calls"].get.operationId).toBe(
      "listModelCalls",
    );
  });

  it("denies a non-administrator authenticated account", async () => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      accountMode: "multi",
      auth: {
        mode: "api_key",
        apiKeys: ["test-user-key"],
        apiKeyAccountMap: { "test-user-key": "regular-user" },
      },
      logger: false,
    });
    app = built.app;
    await built.database.insert(accounts).values({
      id: "regular-user",
      name: "Regular User",
      role: "user",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const response = await app.inject({
      url: "/floors/any/model-calls",
      headers: { authorization: "Bearer test-user-key" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("MODEL_CALL_ACCESS_DENIED");
  });
});

it.each([false, true])(
  "propagates provider finish_reason error without committing partial output, stream=%s",
  async (stream) => {
    const network = vi.fn(async () => {
      const choice = {
        index: 0,
        finish_reason: "error",
        ...(stream
          ? { delta: { role: "assistant", content: "partial" } }
          : { message: { role: "assistant", content: "partial" } }),
      };
      const body = JSON.stringify({
        id: "response",
        object: stream ? "chat.completion.chunk" : "chat.completion",
        created: 1,
        model: "test",
        choices: [choice],
      });
      return new Response(stream ? `data: ${body}\n\ndata: [DONE]\n\n` : body, {
        headers: {
          "content-type": stream ? "text/event-stream" : "application/json",
        },
      });
    });
    const built = await buildTestApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      logger: false,
      enableSseChat: true,
      orchestration: {
        providers: [
          {
            id: "test",
            type: "openai-compatible",
            apiMode: "chat",
            apiKey: "test",
            options: { fetch: network },
          },
        ],
        defaultModel: { providerId: "test", modelId: "test" },
      },
    });
    app = built.app;
    const session = (
      await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { title: "Provider failure" },
      })
    ).json().data;
    const response = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/respond${stream ? "/stream" : ""}`,
      payload: { message: "Hello", generation_params: { stream } },
    });
    if (stream) {
      expect(response.body).toContain("event: error");
      expect(response.body).not.toContain("event: done");
    } else expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      built.database
        .select()
        .from(floors)
        .all()
        .some((floor) => floor.state === "committed"),
    ).toBe(false);
    const records = built.database.$client
      .prepare("SELECT record_json FROM model_call_records")
      .all() as Array<{ record_json: string }>;
    expect(records.length).toBeGreaterThan(0);
    for (const row of records)
      expect(JSON.parse(row.record_json)).toMatchObject({
        status: "failed",
        text: "partial",
        finishReason: "error",
        error: { code: "MODEL_PROVIDER_RESPONSE_ERROR" },
      });
  },
);
