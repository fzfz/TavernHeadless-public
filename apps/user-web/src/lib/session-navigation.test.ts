import { expect, it } from "vitest";
import { roleSessionUrl } from "./session-navigation.js";
it("clears the inspected snapshot when returning to the catalog and opening another session", () => {
  const inspected = new URL(
    "https://user.test/?sessionId=A&snapshotId=snapshotA&floorId=legacy-floorA",
  );
  const catalog = roleSessionUrl(inspected, null);
  expect(catalog.search).toBe("");
  const next = roleSessionUrl(catalog, "B");
  expect(next.searchParams.get("sessionId")).toBe("B");
  expect(next.searchParams.has("snapshotId")).toBe(false);
  expect(next.searchParams.has("floorId")).toBe(false);
  expect(roleSessionUrl(inspected, "B").search).toBe("?sessionId=B");
  expect(inspected.searchParams.get("snapshotId")).toBe("snapshotA");
});
