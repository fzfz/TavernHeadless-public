import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import {
  apiErrorMessages,
  nativeCardAllocateEntryUidSchema,
  nativeCardAllocateEntryUidJsonSchema,
  nativeCardAllocateEntryUidResponseJsonSchema,
  type NativeCardAllocateEntryUid,
  type NativeCardAllocateEntryUidResult,
  nativeCardResponseJsonSchema,
  nativeCardListResponseJsonSchema,
  nativeCardFileResponseJsonSchema,
  nativeCardValidationResponseJsonSchema,
  nativeCardImportResponseJsonSchema,
  nativeCardBuildResponseJsonSchema,
  nativeCardPreviewResponseJsonSchema,
  nativeCardPublicationResponseJsonSchema,
  nativeCardCreateJsonSchema,
  nativeCardSaveJsonSchema,
  nativeCardBuildRequestJsonSchema,
  nativeCardPublishJsonSchema,
  nativeCardPreviewJsonSchema,
  nativeCardIdParamsJsonSchema,
  nativeCardImportParamsJsonSchema,
  nativeCardBuildParamsJsonSchema,
  nativeCardRevisionQueryJsonSchema,
  nativeCardFileQueryJsonSchema,
  nativeCardImportQueryJsonSchema,
  nativeCardImportQuerySchema,
  nativeCardCreateSchema,
  nativeCardSaveSchema,
  nativeCardPublishSchema,
  nativeCardPreviewSchema,
  nativeCardBuildRequestSchema,
  type NativeCard,
  type NativeCardCreate,
  type NativeCardFileContent,
  type NativeCardValidation,
  type NativeCardImport,
  type NativeCardBuild,
  type NativeCardBuildSource,
  type NativeCardSave,
  type NativeCardPublish,
  type NativeCardPreview,
  type NativeCardPreviewResult,
  type NativeCardPublication,
} from "@tavern/shared";
import { authHasCapability, getRequestAuthContext } from "../plugins/auth.js";
import { sendError } from "../lib/http.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { forwardedAuthHeaders } from "./role-releases.js";

export interface NativeCardRouteServices {
  allocateEntryUid(
    accountId: string,
    cardId: string,
    input: NativeCardAllocateEntryUid,
  ): Promise<NativeCardAllocateEntryUidResult>;
  list(accountId: string): NativeCard[] | Promise<NativeCard[]>;
  create(accountId: string, input: NativeCardCreate): Promise<NativeCard>;
  get(accountId: string, cardId: string): NativeCard | Promise<NativeCard>;
  readFile(
    accountId: string,
    cardId: string,
    path: string,
    revision?: number,
  ): Promise<NativeCardFileContent>;
  save(
    accountId: string,
    cardId: string,
    input: NativeCardSave,
  ): Promise<NativeCard>;
  validate(
    accountId: string,
    cardId: string,
    revision?: number,
  ): Promise<NativeCardValidation>;
  inspectImport(
    accountId: string,
    bytes: Buffer,
    fileName: string,
  ): Promise<NativeCardImport>;
  confirmImport(accountId: string, importId: string): Promise<NativeCard>;
  publish(
    accountId: string,
    cardId: string,
    input: NativeCardPublish,
    headers: Record<string, string>,
  ): Promise<NativeCardPublication>;
  createPreview(
    accountId: string,
    cardId: string,
    input: NativeCardPreview,
    headers: Record<string, string>,
  ): Promise<NativeCardPreviewResult>;
  build(
    accountId: string,
    cardId: string,
    source: NativeCardBuildSource,
  ): Promise<NativeCardBuild>;
  getBuild(
    accountId: string,
    buildId: string,
  ): NativeCardBuild | Promise<NativeCardBuild>;
  retryBuild(accountId: string, buildId: string): Promise<NativeCardBuild>;
  readBuild(accountId: string, buildId: string): Promise<Uint8Array>;
  sendError(error: unknown, reply: FastifyReply): unknown;
}

