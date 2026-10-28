import type { FastifyInstance } from "fastify";
import {
  apiErrorMessages,
  createRoleAssetsJsonSchema,
  roleAssetUploadResultJsonSchema,
  roleAssetVersionParamsJsonSchema,
  type CreateRoleAssets,
} from "@tavern/shared";
import { authHasCapability, getRequestAuthContext } from "../plugins/auth.js";
import { sendError } from "../lib/http.js";
import {
  RoleAssetError,
  type RoleAssetService,
} from "../services/role-runtime/role-asset-service.js";
import { errorResponseJsonSchema } from "./schemas/common.js";

export async function registerRoleAssetRoutes(
  app: FastifyInstance,
  service: RoleAssetService,
  maxUploadBytes: number,
): Promise<void> {
  const sendAssetError = (
    error: unknown,
    reply: import("fastify").FastifyReply,
  ) => {
    if (!(error instanceof RoleAssetError)) throw error;
    const status =
      error.code === "ROLE_ASSET_NOT_FOUND"
        ? 404
        : error.code === "ROLE_ASSETS_ALREADY_SAVED"
          ? 409
          : error.code === "ROLE_ASSET_PACKAGE_INVALID"
            ? 400
            : error.code === "ROLE_ASSET_SERVER_ONLY"
              ? 403
              : 503;
    return sendError(reply, status, error.code, error.message, error.details);
  };
  app.post<{ Params: { versionId: string }; Body: CreateRoleAssets }>(
    "/role-assets/:versionId",
    {
      bodyLimit: maxUploadBytes,
      schema: {
        tags: ["role-assets"],
        operationId: "createRoleAssets",
        summary: "Import the complete file set of a role version",
        params: roleAssetVersionParamsJsonSchema,
        body: createRoleAssetsJsonSchema,
        response: {
          201: roleAssetUploadResultJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      ) {
        return sendError(
          reply,
          403,
          "ROLE_ASSET_IMPORT_DENIED",
          apiErrorMessages.ROLE_ASSET_IMPORT_DENIED,
        );
      }
      try {
        return reply
          .code(201)
          .send({
            data: await service.import(
              auth.accountId,
              request.params.versionId,
              request.body,
            ),
          });
      } catch (error) {
        return sendAssetError(error, reply);
      }
    },
  );
  app.get<{ Params: { versionId: string; "*": string } }>(
    "/role-assets/:versionId/*",
    {
      schema: {
        tags: ["role-assets"],
        operationId: "getRoleAsset",
        summary: "Read a browser resource from a committed role version",
      },
    },
    async (request, reply) => {
      try {
        const asset = await service.read(
          getRequestAuthContext(request).accountId,
          request.params.versionId,
          request.params["*"],
        );
        return reply.type(asset.mime).send(asset.content);
      } catch (error) {
        return sendAssetError(error, reply);
      }
    },
  );
}
