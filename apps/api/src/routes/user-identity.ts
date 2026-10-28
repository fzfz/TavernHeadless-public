import { userIdentityPolicy } from "@tavern/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DatabaseConnection } from "../db/client.js";
import type { AccountMode } from "../accounts/constants.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { validateBrowserRequestOrigin } from "../plugins/browser-origin.js";
import {
  getDefaultPersonaId,
  MULTI_ACCOUNT_REQUIRED_MESSAGE,
  readUserSessionToken,
  UserIdentityError,
  UserIdentityService,
} from "../services/user-identity-service.js";

import type { UserSessionCookieConfig } from "../user-session-cookie-config.js";

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(userIdentityPolicy.nameMaxLength);
const emailSchema = z
  .string()
  .trim()
  .max(userIdentityPolicy.emailMaxLength)
  .email();
const passwordSchema = z
  .string()
  .min(userIdentityPolicy.passwordMinLength)
  .max(userIdentityPolicy.passwordMaxLength);
const nameJson = {
  type: "string",
  minLength: 1,
  maxLength: userIdentityPolicy.nameMaxLength,
};
const emailJson = {
  type: "string",
  format: "email",
  maxLength: userIdentityPolicy.emailMaxLength,
};
const passwordJson = {
  type: "string",
  minLength: userIdentityPolicy.passwordMinLength,
  maxLength: userIdentityPolicy.passwordMaxLength,
};
const accountJson = {
  type: "object",
  required: [
    "id",
    "name",
    "email",
    "role",
    "status",
    "default_persona_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    name: nameJson,
    email: { anyOf: [emailJson, { type: "null" }] },
    role: { type: "string", enum: ["admin", "user"] },
    status: { type: "string", enum: ["active", "disabled"] },
    default_persona_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "number" },
    updated_at: { type: "number" },
  },
};
const accountResponseJson = {
  type: "object",
  required: ["data"],
  properties: { data: accountJson },
};
const preferenceJson = {
  type: "object",
  required: ["default_persona_id"],
  properties: {
    default_persona_id: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
  },
};
const preferencesResponseJson = {
  type: "object",
  required: ["data"],
  properties: { data: preferenceJson },
};