export async function registerNativeCardRoutes(
  app: FastifyInstance,
  service: NativeCardRouteServices,
  maxUploadBytes: number,
): Promise<void> {
  await app.register(async (scope) => {
    const inheritedErrorHandler = scope.errorHandler;
    scope.setErrorHandler((error, request, reply) => {
      const failure = error as FastifyError;
      if (failure.code === "NATIVE_CARD_ZIP_INVALID") {
        return sendError(
          reply,
          400,
          "NATIVE_CARD_ZIP_INVALID",
          apiErrorMessages.NATIVE_CARD_ZIP_INVALID,
        );
      }
      if (failure.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return sendError(
          reply,
          413,
          "NATIVE_CARD_ZIP_TOO_LARGE",
          apiErrorMessages.NATIVE_CARD_ZIP_TOO_LARGE,
        );
      }
      if (failure.validation) {
        return sendError(
          reply,
          400,
          "NATIVE_CARD_OPERATION_INVALID",
          apiErrorMessages.NATIVE_CARD_OPERATION_INVALID,
          failure.validation,
        );
      }
      return inheritedErrorHandler.call(scope, error, request, reply);
    });
    scope.addContentTypeParser(
      "application/zip",
      { parseAs: "buffer", bodyLimit: maxUploadBytes },
      (_request, body, done) => done(null, body),
    );
    scope.addHook("preHandler", async (request, reply) => {
      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      )
        return sendError(
          reply,
          403,
          "NATIVE_CARD_ACCESS_DENIED",
          apiErrorMessages.NATIVE_CARD_ACCESS_DENIED,
        );
    });
    const errors = {
      400: errorResponseJsonSchema,
      403: errorResponseJsonSchema,
      404: errorResponseJsonSchema,
      409: errorResponseJsonSchema,
      413: errorResponseJsonSchema,
      422: errorResponseJsonSchema,
      500: errorResponseJsonSchema,
    };
    const tags = ["native-cards"];
    const run = async (
      reply: FastifyReply,
      action: () => unknown | Promise<unknown>,
      status = 200,
    ) => {
      try {
        return reply.code(status).send({ data: await action() });
      } catch (error) {
        return service.sendError(error, reply);
      }
    };
    scope.get(
      "/native-cards",
      {
        schema: {
          tags,
          operationId: "listNativeCards",
          summary: "List persisted native character cards",
          response: { 200: nativeCardListResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.list(getRequestAuthContext(request).accountId),
        ),
    );
    scope.post(
      "/native-cards",
      {
        schema: {
          tags,
          operationId: "createNativeCard",
          summary: "Create a saved minimal native character card",
          body: nativeCardCreateJsonSchema,
          response: { 201: nativeCardResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.create(
              getRequestAuthContext(request).accountId,
              nativeCardCreateSchema.parse(request.body),
            ),
          201,
        ),
    );
    scope.get<{ Params: { cardId: string } }>(
      "/native-cards/:cardId",
      {
        schema: {
          tags,
          operationId: "getNativeCard",
          summary: "Read a native card and its saved revision",
          params: nativeCardIdParamsJsonSchema,
          response: { 200: nativeCardResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.get(
            getRequestAuthContext(request).accountId,
            request.params.cardId,
          ),
        ),
    );
    scope.get<{
      Params: { cardId: string };
      Querystring: { path: string; revision?: number };
    }>(
      "/native-cards/:cardId/file",
      {
        schema: {
          tags,
          operationId: "readNativeCardFile",
          summary: "Read a saved native package file",
          params: nativeCardIdParamsJsonSchema,
          querystring: nativeCardFileQueryJsonSchema,
          response: { 200: nativeCardFileResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.readFile(
            getRequestAuthContext(request).accountId,
            request.params.cardId,
            request.query.path,
            request.query.revision,
          ),
        ),
    );
    scope.post<{
      Params: { cardId: string };
      Body: NativeCardAllocateEntryUid;
    }>(
      "/native-cards/:cardId/entry-uids/allocate",
      {
        schema: {
          tags,
          operationId: "allocateNativeCardEntryUid",
          params: nativeCardIdParamsJsonSchema,
          body: nativeCardAllocateEntryUidJsonSchema,
          response: {
            200: nativeCardAllocateEntryUidResponseJsonSchema,
            ...errors,
          },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.allocateEntryUid(
            getRequestAuthContext(request).accountId,
            request.params.cardId,
            nativeCardAllocateEntryUidSchema.parse(request.body),
          ),
        ),
    );
    scope.put<{ Params: { cardId: string } }>(
      "/native-cards/:cardId/files",
      {
        bodyLimit: maxUploadBytes * 2,
        schema: {
          tags,
          operationId: "saveNativeCardFiles",
          summary:
            "Validate and atomically save a batch of native card file operations",
          params: nativeCardIdParamsJsonSchema,
          body: nativeCardSaveJsonSchema,
          response: { 200: nativeCardResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.save(
            getRequestAuthContext(request).accountId,
            request.params.cardId,
            nativeCardSaveSchema.parse(request.body),
          ),
        ),
    );
    scope.get<{
      Params: { cardId: string };
      Querystring: { revision?: number };
    }>(
      "/native-cards/:cardId/validation",
      {
        schema: {
          tags,
          operationId: "validateNativeCard",
          summary: "Validate a saved native package revision",
          params: nativeCardIdParamsJsonSchema,
          querystring: nativeCardRevisionQueryJsonSchema,
          response: { 200: nativeCardValidationResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.validate(
            getRequestAuthContext(request).accountId,
            request.params.cardId,
            request.query.revision,
          ),
        ),
    );
    scope.post<{ Body: Buffer; Querystring: { fileName?: string } }>(
      "/native-cards/imports",
      {
        bodyLimit: maxUploadBytes,
        validatorCompiler: ({ httpPart }) =>
          httpPart === "body"
            ? (value: unknown) =>
                Buffer.isBuffer(value)
                  ? { value }
                  : {
                      error: Object.assign(
                        new Error(apiErrorMessages.NATIVE_CARD_ZIP_INVALID),
                        { code: "NATIVE_CARD_ZIP_INVALID", statusCode: 400 },
                      ),
                    }
            : (value: unknown) => {
                const parsed = nativeCardImportQuerySchema.safeParse(value);
                return parsed.success
                  ? { value: parsed.data }
                  : { error: parsed.error };
              },
        schema: {
          tags,
          operationId: "inspectNativeCardImport",
          summary:
            "Upload and validate an original native ZIP before confirmation",
          consumes: ["application/zip"],
          body: { type: "string", format: "binary" },
          querystring: nativeCardImportQueryJsonSchema,
          response: { 200: nativeCardImportResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.inspectImport(
            getRequestAuthContext(request).accountId,
            request.body,
            request.query.fileName ?? "character.zip",
          ),
        ),
    );
    scope.post<{ Params: { importId: string } }>(
      "/native-cards/imports/:importId/confirm",
      {
        schema: {
          tags,
          operationId: "confirmNativeCardImport",
          summary: "Commit a previously validated native ZIP and its resources",
          params: nativeCardImportParamsJsonSchema,
          response: { 201: nativeCardResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.confirmImport(
              getRequestAuthContext(request).accountId,
              request.params.importId,
            ),
          201,
        ),
    );
    scope.post<{ Params: { cardId: string } }>(
      "/native-cards/:cardId/publications",
      {
        schema: {
          tags,
          operationId: "publishNativeCard",
          summary:
            "Publish a saved native card revision with system runtime bindings",
          params: nativeCardIdParamsJsonSchema,
          body: nativeCardPublishJsonSchema,
          response: { 201: nativeCardPublicationResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.publish(
              getRequestAuthContext(request).accountId,
              request.params.cardId,
              nativeCardPublishSchema.parse(request.body),
              forwardedAuthHeaders(request),
            ),
          201,
        ),
    );
    scope.post<{ Params: { cardId: string } }>(
      "/native-cards/:cardId/preview-sessions",
      {
        schema: {
          tags,
          operationId: "createNativeCardPreview",
          summary:
            "Create an isolated preview session fixed to a saved revision",
          params: nativeCardIdParamsJsonSchema,
          body: nativeCardPreviewJsonSchema,
          response: { 201: nativeCardPreviewResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.createPreview(
              getRequestAuthContext(request).accountId,
              request.params.cardId,
              nativeCardPreviewSchema.parse(request.body),
              forwardedAuthHeaders(request),
            ),
          201,
        ),
    );
    scope.post<{ Params: { cardId: string } }>(
      "/native-cards/:cardId/builds",
      {
        schema: {
          tags,
          operationId: "buildNativeCardZip",
          summary: "Start ZIP packaging for one fixed saved revision",
          params: nativeCardIdParamsJsonSchema,
          body: nativeCardBuildRequestJsonSchema,
          response: { 202: nativeCardBuildResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.build(
              getRequestAuthContext(request).accountId,
              request.params.cardId,
              nativeCardBuildRequestSchema.parse(request.body).source,
            ),
          202,
        ),
    );
    scope.get<{ Params: { buildId: string } }>(
      "/native-card-builds/:buildId",
      {
        schema: {
          tags,
          operationId: "getNativeCardBuild",
          summary: "Read native ZIP packaging progress",
          params: nativeCardBuildParamsJsonSchema,
          response: { 200: nativeCardBuildResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(reply, () =>
          service.getBuild(
            getRequestAuthContext(request).accountId,
            request.params.buildId,
          ),
        ),
    );
    scope.post<{ Params: { buildId: string } }>(
      "/native-card-builds/:buildId/retry",
      {
        schema: {
          tags,
          operationId: "retryNativeCardBuild",
          summary: "Retry packaging using the same fixed revision",
          params: nativeCardBuildParamsJsonSchema,
          response: { 202: nativeCardBuildResponseJsonSchema, ...errors },
        },
      },
      (request, reply) =>
        run(
          reply,
          () =>
            service.retryBuild(
              getRequestAuthContext(request).accountId,
              request.params.buildId,
            ),
          202,
        ),
    );
    scope.get<{ Params: { buildId: string } }>(
      "/native-card-builds/:buildId/download",
      {
        schema: {
          tags,
          operationId: "downloadNativeCardBuild",
          summary: "Download the completed native ZIP artifact",
          params: nativeCardBuildParamsJsonSchema,
          response: { 200: { type: "string", format: "binary" }, ...errors },
        },
      },
      async (request, reply) => {
        try {
          const bytes = await service.readBuild(
            getRequestAuthContext(request).accountId,
            request.params.buildId,
          );
          return reply
            .header("access-control-expose-headers", "Content-Disposition")
            .header(
              "content-disposition",
              `attachment; filename="character-${encodeURIComponent(request.params.buildId)}.zip"`,
            )
            .type("application/zip")
            .send(Buffer.from(bytes));
        } catch (error) {
          return service.sendError(error, reply);
        }
      },
    );
  });
}
