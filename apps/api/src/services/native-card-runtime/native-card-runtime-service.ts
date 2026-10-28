import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import type { STWorldBook, STWorldBookEntry } from "@tavern/adapters-sillytavern";
import {
  nativeCardPreviewSchema,
  nativeCardRuntimePackageSchema,
  createRoleReleaseBodySchema,
  nativeCardPublishSchema,
  type NativeCardPreview,
  type NativeCardPreviewResult,
  type NativeCardPublication,
  type NativeCardPublish,
  type NativeCardWorldbookEntry,
  roleReleaseModelSlots,
  stateUpdaterSlot,
} from "@tavern/shared";
import type { AppDb, DbExecutor } from "../../db/client.js";
import {
  characterVersions,
  characters,
  nativeCardPublications,
  nativeCards,
  nativeCardResourceBindings,
  nativeCardVersionBindings,
  regexProfiles,
  sessions,
  roleReleases,
  roleAppDrafts,
  sessionBranches,
  promptSnapshots,
  worldbookVersions,
  regexProfileVersions,
  worldbooks,
  worldbookEntries,
} from "../../db/schema.js";
import { buildWorldbookEntryInsertValues, buildPersistedWorldbookGlobalSettings } from "../../lib/worldbook-utils.js";
import { normalizeSessionCharacterSnapshot, type SessionCharacterSnapshot } from "../../lib/character-snapshot.js";
import { AssetVersionService } from "../asset-version-service.js";
import { NativeCardServiceError, type NativeCardDbTransaction, type NativeCardImportIdentity, type NativeCardService, type NativeCardRevisionSnapshot as CardSnapshot } from "../native-card/native-card-service.js";
import { RoleReleaseService, buildRoleReleaseOpenings, selectRoleReleaseOpening, type RoleReleaseSnapshot, type RoleReleaseOpeningSnapshot } from "../role-release-service.js";
import { resolveRoleReleaseConfiguration, type RegisterRoleReleaseRoutesOptions } from "../../routes/role-releases.js";
import { persistRoleModelCapabilitySessionSnapshot } from "../role-model-capabilities.js";
import type { CreateRoleReleaseBody, CreateRoleReleaseSessionBody } from "../../routes/schemas/role-releases.js";

export type NativeCardRuntimeResource = {
  kind: "worldbook" | "regex_profile";
  packageResourceId: string;
  localId: string;
  localVersionId: string;
  ordinal: number;
  enabled: boolean;
};

type PlannedNativeCardResource = NativeCardRuntimeResource;

type MaterializedNativeCardResources = {
  resources: NativeCardRuntimeResource[];
};

type NativeCardRuntimeDb = AppDb | DbExecutor;

export type NativeCardRuntimeSnapshot = {
  accountId: string;
  cardId: string;
  revision: number;
  packageId: string;
  characterId: string;
  characterVersionId: string;
  characterSnapshot: SessionCharacterSnapshot;
  openings: RoleReleaseOpeningSnapshot[];
  resources: NativeCardRuntimeResource[];
};

type SessionCreatedOptions = Pick<RegisterRoleReleaseRoutesOptions, "onSessionCreated">;

/**
 * Materializes a validated package revision into immutable character, worldbook,
 * and regex versions. Every runtime entry point starts from an explicit revision.
 */
export class NativeCardRuntimeService {
  constructor(
    private readonly db: AppDb,
    private readonly sessionOptions: RegisterRoleReleaseRoutesOptions = {},
  ) {}

  commitImportedResources(
    tx: NativeCardDbTransaction,
    snapshot: CardSnapshot,
    identity: NativeCardImportIdentity,
  ): void {
    const { resources } = materializePackageResources(tx, snapshot);
    const runtime = buildRuntimeSnapshot(snapshot, identity.characterVersionId, resources);
    const encoded = JSON.stringify(runtime.characterSnapshot);
    tx.update(characterVersions)
      .set({ dataJson: encoded, contentHash: createHash("sha256").update(encoded).digest("hex") })
      .where(eq(characterVersions.id, identity.characterVersionId))
      .run();
  }

