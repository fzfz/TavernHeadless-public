import { eq } from "drizzle-orm";
import { roleAssets } from "../db/schema.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  apiErrorMessages,
  roleAppValidationResponseJsonSchema,
  createRoleAppSchema,
  updateRoleAppSchema,
  roleAppRevisionSchema,
  createRolePreviewSessionSchema,
  createRoleAppJsonSchema,
  updateRoleAppJsonSchema,
  roleAppRevisionJsonSchema,
  createRolePreviewSessionJsonSchema,
  roleAppResponseJsonSchema,
  roleAppListResponseJsonSchema,
  rolePreviewSessionListResponseJsonSchema,
  roleReleaseResponseJsonSchema,
  rolePreviewSessionCreatedResponseJsonSchema,
} from "@tavern/shared";
import type { AppDb } from "../db/client.js";
import { getRequestAuthContext, authHasCapability } from "../plugins/auth.js";
import { sendError } from "../lib/http.js";
import { RoleAppService, RoleAppError } from "../services/role-app-service.js";
import {
  RoleReleaseService,
  buildRoleReleaseSnapshot,
  toPublicRoleRelease,
} from "../services/role-release-service.js";
import {
  resolveRoleReleaseConfiguration,
  createRoleSessionFromSnapshot,
  forwardedAuthHeaders,
  sendRoleReleaseError,
  type RegisterRoleReleaseRoutesOptions,
} from "./role-releases.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";
export async function registerRoleAppRoutes(
  app: FastifyInstance,
  db: AppDb,
  options: RegisterRoleReleaseRoutesOptions,
) {
  const service = new RoleAppService(db),
    releases = new RoleReleaseService(db);
  const errors = {
    400: errorResponseJsonSchema,
    403: errorResponseJsonSchema,
    404: errorResponseJsonSchema,
    409: errorResponseJsonSchema,
    500: errorResponseJsonSchema,
  };
  const admin = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = getRequestAuthContext(request);
    if (
      auth.role !== "admin" ||
      !authHasCapability(auth, "project.config.write")
    )
      return sendError(
        reply,
        403,
        "ROLE_APP_ADMIN_REQUIRED",
        apiErrorMessages.ROLE_APP_ADMIN_REQUIRED,
      );
  };
  const failure = (reply: FastifyReply, error: unknown) =>
    error instanceof RoleAppError
      ? sendError(
          reply,
          error.code === "ROLE_APP_NOT_FOUND" ? 404 : 409,
          error.code,
          error.message,
        )
      : sendRoleReleaseError(reply, error);
  app.post(
    "/role-apps/validate",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "validateRoleApp",
        body: createRoleAppJsonSchema,
        response: { 200: roleAppValidationResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const parsed = createRoleAppSchema.safeParse(request.body);
      if (!parsed.success)
        return sendError(
          reply,
          400,
          "VALIDATION_ERROR",
          apiErrorMessages.VALIDATION_ERROR,
          parsed.error.issues,
        );
      try {
        const resolved = await resolveRoleReleaseConfiguration(
          app,
          forwardedAuthHeaders(request),
          parsed.data.configuration,
          getRequestAuthContext(request).accountId,
          options.requireAssetBundle,
        );
        const extension = resolved.characterSnapshot.extensions
          ?.tavern_headless as Record<string, unknown> | undefined;
        const stateUpdate = extension?.stateUpdate as
          | { profile: Record<string, unknown> }
          | undefined;
        const files = db
          .select({
            name: roleAssets.name,
            purpose: roleAssets.purpose,
            byteSize: roleAssets.byteSize,
          })
          .from(roleAssets)
          .where(
            eq(
              roleAssets.versionId,
              parsed.data.configuration.character_version_id,
            ),
          )
          .all();
        return reply.send({
          data: {
            valid: true,
            versionId: parsed.data.configuration.character_version_id,
            files,
            stateUpdate: stateUpdate?.profile ?? null,
          },
        });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.get(
    "/role-apps",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "listRoleApps",
        response: { 200: roleAppListResponseJsonSchema, ...errors },
      },
    },
    async (request) => ({
      data: service.list(getRequestAuthContext(request).accountId),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/role-apps/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "getRoleApp",
        params: idParamsJsonSchema,
        response: { 200: roleAppResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      try {
        return {
          data: service.get(
            getRequestAuthContext(request).accountId,
            request.params.id,
          ).draft,
        };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post(
    "/role-apps",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "createRoleApp",
        body: createRoleAppJsonSchema,
        response: { 201: roleAppResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { configuration } = createRoleAppSchema.parse(request.body),
        auth = getRequestAuthContext(request);
      try {
        const resolved = await resolveRoleReleaseConfiguration(
          app,
          forwardedAuthHeaders(request),
          configuration,
          auth.accountId,
          options.requireAssetBundle,
        );
        const resolvedConfiguration = {
          ...configuration,
          statePresetId: resolved.statePresetId,
          statePresetVersionId: resolved.statePresetVersionId,
          stateHistoryTurns: resolved.stateHistoryTurns,
        };
        return reply.code(201).send({
          data: service.save(
            auth.accountId,
            auth.actorId,
            resolvedConfiguration,
            buildRoleReleaseSnapshot(resolved),
          ),
        });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.put<{ Params: { id: string } }>(
    "/role-apps/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "updateRoleApp",
        params: idParamsJsonSchema,
        body: updateRoleAppJsonSchema,
        response: { 200: roleAppResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { configuration, expected_revision } = updateRoleAppSchema.parse(
          request.body,
        ),
        auth = getRequestAuthContext(request);
      try {
        service.get(auth.accountId, request.params.id, expected_revision);
        const resolved = await resolveRoleReleaseConfiguration(
          app,
          forwardedAuthHeaders(request),
          configuration,
          auth.accountId,
          options.requireAssetBundle,
        );
        const resolvedConfiguration = {
          ...configuration,
          statePresetId: resolved.statePresetId,
          statePresetVersionId: resolved.statePresetVersionId,
          stateHistoryTurns: resolved.stateHistoryTurns,
        };
        return {
          data: service.save(
            auth.accountId,
            auth.actorId,
            resolvedConfiguration,
            buildRoleReleaseSnapshot(resolved),
            { id: request.params.id, revision: expected_revision },
          ),
        };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/role-apps/:id/preview-sessions",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "listRolePreviewSessions",
        params: idParamsJsonSchema,
        response: { 200: rolePreviewSessionListResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      try {
        return {
          data: service.previews(
            auth.accountId,
            auth.actorId,
            request.params.id,
          ),
        };
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/role-apps/:id/preview-sessions",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "createRolePreviewSession",
        params: idParamsJsonSchema,
        body: createRolePreviewSessionJsonSchema,
        response: {
          201: rolePreviewSessionCreatedResponseJsonSchema,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const { expected_revision, ...input } =
          createRolePreviewSessionSchema.parse(request.body),
        auth = getRequestAuthContext(request);
      try {
        const { draft, snapshot } = service.get(
          auth.accountId,
          request.params.id,
          expected_revision,
        );
        await options.requireAssetBundle?.(
          auth.accountId,
          snapshot.character_version_id,
        );
        service.get(auth.accountId, request.params.id, expected_revision);
        return await createRoleSessionFromSnapshot(
          db,
          app,
          request,
          reply,
          snapshot,
          input,
          options,
          {
            draft_id: draft.id,
            draft_revision: draft.revision,
            creator_id: auth.actorId,
          },
        );
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/role-apps/:id/releases",
    {
      preHandler: admin,
      schema: {
        tags: ["role-apps"],
        operationId: "publishRoleApp",
        params: idParamsJsonSchema,
        body: roleAppRevisionJsonSchema,
        response: { 201: roleReleaseResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { expected_revision } = roleAppRevisionSchema.parse(request.body),
        auth = getRequestAuthContext(request);
      try {
        const { draft, snapshot } = service.get(
          auth.accountId,
          request.params.id,
          expected_revision,
        );
        await options.requireAssetBundle?.(
          auth.accountId,
          snapshot.character_version_id,
        );
        // Recheck the optimistic revision after asynchronous file validation.
        service.get(auth.accountId, request.params.id, expected_revision);
        const release = releases.create({
          ...draft.configuration,
          accountId: auth.accountId,
          modelSlots: snapshot.model_slots,
          characterSnapshot: snapshot.character_snapshot,
          defaultUserSnapshot: snapshot.default_user_snapshot,
          openings: snapshot.opening_snapshots,
        });
        return reply.code(201).send({ data: toPublicRoleRelease(release) });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
}
