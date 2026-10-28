import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { publicRoleSessions } from "../db/public-role-session-schema.js";
import { sessions } from "../db/schema.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  createPublicRoleSession,
  getPublicRoleSessionOperation,
  PublicRoleSessionError,
} from "../services/public-role-session-service.js";
import {
  toPublicCatalogueRole,
  toPublicRoleRelease,
  selectRoleReleaseOpening,
} from "../services/role-release-service.js";
import { toSessionResponse } from "./sessions.js";
import {
  forwardedAuthHeaders,
  type RegisterRoleReleaseRoutesOptions,
} from "./role-releases.js";
import { parseWithSchema } from "../lib/http.js";
import {
  createPublicRoleSessionBodyJsonSchema,
  createPublicRoleSessionBodySchema,
  publicRoleSessionResponseJsonSchema,
  publicRoleSessionPendingResponseJsonSchema,
  publicRoleListQueryJsonSchema,
  publicRoleListResponseJsonSchema,
  publicRoleResponseJsonSchema,
} from "@tavern/shared";
import type { AppDb } from "../db/client.js";
import { RoleReleaseService } from "../services/role-release-service.js";
import { sendError } from "../lib/http.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";

export async function registerPublicRoleRoutes(
  app: FastifyInstance,
  db: AppDb,
  options: RegisterRoleReleaseRoutesOptions = {},
): Promise<void> {
  const releases = new RoleReleaseService(db);
  const resultFor = (
    accountId: string,
    binding: NonNullable<ReturnType<typeof getPublicRoleSessionOperation>>,
  ) => {
    if (!binding.ready)
      return { status: "initializing" as const, session_id: binding.sessionId };
    const session = db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, binding.sessionId),
          eq(sessions.accountId, accountId),
        ),
      )
      .get();
    const release = releases.get(binding.publisherAccountId, binding.releaseId);
    if (!session || !release)
      throw new PublicRoleSessionError(
        404,
        "PUBLIC_ROLE_OPERATION_NOT_FOUND",
        "尚未找到这次创建的演绎，请稍后再次核对。",
      );
    return {
      status: "complete" as const,
      session: toSessionResponse(session),
      release: toPublicCatalogueRole(release),
      opening_id: JSON.parse(session.metadataJson ?? "{}").opening_id ?? null,
    };
  };
  app.get<{ Params: { id: string } }>(
    "/public/role-session-operations/:id",
    {
      schema: {
        tags: ["public-roles"],
        summary: "Resolve an owned role session creation",
        operationId: "getPublicRoleSessionOperation",
        params: idParamsJsonSchema,
        response: {
          200: publicRoleSessionResponseJsonSchema,
          202: publicRoleSessionPendingResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      const binding = getPublicRoleSessionOperation(
        db,
        auth.accountId,
        request.params.id,
      );
      if (!binding)
        return sendError(
          reply,
          404,
          "PUBLIC_ROLE_OPERATION_NOT_FOUND",
          "尚未找到这次创建的演绎，请稍后再次核对。",
        );
      const data = resultFor(auth.accountId, binding);
      return reply.code(binding.ready ? 200 : 202).send({ data });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/public/roles/:id/sessions",
    {
      schema: {
        tags: ["public-roles"],
        summary: "Start an owned session from a published role",
        operationId: "createPublicRoleSession",
        params: idParamsJsonSchema,
        body: createPublicRoleSessionBodyJsonSchema,
        response: {
          200: publicRoleSessionResponseJsonSchema,
          201: publicRoleSessionResponseJsonSchema,
          202: publicRoleSessionPendingResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      const parsed = parseWithSchema(
        createPublicRoleSessionBodySchema,
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      let initialized: string | undefined;
      try {
        const created = createPublicRoleSession(
          db,
          auth.accountId,
          request.params.id,
          parsed.data,
        );
        if (!created.binding.ready) {
          const session = created.existing
            ? db
                .select()
                .from(sessions)
                .where(
                  and(
                    eq(sessions.id, created.binding.sessionId),
                    eq(sessions.accountId, auth.accountId),
                  ),
                )
                .get()
            : created.session;
          const release = created.existing
            ? releases.get(
                created.binding.publisherAccountId,
                created.binding.releaseId,
              )
            : created.release;
          if (!session || !release)
            throw new PublicRoleSessionError(
              404,
              "PUBLIC_ROLE_OPERATION_NOT_FOUND",
              "尚未找到这次创建的演绎，请稍后再次核对。",
            );
          initialized = session.id;
          const opening = selectRoleReleaseOpening(
            release.opening_snapshots,
            parsed.data.opening_id,
            parsed.data.session_type,
          );
          await options.onSessionCreated?.({
            session: toSessionResponse(session),
            release: toPublicRoleRelease(release),
            opening,
            headers: forwardedAuthHeaders(request),
          });
          db.update(publicRoleSessions)
            .set({ ready: true })
            .where(eq(publicRoleSessions.sessionId, initialized))
            .run();
        }
        const binding = getPublicRoleSessionOperation(
          db,
          auth.accountId,
          parsed.data.operation_id,
        )!;
        const data = resultFor(auth.accountId, binding);
        return reply
          .code(binding.ready ? (created.existing ? 200 : 201) : 202)
          .send({ data });
      } catch (error) {
        if (initialized) {
          const cleanup = await app.inject({
            method: "DELETE",
            url: `/sessions/${encodeURIComponent(initialized)}`,
            headers: forwardedAuthHeaders(request),
          });
          if (cleanup.statusCode >= 400)
            return sendError(
              reply,
              500,
              "PUBLIC_ROLE_SESSION_CLEANUP_FAILED",
              "演绎初始化失败，请核对创建结果后再继续。",
              { session_id: initialized },
            );
        }
        if (error instanceof PublicRoleSessionError)
          return sendError(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    },
  );

  app.get(
    "/public/roles",
    {
      schema: {
        tags: ["public-roles"],
        summary: "Browse published roles",
        operationId: "listPublicRoles",
        querystring: publicRoleListQueryJsonSchema,
        response: { 200: publicRoleListResponseJsonSchema },
      },
    },
    async (request) =>
      releases.publicCatalogue(
        request.query as {
          keyword?: string;
          tag?: string;
          limit?: number;
          offset?: number;
        },
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/public/roles/:id",
    {
      schema: {
        tags: ["public-roles"],
        summary: "Read a published role",
        operationId: "getPublicRole",
        params: idParamsJsonSchema,
        response: {
          200: publicRoleResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const role = releases.getPublicRole(request.params.id);
      if (!role)
        return sendError(
          reply,
          404,
          "PUBLIC_ROLE_NOT_FOUND",
          "这个角色已停止发布，请返回角色广场选择其他角色。",
        );
      return { data: role };
    },
  );
}