  async publish(
    cards: NativeCardService,
    app: FastifyInstance,
    accountId: string,
    cardId: string,
    input: NativeCardPublish,
    headers: Record<string, string>,
  ): Promise<NativeCardPublication> {
    const parsed = nativeCardPublishSchema.parse(input);
    const snapshot = await cards.loadValidatedRevision(accountId, cardId, parsed.revision);
    const plannedResources = planOrLoadResources(this.db, snapshot);
    const characterVersionId = nanoid();
    const runtime = buildRuntimeSnapshot(snapshot, characterVersionId, plannedResources);
    const body = toReleaseInput(runtime, parsed.configuration);
    const resolved = await resolveRoleReleaseConfiguration(
      app,
      headers,
      body,
      accountId,
      undefined,
      runtime.characterSnapshot,
    );
    return cards.withValidatedRevisionTransaction(accountId, cardId, parsed.revision, ({ tx, snapshot: fixed }) => {
      const materialized = materializePackageResources(tx, fixed, plannedResources);
      const fixedRuntime = buildRuntimeSnapshot(fixed, characterVersionId, materialized.resources);
      insertRuntimeCharacterVersion(tx, fixedRuntime, Date.now());
      commitCharacterVersionMetadata(tx, fixedRuntime.characterId);
      const release = new RoleReleaseService(this.db).createInTransaction(tx, resolved);
      const createdAt = release.created_at;
      tx.insert(nativeCardPublications).values({
        id: fixedRuntime.characterVersionId,
        accountId,
        cardId,
        revision: parsed.revision,
        characterVersionId: fixedRuntime.characterVersionId,
        releaseId: release.id,
        resourceMappingsJson: JSON.stringify(fixedRuntime.resources),
        createdAt,
        note: parsed.note ?? "",
      }).run();
      return {
        id: fixedRuntime.characterVersionId,
        cardId,
        revision: parsed.revision,
        createdAt,
        characterId: fixedRuntime.characterId,
        characterVersionId: fixedRuntime.characterVersionId,
        releaseId: release.id,
        note: parsed.note ?? "",
      };
    });
  }

  async createPreview(
    cards: NativeCardService,
    app: FastifyInstance,
    accountId: string,
    cardId: string,
    input: NativeCardPreview,
    headers: Record<string, string>,
  ): Promise<NativeCardPreviewResult> {
    const parsed = nativeCardPreviewSchema.parse(input);
    const snapshot = await cards.loadValidatedRevision(accountId, cardId, parsed.revision);
    const plannedResources = planOrLoadResources(this.db, snapshot);
    const characterVersionId = nanoid();
    const preparedRuntime = buildRuntimeSnapshot(snapshot, characterVersionId, plannedResources);
    const body = toReleaseInput(preparedRuntime, parsed.configuration);
    const resolved = await resolveRoleReleaseConfiguration(
      app,
      headers,
      body,
      accountId,
      undefined,
      preparedRuntime.characterSnapshot,
    );
    const materialized = await cards.withValidatedRevisionTransaction(accountId, cardId, parsed.revision, ({ tx, snapshot: fixed }) => {
      const result = materializePackageResources(tx, fixed, plannedResources);
      const runtime = buildRuntimeSnapshot(fixed, characterVersionId, result.resources);
      insertRuntimeCharacterVersion(tx, runtime, Date.now());
      return runtime;
    });
    let sessionResult: { sessionId: string; openingId: string | null };
    try {
      const previewRelease = toPreviewRelease(resolved, materialized);
      sessionResult = await createSession(this.db, accountId, app, headers, previewRelease, {
        ...(parsed.userId ? { user_id: parsed.userId } : {}),
        ...(parsed.openingId ? { opening_id: parsed.openingId } : {}),
        ...(parsed.sessionType ? { session_type: parsed.sessionType } : {}),
      }, this.sessionOptions);
    } catch (error) {
      if (error instanceof NativeCardServiceError && error.code === "ROLE_RELEASE_SESSION_CLEANUP_FAILED") {
        commitCharacterVersionMetadata(this.db, materialized.characterId);
      } else {
        this.removePreviewMaterialization(materialized);
      }
      throw error;
    }
    commitCharacterVersionMetadata(this.db, materialized.characterId);
    return {
      cardId,
      revision: parsed.revision,
      sessionId: sessionResult.sessionId,
      openingId: sessionResult.openingId,
    };
  }

