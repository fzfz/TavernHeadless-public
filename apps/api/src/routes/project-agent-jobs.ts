/**
 * ProjectAgentTaskBoard routes expose read and cancellation operations for
 * background Agent jobs in a project.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  projectAgentJobJsonSchema,
  projectAgentJobListQueryJsonSchema,
  projectAgentJobListQuerySchema,
  projectAgentJobListResponseJsonSchema,
  projectAgentJobWireSchema,
} from "@tavern/shared";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import {
  ProjectAgentTaskBoardService,
  ProjectAgentTaskBoardServiceError,
  type ProjectAgentJobView,
} from "../services/project-agent-task-board-service.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
} from "../services/runtime-job-query-service.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const jobParamsSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
});

const jobParamsJsonSchema = {
  type: "object",
  required: ["id", "job_id"],
  properties: {
    id: { type: "string", minLength: 1 },
    job_id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const errors = {
  400: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
};

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function jobToResponse(job: ProjectAgentJobView) {
  return projectAgentJobWireSchema.parse({
    id: job.id,
    status: job.status,
    phase: job.phase,
    attempt_count: job.attemptCount,
    max_attempts: job.maxAttempts,
    available_at: job.availableAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    last_error: job.lastError,
    last_error_code: job.lastErrorCode,
    last_error_class: job.lastErrorClass,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    agent_type_id: job.agentTypeId,
    agent_binding_id: job.agentBindingId,
    source_event_id: job.sourceEventId,
    trigger_type: job.triggerType,
    dry_run: job.dryRun,
    delivery_targets: job.deliveryTargets,
    result: job.result,
  });
}

function handleTaskBoardError(reply: FastifyReply, error: unknown): boolean {
  if (
    error instanceof ProjectAccessServiceError ||
    error instanceof ProjectAgentTaskBoardServiceError
  ) {
    sendError(
      reply,
      (error as { statusCode: number }).statusCode,
      (error as { code: string }).code,
      error.message,
    );
    return true;
  }
  if (error instanceof RuntimeJobNotFoundError) {
    sendError(reply, 404, "project_agent_job_not_found", error.message);
    return true;
  }
  if (error instanceof RuntimeJobInvalidStateError) {
    sendError(reply, 409, "project_agent_job_invalid_state", error.message);
    return true;
  }
  return false;
}

export async function registerProjectAgentJobRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get(
    "/projects/:id/agent-jobs",
    {
      schema: {
        tags: ["projects"],
        summary: "List background Agent tasks in a project",
        operationId: "listProjectAgentJobs",
        params: idParamsJsonSchema,
        querystring: projectAgentJobListQueryJsonSchema,
        response: { 200: projectAgentJobListResponseJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(
        projectIdParamsSchema,
        request.params,
        reply,
      );
      if (!params.ok) return;
      const query = parseWithSchema(
        projectAgentJobListQuerySchema,
        request.query ?? {},
        reply,
      );
      if (!query.ok) return;
      const actor = actorFromRequest(request);
      try {
        const access = new ProjectAccessService(
          db,
        ).requireProjectActionForActor(
          actor,
          params.data.id,
          "project.agent.read",
        );
        const result = await new ProjectAgentTaskBoardService(db).list({
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          ...(query.data.status ? { status: query.data.status } : {}),
          ...(query.data.limit !== undefined
            ? { limit: query.data.limit }
            : {}),
          ...(query.data.offset !== undefined
            ? { offset: query.data.offset }
            : {}),
        });
        return reply.send({
          items: result.jobs.map(jobToResponse),
          total: result.total,
        });
      } catch (error) {
        if (handleTaskBoardError(reply, error)) return;
        throw error;
      }
    },
  );

  app.get(
    "/projects/:id/agent-jobs/:job_id",
    {
      schema: {
        tags: ["projects"],
        summary: "Read a background Agent task",
        operationId: "getProjectAgentJob",
        params: jobParamsJsonSchema,
        response: { 200: projectAgentJobJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(jobParamsSchema, request.params, reply);
      if (!params.ok) return;
      const actor = actorFromRequest(request);
      try {
        const access = new ProjectAccessService(
          db,
        ).requireProjectActionForActor(
          actor,
          params.data.id,
          "project.agent.read",
        );
        const job = await new ProjectAgentTaskBoardService(db).get({
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          jobId: params.data.job_id,
        });
        return reply.send(jobToResponse(job));
      } catch (error) {
        if (handleTaskBoardError(reply, error)) return;
        throw error;
      }
    },
  );

  app.post(
    "/projects/:id/agent-jobs/:job_id/cancel",
    {
      schema: {
        tags: ["projects"],
        summary: "Cancel a pending background Agent task",
        operationId: "cancelProjectAgentJob",
        params: jobParamsJsonSchema,
        response: { 200: projectAgentJobJsonSchema, ...errors },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(jobParamsSchema, request.params, reply);
      if (!params.ok) return;
      const actor = actorFromRequest(request);
      try {
        const access = new ProjectAccessService(
          db,
        ).requireProjectActionForActor(
          actor,
          params.data.id,
          "project.agent.run",
        );
        const job = await new ProjectAgentTaskBoardService(db).cancel({
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          jobId: params.data.job_id,
        });
        return reply.send(jobToResponse(job));
      } catch (error) {
        if (handleTaskBoardError(reply, error)) return;
        throw error;
      }
    },
  );
}
