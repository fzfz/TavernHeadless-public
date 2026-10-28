import { roleFixture as fixture } from "./helpers/role-fixture.js";
import { afterEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestApp } from "./helpers/create-test-db.js";
import {
  accounts,
  characters,
  characterVersions,
  sessions,
} from "../src/db/schema.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

it.each(["linqian", "gushengman"])(
  "imports %s through the standard API with all prepared openings",
  async (role) => {
    const built = await buildTestApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      logger: false,
    });
    app = built.app;
    const { source, payload } = await fixture(role);
    const response = await app.inject({
      method: "POST",
      url: "/import/character",
      payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    const version = built.database
      .select()
      .from(characterVersions)
      .where(
        eq(characterVersions.id, response.json().data.character_version_id),
      )
      .get()!;
    const saved = JSON.parse(version.dataJson);
    expect(saved.extensions.tavern_headless.openings.items).toHaveLength(
      1 + source.alternateGreetings.length,
    );
    expect(saved.extensions.tavern_headless.openings.defaultOpeningId).toBe(
      payload.role_migration.metadata.defaultOpeningId,
    );
    expect(
      saved.extensions.tavern_headless.stateUpdate.profile.ruleFiles,
    ).toContain("migrated-variable-rules.json");
    if (role === "linqian") {
      expect(saved.extensions.tavern_headless.promptController).toMatchObject({
        modulePath: "prompt-controllers.js",
        controllerEntryIds: [109, 111, 127],
      });
      expect(
        saved.extensions.tavern_headless.stateUpdate.files[
          "prompt-controllers.js"
        ],
      ).toContain("renderController");
    }
    expect(response.json().data.worldbook).toBeDefined();
    expect(built.database.select().from(sessions).all()).toHaveLength(0);
  },
);

it("rejects malformed YAML and unsupported immediate session creation before writing character data", async () => {
  const built = await buildTestApp({
    databasePath: ":memory:",
    auth: { mode: "off" },
    logger: false,
  });
  app = built.app;
  const { payload } = await fixture("linqian");
  const immediate = await app.inject({
    method: "POST",
    url: "/import/character",
    payload: { ...payload, create_session: true },
  });
  expect(immediate.statusCode).toBe(400);
  expect(immediate.json().error.code).toBe("ROLE_IMPORT_SESSION_UNAVAILABLE");
  const card = payload.payload as any;
  const entries = card.data.character_book.entries;
  const entry = (
    Array.isArray(entries) ? entries : Object.values(entries)
  ).find(
    (item: any) =>
      (item.uid ?? item.id) === payload.role_migration.migration.initialEntryId,
  );
  entry.content = "state: [";
  const invalid = await app.inject({
    method: "POST",
    url: "/import/character",
    payload,
  });
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect(invalid.json().error).toMatchObject({
    code: "ROLE_IMPORT_YAML_INVALID",
    details: { cause: expect.any(String) },
  });
  expect(built.database.select().from(characters).all()).toHaveLength(0);
});

it("denies role migration import for a regular authenticated account", async () => {
  const built = await buildTestApp({
    databasePath: ":memory:",
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: ["user-key"],
      apiKeyAccountMap: { "user-key": "regular" },
    },
    logger: false,
  });
  app = built.app;
  built.database
    .insert(accounts)
    .values({
      id: "regular",
      name: "Regular",
      role: "user",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const { payload } = await fixture("linqian");
  const response = await app.inject({
    method: "POST",
    url: "/import/character",
    headers: { authorization: "Bearer user-key" },
    payload,
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("ROLE_IMPORT_ACCESS_DENIED");
});