  private removePreviewMaterialization(runtime: NativeCardRuntimeSnapshot): void {
    this.db.transaction((tx) => {
      // Consumers can pin the visible version while initialization awaits.
      const sessionReference = tx.select({ id: sessions.id }).from(sessions)
        .where(and(eq(sessions.accountId, runtime.accountId), eq(sessions.characterVersionId, runtime.characterVersionId))).get();
      const releaseReference = tx.select({ id: roleReleases.id }).from(roleReleases)
        .where(and(eq(roleReleases.accountId, runtime.accountId), eq(roleReleases.characterVersionId, runtime.characterVersionId))).get();
      const draftReference = tx.select({ id: roleAppDrafts.id }).from(roleAppDrafts).where(and(
        eq(roleAppDrafts.accountId, runtime.accountId),
        sql`json_extract(${roleAppDrafts.snapshotJson}, '$.character_version_id') = ${runtime.characterVersionId}`,
      )).get();
      const promptReference = tx.select({ id: promptSnapshots.floorId }).from(promptSnapshots)
        .innerJoin(sessions, eq(sessions.id, promptSnapshots.sessionId)).where(and(
          eq(sessions.accountId, runtime.accountId), eq(promptSnapshots.characterVersionId, runtime.characterVersionId),
        )).get();
      if (sessionReference || releaseReference || draftReference || promptReference) {
        commitCharacterVersionMetadata(tx, runtime.characterId);
        return;
      }
      tx.delete(nativeCardVersionBindings)
        .where(eq(nativeCardVersionBindings.characterVersionId, runtime.characterVersionId)).run();
      tx.delete(characterVersions)
        .where(eq(characterVersions.id, runtime.characterVersionId)).run();

      // Derive both lifetimes from surviving rows, including other previews still initializing.
      const latest = tx.select({ versionNo: characterVersions.versionNo }).from(characterVersions)
        .where(eq(characterVersions.characterId, runtime.characterId))
        .orderBy(desc(characterVersions.versionNo)).get();
      tx.update(characters).set({ latestVersionNo: latest?.versionNo ?? 0 })
        .where(eq(characters.id, runtime.characterId)).run();
      const otherVersion = tx.select({ id: nativeCardVersionBindings.characterVersionId })
        .from(nativeCardVersionBindings)
        .where(and(
          eq(nativeCardVersionBindings.cardId, runtime.cardId),
          eq(nativeCardVersionBindings.revision, runtime.revision),
        )).get();
      if (otherVersion || hasIndependentResourceConsumers(tx, runtime)) return;

      const worldbookIds = runtime.resources.filter((resource) => resource.kind === "worldbook").map((resource) => resource.localId);
      const regexIds = runtime.resources.filter((resource) => resource.kind === "regex_profile").map((resource) => resource.localId);
      tx.delete(nativeCardResourceBindings).where(and(
        eq(nativeCardResourceBindings.cardId, runtime.cardId),
        eq(nativeCardResourceBindings.revision, runtime.revision),
      )).run();
      if (worldbookIds.length) tx.delete(worldbooks).where(inArray(worldbooks.id, worldbookIds)).run();
      if (regexIds.length) tx.delete(regexProfiles).where(inArray(regexProfiles.id, regexIds)).run();
    });
  }
}

