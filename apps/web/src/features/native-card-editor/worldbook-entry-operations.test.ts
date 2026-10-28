import { describe, expect, it, vi } from "vitest";
import { allocateWorldbookEntryUidFromServer, moveWorldbookEntryBindings, worldbookEntryUids } from "./worldbook-entry-operations.js";

describe("native card worldbook entry operations", () => {
  it("allocates the next UID from entry file contents, regardless of their names", () => {
    const uids = worldbookEntryUids(
      ["worldbooks/harbor/entries/custom.json", "worldbooks/harbor/entries/notes.json", "worldbooks/harbor/entries/binary.json"],
      {
        "worldbooks/harbor/entries/custom.json": { encoding: "utf8", content: '{"uid":1}' },
        "worldbooks/harbor/entries/notes.json": { encoding: "utf8", content: '{"uid":7}' },
        "worldbooks/harbor/entries/binary.json": { encoding: "base64", content: "eyJ1aWQiOjk5fQ==" },
      },
    );

    expect(uids).toEqual([1, 7]);
  });

  it("ignores malformed or absent files while assigning an initial UID", () => {
    expect(worldbookEntryUids(["entries/malformed.json", "entries/missing.json"], {
      "entries/malformed.json": { encoding: "utf8", content: "{" },
    })).toEqual([]);
  });

  it("asks the server to allocate a UID with the target book's content UIDs reserved", async () => {
    const allocate = vi.fn(async () => ({ uid: 8 }));
    const uid = await allocateWorldbookEntryUidFromServer(allocate, {
      cardId: "card-1",
      expectedRevision: 4,
      bookId: "harbor",
    }, ["entries/custom.json"], {
      "entries/custom.json": { encoding: "utf8", content: '{"uid":1}' },
    }, "无效 UID");

    expect(uid).toBe(8);
    expect(allocate).toHaveBeenCalledWith({ cardId: "card-1", expectedRevision: 4, bookId: "harbor", reservedUids: [1] });
  });

  it("rejects an allocated UID that collides with an unsaved target entry", async () => {
    await expect(allocateWorldbookEntryUidFromServer(async () => ({ uid: 1 }), {
      cardId: "card-1",
      expectedRevision: 4,
      bookId: "harbor",
    }, ["entries/custom.json"], {
      "entries/custom.json": { encoding: "utf8", content: '{"uid":1}' },
    }, "无效 UID")).rejects.toThrow("无效 UID");
  });

  it("moves only bindings for the matching worldbook entry", () => {
    const result = moveWorldbookEntryBindings({
      modulePath: "backend/controllers/prompt.js",
      controllerEntries: [
        { bookId: "source", entryId: 3 },
        { bookId: "source", entryId: 4 },
      ],
      updaterEntries: [
        { bookId: "source", entryId: 3 },
        { bookId: "other", entryId: 3 },
      ],
    }, "source", 3, "target", 8);

    expect(result).toEqual({
      configuration: {
        modulePath: "backend/controllers/prompt.js",
        controllerEntries: [
          { bookId: "target", entryId: 8 },
          { bookId: "source", entryId: 4 },
        ],
        updaterEntries: [
          { bookId: "target", entryId: 8 },
          { bookId: "other", entryId: 3 },
        ],
      },
      controllerBindings: 1,
      updaterBindings: 1,
      stateRuleBindings: 0,
    });
  });

  it("moves state update rule sourceEntries together with a worldbook entry", () => {
    const result = moveWorldbookEntryBindings({
      rules: [{ id: "guard", sourceEntries: [{ bookId: "source", entryId: 3 }, { bookId: "other", entryId: 3 }] }],
    }, "source", 3, "target", 8);

    expect(result).toMatchObject({
      stateRuleBindings: 1,
      configuration: {
        rules: [{ sourceEntries: [{ bookId: "target", entryId: 8 }, { bookId: "other", entryId: 3 }] }],
      },
    });
  });
});
