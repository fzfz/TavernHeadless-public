import { createRoleAssetsBodySchema } from "./schemas/role-assets.mjs";
import { getRequestAuthContext } from "../plugins/auth.ts";
import { sendError } from "../lib/http.ts";
export function registerRoleAssetRoutes(app, db) {
  const sqlite = db.$client;
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS role_asset (account_id TEXT NOT NULL,version_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(version_id,name));",
  );
  app.post(
    "/role-assets/:versionId",
    {
      bodyLimit: 25 * 1024 * 1024,
      schema: { body: createRoleAssetsBodySchema },
    },
    async (req, reply) => {
      const accountId = getRequestAuthContext(req).accountId;
      const check = await app.inject({
        url: `/characters/${req.body.character_id}/versions`,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(
            ([key]) =>
              !["content-length", "content-type", "transfer-encoding"].includes(
                key,
              ),
          ),
        ),
      });
      if (
        check.statusCode !== 200 ||
        !check.json().data.some((v) => v.id === req.params.versionId)
      )
        return sendError(
          reply,
          404,
          "not_found",
          "Character version not found. Select an existing character version and retry.",
        );
      if (
        new Set(req.body.files.map((f) => f.name)).size !==
        req.body.files.length
      )
        return sendError(
          reply,
          400,
          "invalid_request",
          "Asset names are duplicated in this request. Rename the duplicate files and retry.",
        );
      try {
        sqlite.transaction(() => {
          for (const file of req.body.files)
            sqlite
              .prepare("INSERT INTO role_asset VALUES(?,?,?,?,?)")
              .run(
                accountId,
                req.params.versionId,
                file.name,
                file.mime,
                Buffer.from(file.base64, "base64"),
              );
        })();
      } catch (error) {
        if (
          error.code !== "SQLITE_CONSTRAINT_PRIMARYKEY" &&
          error.code !== "SQLITE_CONSTRAINT_UNIQUE"
        )
          throw error;
        return sendError(
          reply,
          409,
          "role_assets_already_saved",
          "Assets have already been saved for this version. Create a new character version to replace them.",
        );
      }
      return reply.code(201).send({
        data: {
          version_id: req.params.versionId,
          count: req.body.files.length,
        },
      });
    },
  );
  app.get("/role-assets/:versionId/*", async (req, reply) => {
    const asset = sqlite
      .prepare(
        "SELECT mime,content FROM role_asset WHERE account_id=? AND version_id=? AND name=?",
      )
      .get(
        getRequestAuthContext(req).accountId,
        req.params.versionId,
        req.params["*"],
      );
    if (!asset)
      return sendError(
        reply,
        404,
        "not_found",
        "The requested role asset does not exist. Check the resource path in the character version.",
      );
    return reply.type(asset.mime).send(asset.content);
  });
}
