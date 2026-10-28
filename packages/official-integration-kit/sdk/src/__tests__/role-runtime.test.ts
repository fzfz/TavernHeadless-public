import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const snapshot = {
  sessionId: "session",
  branchId: "main",
  floorId: "floor",
  attemptId: "run:1",
  versionId: "version",
  snapshotId: "snapshot",
  parentSnapshotId: "initial",
  variables: { score: 2 },
  source: { kind: "floor", runId: "run", jobId: null },
};
const statePromptPreview = {
  messages: [
    { role: "system", content: "Follow the state update rules." },
    { role: "user", content: "The task is complete." },
  ],
  preset: { presetId: "state-preset", presetVersionId: "state-preset-v3" },
  before: { score: 1 },
  previousSnapshotId: "snapshot-before",
  sources: [
    {
      messageId: "assistant-message",
      revision: 2,
      role: "assistant",
      text: "The task is complete.",
    },
  ],
  variableHistory: [
    {
      floorId: "previous-floor",
      floorNo: 1,
      before: { score: 0 },
      after: { score: 1 },
      changes: [{ op: "set", path: "/score", value: 1 }],
      snapshotIds: ["snapshot-before"],
    },
  ],
  sourceIdentity: { floorId: "floor/target", outputPageId: "page-1" },
  outputSchema: { type: "object" },
  prompt_snapshot: { floorId: "floor/target" },
  assembly: { order: ["rules", "state"] },
  runtime_trace: { source: "preset" },
  token_usage: { total: 42, availableForReply: 900 },
};

