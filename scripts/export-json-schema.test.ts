import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildTestApp } from "../apps/api/test/helpers/create-test-db.js";
import { loadStorageConfig } from "../apps/api/src/storage-config.js";
import {
  nativeCardOperationSchema,
  nativeCardSaveSchema,
} from "../packages/shared/src/schemas/native-card-api.js";
import { nativeCardPackageManifestSchema } from "../packages/shared/src/schemas/native-card-package/schema.js";
import { exportJsonSchema } from "./export-json-schema.js";

describe("JSON Schema export", () => {
  it("preserves native card operation data through the application save route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "json-schema-native-save-"));
    const built = await buildTestApp({
      storage: loadStorageConfig({ DATA_DIR: directory }),
      logger: false,
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableWebSocket: false,
      enableMemory: false,
      enableAgentRuntimeWorker: false,
      enableNodeGraphWorker: false,
    });

    try {
      const created = await built.app.inject({
        method: "POST",
        url: "/native-cards",
        payload: { name: "Union contract" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const cardId = created.json().data.id;
      const manifestFile = await built.app.inject({
        method: "GET",
        url: `/native-cards/${cardId}/file?path=manifest.json&revision=1`,
      });
      expect(manifestFile.statusCode, manifestFile.body).toBe(200);
      const manifest = nativeCardPackageManifestSchema.parse(
        JSON.parse(manifestFile.json().data.content),
      );
      const addedManifest = {
        ...manifest,
        files: [
          ...manifest.files,
          {
            path: "data/union.json",
            mediaType: "application/json",
            purpose: "data",
          },
        ],
      };
      const movedManifest = {
        ...addedManifest,
        files: addedManifest.files.map((file) =>
          file.path === "data/union.json"
            ? { ...file, path: "data/moved.json" }
            : file,
        ),
      };
      const invalidPackage = await built.app.inject({
        method: "PUT",
        url: `/native-cards/${cardId}/files`,
        payload: {
          expectedRevision: 1,
          operations: [
            {
              op: "write",
              path: "character.json",
              encoding: "utf8",
              content: "{}",
            },
          ],
        },
      });
      expect(invalidPackage.statusCode, invalidPackage.body).toBe(422);
      expect(invalidPackage.json()).toMatchObject({
        error: { code: "NATIVE_CARD_PACKAGE_INVALID" },
      });

      let expectedRevision = 1;
      for (const operations of [
        [
          {
            op: "write",
            path: "character.json",
            encoding: "utf8",
            content: '{"name":"Union contract updated"}',
          },
        ],
        [
          {
            op: "write",
            path: "data/union.json",
            encoding: "utf8",
            content: "{}",
          },
          {
            op: "write",
            path: "manifest.json",
            encoding: "utf8",
            content: JSON.stringify(addedManifest),
          },
        ],
        [
          { op: "move", path: "data/union.json", to: "data/moved.json" },
          {
            op: "write",
            path: "manifest.json",
            encoding: "utf8",
            content: JSON.stringify(movedManifest),
          },
        ],
        [
          { op: "delete", path: "data/moved.json" },
          {
            op: "write",
            path: "manifest.json",
            encoding: "utf8",
            content: JSON.stringify(manifest),
          },
        ],
      ]) {
        const saved = await built.app.inject({
          method: "PUT",
          url: `/native-cards/${cardId}/files`,
          payload: { expectedRevision, operations },
        });
        expect(saved.statusCode, saved.body).toBe(200);
        expectedRevision += 1;
        expect(saved.json().data.revision).toBe(expectedRevision);
      }
      const read = await built.app.inject({
        method: "GET",
        url: `/native-cards/${cardId}/file?path=character.json&revision=${expectedRevision}`,
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().data.content).toBe(
        '{"name":"Union contract updated"}',
      );

      for (const operation of [
        { path: "character.json" },
        { op: "unknown", path: "character.json" },
      ]) {
        const rejected = await built.app.inject({
          method: "PUT",
          url: `/native-cards/${cardId}/files`,
          payload: { expectedRevision, operations: [operation] },
        });
        expect(rejected.statusCode, rejected.body).toBe(400);
      }
    } finally {
      await built.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("registers the application routes and rejects proposal paths without a slash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "json-schema-export-"));
    const built = await buildTestApp({
      storage: loadStorageConfig({ DATA_DIR: directory }),
      logger: false,
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableWebSocket: false,
      enableMemory: false,
      enableAgentRuntimeWorker: false,
      enableNodeGraphWorker: false,
    });

    try {
      await built.app.ready();
      const payload = {
        proposal: {
          changes: [{ op: "set", path: "hp", value: 5 }],
          evidenceMessageIds: ["message"],
        },
        sourceMessages: [
          {
            messageId: "message",
            revision: 1,
            role: "assistant",
            text: "state",
          },
        ],
      };
      const response = await built.app.inject({
        method: "POST",
        url: "/sessions/missing/role-state/inspect-proposal",
        payload,
      });

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "validation_error" },
      });
    } finally {
      await built.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "prefix",
      schema: z.string().startsWith("/"),
      values: ["/", "/hp", "", "hp", "x/hp"],
    },
    {
      name: "suffix",
      schema: z.string().endsWith(".$"),
      values: [".$", "path.$", "", "path", "pathx$"],
    },
    {
      name: "substring",
      schema: z.string().includes(".+"),
      values: [".+", "path.+value", "", "path", "pathxxvalue"],
    },
    {
      name: "combined patterns",
      schema: z.string().startsWith("/").includes(".").endsWith("$"),
      values: ["/.$", "/path.$", "/path$", "path.$", "/path."],
    },
  ])("preserves $name constraints in Fastify", async ({ schema, values }) => {
    const app = Fastify();
    app.post(
      "/validate",
      {
        schema: {
          body: await exportJsonSchema(z.object({ value: schema }).strict()),
        },
      },
      async () => ({ accepted: true }),
    );

    try {
      await app.ready();
      for (const value of values) {
        const response = await app.inject({
          method: "POST",
          url: "/validate",
          payload: { value },
        });
        expect(response.statusCode, value).toBe(
          schema.safeParse(value).success ? 200 : 400,
        );
      }
    } finally {
      await app.close();
    }
  });

  it("preserves standard formats and literal metadata", async () => {
    const example = { type: "string", format: "starts_with", pattern: "^/" };
    const schema = z.object({
      email: z.email(),
      example: z.unknown().default(example),
    });

    expect(await exportJsonSchema(schema)).toMatchObject({
      properties: {
        email: { format: "email" },
        example: { default: example },
      },
    });
  });
});

describe("union conversion", () => {
  it.each([
    {
      name: "discriminated union",
      operation: nativeCardOperationSchema,
    },
    {
      name: "ordinary union",
      operation: z.union(nativeCardOperationSchema.options),
    },
    {
      name: "reversed ordinary union",
      operation: z.union([
        nativeCardOperationSchema.options[2],
        nativeCardOperationSchema.options[1],
        nativeCardOperationSchema.options[0],
      ]),
    },
    {
      name: "reversed discriminated union",
      operation: z.discriminatedUnion("op", [
        nativeCardOperationSchema.options[2],
        nativeCardOperationSchema.options[1],
        nativeCardOperationSchema.options[0],
      ]),
    },
  ])("preserves operation input for $name", async ({ operation }) => {
    const source = nativeCardSaveSchema.extend({
      operations: z.array(operation).min(1),
    });
    const app = Fastify();
    app.post(
      "/save",
      { schema: { body: await exportJsonSchema(source) } },
      async (request) => source.parse(request.body),
    );

    try {
      await app.ready();
      for (const change of [
        {
          op: "write",
          path: "character.json",
          encoding: "utf8",
          content: "{}",
        },
        { op: "move", path: "assets/source.txt", to: "assets/destination.txt" },
        { op: "delete", path: "assets/temporary.txt" },
      ]) {
        const payload = { expectedRevision: 1, operations: [change] };
        const response = await app.inject({
          method: "POST",
          url: "/save",
          payload,
        });

        expect(source.safeParse(payload).success).toBe(true);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toEqual(payload);
      }

      for (const change of [
        { path: "character.json" },
        { op: "unknown", path: "character.json" },
        { op: "write", path: "character.json", content: "{}" },
        { op: "move", path: "assets/source.txt" },
        { op: "delete", path: "assets/temporary.txt", unsupported: true },
      ]) {
        const payload = { expectedRevision: 1, operations: [change] };
        const response = await app.inject({
          method: "POST",
          url: "/save",
          payload,
        });

        expect(source.safeParse(payload).success).toBe(false);
        expect(response.statusCode, response.body).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      name: "primitive XOR",
      schema: z.xor([z.string().min(1), z.string().max(3)]),
      accepted: ["", "four"],
      rejected: ["a"],
    },
    {
      name: "array XOR",
      schema: z.xor([
        z.array(nativeCardOperationSchema.options[0]),
        z.array(nativeCardOperationSchema.options[2]),
      ]),
      accepted: [
        [
          {
            op: "write",
            path: "character.json",
            encoding: "utf8",
            content: "{}",
          },
        ],
        [{ op: "delete", path: "assets/temporary.txt" }],
      ],
      rejected: [[]],
    },
    {
      name: "object XOR",
      schema: z.xor([
        z.object({ op: z.literal("set"), value: z.number().min(0) }).strict(),
        z.object({ op: z.literal("set"), value: z.number().max(10) }).strict(),
      ]),
      accepted: [
        { op: "set", value: -1 },
        { op: "set", value: 11 },
      ],
      rejected: [{ op: "set", value: 5 }],
    },
  ])(
    "preserves exclusive semantics for $name",
    async ({ schema, accepted, rejected }) => {
      const exported = await exportJsonSchema(schema);
      expect(exported.oneOf).toBeDefined();
      expect(exported.anyOf).toBeUndefined();
      const app = Fastify();
      app.post(
        "/exclusive",
        {
          schema: { body: await exportJsonSchema(z.object({ value: schema })) },
        },
        async (request) => request.body,
      );

      try {
        await app.ready();
        for (const [values, statusCode] of [
          [accepted, 200],
          [rejected, 400],
        ] as const) {
          for (const value of values) {
            const response = await app.inject({
              method: "POST",
              url: "/exclusive",
              payload: { value },
            });
            expect(schema.safeParse(value).success).toBe(statusCode === 200);
            expect(response.statusCode, response.body).toBe(statusCode);
            if (statusCode === 200) expect(response.json()).toEqual({ value });
          }
        }
      } finally {
        await app.close();
      }
    },
  );
});