/** Package bindings are an indivisible set: materialization reuses the complete revision. */
function hasIndependentResourceConsumers(tx: DbExecutor, runtime: NativeCardRuntimeSnapshot): boolean {
  if (runtime.resources.length === 0) return false;
  const drafts = tx.select().from(roleAppDrafts).where(eq(roleAppDrafts.accountId, runtime.accountId)).all();
  const draftConfigurations = drafts.map((draft) => createRoleReleaseBodySchema.parse(JSON.parse(draft.inputJson)));
  for (const resource of runtime.resources) {
    const isBook = resource.kind === "worldbook";
    const session = tx.select({ id: sessions.id }).from(sessions).where(and(
      eq(sessions.accountId, runtime.accountId),
      or(eq(isBook ? sessions.worldbookProfileId : sessions.regexProfileId, resource.localId),
        eq(isBook ? sessions.worldbookVersionId : sessions.regexProfileVersionId, resource.localVersionId)),
    )).get();
    const branch = tx.select({ id: sessionBranches.id }).from(sessionBranches).where(and(
      eq(sessionBranches.accountId, runtime.accountId),
      or(eq(isBook ? sessionBranches.assetBindingWorldbookProfileId : sessionBranches.assetBindingRegexProfileId, resource.localId),
        eq(isBook ? sessionBranches.assetBindingWorldbookVersionId : sessionBranches.assetBindingRegexProfileVersionId, resource.localVersionId)),
    )).get();
    const release = tx.select({ id: roleReleases.id }).from(roleReleases).where(and(
      eq(roleReleases.accountId, runtime.accountId),
      or(eq(isBook ? roleReleases.worldbookId : roleReleases.regexProfileId, resource.localId),
        eq(isBook ? roleReleases.worldbookVersionId : roleReleases.regexProfileVersionId, resource.localVersionId)),
    )).get();
    const prompt = tx.select({ id: promptSnapshots.floorId }).from(promptSnapshots)
      .innerJoin(sessions, eq(sessions.id, promptSnapshots.sessionId)).where(and(
        eq(sessions.accountId, runtime.accountId),
        or(eq(isBook ? promptSnapshots.worldbookId : promptSnapshots.regexProfileId, resource.localId),
          eq(isBook ? promptSnapshots.worldbookVersionId : promptSnapshots.regexProfileVersionId, resource.localVersionId)),
      )).get();
    const draft = draftConfigurations.some((configuration) => isBook
      ? configuration.worldbook_id === resource.localId || configuration.worldbook_version_id === resource.localVersionId
      : configuration.regex_profile_id === resource.localId || configuration.regex_profile_version_id === resource.localVersionId);
    if (session || branch || release || prompt || draft) return true;

    // Independent edits and derived versions are committed resource history, even without sessions.
    const edited = isBook
      ? tx.select({ id: worldbookVersions.id }).from(worldbookVersions)
        .innerJoin(worldbooks, eq(worldbooks.id, worldbookVersions.worldbookId)).where(and(
          eq(worldbooks.accountId, runtime.accountId),
          or(and(eq(worldbookVersions.worldbookId, resource.localId), ne(worldbookVersions.id, resource.localVersionId)),
            eq(worldbookVersions.parentVersionId, resource.localVersionId)),
        )).get()
      : tx.select({ id: regexProfileVersions.id }).from(regexProfileVersions)
        .innerJoin(regexProfiles, eq(regexProfiles.id, regexProfileVersions.regexProfileId)).where(and(
          eq(regexProfiles.accountId, runtime.accountId),
          or(and(eq(regexProfileVersions.regexProfileId, resource.localId), ne(regexProfileVersions.id, resource.localVersionId)),
            eq(regexProfileVersions.parentVersionId, resource.localVersionId)),
        )).get();
    const otherBinding = tx.select({ id: nativeCardResourceBindings.localId }).from(nativeCardResourceBindings)
      .innerJoin(nativeCards, eq(nativeCards.id, nativeCardResourceBindings.cardId)).where(and(
      eq(nativeCards.accountId, runtime.accountId), eq(nativeCardResourceBindings.kind, resource.kind), eq(nativeCardResourceBindings.localId, resource.localId),
      or(ne(nativeCardResourceBindings.cardId, runtime.cardId), ne(nativeCardResourceBindings.revision, runtime.revision)),
    )).get();
    if (edited || otherBinding) return true;
  }

  // Native snapshots carry resource arrays independently of their character-version foreign key.
  const packages = [
    ...tx.select({ json: sql<string | null>`json_extract(${sessions.characterSnapshotJson}, '$.extensions.tavern_headless.nativePackage')` })
      .from(sessions).where(eq(sessions.accountId, runtime.accountId)).all(),
    ...tx.select({ json: sql<string | null>`json_extract(${roleReleases.characterSnapshotJson}, '$.extensions.tavern_headless.nativePackage')` })
      .from(roleReleases).where(eq(roleReleases.accountId, runtime.accountId)).all(),
    ...tx.select({ json: sql<string | null>`json_extract(${characterVersions.dataJson}, '$.extensions.tavern_headless.nativePackage')` })
      .from(characterVersions).innerJoin(characters, eq(characters.id, characterVersions.characterId))
      .where(eq(characters.accountId, runtime.accountId)).all(),
    ...tx.select({ json: sql<string | null>`json_extract(${roleAppDrafts.snapshotJson}, '$.character_snapshot.extensions.tavern_headless.nativePackage')` })
      .from(roleAppDrafts).where(eq(roleAppDrafts.accountId, runtime.accountId)).all(),
  ];
  return packages.some(({ json }) => {
    if (json === null) return false;
    const pkg = nativeCardRuntimePackageSchema.parse(JSON.parse(json));
    return runtime.resources.some((resource) =>
      (resource.kind === "worldbook" ? pkg.worldbooks : pkg.regexProfiles).some((binding) =>
        binding.resourceId === resource.localId || binding.versionId === resource.localVersionId));
  });
}

function toReleaseInput(
  runtime: NativeCardRuntimeSnapshot,
  configuration: NativeCardPublish["configuration"],
): CreateRoleReleaseBody {
  return {
    name: runtime.characterSnapshot.name,
    character_id: runtime.characterId,
    character_version_id: runtime.characterVersionId,
    preset_id: configuration.presetId,
    preset_version_id: configuration.presetVersionId,
    statePresetId: configuration.statePresetId,
    statePresetVersionId: configuration.statePresetVersionId,
    stateHistoryTurns: configuration.stateHistoryTurns,
    regex_profile_id: null,
    regex_profile_version_id: null,
    worldbook_id: null,
    worldbook_version_id: null,
    prompt_mode: configuration.promptMode,
    model_slots: configuration.modelSlots,
    model_capabilities: configuration.model_capabilities,
    default_user_id: configuration.defaultUserId,
  };
}

function planOrLoadResources(db: NativeCardRuntimeDb, snapshot: CardSnapshot): PlannedNativeCardResource[] {
  const existing = db.select().from(nativeCardResourceBindings)
    .where(eq(nativeCardResourceBindings.cardId, snapshot.cardId)).all()
    .filter((binding) => binding.revision === snapshot.revision);
  if (existing.length) return existing.map(toRuntimeResource)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.ordinal - b.ordinal);
  const resources: PlannedNativeCardResource[] = [];
  for (const [ordinal, binding] of (snapshot.package.character.worldbooks ?? []).entries()) {
    resources.push({
      kind: "worldbook", packageResourceId: binding.id, localId: nanoid(),
      localVersionId: nanoid(), ordinal, enabled: binding.enabled,
    });
  }
  for (const [ordinal, path] of (snapshot.package.character.regexProfiles ?? []).entries()) {
    resources.push({
      kind: "regex_profile", packageResourceId: path, localId: nanoid(),
      localVersionId: nanoid(), ordinal, enabled: true,
    });
  }
  return resources;
}

