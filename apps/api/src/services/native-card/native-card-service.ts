import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  apiErrorMessages,
  nativeCardCharacterSchema,
  nativeCardAllocateEntryUidResultSchema,
  nativeCardAllocateEntryUidSchema,
  nativeCardFileInfoSchema,
  nativeCardOpeningsSchema,
  nativeCardPackageManifestSchema,
  nativeCardRevisionConflictDetailsSchema,
  nativeCardSaveSchema,
  nativeCardWriteFailureDetailsSchema,
  nativeCardFileRules,
  nativeCardImportSummarySchema,
  roleAssetPathSchema,
  validateNativeCardPackage,
  type NativeCard as NativeCardDto,
  type NativeCardBuild as NativeCardBuildDto,
  type NativeCardCreate,
  type NativeCardBuildSource,
  type NativeCardAllocateEntryUid,
  type NativeCardAllocateEntryUidResult,
  type NativeCardFileContent,
  type NativeCardFileInfo,
  type NativeCardImport as NativeCardImportDto,
  type NativeCardImportSummary,
  type NativeCardIssue,
  type NativeCardPackage,
  type NativeCardPackageFile,
  type NativeCardPackageManifest,
  type NativeCardOperation,
  type NativeCardSave,
  type NativeCardValidation,
  type NativeCardWriteFailureDetails,
} from "@tavern/shared";
import type { AppDb, DbExecutor } from "../../db/client.js";
import {
  characterVersions,
  characters,
  nativeCardBuilds,
  nativeCardImports,
  nativeCardPublications,
  nativeCardRevisions,
  nativeCards,
  nativeCardVersionBindings,
} from "../../db/schema.js";
import type { NativeCardConfig } from "../../native-card-config.schema.js";
import { NativeCardStore, NativeCardStoreWriteError } from "./store.js";
import { validateNativeCardModules } from "./module-static-checker.js";
import { validateNativeCardFrontendModules } from "./frontend-module-static-checker.js";
import { validateNativeCardFrontendMarkup } from "./frontend-markup-checker.js";
import { validateNativeCardMediaFiles } from "./media-type-checker.js";
import { validateNativeCardStatePackage } from "./state-package-validator.js";
import {
  NativeCardZipError,
  readNativeCardZip,
  writeNativeCardZip,
} from "./zip.js";

export type NativeCardServiceStatusCode = 400 | 404 | 409 | 413 | 422 | 500;

export class NativeCardServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: NativeCardServiceStatusCode,
    readonly details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    const message = apiErrorMessages[code as keyof typeof apiErrorMessages];
    super(message as string, { cause });
    this.name = "NativeCardServiceError";
  }
}

export type NativeCardRecord = NativeCardDto;
export type NativeCardImportCheck = NativeCardImportDto;
export type NativeCardBuildRecord = NativeCardBuildDto;
export type NativeCardDbTransaction = DbExecutor;

export type NativeCardRevisionSnapshot = {
  accountId: string;
  cardId: string;
  characterId: string;
  packageId: string;
  revision: number;
  manifest: NativeCardPackageManifest;
  package: NativeCardPackage;
  files: ReadonlyMap<string, Uint8Array>;
  fileRecords: Array<NativeCardFileInfo>;
};

export type NativeCardImportIdentity = {
  cardId: string;
  characterId: string;
  characterVersionId: string;
  revision: number;
};

export type NativeCardServiceHooks = {
  commitImportedResources?: (
    tx: NativeCardDbTransaction,
    snapshot: NativeCardRevisionSnapshot,
    identity: NativeCardImportIdentity,
  ) => void;
};

type RevisionRow = typeof nativeCardRevisions.$inferSelect;
type CardRow = typeof nativeCards.$inferSelect;
const JSON_MEDIA_TYPE = "application/json";

function utf8Json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

function decodeWriteContent(
  content: string,
  encoding: "utf8" | "base64",
  operation: { operationIndex: number; path: string },
): Buffer {
  if (encoding === "utf8") return Buffer.from(content, "utf8");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { encoding: "base64", ...operation });
  }
  return Buffer.from(content, "base64");
}

function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith("text/") || ["application/json", "application/javascript"].includes(mediaType);
}

function toNativeCardIssues(issues: readonly NativeCardIssue[]): NativeCardIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
    action: issue.action,
    ...(issue.pointer !== undefined ? { pointer: issue.pointer } : {}),
    ...(issue.line !== undefined ? { line: issue.line } : {}),
    ...(issue.column !== undefined ? { column: issue.column } : {}),
    ...(issue.operationIndex !== undefined ? { operationIndex: issue.operationIndex } : {}),
    ...(issue.expected !== undefined ? { expected: issue.expected } : {}),
  }));
}

function attachOperationIndexes(
  issues: readonly NativeCardIssue[],
  operations: readonly NativeCardOperation[],
): NativeCardIssue[] {
  const operationByPath = new Map<string, number>();
  for (const [operationIndex, operation] of operations.entries()) {
    if (operation.op === "write") operationByPath.set(operation.path, operationIndex);
    else if (operation.op === "move") {
      operationByPath.delete(operation.path);
      operationByPath.set(operation.to, operationIndex);
    } else operationByPath.delete(operation.path);
  }
  return issues.map((issue) => {
    const operationIndex = issue.operationIndex ?? operationByPath.get(issue.path);
    return operationIndex === undefined ? issue : { ...issue, operationIndex };
  });
}

function getManifestFileInfo(packageFiles: ReadonlyMap<string, Uint8Array>, manifest: NativeCardPackage["manifest"]): NativeCardFileInfo[] {
  return [
    { path: "manifest.json", mediaType: JSON_MEDIA_TYPE, purpose: "data" as const },
    ...manifest.files,
  ].flatMap((item) => {
    const bytes = packageFiles.get(item.path);
    return bytes ? [{ ...item, byteSize: bytes.byteLength }] : [];
  });
}

