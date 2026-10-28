import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { statePromptSourceIds, type RoleDisplaySnapshot } from "@tavern/shared";
import { createTestDatabase, type DatabaseConnection } from "../../../../test/helpers/create-test-db.js";
import {
  accounts,
  characterVersions,
  characters,
  floorRunStates,
  floors,
  messagePages,
  messages,
  presetVersions,
  presets,
  roleDisplaySnapshots,
  sessions,
} from "../../../db/schema.js";
import { RoleFileStore } from "../../storage/role-file-store.js";
import { DisplaySnapshotService } from "../display-snapshot-service.js";
import { RoleAssetService } from "../role-asset-service.js";
import { StatePromptService } from "../state-prompt-service.js";

const ACCOUNT_ID = "owner";
const SESSION_ID = "session";
const CHARACTER_VERSION_ID = "character-version";
const PRESET_ID = "state-preset";
const PRESET_VERSION_ID = "state-preset-v1";
const CREATED_AT = 1;

let connection: DatabaseConnection;
let snapshots: DisplaySnapshotService;
let service: StatePromptService;

function promptPresetData(): string {
  const prompts = [
    {
      identifier: "main",
      name: "State update task",
      role: "system",
      content: "Update the state from the supplied story and evidence.",
    },
    ...statePromptSourceIds.map((identifier) => ({
      identifier,
      name: identifier,
      role: "system",
      marker: true,
      enabled: true,
      content: "",
    })),
    {
      identifier: "chatHistory",
      name: "Chat History",
      role: "system",
      marker: true,
      enabled: true,
    },
  ];
  const identifiers = prompts.map((prompt) => prompt.identifier);
  return JSON.stringify({
    prompts,
    prompt_order: [
      {
        character_id: 100001,
        order: identifiers.map((identifier) => ({ identifier, enabled: true })),
      },
    ],
    openai_max_context: 8192,
    openai_max_tokens: 512,
    wi_format: "{0}",
    names_behavior: 0,
  });
}

