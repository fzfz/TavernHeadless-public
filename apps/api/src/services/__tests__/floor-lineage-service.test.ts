import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { and, asc, desc, lt, sql } from "drizzle-orm";

import { createTestDatabase, type DatabaseConnection } from "../../../test/helpers/create-test-db.js";
import { sessions, floors } from "../../db/schema.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { FloorLineageService } from "../floor-lineage-service.js";

interface SeedFloorInput {
  id: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state?: "draft" | "generating" | "committed" | "failed";
  supersededAt?: number | null;
}

async function seedSession(
  database: DatabaseConnection,
  floorsToSeed: SeedFloorInput[],
) {
  const sessionId = nanoid();
  const now = Date.now();

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Floor Lineage Test Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  for (const floor of floorsToSeed) {
    await database.db.insert(floors).values({
      id: floor.id,
      sessionId,
      floorNo: floor.floorNo,
      branchId: floor.branchId,
      parentFloorId: floor.parentFloorId,
      state: floor.state ?? "committed",
      supersededAt: floor.supersededAt ?? null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + floor.floorNo,
      updatedAt: now + floor.floorNo,
    });
  }

  return sessionId;
}

describe("FloorLineageService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createTestDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("SQL ancestry 默认只返回分支链上的已提交楼层", async () => {
    const sessionId = await seedSession(database, [
      {
        id: "f1",
        floorNo: 1,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
      },
      {
        id: "f2",
        floorNo: 2,
        branchId: "main",
        parentFloorId: "f1",
        state: "committed",
      },
      {
        id: "f3",
        floorNo: 3,
        branchId: "main",
        parentFloorId: "f2",
        state: "draft",
      },
      {
        id: "f4",
        floorNo: 2,
        branchId: "main",
        parentFloorId: "f1",
        state: "committed",
        supersededAt: 111,
      },
    ]);

    const lineage = new FloorLineageService(database.db);
    const nodes = database.db
      .select({ id: floors.id })
      .from(floors)
      .where(
        sql`${floors.id} IN ${lineage.branchAncestryFloorIdsQuery(sessionId, "main")}`,
      )
      .all();

    expect(nodes.map((node) => node.id).sort()).toEqual(["f1", "f2"]);
  });

  it("SQL ancestry 沿 parentFloorId 选择楼层", async () => {
    const sessionId = await seedSession(database, [
      { id: "f1", floorNo: 1, branchId: "main", parentFloorId: null },
      { id: "f2", floorNo: 2, branchId: "main", parentFloorId: "f1" },
      { id: "f3", floorNo: 3, branchId: "main", parentFloorId: "f2" },
    ]);

    const lineage = new FloorLineageService(database.db);
    const nodes = database.db
      .select({ id: floors.id })
      .from(floors)
      .where(
        sql`${floors.id} IN ${lineage.branchAncestryFloorIdsQuery(sessionId, "main")}`,
      )
      .orderBy(desc(floors.floorNo))
      .all();

    expect(nodes.map((node) => node.id)).toEqual(["f3", "f2", "f1"]);
  });

  it("queries branch ancestry in SQL before applying caller ordering and floor bounds", async () => {
    const sessionId = await seedSession(database, [
      { id: "m1", floorNo: 1, branchId: "main", parentFloorId: null },
      { id: "m2", floorNo: 2, branchId: "main", parentFloorId: "m1" },
      { id: "b1", floorNo: 2, branchId: "alt", parentFloorId: "m1" },
      { id: "b2", floorNo: 3, branchId: "alt", parentFloorId: "b1" },
    ]);

    const lineage = new FloorLineageService(database.db);
    const read = (branchId: string, before?: number) =>
      database.db
        .select({ id: floors.id })
        .from(floors)
        .where(
          and(
            sql`${floors.id} IN ${lineage.branchAncestryFloorIdsQuery(sessionId, branchId)}`,
            before === undefined ? undefined : lt(floors.floorNo, before),
          ),
        )
        .orderBy(asc(floors.floorNo))
        .all()
        .map((row) => row.id);
    expect(read("alt")).toEqual(["m1", "b1", "b2"]);
    expect(read("alt", 3)).toEqual(["m1", "b1"]);
    expect(read("main")).toEqual(["m1", "m2"]);
  });

  it("computeBranchDiff 识别真实共同祖先且不误判 floorNo 相同", async () => {
    const sessionId = await seedSession(database, [
      { id: "m1", floorNo: 1, branchId: "main", parentFloorId: null },
      { id: "m2", floorNo: 2, branchId: "main", parentFloorId: "m1" },
      { id: "m3", floorNo: 3, branchId: "main", parentFloorId: "m2" },
      // 注意 b1 的 floorNo 与 m2 相同，但 parent 指向 m1，ancestry 应认 m1 为 fork。
      { id: "b1", floorNo: 2, branchId: "alt", parentFloorId: "m1" },
      { id: "b2", floorNo: 3, branchId: "alt", parentFloorId: "b1" },
    ]);

    const lineage = new FloorLineageService(database.db);
    const diff = lineage.computeBranchDiff(sessionId, "main", "alt");

    expect(diff.baseTip?.id).toBe("m3");
    expect(diff.targetTip?.id).toBe("b2");
    expect(diff.forkFloor?.id).toBe("m1");
    expect(diff.sharedFloors.map((node) => node.id)).toEqual(["m1"]);
    expect(diff.baseOnlyFloors.map((node) => node.id)).toEqual(["m3", "m2"]);
    expect(diff.targetOnlyFloors.map((node) => node.id)).toEqual(["b2", "b1"]);
  });

  it("computeBranchDiff 在两 branch 无交集时返回完整两条 chain", async () => {
    const sessionId = await seedSession(database, [
      { id: "m1", floorNo: 1, branchId: "main", parentFloorId: null },
      { id: "m2", floorNo: 2, branchId: "main", parentFloorId: "m1" },
      { id: "x1", floorNo: 1, branchId: "alt", parentFloorId: null },
    ]);

    const lineage = new FloorLineageService(database.db);
    const diff = lineage.computeBranchDiff(sessionId, "main", "alt");

    expect(diff.forkFloor).toBeNull();
    expect(diff.sharedFloors).toEqual([]);
    expect(diff.baseOnlyFloors.map((node) => node.id)).toEqual(["m2", "m1"]);
    expect(diff.targetOnlyFloors.map((node) => node.id)).toEqual(["x1"]);
  });

  it("computeBranchDiff 在 branch 不存在时返回 null tip", async () => {
    const sessionId = await seedSession(database, [
      { id: "m1", floorNo: 1, branchId: "main", parentFloorId: null },
    ]);

    const lineage = new FloorLineageService(database.db);
    const diff = lineage.computeBranchDiff(sessionId, "main", "missing");

    expect(diff.baseTip?.id).toBe("m1");
    expect(diff.targetTip).toBeNull();
    expect(diff.forkFloor).toBeNull();
    expect(diff.sharedFloors).toEqual([]);
  });
});
