import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type DatabaseConnection } from "../../../../test/helpers/create-test-db.js";
import {
  accounts,
  characters,
  characterVersions,
  sessions,
  floors,
  roleDisplaySnapshots,
  variables,
} from "../../../db/schema.js";
import { DisplaySnapshotService } from "../display-snapshot-service.js";
import type { RoleDisplaySnapshot } from "@tavern/shared";

let connection: DatabaseConnection;
let service: DisplaySnapshotService;
beforeEach(async () => {
  connection = createTestDatabase(":memory:");
  await connection.db
    .insert(accounts)
    .values({ id: "owner", name: "Owner", createdAt: 1, updatedAt: 1 });
  await connection.db.insert(characters).values({
    id: "character",
    accountId: "owner",
    name: "Role",
    createdAt: 1,
    updatedAt: 1,
  });
  await connection.db.insert(characterVersions).values({
    id: "version",
    characterId: "character",
    versionNo: 1,
    dataJson: "{}",
    contentHash: "fixture",
    createdAt: 1,
  });
  await connection.db.insert(sessions).values({
    id: "session",
    accountId: "owner",
    characterVersionId: "version",
    createdAt: 1,
    updatedAt: 1,
  });
  await connection.db.insert(floors).values({
    id: "floor",
    sessionId: "session",
    floorNo: 1,
    state: "committed",
    createdAt: 1,
    updatedAt: 1,
  });
  service = new DisplaySnapshotService(connection.db);
});
afterEach(() => connection?.close());
const next = (previous: RoleDisplaySnapshot): RoleDisplaySnapshot => ({
  ...previous,
  snapshotId: "snapshot-2",
  parentSnapshotId: previous.snapshotId,
  floorId: "floor",
  attemptId: "run:1",
  source: { kind: "floor", runId: "run", jobId: null },
  variables: { score: 2 },
});

describe("committed role display snapshots", () => {
  it("stores initial state once and commits the next snapshot with its branch variables", () => {
    const initial = service.initialize("owner", "session", { score: 1 });
    expect(service.initialize("owner", "session", { score: 99 })).toEqual(
      initial,
    );
    service.save("owner", next(initial));
    expect(service.first("owner", "session")?.variables.score).toBe(1);
    expect(service.latest("owner", "session")?.variables.score).toBe(2);
    expect(
      service.listPage("owner", "session", "main", { limit: 1 }),
    ).toMatchObject({
      items: [
        {
          snapshotId: next(initial).snapshotId,
          floorId: "floor",
          attemptId: "run:1",
        },
      ],
      nextCursor: expect.any(String),
    });
    const older = service.listPage("owner", "session", "main", {
      cursor: service.listPage("owner", "session", "main", { limit: 1 })
        .nextCursor!,
      limit: 1,
    });
    expect(older.items).toEqual([
      { snapshotId: initial.snapshotId, floorId: null, attemptId: null },
    ]);
    expect(service.getByFloor("owner", "session", "floor")).toEqual(
      next(initial),
    );
    expect(
      JSON.parse(connection.db.select().from(variables).get()!.valueJson),
    ).toEqual({ score: 2 });
  });
  it("rolls back the new display snapshot when its variable write fails", () => {
    const initial = service.initialize("owner", "session", { score: 1 });
    connection.db.$client.exec(
      "CREATE TRIGGER deny_state BEFORE UPDATE ON variable BEGIN SELECT RAISE(ABORT, 'variable write failed'); END",
    );
    expect(() => service.save("owner", next(initial))).toThrow(
      "variable write failed",
    );
    expect(
      connection.db.select().from(roleDisplaySnapshots).all(),
    ).toHaveLength(1);
    expect(
      JSON.parse(connection.db.select().from(variables).get()!.valueJson),
    ).toEqual({ score: 1 });
  });
  it("rejects foreign ownership, version changes and stale parent snapshots", () => {
    const initial = service.initialize("owner", "session", { score: 1 });
    expect(() => service.first("other", "session")).toThrow();
    expect(() =>
      service.save("owner", { ...next(initial), versionId: "other" }),
    ).toThrow();
    expect(() =>
      service.save("owner", { ...next(initial), parentSnapshotId: "old" }),
    ).toThrow();
    expect(() =>
      service.save("owner", { ...next(initial), branchId: "other" }),
    ).toThrow();
    expect(service.latest("owner", "session")).toEqual(initial);
  });
});