function insertFloor(args: {
  id: string;
  floorNo: number;
  branchId?: string;
  parentFloorId?: string | null;
  supersededAt?: number | null;
  supersededByFloorId?: string | null;
}): void {
  connection.db
    .insert(floors)
    .values({
      id: args.id,
      sessionId: SESSION_ID,
      floorNo: args.floorNo,
      branchId: args.branchId ?? "main",
      parentFloorId: args.parentFloorId ?? null,
      supersededAt: args.supersededAt ?? null,
      supersededByFloorId: args.supersededByFloorId ?? null,
      state: "committed",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
}

function insertMessages(args: {
  floorId: string;
  userContent?: string;
  assistantContent?: string;
  userMessageId?: string;
  pageKind?: "input" | "output" | "mixed";
}): void {
  const pageId = `page:${args.floorId}`;
  connection.db
    .insert(messagePages)
    .values({
      id: pageId,
      floorId: args.floorId,
      pageNo: 0,
      pageKind: args.pageKind ?? "mixed",
      isActive: true,
      version: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  if (args.userContent !== undefined) {
    connection.db
      .insert(messages)
      .values({
        id: args.userMessageId ?? `user:${args.floorId}`,
        pageId,
        seq: 0,
        role: "user",
        content: args.userContent,
        createdAt: CREATED_AT,
      })
      .run();
  }
  if (args.assistantContent !== undefined) {
    connection.db
      .insert(messages)
      .values({
        id: `assistant:${args.floorId}`,
        pageId,
        seq: 1,
        role: "assistant",
        content: args.assistantContent,
        createdAt: CREATED_AT,
      })
      .run();
  }
}

function makeSnapshot(args: {
  snapshotId: string;
  branchId?: string;
  floorId: string | null;
  parentSnapshotId: string | null;
  variables: Record<string, unknown>;
  source: RoleDisplaySnapshot["source"];
}): RoleDisplaySnapshot {
  return {
    sessionId: SESSION_ID,
    branchId: args.branchId ?? "main",
    floorId: args.floorId,
    attemptId: args.floorId ? `attempt:${args.floorId}` : null,
    versionId: CHARACTER_VERSION_ID,
    snapshotId: args.snapshotId,
    parentSnapshotId: args.parentSnapshotId,
    variables: args.variables,
    source: args.source,
  };
}

function insertSnapshot(args: {
  snapshot: RoleDisplaySnapshot;
  snapshotNo: number;
  calculationBefore?: Record<string, unknown>;
}): void {
  connection.db
    .insert(roleDisplaySnapshots)
    .values({
      id: args.snapshot.snapshotId,
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      branchId: args.snapshot.branchId,
      floorId: args.snapshot.floorId,
      snapshotNo: args.snapshotNo,
      recordJson: JSON.stringify(args.snapshot),
      calculationBeforeJson:
        args.calculationBefore === undefined
          ? null
          : JSON.stringify(args.calculationBefore),
    })
    .run();
}

function insertRunState(floorId: string, runId: string): void {
  connection.db
    .insert(floorRunStates)
    .values({
      floorId,
      runId,
      runType: "respond",
      status: "completed",
      phase: "transaction_committed",
      publicPhase: "committing",
      startedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
}

function addFloorSnapshots(): void {
  const initial = makeSnapshot({
    snapshotId: "snapshot:initial",
    floorId: null,
    parentSnapshotId: null,
    variables: { score: 0 },
    source: { kind: "initial", runId: null, jobId: null },
  });
  const floorInitial = makeSnapshot({
    snapshotId: "snapshot:floor-1-initial",
    floorId: "floor:1",
    parentSnapshotId: initial.snapshotId,
    variables: { score: 1 },
    source: { kind: "floor", runId: "run:floor-1", jobId: null },
  });
  const floorRepair = makeSnapshot({
    snapshotId: "snapshot:floor-1-repair",
    floorId: "floor:1",
    parentSnapshotId: floorInitial.snapshotId,
    variables: { score: 2 },
    source: { kind: "manual", runId: null, jobId: null },
  });
  const floorTask = makeSnapshot({
    snapshotId: "snapshot:floor-1-task",
    floorId: "floor:1",
    parentSnapshotId: floorRepair.snapshotId,
    variables: { score: 3 },
    source: { kind: "job", runId: null, jobId: "job:floor-1" },
  });
  const supersededFloor = makeSnapshot({
    snapshotId: "snapshot:floor-2-superseded",
    floorId: "floor:2-old",
    parentSnapshotId: floorTask.snapshotId,
    variables: { score: 99 },
    source: { kind: "floor", runId: "run:floor-2-old", jobId: null },
  });
  const mainFloor = makeSnapshot({
    snapshotId: "snapshot:floor-2-main",
    floorId: "floor:2-main",
    parentSnapshotId: floorTask.snapshotId,
    variables: { score: 4 },
    source: { kind: "floor", runId: "run:floor-2-main", jobId: null },
  });
  const mainCurrent = makeSnapshot({
    snapshotId: "snapshot:floor-3-main",
    floorId: "floor:3-main",
    parentSnapshotId: mainFloor.snapshotId,
    variables: { score: 100 },
    source: { kind: "floor", runId: "run:floor-3-main", jobId: null },
  });
  const alternateInitial = makeSnapshot({
    snapshotId: "snapshot:alternate-initial",
    branchId: "alternate",
    floorId: null,
    parentSnapshotId: null,
    variables: { score: 10 },
    source: { kind: "initial", runId: null, jobId: null },
  });
  const alternateFloor = makeSnapshot({
    snapshotId: "snapshot:floor-2-alternate",
    branchId: "alternate",
    floorId: "floor:2-alternate",
    parentSnapshotId: alternateInitial.snapshotId,
    variables: { score: 12 },
    source: { kind: "floor", runId: "run:floor-2-alternate", jobId: null },
  });
  const alternateCurrent = makeSnapshot({
    snapshotId: "snapshot:floor-3-alternate",
    branchId: "alternate",
    floorId: "floor:3-alternate",
    parentSnapshotId: alternateFloor.snapshotId,
    variables: { score: 20 },
    source: { kind: "floor", runId: "run:floor-3-alternate", jobId: null },
  });

  [
    { snapshot: initial, snapshotNo: 0 },
    { snapshot: floorInitial, snapshotNo: 1, calculationBefore: { score: 0 } },
    { snapshot: floorRepair, snapshotNo: 2 },
    { snapshot: floorTask, snapshotNo: 3 },
    { snapshot: supersededFloor, snapshotNo: 4 },
    { snapshot: mainFloor, snapshotNo: 5 },
    { snapshot: mainCurrent, snapshotNo: 6 },
    { snapshot: alternateInitial, snapshotNo: 0 },
    { snapshot: alternateFloor, snapshotNo: 1 },
    { snapshot: alternateCurrent, snapshotNo: 2 },
  ].forEach((snapshot) => insertSnapshot(snapshot));
}

function makePrepareInput(args: {
  floorId: string;
  sourceMessageId: string;
  before: Record<string, unknown>;
  previousSnapshotId: string;
}) {
  return {
    accountId: ACCOUNT_ID,
    session: snapshots.session(ACCOUNT_ID, SESSION_ID),
    profile: {
      updaterPrompt: "",
      writablePaths: ["/score"],
      derivedPaths: ["/derivedScore"],
      stateSchema: {
        type: "object",
        required: ["score"],
        properties: { score: { type: "integer" } },
      },
    },
    files: {},
    before: args.before,
    previousSnapshotId: args.previousSnapshotId,
    floorId: args.floorId,
    sources: [
      {
        messageId: args.sourceMessageId,
        revision: 1,
        role: "user",
        text: "CURRENT_EXPLICIT_SOURCE",
      },
    ],
    toolEvidence: [],
    outputSchema: { type: "object" },
  };
}

beforeEach(() => {
  connection = createTestDatabase(":memory:");
  const db = connection.db;
  db.insert(accounts)
    .values({
      id: ACCOUNT_ID,
      name: "Owner",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  db.insert(characters)
    .values({
      id: "character",
      accountId: ACCOUNT_ID,
      name: "Guide",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  db.insert(characterVersions)
    .values({
      id: CHARACTER_VERSION_ID,
      characterId: "character",
      versionNo: 1,
      dataJson: "{}",
      contentHash: "test",
      createdAt: CREATED_AT,
    })
    .run();
  db.insert(presets)
    .values({
      id: PRESET_ID,
      name: "State prompt",
      accountId: ACCOUNT_ID,
      dataJson: promptPresetData(),
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();
  db.insert(presetVersions)
    .values({
      id: PRESET_VERSION_ID,
      presetId: PRESET_ID,
      versionNo: 1,
      dataJson: promptPresetData(),
      contentHash: "test",
      createdAt: CREATED_AT,
    })
    .run();
  db.insert(sessions)
    .values({
      id: SESSION_ID,
      accountId: ACCOUNT_ID,
      characterVersionId: CHARACTER_VERSION_ID,
      characterSnapshotJson: JSON.stringify({ name: "Guide" }),
      promptMode: "compat_strict",
      metadataJson: JSON.stringify({
        statePrompt: {
          presetId: PRESET_ID,
          presetVersionId: PRESET_VERSION_ID,
          historyTurns: 5,
        },
      }),
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    .run();

  insertFloor({ id: "floor:1", floorNo: 1 });
  insertFloor({
    id: "floor:2-old",
    floorNo: 2,
    parentFloorId: "floor:1",
    supersededAt: 10,
    supersededByFloorId: "floor:2-main",
  });
  insertFloor({
    id: "floor:2-main",
    floorNo: 2,
    parentFloorId: "floor:2-old",
  });
  insertFloor({
    id: "floor:2-alternate",
    floorNo: 2,
    branchId: "alternate",
    parentFloorId: "floor:1",
  });
  insertFloor({
    id: "floor:3-main",
    floorNo: 3,
    parentFloorId: "floor:2-main",
  });
  insertFloor({
    id: "floor:3-alternate",
    floorNo: 3,
    branchId: "alternate",
    parentFloorId: "floor:2-alternate",
  });
  insertRunState("floor:3-main", "run:floor-3-main");
  insertRunState("floor:3-alternate", "run:floor-3-alternate");

  insertMessages({
    floorId: "floor:1",
    userContent: "FLOOR_1_USER",
    assistantContent: "FLOOR_1_ASSISTANT",
  });
  insertMessages({
    floorId: "floor:2-old",
    userContent: "SUPERSEDED_FLOOR_USER",
    assistantContent: "SUPERSEDED_FLOOR_ASSISTANT",
  });
  insertMessages({
    floorId: "floor:2-main",
    userContent: "MAIN_FLOOR_2_USER",
    assistantContent: "MAIN_FLOOR_2_ASSISTANT",
  });
  insertMessages({
    floorId: "floor:2-alternate",
    userContent: "ALTERNATE_FLOOR_2_USER",
    assistantContent: "ALTERNATE_FLOOR_2_ASSISTANT",
  });
  insertMessages({
    floorId: "floor:3-main",
    userMessageId: "source:main-current",
    userContent: "CURRENT_MAIN_INPUT",
    pageKind: "input",
  });
  insertMessages({
    floorId: "floor:3-alternate",
    userMessageId: "source:alternate-current",
    userContent: "CURRENT_ALTERNATE_INPUT",
    pageKind: "input",
  });

  addFloorSnapshots();
  snapshots = new DisplaySnapshotService(db);
  service = new StatePromptService(
    db,
    snapshots,
    new RoleAssetService(
      db,
      new RoleFileStore({
        roleAssetsDir: "unused-role-assets",
        roleAssetStagingDir: "unused-role-asset-staging",
      }),
    ),
  );
});

afterEach(() => connection.close());

describe("StatePromptService.prepare variable history", () => {
  it("groups initial, repair, and task snapshots into the final state of each visible ancestry floor", async () => {
    const preview = await service.prepare(
      makePrepareInput({
        floorId: "floor:3-main",
        sourceMessageId: "source:main-current",
        before: { score: 4 },
        previousSnapshotId: "snapshot:floor-2-main",
      }),
    );

    expect(preview.variableHistory).toEqual([
      {
        floorId: "floor:1",
        floorNo: 1,
        before: { score: 0 },
        after: { score: 3 },
        changes: [{ op: "set", path: "/score", value: 3 }],
        snapshotIds: [
          "snapshot:floor-1-initial",
          "snapshot:floor-1-repair",
          "snapshot:floor-1-task",
        ],
      },
      {
        floorId: "floor:2-main",
        floorNo: 2,
        before: { score: 3 },
        after: { score: 4 },
        changes: [{ op: "set", path: "/score", value: 4 }],
        snapshotIds: ["snapshot:floor-2-main"],
      },
    ]);

    const promptText = preview.messages
      .map((message) => message.content)
      .join("\n");
    expect(promptText).toContain("FLOOR_1_ASSISTANT");
    expect(promptText).toContain("MAIN_FLOOR_2_ASSISTANT");
    expect(promptText).toContain("CURRENT_EXPLICIT_SOURCE");
    expect(promptText).not.toContain("SUPERSEDED_FLOOR_ASSISTANT");
    expect(promptText).not.toContain("ALTERNATE_FLOOR_2_ASSISTANT");
    expect(promptText).not.toContain("CURRENT_MAIN_INPUT");
  });

  it("uses the selected branch ancestry and excludes floors from the other branch", async () => {
    const preview = await service.prepare(
      makePrepareInput({
        floorId: "floor:3-alternate",
        sourceMessageId: "source:alternate-current",
        before: { score: 12 },
        previousSnapshotId: "snapshot:floor-2-alternate",
      }),
    );

    expect(preview.variableHistory.map((round) => round.floorId)).toEqual([
      "floor:1",
      "floor:2-alternate",
    ]);
    expect(preview.variableHistory.map((round) => round.after.score)).toEqual([
      3, 12,
    ]);
    const promptText = preview.messages
      .map((message) => message.content)
      .join("\n");
    expect(promptText).toContain("ALTERNATE_FLOOR_2_ASSISTANT");
    expect(promptText).not.toContain("MAIN_FLOOR_2_ASSISTANT");
    expect(promptText).not.toContain("CURRENT_ALTERNATE_INPUT");
  });

  it("keeps a replaced source floor in both story and variable history of its existing fork", async () => {
    connection.db
      .update(floors)
      .set({ supersededAt: Date.now() })
      .where(eq(floors.id, "floor:1"))
      .run();
    insertFloor({
      id: "floor:1-replacement",
      floorNo: 1,
      parentFloorId: "floor:1",
    });
    const preview = await service.prepare(
      makePrepareInput({
        floorId: "floor:3-alternate",
        sourceMessageId: "source:alternate-current",
        before: { score: 12 },
        previousSnapshotId: "snapshot:floor-2-alternate",
      }),
    );
    expect(preview.variableHistory.map((round) => round.floorId)).toEqual([
      "floor:1",
      "floor:2-alternate",
    ]);
    expect(
      preview.messages.map((message) => message.content).join("\n"),
    ).toContain("FLOOR_1_ASSISTANT");
    expect(preview.variableHistory[0]?.after.score).toBe(3);
  });

  it("returns no variable-history rounds when the fixed preset binding selects zero turns", async () => {
    const session = snapshots.session(ACCOUNT_ID, SESSION_ID);
    connection.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          statePrompt: {
            presetId: PRESET_ID,
            presetVersionId: PRESET_VERSION_ID,
            historyTurns: 0,
          },
        }),
      })
      .where(eq(sessions.id, session.id))
      .run();

    const preview = await service.prepare(
      makePrepareInput({
        floorId: "floor:3-main",
        sourceMessageId: "source:main-current",
        before: { score: 4 },
        previousSnapshotId: "snapshot:floor-2-main",
      }),
    );

    expect(preview.variableHistory).toEqual([]);
    expect(
      preview.messages.map((message) => message.content).join("\n"),
    ).toContain("CURRENT_EXPLICIT_SOURCE");
  });
});