function materializePackageResources(
  tx: DbExecutor,
  snapshot: CardSnapshot,
  planned?: readonly PlannedNativeCardResource[],
): MaterializedNativeCardResources {
  const existing = tx.select().from(nativeCardResourceBindings)
    .where(eq(nativeCardResourceBindings.cardId, snapshot.cardId)).all()
    .filter((binding) => binding.revision === snapshot.revision);
  if (existing.length) {
    const resources = existing.map(toRuntimeResource)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.ordinal - b.ordinal);
    if (planned && !sameResourceBindings(resources, planned)) {
      throw new Error("Native package resource bindings changed while runtime configuration was being validated.");
    }
    return { resources };
  }

  const resourcePlan = planned ?? planOrLoadResources(tx, snapshot);
  const now = Date.now();
  const versionService = new AssetVersionService(tx);
  const resources: NativeCardRuntimeResource[] = [];
  for (const [ordinal, binding] of (snapshot.package.character.worldbooks ?? []).entries()) {
    const plannedResource = resourcePlan.find((resource) => resource.kind === "worldbook" && resource.ordinal === ordinal);
    if (!plannedResource || plannedResource.packageResourceId !== binding.id) throw new Error(`Native worldbook binding ${binding.id} has no materialization plan.`);
    const book = snapshot.package.worldbooks.get(binding.id);
    if (!book) throw new Error(`Native package worldbook ${binding.id} was not validated.`);
    const entries: STWorldBookEntry[] = book.entryFiles.map((path) => {
      const entry = snapshot.package.parsedJson.get(path) as NativeCardWorldbookEntry | undefined;
      if (!entry) throw new Error(`Native package worldbook entry ${path} was not validated.`);
      return { ...entry, extra: entry.extra ?? {} };
    });
    const worldbook: STWorldBook = {
      name: book.name,
      entries,
      scanDepth: book.scanDepth,
      caseSensitive: book.caseSensitive,
      matchWholeWords: book.matchWholeWords,
      recursive: book.recursive,
      maxRecursionSteps: book.maxRecursionSteps,
      extra: book.extra ?? {},
    };
    const id = plannedResource.localId;
    tx.insert(worldbooks).values({
      id,
      name: book.name,
      source: "native_card",
      accountId: snapshot.accountId,
      workspaceId: null,
      dataJson: JSON.stringify(buildPersistedWorldbookGlobalSettings(worldbook)),
      version: 1,
      createdAt: now,
      updatedAt: now,
    }).run();
    if (entries.length > 0) {
      tx.insert(worldbookEntries).values(entries.map((entry) => buildWorldbookEntryInsertValues(entry, {
        id: nanoid(), worldbookId: id, uid: entry.uid, createdAt: now, updatedAt: now,
      }))).run();
    }
    const version = versionService.createWorldbookVersion(id, { id: plannedResource.localVersionId, versionNo: 1, data: worldbook, createdAt: now });
    const resource: NativeCardRuntimeResource = {
      kind: "worldbook", packageResourceId: binding.id, localId: id,
      localVersionId: version.id, ordinal, enabled: binding.enabled,
    };
    persistResourceBinding(tx, snapshot, resource);
    resources.push(resource);
  }

  for (const [ordinal, path] of (snapshot.package.character.regexProfiles ?? []).entries()) {
    const plannedResource = resourcePlan.find((resource) => resource.kind === "regex_profile" && resource.ordinal === ordinal);
    if (!plannedResource || plannedResource.packageResourceId !== path) throw new Error(`Native regex binding ${path} has no materialization plan.`);
    const value = snapshot.package.parsedJson.get(path);
    if (!Array.isArray(value)) throw new Error(`Native regex profile ${path} was not validated.`);
    const runtimeValue = value.map((rawScript, scriptIndex) => {
      if (!rawScript || typeof rawScript !== "object" || Array.isArray(rawScript)) {
        throw new Error(`Native regex profile ${path} script ${scriptIndex} was not validated.`);
      }
      const script = rawScript as Record<string, unknown>;
      return {
        ...script,
        ...(script.minDepth === null ? { minDepth: 0 } : {}),
        ...(script.maxDepth === null ? { maxDepth: 0 } : {}),
      };
    });
    const id = plannedResource.localId;
    const name = path.slice("regex/".length).replace(/\.json$/i, "");
    tx.insert(regexProfiles).values({
      id,
      name,
      source: "native_card",
      accountId: snapshot.accountId,
      workspaceId: null,
      dataJson: JSON.stringify(runtimeValue),
      version: 1,
      createdAt: now,
      updatedAt: now,
    }).run();
    const version = versionService.createRegexProfileVersion(id, { id: plannedResource.localVersionId, versionNo: 1, data: runtimeValue, createdAt: now });
    const resource: NativeCardRuntimeResource = {
      kind: "regex_profile", packageResourceId: path, localId: id,
      localVersionId: version.id, ordinal, enabled: true,
    };
    persistResourceBinding(tx, snapshot, resource);
    resources.push(resource);
  }
  return { resources };
}