function toSnapshot(
  accountId: string,
  cardId: string,
  characterId: string,
  revision: number,
  files: readonly NativeCardPackageFile[],
  parsed: NativeCardPackage,
): NativeCardRevisionSnapshot {
  return {
    accountId,
    cardId,
    characterId,
    packageId: parsed.manifest.packageId,
    revision,
    manifest: parsed.manifest,
    package: parsed,
    files: parsed.files,
    fileRecords: getManifestFileInfo(parsed.files, parsed.manifest),
  };
}

function summarizeNativeCardPackage(pkg: NativeCardPackage): NativeCardImportSummary {
  const hasFile = (path: string | undefined): boolean => path !== undefined && pkg.files.has(path);
  const profile = pkg.stateUpdateProfile;
  const moduleFiles = profile?.moduleFiles ?? [];
  const hasModuleIn = (directory: string): boolean => moduleFiles.some(
    (path) => path.startsWith(directory) && hasFile(path),
  );
  const frontend = pkg.frontendManifest;
  return nativeCardImportSummarySchema.parse({
    formatVersion: pkg.manifest.formatVersion,
    worldbookCount: pkg.worldbooks.size,
    openingCount: pkg.openings.items.length,
    initialStateCount: pkg.openings.items.filter((opening) => hasFile(opening.initialStateFile)).length,
    stateUpdate: {
      rules: profile?.ruleFiles?.some(hasFile) ?? false,
      schema: hasFile(profile?.stateSchemaFile),
      validators: hasFile(profile?.validateScript) || hasModuleIn("backend/validators/"),
      tools: hasFile(profile?.deriveScript) || hasModuleIn("backend/variable-tools/"),
    },
    promptController: !!pkg.controllerConfig && hasFile(pkg.controllerConfig.modulePath),
    frontend: {
      page: !!frontend && hasFile(frontend.html),
      script: !!frontend && hasFile(frontend.script),
      style: !!frontend && hasFile(frontend.css),
      media: !!frontend && Object.values(frontend.assets).some((asset) => hasFile(asset.file)),
    },
    regexProfileCount: (pkg.character.regexProfiles ?? []).filter(hasFile).length,
  });
}

function replacePackageFile(files: readonly NativeCardPackageFile[], path: string, content: Uint8Array): NativeCardPackageFile[] {
  return files.map((file) => file.path === path ? { ...file, content: Buffer.from(content) } : file);
}

function buildStatus(row: typeof nativeCardBuilds.$inferSelect): NativeCardBuildRecord {
  return {
    id: row.id,
    cardId: row.cardId,
    revision: row.sourceRevision,
    ...(row.sourceVersionId ? { versionId: row.sourceVersionId } : {}),
    status: row.status as NativeCardBuildDto["status"],
    stage: row.stage as NativeCardBuildDto["stage"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    issues: JSON.parse(row.issuesJson) as NativeCardIssue[],
    ...(row.status === "succeeded" ? { downloadUrl: `/native-card-builds/${row.id}/download` } : {}),
  };
}

function asStorageFailure(cause: unknown, details?: Record<string, unknown>): NativeCardServiceError {
  return cause instanceof NativeCardServiceError
    ? cause
    : new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, {
      ...details,
      diagnostic: cause instanceof Error ? cause.message : String(cause),
    }, cause);
}

type NativeCardWriteIdentity = Pick<NativeCardWriteFailureDetails, "cardId" | "revision" | "importId">;

function writeFailureDetails(
  stage: NativeCardWriteFailureDetails["stage"],
  identity: NativeCardWriteIdentity,
  options: { rolledBack?: boolean; cleanupFailed?: boolean } = {},
): NativeCardWriteFailureDetails {
  return nativeCardWriteFailureDetailsSchema.parse({
    stage,
    ...identity,
    ...(options.rolledBack ? { committed: false as const } : {}),
    ...(options.cleanupFailed ? { cleanupFailed: true } : {}),
  });
}

function databaseCommitFailure(
  cause: unknown,
  identity: NativeCardWriteIdentity,
  cleanupFailed: boolean,
): NativeCardServiceError {
  return new NativeCardServiceError(
    "NATIVE_CARD_STORAGE_FAILURE",
    500,
    writeFailureDetails("database-commit", identity, { rolledBack: true, cleanupFailed }),
    cause,
  );
}

function revisionConflictDetails(expectedRevision: number, actualRevision: number) {
  return nativeCardRevisionConflictDetailsSchema.parse({ expectedRevision, actualRevision });
}

function initialPackage(name: string, packageId: string): NativeCardPackageFile[] {
  const character = { name };
  const openings = { defaultOpeningIds: {}, items: [] };
  const files = [
    { path: "character.json", mediaType: JSON_MEDIA_TYPE, purpose: "data" as const, content: utf8Json(character) },
    { path: "openings.json", mediaType: JSON_MEDIA_TYPE, purpose: "data" as const, content: utf8Json(openings) },
  ];
  const manifest = {
    format: "tavern_headless_role_package",
    formatVersion: "1.0.0",
    packageId,
    character: "character.json",
    openings: "openings.json",
    files: files.map(({ path, mediaType, purpose }) => ({ path, mediaType, purpose })),
  };
  return [{ path: "manifest.json", content: utf8Json(manifest) }, ...files];
}

export class NativeCardService {
  private readonly store: NativeCardStore;

  constructor(
    private readonly db: AppDb,
    private readonly config: NativeCardConfig,
    private readonly hooks: NativeCardServiceHooks = {},
  ) {
    this.store = new NativeCardStore(config);
  }

