import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import {
  RoleModelCapabilitiesToolProvider,
  type ToolPermissions,
} from "@tavern/core";
import {
  roleModelCapabilitiesGrantSchema,
  roleModelCapabilityProtectedMetadataRootFields,
  roleModelCapabilitySessionMetadataSchema,
  roleModelCapabilitySessionSnapshotSchema,
  roleModelCapabilityLimitsSchema,
  roleModelCapabilityLimitKeys,
  type RoleModelCapabilitiesGrant,
  type RoleModelCapabilitySessionSnapshot,
  type RoleModelCapabilitiesSystemConfig,
  type RoleModelCapabilityLimits,
  type RoleModelCapabilityName,
  type RoleModelCapabilityTransport,
} from "@tavern/shared";

import type { AppDb } from "../db/client.js";
import { roleReleases } from "../db/role-release-schema.js";
import { nativeCardVersionBindings } from "../db/native-card-runtime-schema.js";
import { nativeCards } from "../db/native-card-schema.js";
import { roleAppDrafts } from "../db/role-app-schema.js";
import { characterVersions, characters, sessions } from "../db/schema.js";
import { loadRoleModelCapabilitiesSystemConfig } from "../config.js";

import { getSessionResourceAccountId } from "./public-role-session-binding.js";
const LIMIT_KEYS = roleModelCapabilityLimitKeys;

export interface RoleModelCapabilitiesRuntime {
  /** Frozen role/session capability grant with per-request limits applied. */
  modelCapabilities: RoleModelCapabilitiesGrant;
  /** Provider reserved for random and calculate in this role session. */
  provider: RoleModelCapabilitiesToolProvider;
  /** Per-turn permissions matching the frozen grant. */
  permissions: ToolPermissions;
}

export class RoleModelCapabilitiesBuildError extends Error {
  readonly code = "LIMIT_EXCEEDED" as const;

  constructor(message: string) {
    super(message);
    this.name = "RoleModelCapabilitiesBuildError";
  }
}

type RoleOrigin =
  | { kind: "release"; id: string }
  | { kind: "preview"; draftId: string }
  | { kind: "native_card"; cardId: string; revision: number }
  | { kind: "invalid" };

interface SessionRecord {
  characterId: string | null;
  characterVersionId: string | null;
  metadataJson: string | null;
  roleModelCapabilitiesSnapshotJson: string | null;
}

/**
 * Build the dedicated role capability provider for a role session.
 * Generic sessions return null. A session carrying any role origin marker
 * always returns a provider, even when its frozen grant is absent or revoked,
 * so its reserved tool names cannot fall through to a mixed global registry.
 */
