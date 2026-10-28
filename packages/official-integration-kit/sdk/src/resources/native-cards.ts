import { z } from "zod";
import {
  nativeCardSchema,
  nativeCardAllocateEntryUidSchema,
  nativeCardAllocateEntryUidResultSchema,
  type NativeCardAllocateEntryUid,
  nativeCardCreateSchema,
  nativeCardFileContentSchema,
  nativeCardSaveSchema,
  nativeCardValidationSchema,
  nativeCardImportSchema,
  nativeCardBuildSchema,
  nativeCardBuildRequestSchema,
  nativeCardPublishSchema,
  nativeCardPreviewSchema,
  nativeCardPreviewResultSchema,
  nativeCardPublicationSchema,
  type NativeCardSave,
  type NativeCardCreate,
  type NativeCardBuildSource,
  type NativeCardPublish,
  type NativeCardPreview,
} from "@tavern/shared";
import type {
  TransportClient,
  TransportRequestOptions,
} from "../client/transport.js";
import { createResponseError } from "../errors/normalize-error.js";
import {
  nativeCardDownloadArtifactSchema,
  type NativeCardDownloadArtifact,
} from "../schemas/native-card-download.js";

export function createNativeCardsResource(client: TransportClient) {
  const cardPath = (cardId: string) =>
    `/native-cards/${encodeURIComponent(cardId)}`;
  const buildPath = (buildId: string) =>
    `/native-card-builds/${encodeURIComponent(buildId)}`;
  const downloadResponse = async (buildId: string): Promise<Response> => {
    const response = await client.fetchRaw(`${buildPath(buildId)}/download`, {
      accept: "application/zip",
    });
    if (!response.ok) throw await createResponseError(response);
    return response;
  };
  const data = async <T>(
    path: string,
    schema: z.ZodType<T>,
    options?: TransportRequestOptions,
  ): Promise<T> => {
    const response = await client.fetchJson(path, options);
    return schema.parse(
      z.object({ data: z.unknown() }).parse(response.body).data,
    );
  };
  return {
    allocateEntryUid: ({
      cardId,
      ...input
    }: NativeCardAllocateEntryUid & { cardId: string }) =>
      data(
        `${cardPath(cardId)}/entry-uids/allocate`,
        nativeCardAllocateEntryUidResultSchema,
        {
          method: "POST",
          body: nativeCardAllocateEntryUidSchema.parse(input),
        },
      ),
    list: () => data("/native-cards", z.array(nativeCardSchema)),
    create: (input: NativeCardCreate) =>
      data("/native-cards", nativeCardSchema, {
        body: nativeCardCreateSchema.parse(input),
      }),
    get: ({ cardId }: { cardId: string }) =>
      data(cardPath(cardId), nativeCardSchema),
    readFile: ({
      cardId,
      path,
      revision,
    }: {
      cardId: string;
      path: string;
      revision?: number;
    }) => {
      const query = new URLSearchParams({ path });
      if (revision !== undefined) query.set("revision", String(revision));
      return data(
        `${cardPath(cardId)}/file?${query}`,
        nativeCardFileContentSchema,
      );
    },
    save: ({ cardId, ...input }: NativeCardSave & { cardId: string }) =>
      data(`${cardPath(cardId)}/files`, nativeCardSchema, {
        method: "PUT",
        body: nativeCardSaveSchema.parse(input),
      }),
    validate: ({ cardId, revision }: { cardId: string; revision?: number }) =>
      data(
        `${cardPath(cardId)}/validation${revision === undefined ? "" : `?revision=${revision}`}`,
        nativeCardValidationSchema,
      ),
    checkImport: ({ file, fileName }: { file: Blob; fileName?: string }) =>
      data(
        `/native-cards/imports?${new URLSearchParams({ fileName: fileName ?? "character.zip" })}`,
        nativeCardImportSchema,
        {
          method: "POST",
          rawBody: file,
          headers: { "content-type": "application/zip" },
        },
      ),
    confirmImport: ({ importId }: { importId: string }) =>
      data(
        `/native-cards/imports/${encodeURIComponent(importId)}/confirm`,
        nativeCardSchema,
        { method: "POST" },
      ),
    publish: ({ cardId, ...input }: NativeCardPublish & { cardId: string }) =>
      data(`${cardPath(cardId)}/publications`, nativeCardPublicationSchema, {
        body: nativeCardPublishSchema.parse(input),
      }),
    createPreview: ({
      cardId,
      ...input
    }: NativeCardPreview & { cardId: string }) =>
      data(
        `${cardPath(cardId)}/preview-sessions`,
        nativeCardPreviewResultSchema,
        { body: nativeCardPreviewSchema.parse(input) },
      ),
    createBuild: ({
      cardId,
      source,
    }: {
      cardId: string;
      source: NativeCardBuildSource;
    }) =>
      data(`${cardPath(cardId)}/builds`, nativeCardBuildSchema, {
        body: nativeCardBuildRequestSchema.parse({ source }),
      }),
    getBuild: ({ buildId }: { buildId: string }) =>
      data(buildPath(buildId), nativeCardBuildSchema),
    retryBuild: ({ buildId }: { buildId: string }) =>
      data(`${buildPath(buildId)}/retry`, nativeCardBuildSchema, {
        method: "POST",
      }),
    async downloadBuild({ buildId }: { buildId: string }): Promise<Blob> {
      return (await downloadResponse(buildId)).blob();
    },
    async downloadArtifact({
      buildId,
    }: {
      buildId: string;
    }): Promise<NativeCardDownloadArtifact> {
      const response = await downloadResponse(buildId);
      const disposition = response.headers.get("content-disposition");
      const encoded = disposition?.match(
        /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i,
      );
      const quoted = disposition?.match(/(?:^|;)\s*filename="([^"]*)"/i);
      const unquoted = disposition?.match(/(?:^|;)\s*filename=([^;\s]+)/i);
      const fileName = encoded
        ? decodeURIComponent(encoded[1]!.trim())
        : (quoted?.[1] ?? unquoted?.[1] ?? null);
      return nativeCardDownloadArtifactSchema.parse({
        blob: await response.blob(),
        fileName,
      });
    },
  };
}
export type NativeCardsResource = ReturnType<typeof createNativeCardsResource>;
