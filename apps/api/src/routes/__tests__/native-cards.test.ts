import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import {
  registerNativeCardRoutes,
  type NativeCardRouteServices,
} from "../native-cards.js";
import type { AuthenticatedAuthContext } from "../../plugins/auth.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(role: "admin" | "user" = "admin") {
  const app = Fastify();
  apps.push(app);
  app.addHook("onRequest", async (request) => {
    request.authContext = {
      kind: "authenticated",
      accountId: "owner",
      role,
      status: "active",
      actorType: "account",
      actorId: "owner",
      actorAccountId: "owner",
      actorClientId: null,
      authMethod: "dev",
    } satisfies AuthenticatedAuthContext;
  });
  const inspectImport = vi.fn(async () => ({
    id: "import-a",
    fileName: "sample.zip",
    packageId: "sample",
    name: "Sample",
    summary: {
      formatVersion: "1.0.0" as const,
      worldbookCount: 0,
      openingCount: 0,
      initialStateCount: 0,
      stateUpdate: {
        rules: false,
        schema: false,
        validators: false,
        tools: false,
      },
      promptController: false,
      frontend: { page: false, script: false, style: false, media: false },
      regexProfileCount: 0,
    },
    files: [],
    issues: [],
    status: "ready" as const,
  }));
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected service call");
  };
  const allocateEntryUid = vi.fn(async () => ({ uid: 8 }));
  const readBuild = vi.fn(async () => Buffer.from("ZIP"));
  const service: NativeCardRouteServices = {
    allocateEntryUid,
    list: unused,
    create: unused,
    get: unused,
    readFile: unused,
    save: unused,
    validate: unused,
    inspectImport,
    confirmImport: unused,
    publish: unused,
    createPreview: unused,
    build: unused,
    getBuild: unused,
    retryBuild: unused,
    readBuild,
    sendError: (error, reply) => reply.code(500).send({ error: String(error) }),
  };
  await registerNativeCardRoutes(app, service, 32);
  return { app, inspectImport, allocateEntryUid, readBuild };
}

it("exposes the fixed artifact filename to browser SDK downloads", async () => {
  const { app, readBuild } = await setup();
  const response = await app.inject({
    method: "GET",
    url: "/native-card-builds/build-a/download",
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["content-disposition"]).toBe(
    'attachment; filename="character-build-a.zip"',
  );
  expect(response.headers["access-control-expose-headers"]).toBe(
    "Content-Disposition",
  );
  expect(response.body).toBe("ZIP");
  expect(readBuild).toHaveBeenCalledWith("owner", "build-a");
});

it("passes the original ZIP bytes and filename to the account-scoped import service", async () => {
  const { app, inspectImport } = await setup();
  const bytes = Buffer.from([0x50, 0x4b, 0, 255, 128]);
  const result = await app.inject({
    method: "POST",
    url: "/native-cards/imports?fileName=sample.zip",
    headers: { "content-type": "application/zip" },
    payload: bytes,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(inspectImport).toHaveBeenCalledWith("owner", bytes, "sample.zip");
  expect(result.json().data.summary).toMatchObject({
    formatVersion: "1.0.0",
    worldbookCount: 0,
    openingCount: 0,
  });
});

it("rejects an oversized upload before calling the import service", async () => {
  const { app, inspectImport } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/native-cards/imports",
    headers: { "content-type": "application/zip" },
    payload: Buffer.alloc(33),
  });
  expect(result.statusCode, result.body).toBe(413);
  expect(inspectImport).not.toHaveBeenCalled();
});

it("rejects JSON uploads even when the payload resembles a file", async () => {
  const { app, inspectImport } = await setup();
  const result = await app.inject({
    method: "POST",
    url: "/native-cards/imports",
    payload: { file: "PK" },
  });
  expect(result.statusCode, result.body).toBe(400);
  expect(inspectImport).not.toHaveBeenCalled();
});

it("denies package administration to ordinary users", async () => {
  const { app, inspectImport } = await setup("user");
  const result = await app.inject({
    method: "POST",
    url: "/native-cards/imports",
    headers: { "content-type": "application/zip" },
    payload: Buffer.from("PK"),
  });
  expect(result.statusCode, result.body).toBe(403);
  expect(result.json().error.code).toBe("NATIVE_CARD_ACCESS_DENIED");
  expect(inspectImport).not.toHaveBeenCalled();
});

it("allocates entry ids with the saved revision and rejects malformed reserved ids", async () => {
  const { app, allocateEntryUid } = await setup();
  const input = { expectedRevision: 2, bookId: "harbor", reservedUids: [7] };
  const result = await app.inject({
    method: "POST",
    url: "/native-cards/card-a/entry-uids/allocate",
    payload: input,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toEqual({ data: { uid: 8 } });
  expect(allocateEntryUid).toHaveBeenCalledWith("owner", "card-a", input);
  const invalid = await app.inject({
    method: "POST",
    url: "/native-cards/card-a/entry-uids/allocate",
    payload: { ...input, reservedUids: [-1] },
  });
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect(allocateEntryUid).toHaveBeenCalledTimes(1);
});