describe("role runtime SDK contracts", () => {
  it("previews a state update with the fixed floor snapshot, account, signal, and validated response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: statePromptPreview }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer token" }),
    });
    const controller = new AbortController();

    await expect(
      client.roleRuntime.previewStateUpdate({
        accountId: "account/a",
        sessionId: "session/a",
        floorId: "floor/target",
        expectedSnapshotId: "snapshot-before",
        signal: controller.signal,
      }),
    ).resolves.toEqual(statePromptPreview);

    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.test/sessions/session%2Fa/role-state/updates/dry-run",
    );
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      floor_id: "floor/target",
      expected_snapshot_id: "snapshot-before",
    });
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-account-id")).toBe("account/a");
    expect(headers.get("content-type")).toContain("application/json");
    expect(request?.signal).toBe(controller.signal);
  });

  it("validates state preview inputs before sending and rejects malformed preview responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: {} }));
    const client = createTavernClient({ baseUrl: "https://api.test", fetchImpl });

    await expect(
      client.roleRuntime.previewStateUpdate({
        sessionId: "session",
        floorId: "",
        expectedSnapshotId: "snapshot",
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      client.roleRuntime.previewStateUpdate({
        sessionId: "session",
        floorId: "floor",
        expectedSnapshotId: "snapshot",
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("preserves backend errors from state preview requests", async () => {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        json(
          { error: { code: "ROLE_STATE_CONFIG_MISSING", message: "No state preset is bound." } },
          409,
        ),
      ),
    });

    await expect(
      client.roleRuntime.previewStateUpdate({
        sessionId: "session",
        floorId: "floor",
        expectedSnapshotId: "snapshot",
      }),
    ).rejects.toMatchObject({ code: "ROLE_STATE_CONFIG_MISSING", status: 409 });
  });

  it("inspects a fixed proposal through the authenticated session endpoint without a generation request", async () => {
    const input = { sourceMessages: [{ messageId: "preview-message", revision: 1, role: "assistant", text: "抵达花园" }], proposal: { changes: [{ op: "set" as const, path: "/score", value: 2 }], evidenceMessageIds: ["preview-message"] } };
    const result = { before: { score: 1 }, candidate: { score: 2 }, derived: { score: 3 }, valid: true, issues: [] };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ data: result }));
    const client = createTavernClient({ baseUrl: "https://api.test", fetchImpl, getHeaders: () => ({ authorization: "Bearer token" }) });
    expect(await client.roleRuntime.inspectProposal({ sessionId: "session/a", input })).toEqual(result);
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test/sessions/session%2Fa/role-state/inspect-proposal");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual(input);
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer token");
    await expect(client.roleRuntime.inspectProposal({ sessionId: "session/a", input: { ...input, sourceMessages: [] } })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("submits and validates variable updates with the configured auth and abort signal", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: snapshot }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer token" }),
    });
    const controller = new AbortController();
    expect(
      await client.roleRuntime.updateState({
        sessionId: "session/a",
        floorId: "floor",
        signal: controller.signal,
      }),
    ).toEqual(snapshot);
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.test/sessions/session%2Fa/role-state/updates",
    );
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ floor_id: "floor" });
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer token",
    );
    expect(request?.signal).toBe(controller.signal);
  });
  it("lists history independently and reads projected messages with branch scope", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: snapshot }))
      .mockResolvedValueOnce(
        json({
          data: {
            items: [{ snapshotId: "s/a", floorId: "f/a", attemptId: "run:1" }],
            nextCursor: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            items: [{ floorId: "f/a", floorNo: 2, state: "committed" }],
            nextCursor: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: "message",
              role: "assistant",
              content: "Visible",
              source: null,
            },
          ],
        }),
      );
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    await client.roleRuntime.getSnapshot({
      sessionId: "session",
      snapshotId: "s/a",
    });
    await client.roleRuntime.listSnapshots({
      sessionId: "session",
      branchId: "branch/a",
      cursor: "older",
      limit: 12,
    });
    await client.roleRuntime.listFloors({
      sessionId: "session",
      branchId: "branch/a",
      limit: 12,
    });
    expect(
      await client.roleRuntime.getMessages({
        sessionId: "session",
        branchId: "branch/a",
        floorId: "f/a",
      }),
    ).toHaveLength(1);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.test/sessions/session/role-view/snapshots/s%2Fa",
      "https://api.test/sessions/session/role-view/snapshots?branch_id=branch%2Fa&limit=12&cursor=older",
      "https://api.test/sessions/session/role-messages/floors?branch_id=branch%2Fa&limit=12",
      "https://api.test/sessions/session/role-messages?branch_id=branch%2Fa&floor_id=f%2Fa",
    ]);
  });
  it("applies shared history defaults and rejects limits outside the shared range", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: { items: [], nextCursor: null } }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    await client.roleRuntime.listSnapshots({
      sessionId: "session",
      branchId: "main",
    });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/sessions/session/role-view/snapshots?branch_id=main&limit=20",
    );
    await expect(
      client.roleRuntime.listFloors({
        sessionId: "session",
        branchId: "main",
        limit: 101,
      }),
    ).rejects.toMatchObject({ code: "ROLE_RUNTIME_LIST_PAGE_SIZE_INVALID" });
    await expect(
      client.roleRuntime.listSnapshots({
        sessionId: "session",
        branchId: "main",
        cursor: "",
      }),
    ).rejects.toMatchObject({ code: "ROLE_HISTORY_CURSOR_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed view and state responses", async () => {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json({ data: {} })),
    });
    await expect(
      client.roleRuntime.getView({ sessionId: "session" }),
    ).rejects.toThrow();
    await expect(
      client.roleRuntime.getSnapshot({
        sessionId: "session",
        snapshotId: "snapshot",
      }),
    ).rejects.toThrow();
  });
  it("does not send an invalid asset import", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    await expect(
      client.roleRuntime.importAssets({
        versionId: "version",
        input: { character_id: "character", files: [] },
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("validates release lists and rejects invalid publication input before sending it", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [] }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    expect(
      await client.roleReleases.list({ latestPerCharacter: true }),
    ).toEqual([]);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/role-releases?latest_per_character=true",
    );
    await expect(
      client.roleReleases.create({ input: {} as never }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("requests active publications and validates publication changes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [] }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    await client.roleReleases.list({ activeOnly: true });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/role-releases?latest_per_character=false&active_only=true",
    );
    await expect(
      client.roleReleases.setPublication({
        releaseId: "release",
        active: "yes" as never,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    fetchImpl.mockResolvedValue(
      json(
        { error: { code: "role_release_not_found", message: "missing" } },
        404,
      ),
    );
    await expect(
      client.roleReleases.setPublication({ releaseId: "r/a", active: false }),
    ).rejects.toThrow();
    const [url, request] = fetchImpl.mock.calls[1]!;
    expect(String(url)).toBe(
      "https://api.test/role-releases/r%2Fa/publication",
    );
    expect(request?.method).toBe("PUT");
    expect(JSON.parse(String(request?.body))).toEqual({ active: false });
  });
  it("sends the validated role migration through the standard character import resource", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: {
          character_id: "character",
          character_version_id: "version",
          character: {},
          create_session: false,
        },
      }),
    );
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
    });
    const roleMigration = {
      stateUpdate: {
        profile: { updaterPrompt: "Update state", writablePaths: [] },
        files: {},
      },
      migration: {
        disabledEntryIds: [],
        ruleEntryIds: [],
        readonlyPaths: [],
        cleanRuleFiles: [],
        controllerEntryIds: [],
        initialEntryId: 1,
      },
      metadata: { defaultOpeningId: "first", entries: {} },
    };
    const result = await client.imports.character({
      payload: { name: "Role" },
      createSession: false,
      roleMigration,
    });
    expect(result.characterId).toBe("character");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject(
      { create_session: false, role_migration: roleMigration },
    );
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/import/character",
    );
    fetchImpl.mockClear();
    await expect(
      client.imports.character({ payload: {}, roleMigration: {} as never }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("propagates resource failures with backend codes", async () => {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        json(
          {
            error: {
              code: "ROLE_RELEASE_NOT_FOUND",
              message: "Missing release",
            },
          },
          404,
        ),
      ),
    });
    await expect(
      client.roleReleases.createSession({ releaseId: "missing" }),
    ).rejects.toMatchObject({ code: "ROLE_RELEASE_NOT_FOUND", status: 404 });
  });
});