function toRuntimeResource(binding: typeof nativeCardResourceBindings.$inferSelect): NativeCardRuntimeResource {
  return {
    kind: binding.kind as NativeCardRuntimeResource["kind"],
    packageResourceId: binding.packageResourceId,
    localId: binding.localId,
    localVersionId: binding.localVersionId,
    ordinal: binding.ordinal,
    enabled: binding.enabled,
  };
}

function sameResourceBindings(left: readonly NativeCardRuntimeResource[], right: readonly NativeCardRuntimeResource[]): boolean {
  return left.length === right.length && left.every((resource, index) => {
    const candidate = right[index];
    return !!candidate && resource.kind === candidate.kind && resource.packageResourceId === candidate.packageResourceId
      && resource.localId === candidate.localId && resource.localVersionId === candidate.localVersionId
      && resource.ordinal === candidate.ordinal && resource.enabled === candidate.enabled;
  });
}

function insertRuntimeCharacterVersion(
  tx: DbExecutor,
  runtime: NativeCardRuntimeSnapshot,
  now: number,
): void {
  const character = tx.select().from(characters).where(eq(characters.id, runtime.characterId)).get();
  if (!character || character.accountId !== runtime.accountId) throw new Error("Native card character does not belong to the selected account.");
  const encoded = JSON.stringify(runtime.characterSnapshot);
  const versionNo = character.latestVersionNo + 1;
  tx.insert(characterVersions).values({
    id: runtime.characterVersionId,
    characterId: runtime.characterId,
    versionNo,
    dataJson: encoded,
    contentHash: createHash("sha256").update(encoded).digest("hex"),
    createdAt: now,
  }).run();
  // Reserve the next number for every writer; commit editable metadata only when retained.
  tx.update(characters).set({ latestVersionNo: versionNo })
    .where(eq(characters.id, runtime.characterId)).run();
  tx.insert(nativeCardVersionBindings).values({
    characterVersionId: runtime.characterVersionId,
    accountId: runtime.accountId,
    cardId: runtime.cardId,
    revision: runtime.revision,
    createdAt: now,
  }).run();
}

function commitCharacterVersionMetadata(db: NativeCardRuntimeDb, characterId: string): void {
  db.update(characters).set({
    revision: sql`${characters.revision} + 1`,
    updatedAt: sql`max(${characters.updatedAt}, ${Date.now()})`,
  }).where(eq(characters.id, characterId)).run();
}

function persistResourceBinding(tx: DbExecutor, snapshot: CardSnapshot, resource: NativeCardRuntimeResource): void {
  tx.insert(nativeCardResourceBindings).values({
    cardId: snapshot.cardId,
    revision: snapshot.revision,
    kind: resource.kind,
    localId: resource.localId,
    localVersionId: resource.localVersionId,
    packageResourceId: resource.packageResourceId,
    ordinal: resource.ordinal,
    enabled: resource.enabled,
  }).run();
}

function toPreviewRelease(
  resolved: Awaited<ReturnType<typeof resolveRoleReleaseConfiguration>>,
  runtime: NativeCardRuntimeSnapshot,
): RoleReleaseSnapshot {
  return {
    id: `native-preview:${runtime.characterVersionId}`,
    name: resolved.name,
    character_id: resolved.character_id,
    character_version_id: resolved.character_version_id,
    character_snapshot: resolved.characterSnapshot,
    preset_id: resolved.preset_id,
    preset_version_id: resolved.preset_version_id,
    state_preset_id: resolved.statePresetId ?? null,
    state_preset_version_id: resolved.statePresetVersionId ?? null,
    state_history_turns: resolved.stateHistoryTurns,
    regex_profile_id: resolved.regex_profile_id,
    regex_profile_version_id: resolved.regex_profile_version_id,
    worldbook_id: resolved.worldbook_id,
    worldbook_version_id: resolved.worldbook_version_id,
    prompt_mode: resolved.prompt_mode,
    model_slots: resolved.modelSlots,
    model_capabilities: resolved.model_capabilities ?? null,
    default_user_id: resolved.default_user_id,
    default_user_snapshot: resolved.defaultUserSnapshot,
    openings: resolved.openings.map(({ text: _text, variables: _variables, source_index: _sourceIndex, ...opening }) => opening),
    opening_snapshots: runtime.openings,
    created_at: Date.now(),
  };
}

