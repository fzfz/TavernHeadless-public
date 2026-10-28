import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { RoleDisplaySnapshot } from "@tavern/shared";
import { createTestDatabase } from "../../../test/helpers/create-test-db.js";
import { accounts, characters, characterVersions, floors, roleDisplaySnapshots, sessions } from "../schema.js";
import { DisplaySnapshotService } from "../../services/role-runtime/display-snapshot-service.js";

it("upgrades 0099 snapshots in place and supports floor and initial-state revisions with server pagination", () => {
  const root = mkdtempSync(join(tmpdir(), "role-state-upgrade-"));
  const originalMigrations = fileURLToPath(new URL("../../../drizzle", import.meta.url));
  const oldMigrations = join(root, "migrations");
  cpSync(originalMigrations, oldMigrations, { recursive: true });
  const journal = JSON.parse(readFileSync(join(originalMigrations, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((entry: { tag: string }) => Number(entry.tag.slice(0, 4)) <= 99);
  mkdirSync(join(oldMigrations, "meta"), { recursive: true });
  writeFileSync(join(oldMigrations, "meta/_journal.json"), JSON.stringify(journal));
  const path = join(root, "database.sqlite");
  let database = createTestDatabase(path, oldMigrations);
  try {
    const db = database.db;
    db.insert(accounts).values({ id: "owner", name: "Owner", createdAt: 1, updatedAt: 1 }).run();
    db.insert(characters).values({ id: "character", accountId: "owner", name: "Character", createdAt: 1, updatedAt: 1 }).run();
    db.insert(characterVersions).values({ id: "version", characterId: "character", versionNo: 1, dataJson: "{}", contentHash: "fixture", createdAt: 1 }).run();
    for (const id of ["with-floor", "initial-only"]) db.$client.prepare("INSERT INTO session (id, account_id, character_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, "owner", "version", 1, 1);
    db.insert(floors).values({ id: "floor", sessionId: "with-floor", floorNo: 1, state: "committed", createdAt: 1, updatedAt: 1 }).run();
    const initial = (sessionId: string): RoleDisplaySnapshot => ({ sessionId, branchId: "main", floorId: null, attemptId: null, versionId: "version", snapshotId: `${sessionId}-initial`, parentSnapshotId: null, variables: { score: 1 }, source: { kind: "initial", runId: null, jobId: null } });
    const floorRecord: RoleDisplaySnapshot = { ...initial("with-floor"), snapshotId: "floor-original", parentSnapshotId: "with-floor-initial", floorId: "floor", attemptId: "run:1", variables: { score: 2 }, source: { kind: "floor", runId: "run", jobId: null } };
    for (const [record, snapshotNo] of [[initial("with-floor"), 0], [floorRecord, 1], [initial("initial-only"), 0]] as const) {
      db.$client.prepare("INSERT INTO role_display_snapshot (id, account_id, session_id, branch_id, floor_id, snapshot_no, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.snapshotId, "owner", record.sessionId, "main", record.floorId, snapshotNo, JSON.stringify(record));
    }
    const before = db.$client.prepare("SELECT * FROM role_display_snapshot ORDER BY id").all();
    expect(() => db.$client.prepare("INSERT INTO role_display_snapshot SELECT 'duplicate-floor', account_id, session_id, branch_id, floor_id, 2, record_json FROM role_display_snapshot WHERE id = 'floor-original'").run()).toThrow(/UNIQUE/);
    database.close();
    database = createTestDatabase(path);
    expect(database.db.$client.prepare("SELECT id, account_id, session_id, branch_id, floor_id, snapshot_no, record_json FROM role_display_snapshot ORDER BY id").all()).toEqual(before);
    expect(database.db.select().from(roleDisplaySnapshots).all().every((row) => row.calculationBeforeJson === null)).toBe(true);
    expect(database.db.select().from(sessions).all().every((row) => row.roleModelCapabilitiesSnapshotJson === null)).toBe(true);
    expect(database.db.$client.pragma("foreign_key_check")).toEqual([]);
    const snapshots = new DisplaySnapshotService(database.db);
    const revision = { ...floorRecord, snapshotId: "floor-revised", parentSnapshotId: floorRecord.snapshotId, variables: { score: 3 }, source: { kind: "manual" as const, runId: null, jobId: null } };
    snapshots.save("owner", revision);
    const initialRevision = { ...initial("initial-only"), snapshotId: "initial-revised", parentSnapshotId: "initial-only-initial", variables: { score: 4 }, source: { kind: "manual" as const, runId: null, jobId: null } };
    snapshots.save("owner", initialRevision);
    expect(snapshots.getByFloor("owner", "with-floor", "floor")).toEqual(revision);
    expect(snapshots.get("owner", "with-floor", { snapshotId: "floor-original" })).toEqual(floorRecord);
    expect(snapshots.first("owner", "initial-only")).toEqual(initial("initial-only"));
    expect(snapshots.latest("owner", "initial-only")).toEqual(initialRevision);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = snapshots.listPage("owner", "with-floor", "main", { limit: 1, cursor });
      expect(page.items).toHaveLength(1);
      ids.push(page.items[0]!.snapshotId);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(["floor-revised", "floor-original", "with-floor-initial"]);
    expect(database.db.$client.pragma("foreign_key_check")).toEqual([]);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