export async function buildRoleModelCapabilities(
  db: AppDb,
  sessionId: string,
  accountId: string,
  requestLimits?: Partial<RoleModelCapabilityLimits>,
): Promise<RoleModelCapabilitiesRuntime | null> {
  const session = db
    .select({
      characterId: sessions.characterId,
      characterVersionId: sessions.characterVersionId,
      metadataJson: sessions.metadataJson,
      roleModelCapabilitiesSnapshotJson:
        sessions.roleModelCapabilitiesSnapshotJson,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
    .get();
  if (!session) return null;

  const metadata = parseRecord(session.metadataJson);
  const privateSnapshotJson = session.roleModelCapabilitiesSnapshotJson;
  const hasPrivateSnapshot = privateSnapshotJson !== null;
  const privateSnapshot = parseCapabilitySessionSnapshot(privateSnapshotJson);
  const origin = hasPrivateSnapshot
    ? privateSnapshot
      ? readRoleOrigin(privateSnapshot.metadata)
      : { kind: "invalid" as const }
    : readRoleOrigin(metadata);
  if (!origin) return null;

  const systemConfig = loadRoleModelCapabilitiesSystemConfig();
  const pinnedIdentityMatches = !hasPrivateSnapshot || Boolean(
    privateSnapshot &&
    session.characterId === privateSnapshot.character_id &&
    session.characterVersionId === privateSnapshot.character_version_id,
  );
  const snapshotGrant = privateSnapshot
    ? readGrant(privateSnapshot.metadata.model_capabilities)
    : null;
  const resolveCurrentGrant = () =>
    hasPrivateSnapshot && pinnedIdentityMatches && privateSnapshot
      ? resolveLiveGrant(
          db,
          session,
          privateSnapshot.metadata,
          origin,
          getSessionResourceAccountId(db, accountId, sessionId),
        )
      : null;
  const liveGrant = resolveCurrentGrant();
  const sourceGrant = hasPrivateSnapshot && pinnedIdentityMatches && snapshotGrant
    ? intersectGrants(snapshotGrant, liveGrant, systemConfig)
    : disabledGrant(systemConfig, null);
  const boundedRequestLimits = validateRequestLimits(
    requestLimits,
    { ...limitsFromSystem(systemConfig), ...sourceGrant.limits },
    systemConfig,
  );
  const modelCapabilities = applyRequestLimits(
    sourceGrant,
    boundedRequestLimits,
    systemConfig,
  );

  const provider = new RoleModelCapabilitiesToolProvider({
    systemConfig,
    grant: modelCapabilities,
    resolveGrant: async (context) => {
      if (context.sessionId !== sessionId || context.accountId !== accountId)
        return null;
      const currentConfig = loadRoleModelCapabilitiesSystemConfig();
      const currentGrant = resolveCurrentGrant();
      const frozen = hasPrivateSnapshot && pinnedIdentityMatches && snapshotGrant
        ? intersectGrants(snapshotGrant, currentGrant, currentConfig)
        : disabledGrant(currentConfig, modelCapabilities.transport);
      if (!frozen.enabled)
        return disabledGrant(currentConfig, modelCapabilities.transport);
      return applyRequestLimits(frozen, boundedRequestLimits, currentConfig);
    },
  });

  return {
    modelCapabilities,
    provider,
    permissions: {
      enabled:
        modelCapabilities.enabled && modelCapabilities.allowed.length > 0,
      slotAllowList: { narrator: [...modelCapabilities.allowed] },
      maxCallsPerTurn: modelCapabilities.limits?.maxCallsPerTurn,
      maxStepsPerGeneration: modelCapabilities.limits?.maxStepsPerGeneration,
      allowIrreversible: false,
    },
  };
}

export function persistRoleModelCapabilitySessionSnapshot(
  db: AppDb,
  input: {
    sessionId: string;
    accountId: string;
    metadata: Record<string, unknown>;
  },
): RoleModelCapabilitySessionSnapshot {
  return db.transaction((tx) => {
    const session = tx
      .select({
        characterId: sessions.characterId,
        characterVersionId: sessions.characterVersionId,
        metadataJson: sessions.metadataJson,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.accountId, input.accountId),
        ),
      )
      .get();
    if (!session) throw new Error();

    const protectedFields = Object.fromEntries(
      roleModelCapabilityProtectedMetadataRootFields
        .filter((field) => Object.hasOwn(input.metadata, field))
        .map((field) => [field, input.metadata[field]]),
    );
    const metadata = roleModelCapabilitySessionMetadataSchema.parse(
      protectedFields,
    );
    const normalizedGrant = metadata.model_capabilities
      ? normalizeRoleModelCapabilitiesGrant(metadata.model_capabilities)
      : null;
    const trustedMetadata = roleModelCapabilitySessionMetadataSchema.parse({
      ...metadata,
      model_capabilities: normalizedGrant,
    });
    const snapshot = roleModelCapabilitySessionSnapshotSchema.parse({
      metadata: trustedMetadata,
      character_id: session.characterId,
      character_version_id: session.characterVersionId,
    });

    const nextMetadata = parseRecord(session.metadataJson);
    for (const field of roleModelCapabilityProtectedMetadataRootFields)
      delete nextMetadata[field];
    Object.assign(nextMetadata, trustedMetadata);
    const updated = tx
      .update(sessions)
      .set({
        roleModelCapabilitiesSnapshotJson: JSON.stringify(snapshot),
        metadataJson: JSON.stringify(nextMetadata),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.accountId, input.accountId),
        ),
      )
      .run();
    if (updated.changes !== 1) throw new Error();
    return snapshot;
  });
}

