import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  apiErrorMessages,
  modelCallDetailJsonSchema,
  modelCallListJsonSchema,
  modelCallQueryJsonSchema,
} from "@tavern/shared";

import { sendError } from "../lib/http.js";
import { authHasCapability, getRequestAuthContext } from "../plugins/auth.js";
import {
  ModelCallQueryError,
  type ModelCallRecordService,
} from "../services/model-call-record-service.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";

export async function registerModelCallRoutes(
  app: FastifyInstance,
  service: ModelCallRecordService,
): Promise<void> {
  function authorize(
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | undefined {
    const auth = getRequestAuthContext(request);
    if (
      auth.role !== "admin" ||
      !authHasCapability(auth, "session.read") ||
      !authHasCapability(auth, "audit.read")
    ) {
      sendError(
        reply,
        403,
        "MODEL_CALL_ACCESS_DENIED",
        apiErrorMessages.MODEL_CALL_ACCESS_DENIED,
      );
      return undefined;
    }
    return auth.accountId;
  }

  function queryError(error: unknown, reply: FastifyReply) {
    if (!(error instanceof ModelCallQueryError)) throw error;
    return sendError(
      reply,
      error.code === "MODEL_CALL_NOT_FOUND" ? 404 : 400,
      error.code,
      apiErrorMessages[error.code],
    );
  }

  app.get<{ Params: { id: string } }>(
    "/floors/:id/model-calls",
    {
      schema: {
        tags: ["model-calls"],
        operationId: "listModelCalls",
        summary: "Read saved model calls for a floor",
        params: idParamsJsonSchema,
        querystring: modelCallQueryJsonSchema,
        response: {
          200: modelCallListJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const accountId = authorize(request, reply);
      if (!accountId) return;
      try {
        return service.list(accountId, request.params.id, request.query);
      } catch (error) {
        return queryError(error, reply);
      }
    },
  );

  app.get<{ Params: { id: string; callId: string } }>(
    "/floors/:id/model-calls/:callId",
    {
      schema: {
        tags: ["model-calls"],
        operationId: "getModelCall",
        summary: "Read one saved model request and response",
        params: {
          type: "object",
          required: ["id", "callId"],
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1 },
            callId: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: modelCallDetailJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const accountId = authorize(request, reply);
      if (!accountId) return;
      try {
        return service.get(accountId, request.params.id, request.params.callId);
      } catch (error) {
        return queryError(error, reply);
      }
    },
  );
}
