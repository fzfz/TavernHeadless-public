import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import { eq } from "drizzle-orm";
import type { CreateRoleReleaseBody } from "@tavern/shared";

import { buildTestApp } from "./helpers/create-test-db.js";
import { floors } from "../src/db/schema.js";
import { loadStorageConfig } from "../src/storage-config.js";
import {
  configuration,
  ids,
  seedRoleResources,
} from "./helpers/role-workspace.js";

function createClient(app: FastifyInstance): TavernClient {
  return createTavernClient({
    baseUrl: "http://tavern-integration.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        payload: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
}

describe("role workspace through the official SDK and Fastify", () => {
  let app: FastifyInstance;
  let client: TavernClient;
  let database: Awaited<ReturnType<typeof buildTestApp>>["database"];
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "role-workspace-sdk-"));
    const storage = loadStorageConfig({ DATA_DIR: dataRoot });
    const built = await buildTestApp({
      databasePath: ":memory:",
      storage,
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    database = built.database;
    client = createClient(app);
    await seedRoleResources(built.database, storage);
  });

  afterEach(async () => {
    await app?.close();
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  it("saves and rereads a draft, then manages a frozen draft preview session", async () => {
    const firstConfig = { ...configuration(), stateHistoryTurns: 5 };
    const draft = await client.roleApps.create({ configuration: firstConfig });
    expect(draft.revision).toBe(1);

    const editedConfig: CreateRoleReleaseBody = {
      ...firstConfig,
      name: "SDK Lighthouse · saved revision",
      model_slots: [
        {
          ...firstConfig.model_slots[0]!,
          params: { temperature: 0.2, max_output_tokens: 192 },
        },
      ],
    };
    const saved = await client.roleApps.update({
      id: draft.id,
      expectedRevision: draft.revision,
      configuration: editedConfig,
    });
    expect(saved.revision).toBe(2);
    expect((await client.roleApps.get({ id: draft.id })).configuration).toEqual(
      editedConfig,
    );

    const preview = await client.roleApps.createPreview({
      id: draft.id,
      expectedRevision: saved.revision,
    });
    const sessionId = String(preview.session.id);
    expect(preview).toMatchObject({
      draft_id: draft.id,
      draft_revision: 2,
    });
    expect(await client.roleApps.listPreviews({ id: draft.id })).toEqual([
      expect.objectContaining({
        id: sessionId,
        draft_revision: 2,
        status: "active",
      }),
    ]);

    const nextDraft = await client.roleApps.update({
      id: draft.id,
      expectedRevision: saved.revision,
      configuration: { ...editedConfig, name: "Next saved draft" },
    });
    expect(nextDraft.revision).toBe(3);
    expect(
      (await client.roleApps.listPreviews({ id: draft.id }))[0]?.draft_revision,
    ).toBe(2);

    const renamed = await client.sessions.update({
      sessionId,
      title: "Preview renamed through SDK",
    });
    expect(renamed.title).toBe("Preview renamed through SDK");
    const archived = await client.sessions.update({
      sessionId,
      status: "archived",
    });
    expect(archived.status).toBe("archived");
    expect(
      (await client.roleApps.listPreviews({ id: draft.id }))[0]?.status,
    ).toBe("archived");

    const restored = await client.sessions.update({
      sessionId,
      status: "active",
    });
    expect(restored.status).toBe("active");
    expect(await client.sessions.remove({ sessionId })).toBe(true);
    expect(await client.roleApps.listPreviews({ id: draft.id })).toEqual([]);
  });

  it("publishes, stops, and restores releases while existing sessions stay pinned", async () => {
    const draft = await client.roleApps.create({
      configuration: configuration(),
    });
    const firstRelease = await client.roleApps.publish({
      id: draft.id,
      expectedRevision: draft.revision,
    });
    const firstSession = await client.roleReleases.createSession({
      releaseId: firstRelease.id,
    });
    const firstSessionId = String(firstSession.session.id);
    const firstSessionSnapshot = await client.sessions.getDetail({
      sessionId: firstSessionId,
    });

    const editedConfig: CreateRoleReleaseBody = {
      ...configuration(),
      name: "SDK Lighthouse revision 2",
      model_slots: [
        {
          ...configuration().model_slots[0]!,
          params: { temperature: 0.8, max_output_tokens: 256 },
        },
      ],
    };
    const saved = await client.roleApps.update({
      id: draft.id,
      expectedRevision: draft.revision,
      configuration: editedConfig,
    });
    const secondRelease = await client.roleApps.publish({
      id: draft.id,
      expectedRevision: saved.revision,
    });
    expect(secondRelease.id).not.toBe(firstRelease.id);
    expect(
      (await client.roleReleases.list({ activeOnly: true })).map(
        ({ id }) => id,
      ),
    ).toEqual([secondRelease.id]);

    const secondSession = await client.roleReleases.createSession({
      releaseId: secondRelease.id,
    });
    const secondSessionId = String(secondSession.session.id);

    await client.roleReleases.setPublication({
      releaseId: secondRelease.id,
      active: false,
    });
    expect(await client.roleReleases.list({ activeOnly: true })).toEqual([]);
    await expectApiCode(
      () => client.roleReleases.createSession({ releaseId: secondRelease.id }),
      "ROLE_RELEASE_INACTIVE",
    );

    await client.roleReleases.setPublication({
      releaseId: firstRelease.id,
      active: true,
    });
    expect(
      (await client.roleReleases.list({ activeOnly: true })).map(
        ({ id }) => id,
      ),
    ).toEqual([firstRelease.id]);
    expect(
      await client.sessions.getDetail({ sessionId: firstSessionId }),
    ).toEqual(firstSessionSnapshot);
    expect(
      (await client.sessions.getDetail({ sessionId: secondSessionId }))
        .metadata,
    ).toMatchObject({
      role_release_id: secondRelease.id,
    });

    const branches = await client.sessions.listBranches({
      sessionId: firstSessionId,
    });
    expect(branches.map(({ branchId }) => branchId)).toContain("main");
    await expectApiCode(
      () =>
        client.sessions.diffBranches({
          sessionId: firstSessionId,
          baseBranchId: "main",
          targetBranchId: "missing-branch",
        }),
      "branch_not_found",
    );

    const existingMainFloors = await client.floors.list({
      sessionId: firstSessionId,
      branchId: "main",
    });
    const nextFloorNo =
      Math.max(-1, ...existingMainFloors.map(({ floorNo }) => floorNo)) + 1;
    const mainPageOne = await client.floors.create({
      sessionId: firstSessionId,
      branchId: "main",
      floorNo: nextFloorNo,
      state: "committed",
    });
    const mainPageTwo = await client.floors.create({
      sessionId: firstSessionId,
      branchId: "main",
      floorNo: nextFloorNo + 1,
      parentFloorId: mainPageOne.id,
      state: "committed",
    });
    const alternateFloor = await client.floors.create({
      sessionId: firstSessionId,
      branchId: "alternate",
      floorNo: 0,
      parentFloorId: mainPageOne.id,
      state: "committed",
    });
    const mainFirstPage = await client.sessions.timeline({
      sessionId: firstSessionId,
      branchId: "main",
      limit: 1,
      offset: 0,
    });
    const mainSecondPage = await client.sessions.timeline({
      sessionId: firstSessionId,
      branchId: "main",
      limit: 1,
      offset: 1,
    });
    const mainTimelineFloors = database
      .select()
      .from(floors)
      .where(eq(floors.sessionId, firstSessionId))
      .all();
    const committedMainFloorIds = mainTimelineFloors
      .filter(
        ({ branchId, state, supersededAt }) =>
          branchId === "main" && state === "committed" && supersededAt === null,
      )
      .sort((left, right) => left.floorNo - right.floorNo)
      .map(({ id }) => id);
    const expectedFirstPageIds = committedMainFloorIds.slice(0, 2);
    expect(mainFirstPage.floors).toHaveLength(1);
    expect(mainSecondPage.floors).toHaveLength(1);
    expect([mainFirstPage.floors[0]?.id, mainSecondPage.floors[0]?.id]).toEqual(
      expectedFirstPageIds,
    );
    expect(committedMainFloorIds).toEqual(
      expect.arrayContaining([mainPageOne.id, mainPageTwo.id]),
    );
    const alternateTimeline = await client.sessions.timeline({
      sessionId: firstSessionId,
      branchId: "alternate",
      limit: 10,
      offset: 0,
    });
    expect(alternateTimeline.floors.map(({ id }) => id)).toContain(
      alternateFloor.id,
    );
    expect(alternateTimeline.branchId).toBe("alternate");
    expect(
      (
        await client.sessions.timeline({
          sessionId: firstSessionId,
          branchId: "main",
          limit: 1,
          offset: 9999,
        })
      ).floors,
    ).toEqual([]);
    await expectApiCode(
      () => client.sessions.timeline({ sessionId: firstSessionId, limit: 0 }),
      "validation_error",
    );

    const branchVariable = await client.variables.upsert({
      scope: "branch",
      sessionId: firstSessionId,
      branchId: "main",
      key: "relationship",
      value: "new acquaintance",
    });
    await client.variables.upsert({
      scope: "branch",
      sessionId: firstSessionId,
      branchId: "main",
      key: "relationship",
      value: "trusted companion",
    });
    expect(
      await client.variables.getDetail({ variableId: branchVariable.id }),
    ).toMatchObject({
      scope: "branch",
      scopeId: branchVariable.scopeId,
      value: "trusted companion",
    });
    await client.variables.upsert({
      scope: "branch",
      sessionId: firstSessionId,
      branchId: "alternate",
      key: "relationship",
      value: "unfamiliar visitor",
    });
    expect(
      (
        await client.variables.resolveContext({
          sessionId: firstSessionId,
          branchId: "alternate",
        })
      ).resolved,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "relationship",
          value: "unfamiliar visitor",
        }),
      ]),
    );
    await expectApiCode(
      () =>
        client.variables.upsert({
          scope: "branch",
          sessionId: firstSessionId,
          branchId: "missing-branch",
          key: "invalid",
          value: true,
        }),
      "variable_host_not_found",
    );

    const memory = await client.memories.create({
      scope: "chat",
      scopeId: firstSessionId,
      type: "fact",
      content: "The keeper met the visitor at the lighthouse.",
    });
    await client.memories.update({
      memoryId: memory.id,
      content: "The keeper now trusts the visitor at the lighthouse.",
      importance: 0.9,
    });
    expect(
      await client.memories.getDetail({ memoryId: memory.id }),
    ).toMatchObject({
      id: memory.id,
      scope: "chat",
      scopeId: firstSessionId,
      content: "The keeper now trusts the visitor at the lighthouse.",
      importance: 0.9,
    });
    await expectApiCode(
      () => client.memories.getDetail({ memoryId: "missing-memory" }),
      "not_found",
    );

    const floor = database
      .select({ id: floors.id })
      .from(floors)
      .where(eq(floors.sessionId, firstSessionId))
      .get();
    expect(floor).toBeDefined();
    const history = await client.generationInspection.load({
      floorId: floor!.id,
    });
    expect(history.length).toBeGreaterThan(0);
    await expectApiCode(
      () => client.generationInspection.load({ floorId: "missing-floor" }),
      "not_found",
    );
  });
});

async function expectApiCode(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected API error ${code}`);
}