export function isRoleModelCapabilitySessionMetadataPatchAllowed(
  snapshotJson: string | null,
  nextMetadata: unknown,
): boolean {
  if (snapshotJson === null) return true;
  const snapshot = parseCapabilitySessionSnapshot(snapshotJson);
  if (!snapshot || !isPlainRecord(nextMetadata)) return false;
  const snapshotMetadata = snapshot.metadata as unknown as Record<
    string,
    unknown
  >;
  return roleModelCapabilityProtectedMetadataRootFields.every((field) =>
    isDeepStrictEqual(
      Object.hasOwn(snapshotMetadata, field)
        ? snapshotMetadata[field]
        : undefined,
      Object.hasOwn(nextMetadata, field)
        ? nextMetadata[field]
        : undefined,
    ),
  );
}

/** Validate a published grant against the current system policy and freeze all limits. */
export function normalizeRoleModelCapabilitiesGrant(
  grant: RoleModelCapabilitiesGrant | null | undefined,
  systemConfig: RoleModelCapabilitiesSystemConfig = loadRoleModelCapabilitiesSystemConfig(),
): RoleModelCapabilitiesGrant | null {
  if (grant == null) return null;
  const parsedResult = roleModelCapabilitiesGrantSchema.safeParse(grant);
  if (!parsedResult.success) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }
  const parsed = parsedResult.data;
  if (
    parsed.slot !== systemConfig.slot ||
    !systemConfig.transports.includes(parsed.transport)
  ) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }
  if (parsed.allowed.some((name) => !systemConfig.allowed.includes(name))) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }

  const limits = limitsFromSystem(systemConfig);
  for (const key of LIMIT_KEYS) {
    const requested = parsed.limits?.[key];
    if (requested === undefined) continue;
    if (requested > limits[key]) {
      throw new RoleModelCapabilitiesBuildError(
        systemConfig.messages.LIMIT_EXCEEDED,
      );
    }
    limits[key] = requested;
  }
  if (limits.maxResultBytes < systemConfig.limits.minResultBytes) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }
  return { ...parsed, allowed: [...parsed.allowed], limits };
}

function readRoleOrigin(metadata: Record<string, unknown>): RoleOrigin | null {
  if (Object.hasOwn(metadata, "role_release_id")) {
    return typeof metadata.role_release_id === "string" &&
      metadata.role_release_id.length > 0
      ? { kind: "release", id: metadata.role_release_id }
      : { kind: "invalid" };
  }
  if (Object.hasOwn(metadata, "role_preview")) {
    const preview = parseRecord(metadata.role_preview);
    return typeof preview.draft_id === "string" &&
      preview.draft_id.length > 0 &&
      typeof preview.creator_id === "string" &&
      preview.creator_id.length > 0
      ? {
          kind: "preview",
          draftId: preview.draft_id,
        }
      : { kind: "invalid" };
  }
  if (Object.hasOwn(metadata, "native_card")) {
    const card = parseRecord(metadata.native_card);
    const revision = card.revision;
    return typeof card.card_id === "string" &&
      card.card_id.length > 0 &&
      typeof revision === "number" &&
      Number.isSafeInteger(revision) &&
      revision > 0
      ? { kind: "native_card", cardId: card.card_id, revision }
      : { kind: "invalid" };
  }
  return null;
}