  async create(accountId: string, input: NativeCardCreate): Promise<NativeCardRecord> {
    const now = Date.now();
    const cardId = nanoid();
    const characterId = nanoid();
    const characterVersionId = nanoid();
    const packageId = nanoid();
    const revision = 1;
    const storageKey = `${cardId}/revisions/${revision}-${randomUUID()}`;
    let files: NativeCardPackageFile[];
    if (input.sourceVersionId) {
      const publication = this.db.select({ cardId: nativeCardPublications.cardId, revision: nativeCardPublications.revision })
        .from(nativeCardPublications)
        .where(and(
          eq(nativeCardPublications.accountId, accountId),
          eq(nativeCardPublications.characterVersionId, input.sourceVersionId),
        )).get();
      if (!publication) throw new NativeCardServiceError("NATIVE_CARD_VERSION_NOT_FOUND", 404, { versionId: input.sourceVersionId });
      const source = await this.loadValidatedRevision(accountId, publication.cardId, publication.revision);
      const sourceRow = await this.requireRevision(accountId, publication.cardId, publication.revision);
      let stored: Map<string, Uint8Array>;
      try { stored = await this.store.readDirectory("cards", sourceRow.storageKey, this.revisionFilePaths(sourceRow.manifestJson)); }
      catch (cause) { throw asStorageFailure(cause, { cardId: publication.cardId, revision: publication.revision }); }
      const manifest = { ...source.manifest, packageId };
      const character = { ...source.package.character, name: input.name };
      files = [...stored].map(([path, content]) => ({
        path,
        content: path === "manifest.json" ? utf8Json(manifest)
          : path === source.manifest.character ? utf8Json(character) : Buffer.from(content),
      }));
    } else {
      files = initialPackage(input.name, packageId);
    }
    const checked = this.checkPackage(files);
    if (!checked.valid || !checked.package) throw new NativeCardServiceError("NATIVE_CARD_PACKAGE_INVALID", 422, { issues: checked.issues });
    const snapshot = toSnapshot(accountId, cardId, characterId, revision, files, checked.package);
    await this.writeCompleteDirectory("cards", storageKey, files, { cardId, revision });
    try {
      this.db.transaction((tx) => {
        const dataJson = JSON.stringify({ ...snapshot.package.character, importedFormat: "native_card" });
        tx.insert(characters).values({
          id: characterId, accountId, name: input.name, source: "native_card", status: "active",
          revision: 0, latestVersionNo: 1, createdAt: now, updatedAt: now,
        }).run();
        tx.insert(characterVersions).values({
          id: characterVersionId, characterId, versionNo: 1, dataJson,
          contentHash: createHash("sha256").update(dataJson).digest("hex"), createdAt: now,
        }).run();
        tx.insert(nativeCards).values({
          id: cardId, accountId, characterId, packageId, name: input.name,
          currentRevision: revision, createdAt: now, updatedAt: now,
        }).run();
        tx.insert(nativeCardRevisions).values({
          cardId, revision, storageKey, packageId: snapshot.packageId,
          manifestJson: Buffer.from(files.find((file) => file.path === "manifest.json")!.content).toString("utf8"), fileCount: files.length,
          totalBytes: files.reduce((sum, file) => sum + file.content.byteLength, 0), createdAt: now,
        }).run();
        tx.insert(nativeCardVersionBindings).values({
          characterVersionId, accountId, cardId, revision, createdAt: now,
        }).run();
        this.hooks.commitImportedResources?.(tx, snapshot, { cardId, characterId, characterVersionId, revision });
      });
    } catch (cause) {
      let cleanupFailed = false;
      try { await this.store.remove("cards", storageKey); }
      catch { cleanupFailed = true; }
      if (cause instanceof NativeCardServiceError && !cleanupFailed) throw cause;
      throw databaseCommitFailure(cause, { cardId, revision }, cleanupFailed);
    }
    return this.get(accountId, cardId);
  }

  async list(accountId: string): Promise<NativeCardRecord[]> {
    const rows = this.db.select().from(nativeCards).where(eq(nativeCards.accountId, accountId)).orderBy(asc(nativeCards.updatedAt)).all();
    return Promise.all(rows.map((row) => this.toRecord(accountId, row)));
  }