function buildRuntimeSnapshot(
  snapshot: CardSnapshot,
  characterVersionId: string,
  resources: NativeCardRuntimeResource[],
): NativeCardRuntimeSnapshot {
  const pkg = snapshot.package;
  const openings = pkg.openings.items.map((item, index) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    summary: item.summary,
    display_text: textFile(pkg.files.get(item.textFile), item.textFile),
    text: textFile(pkg.files.get(item.textFile), item.textFile),
    variables: item.initialStateFile
      ? recordJsonFile(pkg.files.get(item.initialStateFile), item.initialStateFile)
      : {},
    source_index: index,
    audience: item.audience,
    default: pkg.openings.defaultOpeningIds.individual === item.id || pkg.openings.defaultOpeningIds.group === item.id,
    default_for: [
      ...(pkg.openings.defaultOpeningIds.individual === item.id ? ["individual" as const] : []),
      ...(pkg.openings.defaultOpeningIds.group === item.id ? ["group" as const] : []),
    ],
  }));
  const defaultOpening = openings.find((opening) => opening.id === pkg.openings.defaultOpeningIds.individual)
    ?? openings.find((opening) => opening.audience === "both" || opening.audience === "individual")
    ?? openings[0];
  const worldbookResources = resources.filter((resource) => resource.kind === "worldbook");
  const regexResources = resources.filter((resource) => resource.kind === "regex_profile");
  const tavernHeadless: Record<string, unknown> = {
    nativePackage: {
      cardId: snapshot.cardId,
      revision: snapshot.revision,
      packageId: pkg.manifest.packageId,
      worldbooks: worldbookResources.map((resource) => ({
        bookId: resource.packageResourceId,
        resourceId: resource.localId,
        versionId: resource.localVersionId,
        ordinal: resource.ordinal,
        enabled: resource.enabled,
      })),
      regexProfiles: regexResources.map((resource) => ({
        path: resource.packageResourceId,
        resourceId: resource.localId,
        versionId: resource.localVersionId,
        ordinal: resource.ordinal,
      })),
      frontendManifestPath: pkg.frontendManifest ? pkg.manifest.frontend : null,
    },
    openings: {
      defaultOpeningIds: pkg.openings.defaultOpeningIds,
      items: openings.map(({ id, display_text, variables, ...item }) => ({
        id, displayText: display_text, variables, ...item,
      })),
    },
  };
  if (pkg.stateUpdateProfile) {
    tavernHeadless.stateUpdate = {
      profile: {
        id: `${pkg.manifest.packageId}:state-update`,
        ...pkg.stateUpdateProfile,
        modelSlot: stateUpdaterSlot,
      },
      files: {},
    };
  }
  if (pkg.controllerConfig) tavernHeadless.promptController = pkg.controllerConfig;
  const character = pkg.character;
  const rawSnapshot: SessionCharacterSnapshot = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogue: character.exampleDialogue,
    systemPrompt: character.systemPrompt,
    postHistoryInstructions: character.postHistoryInstructions,
    creatorNotes: character.creatorNotes,
    creator: character.creator,
    characterVersion: character.characterVersion,
    tags: character.tags,
    nickname: character.nickname,
    source: character.source ? [character.source] : undefined,
    primaryGreeting: defaultOpening?.text,
    greeting: defaultOpening?.text,
    extensions: { tavern_headless: tavernHeadless },
  };
  const characterSnapshot = normalizeSessionCharacterSnapshot(rawSnapshot);
  if (!characterSnapshot) throw new Error("Native package character could not be mapped to a runtime snapshot.");
  return {
    accountId: snapshot.accountId,
    cardId: snapshot.cardId,
    revision: snapshot.revision,
    packageId: pkg.manifest.packageId,
    characterId: snapshot.characterId,
    characterVersionId,
    characterSnapshot,
    openings: buildRoleReleaseOpenings(characterSnapshot),
    resources,
  };
}

function textFile(bytes: Uint8Array | undefined, path: string): string {
  if (!bytes) throw new Error(`Native package file ${path} is missing.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function recordJsonFile(bytes: Uint8Array | undefined, path: string): Record<string, unknown> {
  const value = JSON.parse(textFile(bytes, path)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Native opening state ${path} must be an object.`);
  return value as Record<string, unknown>;
}