function resolveLiveGrant(
  db: AppDb,
  session: SessionRecord,
  metadata: Record<string, unknown>,
  origin: RoleOrigin,
  accountId: string,
): RoleModelCapabilitiesGrant | null {
  if (origin.kind === "release") {
    const release = db
      .select({
        id: roleReleases.id,
        characterId: roleReleases.characterId,
        characterVersionId: roleReleases.characterVersionId,
        modelCapabilitiesJson: roleReleases.modelCapabilitiesJson,
        modelCapabilitiesRevokedAt: roleReleases.modelCapabilitiesRevokedAt,
      })
      .from(roleReleases)
      .where(
        and(
          eq(roleReleases.id, origin.id),
          eq(roleReleases.accountId, accountId),
        ),
      )
      .get();
    if (
      !release ||
      release.modelCapabilitiesRevokedAt !== null ||
      release.characterId !== session.characterId ||
      release.characterVersionId !== session.characterVersionId
    )
      return null;
    return parseStoredGrant(release.modelCapabilitiesJson);
  }

  if (origin.kind === "preview") {
    const draft = db
      .select()
      .from(roleAppDrafts)
      .where(
        and(
          eq(roleAppDrafts.id, origin.draftId),
          eq(roleAppDrafts.accountId, accountId),
        ),
      )
      .get();
    if (!draft) return null;
    const pinnedVersion = session.characterId && session.characterVersionId
      ? db
          .select({ id: characterVersions.id })
          .from(characterVersions)
          .innerJoin(characters, eq(characters.id, characterVersions.characterId))
          .where(
            and(
              eq(characterVersions.id, session.characterVersionId),
              eq(characterVersions.characterId, session.characterId),
              eq(characters.accountId, accountId),
            ),
          )
          .get()
      : undefined;
    if (!pinnedVersion)
      return null;
    return readGrant(parseRecord(draft.inputJson).model_capabilities);
  }

  if (origin.kind === "native_card") {
    const card = db
      .select({
        id: nativeCards.id,
        characterId: nativeCards.characterId,
      })
      .from(nativeCards)
      .where(
        and(
          eq(nativeCards.id, origin.cardId),
          eq(nativeCards.accountId, accountId),
        ),
      )
      .get();
    if (
      !card ||
      card.characterId !== session.characterId
    )
      return null;
    const binding = session.characterVersionId && session.characterId
      ? db
          .select({
            characterVersionId: nativeCardVersionBindings.characterVersionId,
            characterId: characterVersions.characterId,
          })
          .from(nativeCardVersionBindings)
          .innerJoin(
            characterVersions,
            eq(
              characterVersions.id,
              nativeCardVersionBindings.characterVersionId,
            ),
          )
          .where(
            and(
              eq(
                nativeCardVersionBindings.characterVersionId,
                session.characterVersionId,
              ),
              eq(nativeCardVersionBindings.accountId, accountId),
              eq(nativeCardVersionBindings.cardId, origin.cardId),
              eq(nativeCardVersionBindings.revision, origin.revision),
              eq(characterVersions.characterId, card.characterId),
            ),
          )
          .get()
      : undefined;
    if (!binding) return null;
    return readGrant(metadata.model_capabilities);
  }

  return null;
}

function intersectGrants(
  frozen: RoleModelCapabilitiesGrant,
  live: RoleModelCapabilitiesGrant | null,
  systemConfig: RoleModelCapabilitiesSystemConfig,
): RoleModelCapabilitiesGrant {
  const transport = frozen.transport;
  const liveEnabled =
    live !== null &&
    live.enabled &&
    live.slot === frozen.slot &&
    live.transport === transport;
  const allowed: RoleModelCapabilityName[] =
    liveEnabled && frozen.enabled && systemConfig.enabled
      ? frozen.allowed.filter(
          (name) =>
            live.allowed.includes(name) && systemConfig.allowed.includes(name),
        )
      : [];
  const limits = limitsFromSystem(systemConfig);
  for (const key of LIMIT_KEYS) {
    limits[key] = Math.min(
      limits[key],
      frozen.limits?.[key] ?? limits[key],
      live?.limits?.[key] ?? limits[key],
    );
  }
  if (limits.maxResultBytes < systemConfig.limits.minResultBytes) {
    return disabledGrant(systemConfig, transport);
  }
  const transportSupported = systemConfig.transports.includes(transport);
  return {
    enabled: allowed.length > 0 && transportSupported,
    allowed,
    slot: "narrator",
    transport: transportSupported ? transport : systemConfig.transports[0]!,
    limits,
  };
}