function sessionCookie(
  token: string,
  request: FastifyRequest,
  cookieConfig: UserSessionCookieConfig,
  clear = false,
): string {
  const secure =
    cookieConfig.secure === "auto"
      ? request.protocol === "https" || process.env.NODE_ENV === "production"
      : cookieConfig.secure;
  return `${cookieConfig.name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : userIdentityPolicy.sessionMaxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export async function registerUserIdentityRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  cookieConfig: UserSessionCookieConfig,
  allowedOrigins: readonly string[] = [],
  accountMode: AccountMode = "single",
): Promise<void> {
  const service = new UserIdentityService(connection.db);
  const requireMultiAccountMode = () => {
    if (accountMode !== "multi")
      throw new UserIdentityError(
        409,
        "account_mode_restricted",
        MULTI_ACCOUNT_REQUIRED_MESSAGE,
      );
  };
  const handle =
    (
      action: (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => unknown | Promise<unknown>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await action(request, reply);
      } catch (error) {
        if (error instanceof UserIdentityError)
          return sendError(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    };
  const ownAccountId = (request: FastifyRequest) => {
    const auth = getRequestAuthContext(request);
    if (auth.authMethod === "dev" || auth.actorType !== "account")
      throw new UserIdentityError(401, "auth_required", "请先登录。");
    return auth.accountId;
  };
  const requireBrowserOrigin = (request: FastifyRequest) => {
    if (!validateBrowserRequestOrigin(request, allowedOrigins))
      throw new UserIdentityError(
        403,
        "auth_origin_forbidden",
        "请求来源无效，请从当前站点重试。",
      );
  };
  const errors = {
    400: errorResponseJsonSchema,
    401: errorResponseJsonSchema,
    403: errorResponseJsonSchema,
    409: errorResponseJsonSchema,
  };

  app.post(
    "/auth/register",
    {
      schema: {
        tags: ["auth"],
        summary: "Register user account",
        operationId: "registerUserAccount",
        security: [],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "email", "password"],
          properties: {
            name: nameJson,
            email: emailJson,
            password: passwordJson,
            operation_id: { type: "string", format: "uuid" },
          },
        },
        response: { 201: accountResponseJson, ...errors },
      },
    },
    handle(async (request, reply) => {
      requireMultiAccountMode();
      requireBrowserOrigin(request);
      const parsed = parseWithSchema(
        z.object({
          name: nameSchema,
          email: emailSchema,
          password: passwordSchema,
          operation_id: z.string().uuid().optional(),
        }),
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      return reply
        .code(201)
        .send({
          data: await service.register({
            ...parsed.data,
            operationId: parsed.data.operation_id,
          }),
        });
    }),
  );
  app.post(
    "/auth/register/operations/resolve",
    {
      schema: {
        tags: ["auth"],
        summary: "Resolve or close an unconfirmed registration",
        operationId: "resolveRegistrationOperation",
        security: [],
        body: {
          type: "object",
          required: ["operation_id"],
          additionalProperties: false,
          properties: { operation_id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "object",
                required: ["operation_id", "status"],
                additionalProperties: false,
                properties: {
                  operation_id: { type: "string" },
                  status: { type: "string", enum: ["created", "not_created"] },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    handle((request, reply) => {
      requireMultiAccountMode();
      requireBrowserOrigin(request);
      const parsed = parseWithSchema(
        z.object({ operation_id: z.string().uuid() }).strict(),
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      return reply.send({
        data: service.resolveRegistrationOperation(parsed.data.operation_id),
      });
    }),
  );
  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Log in user account",
        operationId: "loginUserAccount",
        security: [],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: { email: emailJson, password: passwordJson },
        },
        response: { 200: accountResponseJson, ...errors },
      },
    },
    handle(async (request, reply) => {
      requireMultiAccountMode();
      requireBrowserOrigin(request);
      const parsed = parseWithSchema(
        z.object({ email: emailSchema, password: passwordSchema }),
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      const result = await service.login(
        parsed.data,
        readUserSessionToken(request.headers.cookie, cookieConfig.name),
      );
      return reply
        .header("Set-Cookie", sessionCookie(result.token, request, cookieConfig))
        .send({ data: result.account });
    }),
  );
  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Revoke user login session",
        operationId: "logoutUserAccount",
        security: [],
        response: {
          200: {
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "object",
                required: ["logged_out"],
                properties: { logged_out: { type: "boolean" } },
              },
            },
          },
          ...errors,
        },
      },
    },
    handle((request, reply) => {
      requireBrowserOrigin(request);
      service.logout(
        readUserSessionToken(request.headers.cookie, cookieConfig.name),
      );
      return reply
        .header("Set-Cookie", sessionCookie("", request, cookieConfig, true))
        .send({ data: { logged_out: true } });
    }),
  );
  app.get(
    "/auth/me",
    {
      schema: {
        tags: ["auth"],
        summary: "Get current account",
        operationId: "getCurrentAccount",
        response: { 200: accountResponseJson, ...errors },
      },
    },
    handle((request, reply) =>
      reply.send({ data: service.getAccount(ownAccountId(request)) }),
    ),
  );
  app.patch(
    "/auth/me",
    {
      schema: {
        tags: ["auth"],
        summary: "Update current account name",
        operationId: "updateCurrentAccount",
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: nameJson },
        },
        response: { 200: accountResponseJson, ...errors },
      },
    },
    handle((request, reply) => {
      requireMultiAccountMode();
      const parsed = parseWithSchema(
        z.object({ name: nameSchema }),
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      return reply.send({
        data: service.updateName(ownAccountId(request), parsed.data.name),
      });
    }),
  );
  app.get(
    "/auth/preferences",
    {
      schema: {
        tags: ["auth"],
        summary: "Get current account preferences",
        operationId: "getCurrentAccountPreferences",
        response: { 200: preferencesResponseJson, ...errors },
      },
    },
    handle((request, reply) =>
      reply.send({
        data: {
          default_persona_id: getDefaultPersonaId(
            connection.db,
            ownAccountId(request),
          ),
        },
      }),
    ),
  );
  app.patch(
    "/auth/preferences",
    {
      schema: {
        tags: ["auth"],
        summary: "Set current account default persona",
        operationId: "updateCurrentAccountPreferences",
        body: { ...preferenceJson, additionalProperties: false },
        response: {
          200: preferencesResponseJson,
          404: errorResponseJsonSchema,
          ...errors,
        },
      },
    },
    handle((request, reply) => {
      const parsed = parseWithSchema(
        z.object({ default_persona_id: z.string().min(1).nullable() }),
        request.body,
        reply,
      );
      if (!parsed.ok) return;
      return reply.send({
        data: service.updateDefaultPersona(
          ownAccountId(request),
          parsed.data.default_persona_id,
        ),
      });
    }),
  );
}
