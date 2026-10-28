import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type BuildAppResult } from "./helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import {
  characters,
  characterVersions,
  sessions,
  floors,
  messagePages,
  messages,
  roleDisplaySnapshots,
} from "../src/db/schema.js";
import { DisplaySnapshotService } from "../src/services/role-runtime/display-snapshot-service.js";
import { BranchLocalVariableSnapshotService } from "../src/services/branch-local-variable-snapshot-service.js";
import { SessionBranchRegistryService } from "../src/services/variables/host/session-branch-registry-service.js";
import { VariableService } from "../src/services/variables/variable-service.js";
import { eq } from "drizzle-orm";
import { buildBranchVariableScopeId } from "@tavern/shared";
import {
  InMemoryGenerationCoordinator,
  type GenerationCoordinator,
} from "../src/services/generation-guard-service.js";

let built: BuildAppResult | undefined;
afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

async function fixture(generationCoordinator?: GenerationCoordinator) {
  built = await buildTestApp({
    databasePath: ":memory:",
    accountMode: "multi",
    logger: false,
    generationCoordinator,
  });
  const db = built.database;
  db.insert(characters)
    .values({
      id: "char",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "角色",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  db.insert(characterVersions)
    .values({
      id: "version",
      characterId: "char",
      versionNo: 1,
      dataJson: "{}",
      contentHash: "fixture",
      createdAt: 1,
    })
    .run();
  db.insert(sessions)
    .values({
      id: "story",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      characterVersionId: "version",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  new SessionBranchRegistryService(db).ensure({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: "story",
    branchId: "main",
    createdAt: 1,
  });
  const snapshots = new DisplaySnapshotService(db);
  const initial = snapshots.initialize(DEFAULT_ADMIN_ACCOUNT_ID, "story", {
    score: 0,
  });
  const createFloor = (id: string, text: string, at: number) => {
    db.insert(floors)
      .values({
        id,
        sessionId: "story",
        branchId: "main",
        floorNo: 1,
        state: "committed",
        createdAt: at,
        updatedAt: at,
      })
      .run();
    db.insert(messagePages)
      .values({
        id: `page-${id}`,
        floorId: id,
        pageNo: 1,
        pageKind: "output",
        isActive: true,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    db.insert(messages)
      .values({
        id: `message-${id}`,
        pageId: `page-${id}`,
        seq: 0,
        role: "assistant",
        content: text,
        createdAt: at,
      })
      .run();
  };
  createFloor("answer-a", "第一份候选回复", 2);
  const a = {
    ...initial,
    snapshotId: "snapshot-a",
    parentSnapshotId: initial.snapshotId,
    floorId: "answer-a",
    attemptId: "attempt-a",
    source: { kind: "floor" as const, runId: "run-a", jobId: null },
    variables: { score: 1 },
  };
  snapshots.save(DEFAULT_ADMIN_ACCOUNT_ID, a);
  db.update(floors)
    .set({ supersededAt: 3 })
    .where(eq(floors.id, "answer-a"))
    .run();
  createFloor("answer-b", "第二份候选回复", 3);
  db.update(floors)
    .set({ supersededByFloorId: "answer-b" })
    .where(eq(floors.id, "answer-a"))
    .run();
  const b = {
    ...a,
    snapshotId: "snapshot-b",
    parentSnapshotId: a.snapshotId,
    floorId: "answer-b",
    attemptId: "attempt-b",
    source: { kind: "floor" as const, runId: "run-b", jobId: null },
    variables: { score: 2 },
  };
  snapshots.save(DEFAULT_ADMIN_ACCOUNT_ID, b);
  const local = new BranchLocalVariableSnapshotService(db);
  local.restoreSnapshot({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: "story",
    branchId: "main",
    floorId: "answer-a",
    createdAt: 2,
    values: { stat_data: { score: 1 }, note: "来自第一份回复" },
  });
  local.restoreSnapshot({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: "story",
    branchId: "main",
    floorId: "answer-b",
    createdAt: 3,
    values: { stat_data: { score: 2 }, extra: "第二份回复专有变量" },
  });
  new VariableService(db).restoreMany({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    items: [
      {
        scope: "branch",
        scopeId: buildBranchVariableScopeId("story", "main"),
        key: "extra",
        value: "第二份回复专有变量",
        updatedAt: 3,
      },
    ],
  });
  return built.app;
}

describe("reply candidate HTTP", () => {
  it("waits for the latest reply role state before switching to another candidate", async () => {
    const app = await fixture();
    built!.database
      .delete(roleDisplaySnapshots)
      .where(eq(roleDisplaySnapshots.id, "snapshot-b"))
      .run();
    const result = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload: {
        branch_id: "main",
        floor_id: "answer-a",
        expected_snapshot_id: "snapshot-a",
        operation_id: "pending-state",
      },
    });
    expect(result.statusCode, result.body).toBe(409);
    expect(result.json().error.code).toBe("candidate_state_unavailable");
    const list = await app.inject({
      method: "GET",
      url: "/floors/answer-b/reply-candidates",
    });
    expect(list.json().data.active_floor_id).toBe("answer-b");
    expect(list.json().data.can_activate).toBe(false);
  });

  it("ignores a failed later turn when selecting the last committed reply", async () => {
    const app = await fixture();
    built!.database
      .insert(floors)
      .values({
        id: "cancelled-later",
        sessionId: "story",
        branchId: "main",
        floorNo: 2,
        state: "failed",
        createdAt: 4,
        updatedAt: 4,
      })
      .run();
    const list = await app.inject({
      method: "GET",
      url: "/floors/answer-b/reply-candidates",
    });
    expect(list.json().data.can_activate).toBe(true);
    const selected = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload: {
        branch_id: "main",
        floor_id: "answer-a",
        expected_snapshot_id: "snapshot-b",
        operation_id: "after-cancel",
      },
    });
    expect(selected.statusCode, selected.body).toBe(200);
    expect(selected.json().data.active_floor_id).toBe("answer-a");
  });

  it("keeps an unfinished later turn locked during candidate selection", async () => {
    const app = await fixture();
    built!.database
      .insert(floors)
      .values({
        id: "draft-later",
        sessionId: "story",
        branchId: "main",
        floorNo: 2,
        state: "draft",
        createdAt: 4,
        updatedAt: 4,
      })
      .run();
    const list = await app.inject({
      method: "GET",
      url: "/floors/answer-b/reply-candidates",
    });
    expect(list.json().data.can_activate).toBe(false);
    const selected = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload: {
        branch_id: "main",
        floor_id: "answer-a",
        expected_snapshot_id: "snapshot-b",
        operation_id: "during-draft",
      },
    });
    expect(selected.statusCode, selected.body).toBe(409);
  });

  it("rejects earlier turns, another branch and another account", async () => {
    const app = await fixture();
    built!.database
      .insert(floors)
      .values({
        id: "later",
        sessionId: "story",
        branchId: "main",
        floorNo: 2,
        state: "committed",
        createdAt: 4,
        updatedAt: 4,
      })
      .run();
    const list = await app.inject({
      method: "GET",
      url: "/floors/answer-a/reply-candidates",
    });
    expect(list.json().data.can_activate).toBe(false);
    const payload = {
      branch_id: "main",
      floor_id: "answer-a",
      expected_snapshot_id: "snapshot-b",
      operation_id: "earlier",
    };
    const earlier = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload,
    });
    expect(earlier.statusCode, earlier.body).toBe(409);
    const branch = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload: { ...payload, branch_id: "side" },
    });
    expect(branch.statusCode).toBe(404);
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "其他用户",
        email: "other@example.com",
        password: "secure password",
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "other@example.com", password: "secure password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/floors/answer-a/reply-candidates",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/sessions/story/reply-candidates/activate",
          payload,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rejects candidate changes while the shared generation coordinator is running", async () => {
    const coordinator = new InMemoryGenerationCoordinator();
    const app = await fixture(coordinator);
    let release!: () => void;
    let notify!: () => void;
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const running = coordinator.execute({
      sessionId: "story",
      branchId: "main",
      mode: "reject",
      task: async () => {
        notify();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    await started;
    try {
      const result = await app.inject({
        method: "POST",
        url: "/sessions/story/reply-candidates/activate",
        payload: {
          branch_id: "main",
          floor_id: "answer-a",
          expected_snapshot_id: "snapshot-b",
          operation_id: "during-generation",
        },
      });
      expect(result.statusCode, result.body).toBe(409);
      expect(result.json().error.code).toBe("generation_conflict");
    } finally {
      release();
      await running;
    }
  });

  it("switches the last reply with its role state and branch variables, and replays the operation safely", async () => {
    const app = await fixture();
    const list = await app.inject({
      method: "GET",
      url: "/floors/answer-b/reply-candidates",
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data).toMatchObject({
      active_floor_id: "answer-b",
      can_activate: true,
      items: [{ floor_id: "answer-a" }, { floor_id: "answer-b" }],
    });
    const payload = {
      branch_id: "main",
      floor_id: "answer-a",
      expected_snapshot_id: "snapshot-b",
      operation_id: "select-a",
    };
    const activate = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload,
    });
    expect(activate.statusCode, activate.body).toBe(200);
    expect(activate.json().data).toMatchObject({
      active_floor_id: "answer-a",
      current: {
        floorId: "answer-a",
        variables: { score: 1 },
        parentSnapshotId: "snapshot-b",
      },
    });
    const variables = await app.inject({
      method: "GET",
      url: "/variables?scope=branch&session_id=story&branch_id=main",
    });
    expect(variables.statusCode, variables.body).toBe(200);
    expect(
      variables
        .json()
        .data.some((item: { key: string }) => item.key === "extra"),
    ).toBe(false);
    expect(
      variables.json().data.find((item: { key: string }) => item.key === "note")
        ?.value,
      variables.body,
    ).toBe("来自第一份回复");
    const timeline = await app.inject({
      method: "GET",
      url: "/sessions/story/timeline?branch_id=main",
    });
    expect(timeline.statusCode, timeline.body).toBe(200);
    expect(
      timeline.json().data.floors.map((floor: { id: string }) => floor.id),
    ).toEqual(["answer-a"]);
    const repeat = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload,
    });
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(repeat.json().data.current.snapshotId).toBe(
      activate.json().data.current.snapshotId,
    );
    const stale = await app.inject({
      method: "POST",
      url: "/sessions/story/reply-candidates/activate",
      payload: { ...payload, floor_id: "answer-b", operation_id: "select-b" },
    });
    expect(stale.statusCode).toBe(409);
  });
});