function validateRequestLimits(
  requestLimits: Partial<RoleModelCapabilityLimits> | undefined,
  maximum: RoleModelCapabilityLimits,
  systemConfig: RoleModelCapabilitiesSystemConfig,
): Partial<RoleModelCapabilityLimits> | undefined {
  if (requestLimits === undefined) return undefined;
  const parsedResult = roleModelCapabilityLimitsSchema.safeParse(requestLimits);
  if (!parsedResult.success) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }
  const bounded = parsedResult.data;
  for (const key of LIMIT_KEYS) {
    const requested = bounded[key];
    if (requested !== undefined && requested > maximum[key]) {
      throw new RoleModelCapabilitiesBuildError(
        systemConfig.messages.LIMIT_EXCEEDED,
      );
    }
  }
  if (
    bounded.maxResultBytes !== undefined &&
    bounded.maxResultBytes < systemConfig.limits.minResultBytes
  ) {
    throw new RoleModelCapabilitiesBuildError(
      systemConfig.messages.LIMIT_EXCEEDED,
    );
  }
  return bounded;
}

function applyRequestLimits(
  grant: RoleModelCapabilitiesGrant,
  requestLimits: Partial<RoleModelCapabilityLimits> | undefined,
  systemConfig: RoleModelCapabilitiesSystemConfig,
): RoleModelCapabilitiesGrant {
  const limits = limitsFromSystem(systemConfig);
  for (const key of LIMIT_KEYS) {
    limits[key] = Math.min(
      limits[key],
      grant.limits?.[key] ?? limits[key],
      requestLimits?.[key] ?? limits[key],
    );
  }
  if (limits.maxResultBytes < systemConfig.limits.minResultBytes) {
    return disabledGrant(systemConfig, grant.transport);
  }
  return { ...grant, allowed: [...grant.allowed], limits };
}

function disabledGrant(
  systemConfig: RoleModelCapabilitiesSystemConfig,
  transport: RoleModelCapabilityTransport | null,
): RoleModelCapabilitiesGrant {
  const selectedTransport =
    transport && systemConfig.transports.includes(transport)
      ? transport
      : systemConfig.transports[0]!;
  return {
    enabled: false,
    allowed: [],
    slot: "narrator",
    transport: selectedTransport,
    limits: limitsFromSystem(systemConfig),
  };
}

function limitsFromSystem(
  config: RoleModelCapabilitiesSystemConfig,
): RoleModelCapabilityLimits {
  const { minResultBytes: _minResultBytes, ...limits } = config.limits;
  return { ...limits };
}

function readGrant(value: unknown): RoleModelCapabilitiesGrant | null {
  const parsed = roleModelCapabilitiesGrantSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseStoredGrant(
  value: string | null | undefined,
): RoleModelCapabilitiesGrant | null {
  if (typeof value !== "string") return null;
  try {
    return readGrant(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseCapabilitySessionSnapshot(
  value: string | null,
): RoleModelCapabilitySessionSnapshot | null {
  if (value === null) return null;
  try {
    const parsed = roleModelCapabilitySessionSnapshotSchema.safeParse(
      JSON.parse(value),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRecord(
  value: string | null | undefined | unknown,
): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isPlainRecord(value) ? value : {};
}
