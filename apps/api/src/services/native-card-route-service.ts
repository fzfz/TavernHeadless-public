import type { FastifyInstance } from "fastify";
import type { AppDb } from "../db/client.js";
import type { NativeCardRouteServices } from "../routes/native-cards.js";
import type { NativeCardBuildSource } from "@tavern/shared";
import {
  NativeCardService,
  NativeCardServiceError,
} from "./native-card/native-card-service.js";
import type { NativeCardRuntimeService } from "./native-card-runtime/native-card-runtime-service.js";
import { sendError } from "../lib/http.js";
import { sendRoleReleaseError } from "../routes/role-releases.js";

export function createNativeCardRouteService(
  app: FastifyInstance,
  db: AppDb,
  cards: NativeCardService,
  runtime: NativeCardRuntimeService,
): NativeCardRouteServices {
  const running = new Set<Promise<void>>();
  const execute = (accountId: string, buildId: string) => {
    const job = cards.executeBuild(accountId, buildId).then(() => undefined);
    running.add(job);
    void job
      .catch((error: unknown) =>
        app.log.error(
          { err: error, buildId },
          "Native card ZIP packaging failed",
        ),
      )
      .finally(() => running.delete(job));
  };
  app.addHook("onClose", async () => {
    await Promise.allSettled([...running]);
  });
  const revision = async (
    accountId: string,
    cardId: string,
    selected?: number,
  ) => selected ?? (await cards.get(accountId, cardId)).revision;
  const sourceRevision = (
    accountId: string,
    cardId: string,
    source: NativeCardBuildSource,
  ) => {
    if ("revision" in source) return { revision: source.revision };
    const row = db.$client
      .prepare(
        "SELECT revision FROM native_card_publication WHERE account_id = ? AND card_id = ? AND character_version_id = ?",
      )
      .get(accountId, cardId, source.versionId) as
      | { revision: number }
      | undefined;
    if (!row)
      throw new NativeCardServiceError("NATIVE_CARD_VERSION_NOT_FOUND", 404);
    return { revision: row.revision, versionId: source.versionId };
  };
  return {
    allocateEntryUid: (accountId, cardId, input) => cards.allocateEntryUid(accountId, cardId, input),
    list: (accountId) => cards.list(accountId),
    create: (accountId, input) => cards.create(accountId, input),
    get: (accountId, cardId) => cards.get(accountId, cardId),
    readFile: async (accountId, cardId, path, selected) =>
      cards.readFile(
        accountId,
        cardId,
        path,
        await revision(accountId, cardId, selected),
      ),
    save: (accountId, cardId, input) => cards.save(accountId, cardId, input),
    validate: async (accountId, cardId, selected) =>
      cards.validate(
        accountId,
        cardId,
        await revision(accountId, cardId, selected),
      ),
    inspectImport: (accountId, bytes, fileName) =>
      cards.inspectImport(accountId, bytes, fileName),
    confirmImport: (accountId, importId) =>
      cards.confirmImport(accountId, importId),
    publish: (accountId, cardId, input, headers) =>
      runtime.publish(cards, app, accountId, cardId, input, headers),
    createPreview: (accountId, cardId, input, headers) =>
      runtime.createPreview(cards, app, accountId, cardId, input, headers),
    async build(accountId, cardId, source) {
      const result = await cards.createBuild(
        accountId,
        cardId,
        sourceRevision(accountId, cardId, source),
      );
      execute(accountId, result.id);
      return result;
    },
    getBuild: (accountId, buildId) => cards.getBuild(accountId, buildId),
    async retryBuild(accountId, buildId) {
      const result = await cards.retryBuild(accountId, buildId);
      execute(accountId, buildId);
      return result;
    },
    readBuild: (accountId, buildId) => cards.readBuildZip(accountId, buildId),
    sendError(error, reply) {
      if (error instanceof NativeCardServiceError) {
        return sendError(
          reply,
          error.statusCode,
          error.code,
          error.message,
          error.details,
        );
      }
      return sendRoleReleaseError(reply, error);
    },
  };
}
