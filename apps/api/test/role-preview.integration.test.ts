import { afterEach, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildTestApp } from "./helpers/create-test-db.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { sessions } from "../src/db/schema.js";
let built: Awaited<ReturnType<typeof buildTestApp>>;
beforeEach(async () => {
  built = await buildTestApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    logger: false,
  });
  built.database
    .insert(sessions)
    .values({
      id: "preview",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      createdAt: 1,
      updatedAt: 1,
      metadataJson: JSON.stringify({
        role_preview: {
          draft_id: "draft",
          draft_revision: 2,
          creator_id: DEFAULT_ADMIN_ACCOUNT_ID,
        },
      }),
    })
    .run();
});
afterEach(async () => {
  await built?.app.close();
});
it("opens a local preview session without credentials", async () => {
  const response = await built.app.inject("/sessions/preview");
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data.metadata.role_preview).toMatchObject({
    draft_id: "draft",
    draft_revision: 2,
  });
});
it("builds the database without preview credential tables and retains role drafts", () => {
  const tables = built.database
    .all<{
      name: string;
    }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .map((row) => row.name);
  expect(tables).not.toContain("role_preview_handoff");
  expect(tables).not.toContain("role_preview_access");
  expect(tables).toContain("role_app_draft");
  expect(tables).toContain("session");
});
it.each([
  ["POST", "/preview-sessions/preview/handoffs"],
  ["POST", "/preview-handoffs/exchange"],
  ["GET", "/preview-access"],
] as const)("removes the credential route %s %s", async (method, url) => {
  const response = await built.app.inject({ method, url });
  expect(response.statusCode, response.body).toBe(404);
});
it("ignores a removed preview header in local mode", async () => {
  const response = await built.app.inject({
    url: "/sessions/preview",
    headers: { "x-tavern-preview-key": "unused" },
  });
  expect(response.statusCode, response.body).toBe(200);
});
