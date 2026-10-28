import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import * as modelCallSchemas from "../generated/model-call-json-schemas.js";
import * as nativeCardSchemas from "../generated/native-card-json-schemas.js";
import * as roleAppSchemas from "../generated/role-app-json-schemas.js";
import * as roleAssetSchemas from "../generated/role-asset-json-schemas.js";
import * as roleImportSchemas from "../generated/role-import-json-schemas.js";
import * as roleViewSchemas from "../generated/role-view-json-schemas.js";
import stateUpdateProfileSchema from "../schemas/native-card-package/state-update-profile.schema.json";

describe("generated JSON Schema contracts", () => {
  it("registers every generated API contract with Fastify", async () => {
    const app = Fastify();
    const contracts = {
      ...modelCallSchemas,
      ...nativeCardSchemas,
      ...roleAppSchemas,
      ...roleAssetSchemas,
      ...roleImportSchemas,
      ...roleViewSchemas,
    };
    for (const [name, schema] of Object.entries(contracts)) {
      app.post(`/${name}`, { schema: { body: schema } }, async () => ({
        accepted: true,
      }));
    }

    try {
      await app.ready();
    } finally {
      await app.close();
    }
  });

  it("requires the slash prefix on every generated state profile path", async () => {
    const app = Fastify();
    app.post(
      "/state-profile",
      { schema: { body: stateUpdateProfileSchema } },
      async () => ({ accepted: true }),
    );

    try {
      await app.ready();
      for (const field of [
        "writablePaths",
        "derivedPaths",
        "controllerOwnedPaths",
        "initialDescriptionPaths",
      ]) {
        for (const [path, statusCode] of [
          ["/", 200],
          ["/hp", 200],
          ["", 400],
          ["hp", 400],
          ["x/hp", 400],
        ] as const) {
          const response = await app.inject({
            method: "POST",
            url: "/state-profile",
            payload: {
              updaterPrompt: "update",
              writablePaths: ["/hp"],
              [field]: [path],
            },
          });

          expect(response.statusCode, `${field}: ${path}`).toBe(statusCode);
        }
      }
    } finally {
      await app.close();
    }
  });
});