async function createSession(
  db: AppDb,
  accountId: string,
  app: FastifyInstance,
  headers: Record<string, string>,
  release: RoleReleaseSnapshot,
  input: CreateRoleReleaseSessionBody & { session_type?: "individual" | "group" },
  options: SessionCreatedOptions,
): Promise<{ sessionId: string; openingId: string | null }> {
  const userId = input.user_id ?? release.default_user_id;
  const userResponse = await app.inject({
    method: "GET", url: `/users/${encodeURIComponent(userId)}`, headers,
  });
  const userBody = parseResponseData(userResponse.body, "Persona response is invalid.");
  if (userBody.status !== "active") throw new Error(`Persona ${userId} is inactive.`);
  const userSnapshot = userBody.snapshot;
  if (!userSnapshot || typeof userSnapshot !== "object" || Array.isArray(userSnapshot)) throw new Error("Persona snapshot is invalid.");
  const selectedOpening = selectRoleReleaseOpening(
    release.opening_snapshots,
    input.opening_id,
    input.session_type,
  );
  if (input.opening_id && !selectedOpening) {
    throw new NativeCardServiceError("ROLE_RELEASE_OPENING_NOT_FOUND", 404, {
      opening_id: input.opening_id,
    });
  }
  const openingId = selectedOpening?.id ?? null;
  const nativePackage = nativeCardRuntimePackageSchema.parse(
    (release.character_snapshot.extensions?.tavern_headless as Record<string, unknown> | undefined)?.nativePackage,
  );
    const sessionMetadata = {
    native_card: {
      card_id: nativePackage.cardId,
      revision: nativePackage.revision,
      package: nativePackage,
    },
      model_capabilities: release.model_capabilities ?? null,
      opening_id: openingId,
      ...(release.state_preset_id && release.state_preset_version_id
        ? {
            statePrompt: {
              presetId: release.state_preset_id,
              presetVersionId: release.state_preset_version_id,
              historyTurns: release.state_history_turns,
            },
          }
        : {}),
    };
  const sessionResponse = await app.inject({
    method: "POST", url: "/sessions", headers,
    payload: {
      title: release.name,
      character_id: release.character_id,
      character_version_id: release.character_version_id,
      character_sync_policy: "pin",
      character_snapshot: release.character_snapshot,
      user_id: userId,
      user_snapshot: userSnapshot,
      preset_id: release.preset_id,
      preset_version_id: release.preset_version_id,
      regex_profile_id: release.regex_profile_id,
      regex_profile_version_id: release.regex_profile_version_id,
      worldbook_profile_id: release.worldbook_id,
      worldbook_version_id: release.worldbook_version_id,
      deep_binding: true,
      prompt_mode: release.prompt_mode,
      metadata: sessionMetadata,
    },
  });
  if (sessionResponse.statusCode >= 400) throw new Error(`Could not create native card preview session: ${sessionResponse.body}`);
  const sessionBody = JSON.parse(sessionResponse.body) as { data?: Record<string, unknown> };
  const session = sessionBody.data;
  if (!session || typeof session.id !== "string") throw new Error("Session response did not include a session id.");
  const sessionId = session.id;
  try {
    persistRoleModelCapabilitySessionSnapshot(db, {
      sessionId,
      accountId,
      metadata: sessionMetadata,
    });
    for (const binding of release.model_slots) {
      const activation = await app.inject({
        method: "POST", url: `/llm-profiles/${encodeURIComponent(binding.profile_id)}/activate`, headers,
        payload: { scope: "session", session_id: sessionId, instance_slot: binding.slot, params: binding.params, profile_snapshot: binding.profile_snapshot },
      });
      if (activation.statusCode >= 400) throw new Error(activation.body);
    }
    const boundSlots = new Set(release.model_slots.map((binding) => binding.slot));
    const updaterSlot = stateUpdaterSlot;
    for (const slot of roleReleaseModelSlots) {
      const instance = await app.inject({
        method: "PUT", url: `/llm-instances/${encodeURIComponent(slot)}`, headers,
        payload: { scope: "session", session_id: sessionId, enabled: slot !== "*" && slot !== updaterSlot && (boundSlots.has(slot) || boundSlots.has("*")), preset_id: null, model_id_override: null, params: null, capabilities: null },
      });
      if (instance.statusCode >= 400) throw new Error(instance.body);
    }
    await options.onSessionCreated?.({ session, release, opening: selectedOpening ?? null, headers });
    return { sessionId, openingId };
  } catch (error) {
    let deleteResponse: Awaited<ReturnType<typeof app.inject>>;
    try {
      deleteResponse = await app.inject({ method: "DELETE", url: `/sessions/${encodeURIComponent(sessionId)}`, headers });
    } catch (cleanupError) {
      throw new NativeCardServiceError("ROLE_RELEASE_SESSION_CLEANUP_FAILED", 500, {
        session_id: sessionId,
        preview_character_version_id: release.character_version_id,
        preview_materialization_retained: true,
      }, cleanupError);
    }
    if (deleteResponse.statusCode >= 400) {
      throw new NativeCardServiceError("ROLE_RELEASE_SESSION_CLEANUP_FAILED", 500, {
        session_id: sessionId,
        preview_character_version_id: release.character_version_id,
        delete_status: deleteResponse.statusCode,
        preview_materialization_retained: true,
      }, error);
    }
    throw error;
  }
}

function parseResponseData(body: string, message: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(body) as unknown; } catch { throw new Error(message); }
  if (!parsed || typeof parsed !== "object" || !("data" in parsed)) throw new Error(message);
  const data = (parsed as { data: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(message);
  return data as Record<string, unknown>;
}
