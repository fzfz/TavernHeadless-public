import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDb } from "../db/client.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import {
  ReplyCandidateError,
  ReplyCandidateService,
} from "../services/reply-candidate-service.js";
import type { GenerationCoordinator } from "../services/generation-guard-service.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";
import { roleSnapshotResponseJsonSchema } from "@tavern/shared";

const activateSchema = z.object({
  branch_id: z.string().min(1),
  floor_id: z.string().min(1),
  expected_snapshot_id: z.string().min(1).nullable(),
  operation_id: z.string().min(1).max(200),
});
const candidateJson = {
  type: "object",
  required: ["floor_id", "page_id", "text", "created_at"],
  properties: {
    floor_id: { type: "string" },
    page_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    text: { type: "string" },
    created_at: { type: "number" },
  },
};
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const listJson = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "session_id",
        "branch_id",
        "floor_no",
        "active_floor_id",
        "can_activate",
        "items",
      ],
      properties: {
        session_id: { type: "string" },
        branch_id: { type: "string" },
        floor_no: { type: "number" },
        active_floor_id: nullableString,
        can_activate: { type: "boolean" },
        items: { type: "array", items: candidateJson },
      },
    },
  },
};
const activateJson = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["active_floor_id", "current"],
      properties: {
        active_floor_id: nullableString,
        current: {
          anyOf: [
            roleSnapshotResponseJsonSchema.properties.data,
            { type: "null" },
          ],
        },
      },
    },
  },
};

export async function registerReplyCandidateRoutes(
  app: FastifyInstance,
  db: AppDb,
  coordinator: GenerationCoordinator,
): Promise<void> {
  const service = new ReplyCandidateService(db, coordinator);
  app.get<{ Params: { id: string } }>(
    "/floors/:id/reply-candidates",
    {
      schema: {
        tags: ["sessions"],
        operationId: "listReplyCandidates",
        summary: "List committed reply candidates",
        params: idParamsJsonSchema,
        response: { 200: listJson, 404: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.send({
          data: service.list(
            getRequestAuthContext(request).accountId,
            request.params.id,
          ),
        });
      } catch (error) {
        if (error instanceof ReplyCandidateError)
          return sendError(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/sessions/:id/reply-candidates/activate",
    {
      schema: {
        tags: ["sessions"],
        operationId: "activateReplyCandidate",
        summary: "Select the last committed reply with its saved state",
        params: idParamsJsonSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "branch_id",
            "floor_id",
            "expected_snapshot_id",
            "operation_id",
          ],
          properties: {
            branch_id: { type: "string", minLength: 1 },
            floor_id: { type: "string", minLength: 1 },
            expected_snapshot_id: nullableString,
            operation_id: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
        response: {
          200: activateJson,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseWithSchema(activateSchema, request.body, reply);
      if (!parsed.ok) return;
      try {
        return reply.send({
          data: await service.activate(getRequestAuthContext(request), {
            sessionId: request.params.id,
            branchId: parsed.data.branch_id,
            floorId: parsed.data.floor_id,
            expectedSnapshotId: parsed.data.expected_snapshot_id,
            operationId: parsed.data.operation_id,
          }),
        });
      } catch (error) {
        if (error instanceof ReplyCandidateError)
          return sendError(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    },
  );
}