  async get(accountId: string, cardId: string): Promise<NativeCardRecord> {
    const row = this.db.select().from(nativeCards).where(and(eq(nativeCards.id, cardId), eq(nativeCards.accountId, accountId))).get();
    if (!row) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId });
    return this.toRecord(accountId, row);
  }

  async allocateEntryUid(
    accountId: string,
    cardId: string,
    rawInput: NativeCardAllocateEntryUid,
  ): Promise<NativeCardAllocateEntryUidResult> {
    const parsed = nativeCardAllocateEntryUidSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, {
        issues: parsed.error.issues,
      });
    }
    const current = await this.get(accountId, cardId);
    if (current.revision !== parsed.data.expectedRevision) {
      throw new NativeCardServiceError(
        "NATIVE_CARD_REVISION_CONFLICT",
        409,
        revisionConflictDetails(parsed.data.expectedRevision, current.revision),
      );
    }
    const snapshot = await this.loadValidatedRevision(
      accountId,
      cardId,
      parsed.data.expectedRevision,
    );
    const worldbook = snapshot.package.worldbooks.get(parsed.data.bookId);
    if (!worldbook && !parsed.data.draftBook) {
      throw new NativeCardServiceError("NATIVE_CARD_WORLDBOOK_NOT_FOUND", 404, {
        cardId,
        bookId: parsed.data.bookId,
      });
    }

    const usedUids = new Set(parsed.data.reservedUids);
    for (const entryPath of worldbook?.entryFiles ?? []) {
      const entry = snapshot.package.parsedJson.get(entryPath) as
        | { uid: number }
        | undefined;
      if (!entry) {
        throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, {
          cardId,
          revision: parsed.data.expectedRevision,
          path: entryPath,
        });
      }
      usedUids.add(entry.uid);
    }
    let uid = 1;
    while (usedUids.has(uid)) uid += 1;
    return nativeCardAllocateEntryUidResultSchema.parse({ uid });
  }

  async readFile(accountId: string, cardId: string, path: string, revision?: number): Promise<NativeCardFileContent> {
    const selected = revision ?? (await this.get(accountId, cardId)).revision;
    const snapshot = await this.loadValidatedRevision(accountId, cardId, selected);
    roleAssetPathSchema.parse(path);
    const record = snapshot.fileRecords.find((file) => file.path === path);
    if (path !== "manifest.json" && !record) throw new NativeCardServiceError("NATIVE_CARD_FILE_NOT_FOUND", 404, { cardId, revision: selected, path });
    let content: Buffer;
    if (path === "manifest.json") {
      const row = await this.requireRevision(accountId, cardId, selected);
      try { content = await this.store.read("cards", row.storageKey, path); }
      catch (cause) { throw asStorageFailure(cause, { cardId, revision: selected, path }); }
    } else {
      content = Buffer.from(snapshot.files.get(path)!);
    }
    const mediaType = record?.mediaType ?? JSON_MEDIA_TYPE;
    return {
      path, mediaType,
      encoding: isTextMediaType(mediaType) ? "utf8" : "base64",
      content: isTextMediaType(mediaType) ? content.toString("utf8") : content.toString("base64"),
    };
  }

  async save(accountId: string, cardId: string, rawInput: NativeCardSave): Promise<NativeCardRecord> {
    const parsed = nativeCardSaveSchema.safeParse(rawInput);
    if (!parsed.success) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { issues: parsed.error.issues });
    const current = await this.get(accountId, cardId);
    if (parsed.data.expectedRevision !== current.revision) {
      throw new NativeCardServiceError("NATIVE_CARD_REVISION_CONFLICT", 409, revisionConflictDetails(parsed.data.expectedRevision, current.revision));
    }
    const revisionRow = await this.requireRevision(accountId, cardId, current.revision);
    const snapshot = await this.loadValidatedRevision(accountId, cardId, current.revision);
    const files = new Map<string, Uint8Array>(snapshot.files);
    try { files.set("manifest.json", await this.store.read("cards", revisionRow.storageKey, "manifest.json")); }
    catch (cause) { throw asStorageFailure(cause, { cardId, revision: current.revision, path: "manifest.json" }); }
    for (const [operationIndex, operation] of parsed.data.operations.entries()) {
      if (operation.op === "write") {
        const content = decodeWriteContent(operation.content, operation.encoding, { operationIndex, path: operation.path });
        if (content.byteLength > this.config.maxFileBytes) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { operationIndex, path: operation.path, maxFileBytes: this.config.maxFileBytes });
        files.set(operation.path, content);
      } else if (operation.op === "move") {
        const value = files.get(operation.path);
        if (!value) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { operationIndex, path: operation.path });
        if (files.has(operation.to)) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { operationIndex, path: operation.to });
        files.delete(operation.path);
        files.set(operation.to, value);
      } else {
        if (!files.has(operation.path)) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { operationIndex, path: operation.path });
        if (operation.path === "manifest.json") throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { operationIndex, path: operation.path });
        files.delete(operation.path);
      }
    }
    const nextFiles = [...files].map(([path, content]) => ({ path, content }));
    const validation = this.checkPackage(nextFiles);
    if (!validation.valid || !validation.package) {
      throw new NativeCardServiceError("NATIVE_CARD_PACKAGE_INVALID", 422, {
        issues: attachOperationIndexes(validation.issues, parsed.data.operations),
      });
    }
    if (nextFiles.reduce((sum, file) => sum + file.content.byteLength, 0) > this.config.maxExpandedBytes) {
      throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { maxExpandedBytes: this.config.maxExpandedBytes });
    }
    if (nextFiles.length > this.config.maxFileCount) throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { maxFileCount: this.config.maxFileCount });

    const nextRevision = current.revision + 1;
    const storageKey = `${cardId}/revisions/${nextRevision}-${randomUUID()}`;
    await this.writeCompleteDirectory("cards", storageKey, nextFiles, { cardId, revision: nextRevision });
    try {
      this.db.transaction((tx) => {
        const existing = tx.select({ currentRevision: nativeCards.currentRevision, characterId: nativeCards.characterId }).from(nativeCards)
          .where(and(eq(nativeCards.id, cardId), eq(nativeCards.accountId, accountId))).get();
        if (!existing) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId });
        if (existing.currentRevision !== parsed.data.expectedRevision) {
          throw new NativeCardServiceError("NATIVE_CARD_REVISION_CONFLICT", 409, revisionConflictDetails(parsed.data.expectedRevision, existing.currentRevision));
        }
        tx.insert(nativeCardRevisions).values({
          cardId, revision: nextRevision, storageKey,
          packageId: validation.package!.manifest.packageId,
          manifestJson: Buffer.from(nextFiles.find((file) => file.path === "manifest.json")!.content).toString("utf8"),
          fileCount: nextFiles.length, totalBytes: nextFiles.reduce((sum, file) => sum + file.content.byteLength, 0), createdAt: Date.now(),
        }).run();
        const updated = tx.update(nativeCards).set({
          packageId: validation.package!.manifest.packageId,
          name: validation.package!.character.name,
          currentRevision: nextRevision,
          updatedAt: Date.now(),
        }).where(and(eq(nativeCards.id, cardId), eq(nativeCards.accountId, accountId), eq(nativeCards.currentRevision, parsed.data.expectedRevision))).run();
        if (!updated.changes) throw new NativeCardServiceError("NATIVE_CARD_REVISION_CONFLICT", 409, revisionConflictDetails(parsed.data.expectedRevision, existing.currentRevision));
        tx.update(characters).set({ name: validation.package!.character.name, updatedAt: Date.now() })
          .where(and(eq(characters.id, existing.characterId), eq(characters.accountId, accountId))).run();
      });
    } catch (cause) {
      let cleanupFailed = false;
      try { await this.store.remove("cards", storageKey); }
      catch { cleanupFailed = true; }
      if (cause instanceof NativeCardServiceError && !cleanupFailed) throw cause;
      throw databaseCommitFailure(cause, { cardId, revision: nextRevision }, cleanupFailed);
    }
    return this.get(accountId, cardId);
  }

  async inspectImport(accountId: string, archive: Uint8Array, fileName: string): Promise<NativeCardImportCheck> {
    let files: NativeCardPackageFile[];
    try {
      files = readNativeCardZip(archive, this.config);
    } catch (cause) {
      if (cause instanceof NativeCardZipError) {
        throw new NativeCardServiceError(cause.code, cause.code === "NATIVE_CARD_ZIP_TOO_LARGE" ? 413 : 400, cause.details, cause);
      }
      throw cause;
    }
    const checked = this.checkPackage(files);
    const id = nanoid();
    const storageKey = id;
    const now = Date.now();
    const issues = toNativeCardIssues(checked.issues);
    const fileInfo = checked.package
      ? getManifestFileInfo(new Map(files.map((file) => [file.path, file.content])), checked.package.manifest)
      : [];
    await this.writeCompleteDirectory("imports", storageKey, files, { importId: id });
    try {
      this.db.insert(nativeCardImports).values({
        id, accountId, storageKey, fileName: fileName.slice(0, 255),
        packageId: checked.package?.manifest.packageId ?? null,
        name: checked.package?.character.name ?? null,
        status: checked.valid ? "ready" : "invalid",
        issuesJson: JSON.stringify(issues), fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.content.byteLength, 0),
        expiresAt: now + this.config.importTtlMs, createdAt: now, updatedAt: now,
      }).run();
    } catch (cause) {
      let cleanupFailed = false;
      try { await this.store.remove("imports", storageKey); }
      catch { cleanupFailed = true; }
      throw databaseCommitFailure(cause, { importId: id }, cleanupFailed);
    }
    return {
      id, fileName: fileName.slice(0, 255),
      packageId: checked.package?.manifest.packageId ?? "",
      name: checked.package?.character.name ?? "",
      summary: checked.package ? summarizeNativeCardPackage(checked.package) : null,
      files: fileInfo,
      issues,
      status: checked.valid ? "ready" : "invalid",
    };
  }

  private async readConfirmedImportCard(accountId: string, importId: string): Promise<NativeCardRecord | undefined> {
    const confirmed = this.db.select().from(nativeCardImports).where(and(
      eq(nativeCardImports.id, importId), eq(nativeCardImports.accountId, accountId),
    )).get();
    if (!confirmed || confirmed.expiresAt <= Date.now() || confirmed.status !== "confirmed") return undefined;
    if (!confirmed.confirmedCardId) {
      throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { importId, stage: "confirmation-reference" });
    }
    return this.get(accountId, confirmed.confirmedCardId);
  }

  async confirmImport(accountId: string, importId: string): Promise<NativeCardRecord> {
    const imported = this.db.select().from(nativeCardImports).where(and(
      eq(nativeCardImports.id, importId), eq(nativeCardImports.accountId, accountId),
    )).get();
    if (!imported || imported.expiresAt <= Date.now()) throw new NativeCardServiceError("NATIVE_CARD_IMPORT_NOT_FOUND", 404, { importId });
    if (imported.status === "confirmed") {
      const confirmed = await this.readConfirmedImportCard(accountId, importId);
      if (confirmed) return confirmed;
      throw new NativeCardServiceError("NATIVE_CARD_IMPORT_NOT_FOUND", 404, { importId });
    }
    if (imported.status !== "ready") throw new NativeCardServiceError("NATIVE_CARD_PACKAGE_INVALID", 422, { importId, issues: JSON.parse(imported.issuesJson) as NativeCardIssue[] });
    let rawManifest: Buffer;
    try { rawManifest = await this.store.read("imports", imported.storageKey, "manifest.json"); }
    catch (cause) {
      const confirmed = await this.readConfirmedImportCard(accountId, importId);
      if (confirmed) return confirmed;
      throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { importId }, cause);
    }
    const manifest = this.parseStoredManifest(rawManifest.toString("utf8"), importId, 1);
    const paths = ["manifest.json", ...manifest.files.map((file) => file.path)];
    let staged: Map<string, Uint8Array>;
    try { staged = await this.store.readDirectory("imports", imported.storageKey, paths); }
    catch (cause) {
      const confirmed = await this.readConfirmedImportCard(accountId, importId);
      if (confirmed) return confirmed;
      throw asStorageFailure(cause, { importId, stage: "read-staging" });
    }
    const files = [...staged].map(([path, content]) => ({ path, content }));
    const checked = this.checkPackage(files);
    if (!checked.valid || !checked.package) throw new NativeCardServiceError("NATIVE_CARD_PACKAGE_INVALID", 422, { importId, issues: toNativeCardIssues(checked.issues) });

    const cardId = nanoid();
    const characterId = nanoid();
    const characterVersionId = nanoid();
    const revision = 1;
    const now = Date.now();
    const storageKey = `${cardId}/revisions/${revision}-${randomUUID()}`;
    const snapshot = toSnapshot(accountId, cardId, characterId, revision, files, checked.package);
    await this.writeCompleteDirectory("cards", storageKey, files, { cardId, revision, importId });
    try {
      this.db.transaction((tx) => {
        const dataJson = JSON.stringify({ ...snapshot.package.character, importedFormat: "native_card" });
        tx.insert(characters).values({
          id: characterId, accountId, name: snapshot.package.character.name, source: "native_card", status: "active",
          revision: 0, latestVersionNo: 1, createdAt: now, updatedAt: now,
        }).run();
        tx.insert(characterVersions).values({
          id: characterVersionId, characterId, versionNo: 1, dataJson,
          contentHash: createHash("sha256").update(dataJson).digest("hex"), createdAt: now,
        }).run();
        tx.insert(nativeCards).values({
          id: cardId, accountId, characterId, packageId: snapshot.packageId,
          name: snapshot.package.character.name, currentRevision: revision, createdAt: now, updatedAt: now,
        }).run();
        tx.insert(nativeCardRevisions).values({
          cardId, revision, storageKey, packageId: snapshot.packageId,
          manifestJson: Buffer.from(files.find((file) => file.path === "manifest.json")!.content).toString("utf8"),
          fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.content.byteLength, 0), createdAt: now,
        }).run();
        tx.insert(nativeCardVersionBindings).values({ characterVersionId, accountId, cardId, revision, createdAt: now }).run();
        const marked = tx.update(nativeCardImports).set({ status: "confirmed", confirmedCardId: cardId, updatedAt: now })
          .where(and(
            eq(nativeCardImports.id, importId),
            eq(nativeCardImports.accountId, accountId),
            eq(nativeCardImports.status, "ready"),
            gt(nativeCardImports.expiresAt, now),
          )).run();
        if (!marked.changes) throw new NativeCardServiceError("NATIVE_CARD_IMPORT_NOT_FOUND", 404, { importId });
        this.hooks.commitImportedResources?.(tx, snapshot, { cardId, characterId, characterVersionId, revision });
      });
    } catch (cause) {
      let cleanupFailed = false;
      try { await this.store.remove("cards", storageKey); }
      catch { cleanupFailed = true; }
      if (cause instanceof NativeCardServiceError && !cleanupFailed) {
        if (cause.code === "NATIVE_CARD_IMPORT_NOT_FOUND") {
          const confirmed = await this.readConfirmedImportCard(accountId, importId);
          if (confirmed) return confirmed;
        }
        throw cause;
      }
      throw databaseCommitFailure(cause, { importId, cardId, revision }, cleanupFailed);
    }
    await this.store.remove("imports", imported.storageKey).catch(() => undefined);
    return this.get(accountId, cardId);
  }

  async createBuild(accountId: string, cardId: string, source: { revision: number; versionId?: string }): Promise<NativeCardBuildRecord> {
    await this.requireRevision(accountId, cardId, source.revision);
    if (source.versionId) {
      const publication = this.db.select({ revision: nativeCardPublications.revision }).from(nativeCardPublications)
        .where(and(eq(nativeCardPublications.accountId, accountId), eq(nativeCardPublications.cardId, cardId), eq(nativeCardPublications.characterVersionId, source.versionId))).get();
      if (!publication || publication.revision !== source.revision) throw new NativeCardServiceError("NATIVE_CARD_VERSION_NOT_FOUND", 404, { cardId, versionId: source.versionId });
    }
    const id = nanoid();
    const now = Date.now();
    this.db.insert(nativeCardBuilds).values({
      id, accountId, cardId, sourceRevision: source.revision, sourceVersionId: source.versionId ?? null,
      status: "queued", stage: "validating", storageKey: null, issuesJson: "[]",
      expiresAt: now + this.config.buildTtlMs, createdAt: now, updatedAt: now,
    }).run();
    return buildStatus(this.db.select().from(nativeCardBuilds).where(eq(nativeCardBuilds.id, id)).get()!);
  }

  async executeBuild(accountId: string, buildId: string): Promise<NativeCardBuildRecord> {
    const claimed = this.db.$client.prepare(
      "UPDATE native_card_build SET status = 'running', stage = 'validating', updated_at = ? WHERE id = ? AND account_id = ? AND status = 'queued'",
    ).run(Date.now(), buildId, accountId);
    if (!claimed.changes) return this.getBuild(accountId, buildId);
    const current = this.db.select().from(nativeCardBuilds).where(and(eq(nativeCardBuilds.id, buildId), eq(nativeCardBuilds.accountId, accountId))).get();
    if (!current) throw new NativeCardServiceError("NATIVE_CARD_BUILD_NOT_FOUND", 404, { buildId });
    const storageKey = `${buildId}-${randomUUID()}`;
    let stage: "validating" | "archiving" = "validating";
    try {
      const snapshot = await this.loadValidatedRevision(accountId, current.cardId, current.sourceRevision);
      const revisionRow = await this.requireRevision(accountId, current.cardId, current.sourceRevision);
      const manifestBytes = await this.store.read("cards", revisionRow.storageKey, "manifest.json");
      const zip = writeNativeCardZip([
        { path: "manifest.json", content: manifestBytes },
        ...snapshot.manifest.files.map(({ path }) => ({ path, content: Buffer.from(snapshot.files.get(path)!) })),
      ]);
      if (zip.byteLength > this.config.maxUploadBytes) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "The built ZIP exceeds the configured upload limit.", { maxUploadBytes: this.config.maxUploadBytes, actualBytes: zip.byteLength });
      stage = "archiving";
      this.db.$client.prepare("UPDATE native_card_build SET stage = 'archiving', updated_at = ? WHERE id = ? AND account_id = ?").run(Date.now(), buildId, accountId);
      await this.writeCompleteDirectory("builds", storageKey, [{ path: "package.zip", content: zip }]);
      this.db.$client.prepare("UPDATE native_card_build SET status = 'succeeded', stage = 'ready', storage_key = ?, issues_json = '[]', updated_at = ? WHERE id = ? AND account_id = ?").run(storageKey, Date.now(), buildId, accountId);
    } catch (cause) {
      const issueCode = cause instanceof NativeCardZipError ? cause.code : "NATIVE_CARD_BUILD_FAILED";
      const issue: NativeCardIssue = {
        code: issueCode,
        path: "",
        message: issueCode === "NATIVE_CARD_ZIP_TOO_LARGE" ? apiErrorMessages.NATIVE_CARD_ZIP_TOO_LARGE : apiErrorMessages.NATIVE_CARD_BUILD_FAILED,
        action: apiErrorMessages.NATIVE_CARD_BUILD_FAILED,
        ...(cause instanceof Error ? { expected: cause.message } : {}),
      };
      const validationIssues = cause instanceof NativeCardServiceError &&
        cause.code === "NATIVE_CARD_PACKAGE_INVALID" &&
        Array.isArray(cause.details?.issues)
        ? cause.details.issues as NativeCardIssue[]
        : undefined;
      const failureIssues = validationIssues ? toNativeCardIssues(validationIssues) : [issue];
      this.db.$client.prepare("UPDATE native_card_build SET status = 'failed', stage = ?, storage_key = NULL, issues_json = ?, updated_at = ? WHERE id = ? AND account_id = ?").run(stage, JSON.stringify(failureIssues), Date.now(), buildId, accountId);
      await this.store.remove("builds", storageKey).catch(() => undefined);
      if (cause instanceof NativeCardServiceError) return this.getBuild(accountId, buildId);
    }
    return this.getBuild(accountId, buildId);
  }

  async getBuild(accountId: string, buildId: string): Promise<NativeCardBuildRecord> {
    const row = this.db.select().from(nativeCardBuilds).where(and(eq(nativeCardBuilds.id, buildId), eq(nativeCardBuilds.accountId, accountId))).get();
    if (!row || row.expiresAt <= Date.now()) throw new NativeCardServiceError("NATIVE_CARD_BUILD_NOT_FOUND", 404, { buildId });
    return buildStatus(row);
  }

  async retryBuild(accountId: string, buildId: string): Promise<NativeCardBuildRecord> {
    const current = await this.getBuild(accountId, buildId);
    if (current.status !== "failed") throw new NativeCardServiceError("NATIVE_CARD_BUILD_FAILED", 409, { buildId, status: current.status });
    this.db.$client.prepare("UPDATE native_card_build SET status = 'queued', stage = 'validating', issues_json = '[]', expires_at = ?, updated_at = ? WHERE id = ? AND account_id = ? AND status = 'failed'")
      .run(Date.now() + this.config.buildTtlMs, Date.now(), buildId, accountId);
    return this.getBuild(accountId, buildId);
  }

  async readBuildZip(accountId: string, buildId: string): Promise<Uint8Array> {
    const row = this.db.select().from(nativeCardBuilds).where(and(eq(nativeCardBuilds.id, buildId), eq(nativeCardBuilds.accountId, accountId))).get();
    if (!row || row.expiresAt <= Date.now()) throw new NativeCardServiceError("NATIVE_CARD_BUILD_NOT_FOUND", 404, { buildId });
    if (row.status !== "succeeded" || row.stage !== "ready" || !row.storageKey) throw new NativeCardServiceError("NATIVE_CARD_BUILD_NOT_READY", 409, { buildId, status: row.status, stage: row.stage });
    try { return await this.store.read("builds", row.storageKey, "package.zip"); }
    catch (cause) { throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { buildId }, cause); }
  }

  async recoverInterruptedBuilds(): Promise<void> {
    const now = Date.now();
    this.db.$client.prepare("UPDATE native_card_build SET status = 'failed', issues_json = ?, updated_at = ? WHERE status IN ('queued','running')")
      .run(JSON.stringify([{ code: "NATIVE_CARD_BUILD_FAILED", path: "", message: apiErrorMessages.NATIVE_CARD_BUILD_FAILED, action: "Retry packaging for this revision." }]), now);
  }

  async validate(accountId: string, cardId: string, revision?: number): Promise<NativeCardValidation> {
    const selected = revision ?? (await this.get(accountId, cardId)).revision;
    const row = await this.requireRevision(accountId, cardId, selected);
    const paths = this.revisionFilePaths(row.manifestJson);
    let files: Map<string, Uint8Array>;
    try { files = await this.store.readDirectory("cards", row.storageKey, paths); }
    catch (cause) { throw asStorageFailure(cause, { cardId, revision: selected }); }
    const result = this.checkPackage([...files].map(([path, content]) => ({ path, content })));
    return { valid: result.valid, issues: toNativeCardIssues(result.issues) };
  }

  async loadValidatedRevision(accountId: string, cardId: string, revision: number): Promise<NativeCardRevisionSnapshot> {
    const card = this.db.select().from(nativeCards).where(and(eq(nativeCards.id, cardId), eq(nativeCards.accountId, accountId))).get();
    if (!card) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId });
    const row = this.db.select().from(nativeCardRevisions).where(and(eq(nativeCardRevisions.cardId, cardId), eq(nativeCardRevisions.revision, revision))).get();
    if (!row) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId, revision });
    const paths = this.revisionFilePaths(row.manifestJson);
    let stored: Map<string, Uint8Array>;
    try { stored = await this.store.readDirectory("cards", row.storageKey, paths); }
    catch (cause) { throw asStorageFailure(cause, { cardId, revision }); }
    const validation = this.checkPackage([...stored].map(([path, content]) => ({ path, content })));
    if (!validation.valid || !validation.package) throw new NativeCardServiceError("NATIVE_CARD_PACKAGE_INVALID", 422, { cardId, revision, issues: validation.issues });
    return {
      accountId, cardId, characterId: card.characterId, packageId: validation.package.manifest.packageId,
      revision, manifest: validation.package.manifest, package: validation.package, files: validation.package.files,
      fileRecords: getManifestFileInfo(validation.package.files, validation.package.manifest),
    };
  }

  async resolveFilePath(accountId: string, cardId: string, revision: number, path: string): Promise<string> {
    const snapshot = await this.loadValidatedRevision(accountId, cardId, revision);
    roleAssetPathSchema.parse(path);
    if (path !== "manifest.json" && !snapshot.files.has(path)) throw new NativeCardServiceError("NATIVE_CARD_FILE_NOT_FOUND", 404, { cardId, revision, path });
    const row = await this.requireRevision(accountId, cardId, revision);
    const filePath = this.store.path("cards", row.storageKey, path);
    try { await this.store.read("cards", row.storageKey, path); }
    catch (cause) { throw asStorageFailure(cause, { cardId, revision, path }); }
    return filePath;
  }

  async findRevisionByCharacterVersion(accountId: string, characterVersionId: string): Promise<NativeCardRevisionSnapshot> {
    const binding = this.db.select({ cardId: nativeCardVersionBindings.cardId, revision: nativeCardVersionBindings.revision })
      .from(nativeCardVersionBindings)
      .where(and(eq(nativeCardVersionBindings.accountId, accountId), eq(nativeCardVersionBindings.characterVersionId, characterVersionId))).get();
    if (!binding) throw new NativeCardServiceError("NATIVE_CARD_VERSION_NOT_FOUND", 404, { characterVersionId });
    return this.loadValidatedRevision(accountId, binding.cardId, binding.revision);
  }

  async withValidatedRevisionTransaction<T>(
    accountId: string,
    cardId: string,
    revision: number,
    callback: (context: { tx: NativeCardDbTransaction; snapshot: NativeCardRevisionSnapshot }) => T,
  ): Promise<T> {
    const snapshot = await this.loadValidatedRevision(accountId, cardId, revision);
    return this.db.transaction((tx) => callback({ tx, snapshot }));
  }

  private async toRecord(accountId: string, card: CardRow): Promise<NativeCardRecord> {
    const row = await this.requireRevision(accountId, card.id, card.currentRevision);
    const manifest = this.parseStoredManifest(row.manifestJson, card.id, card.currentRevision);
    let files: Map<string, Uint8Array>;
    try { files = await this.store.readDirectory("cards", row.storageKey, this.revisionFilePaths(row.manifestJson)); }
    catch (cause) { throw asStorageFailure(cause, { cardId: card.id, revision: card.currentRevision }); }
    const checked = this.checkPackage([...files].map(([path, content]) => ({ path, content })));
    if (!checked.valid || !checked.package) throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { cardId: card.id, revision: card.currentRevision, issues: checked.issues });
    const fileRecords = getManifestFileInfo(files, manifest);
    const published = this.db.select({ id: nativeCardPublications.characterVersionId, revision: nativeCardPublications.revision, createdAt: nativeCardPublications.createdAt, note: nativeCardPublications.note })
      .from(nativeCardPublications)
      .where(and(eq(nativeCardPublications.accountId, accountId), eq(nativeCardPublications.cardId, card.id)))
      .orderBy(asc(nativeCardPublications.createdAt)).all();
    return {
      id: card.id,
      characterId: card.characterId,
      packageId: card.packageId,
      name: card.name,
      revision: card.currentRevision,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      files: fileRecords,
      versions: published.map((version) => ({ id: version.id, revision: version.revision, createdAt: version.createdAt, note: version.note })),
    };
  }

  private checkPackage(files: readonly NativeCardPackageFile[]): { valid: boolean; issues: NativeCardIssue[]; package?: NativeCardPackage } {
    const checked = validateNativeCardPackage(files);
    const issues = toNativeCardIssues(checked.issues);
    if (!checked.package) return { valid: false, issues };

    issues.push(...validateNativeCardModules(files, nativeCardFileRules.backendModuleApi));
    issues.push(...validateNativeCardFrontendModules(
      files,
      checked.package.frontendManifest?.script,
      nativeCardFileRules.frontendModuleApi,
    ));
    issues.push(...validateNativeCardFrontendMarkup(files));

    const fileMap = new Map(files.map((file) => [file.path, file.content]));
    const manifestFiles = checked.package.manifest.files;
    for (const issue of validateNativeCardMediaFiles(manifestFiles, fileMap)) {
      const file = manifestFiles.find((candidate) => candidate.path === issue.path);
      const message = issue.code === "NATIVE_CARD_MEDIA_TYPE_UNSUPPORTED"
        ? apiErrorMessages.NATIVE_CARD_MEDIA_TYPE_UNSUPPORTED
        : apiErrorMessages.NATIVE_CARD_MEDIA_TYPE_MISMATCH;
      issues.push({
        code: issue.code,
        path: issue.path,
        message,
        action: message,
        ...(file ? { expected: `Declared ${file.mediaType}${issue.formatId ? `; expected ${issue.formatId} file signature.` : " is not listed in native-card-file-rules.json assetMediaFormats."}` } : {}),
      });
    }
    issues.push(...validateNativeCardStatePackage(checked.package));
    return { valid: checked.valid && issues.length === 0, issues, package: checked.package };
  }

  private async requireRevision(accountId: string, cardId: string, revision: number): Promise<RevisionRow> {
    const card = this.db.select({ id: nativeCards.id }).from(nativeCards)
      .where(and(eq(nativeCards.id, cardId), eq(nativeCards.accountId, accountId))).get();
    if (!card) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId });
    const row = this.db.select().from(nativeCardRevisions)
      .where(and(eq(nativeCardRevisions.cardId, cardId), eq(nativeCardRevisions.revision, revision))).get();
    if (!row) throw new NativeCardServiceError("NATIVE_CARD_NOT_FOUND", 404, { cardId, revision });
    return row;
  }

  private revisionFilePaths(manifestJson: string): string[] {
    const manifest = this.parseStoredManifest(manifestJson, "manifest.json", 0);
    return ["manifest.json", ...manifest.files.map((file) => file.path)];
  }

  private parseStoredManifest(manifestJson: string, cardId: string, revision: number): NativeCardPackageManifest {
    try {
      const result = nativeCardPackageManifestSchema.safeParse(JSON.parse(manifestJson));
      if (result.success) return result.data;
    } catch (cause) {
      throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { cardId, revision, path: "manifest.json" }, cause);
    }
    throw new NativeCardServiceError("NATIVE_CARD_STORAGE_FAILURE", 500, { cardId, revision, path: "manifest.json" });
  }

  private async writeCompleteDirectory(
    area: "cards" | "imports" | "builds",
    storageKey: string,
    files: readonly NativeCardPackageFile[],
    identity: NativeCardWriteIdentity = {},
  ): Promise<void> {
    const total = files.reduce((sum, file) => sum + file.content.byteLength, 0);
    const oversizedPath = files.find((file) => Buffer.byteLength(file.path, "utf8") > this.config.maxPathBytes);
    const oversizedFile = files.find((file) => file.content.byteLength > this.config.maxFileBytes);
    if (oversizedPath || oversizedFile) {
      throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, {
        ...(oversizedPath ? { path: oversizedPath.path, maxPathBytes: this.config.maxPathBytes } : {}),
        ...(oversizedFile ? { path: oversizedFile.path, maxFileBytes: this.config.maxFileBytes } : {}),
      });
    }
    if (files.length > this.config.maxFileCount || total > this.config.maxExpandedBytes) {
      throw new NativeCardServiceError("NATIVE_CARD_OPERATION_INVALID", 400, { totalBytes: total, maxExpandedBytes: this.config.maxExpandedBytes });
    }
    try { await this.store.writeDirectory(area, storageKey, files); }
    catch (cause) {
      const cleanupFailed = cause instanceof NativeCardStoreWriteError && cause.cleanupFailed;
      throw new NativeCardServiceError(
        "NATIVE_CARD_STORAGE_FAILURE",
        500,
        writeFailureDetails("file-commit", identity, { cleanupFailed }),
        cause,
      );
    }
  }
}
