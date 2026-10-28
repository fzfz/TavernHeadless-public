import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { roleReleases } from "../db/role-release-schema.js";
import {
  getGreetingCandidates,
  getPrimaryGreeting,
  type SessionCharacterSnapshot,
} from "../lib/character-snapshot.js";
import type {
  CreateRoleReleaseBody,
  RoleReleaseModelSlot,
} from "../routes/schemas/role-releases.js";
import type { RoleModelCapabilitiesGrant } from "@tavern/shared";
import {
  apiErrorMessages,
  roleReleaseOpeningSnapshotSchema,
  roleStatePolicy,
  roleModelCapabilitiesGrantSchema,
  type RoleReleaseOpeningSnapshot as SharedRoleReleaseOpeningSnapshot,
} from "@tavern/shared";

export type RoleReleaseOpening = {
  id: string;
  title: string;
  kind: "story" | "introduction";
  summary: string;
  display_text: string;
  default: boolean;
  audience?: "individual" | "group" | "both";
};

export type RoleReleaseOpeningSnapshot = SharedRoleReleaseOpeningSnapshot;

export type RoleRelease = {
  id: string;
  name: string;
  character_id: string;
  character_version_id: string;
  character_snapshot: SessionCharacterSnapshot;
  preset_id: string;
  preset_version_id: string;
  state_preset_id: string | null;
  state_preset_version_id: string | null;
  state_history_turns: number;
  regex_profile_id: string | null;
  regex_profile_version_id: string | null;
  worldbook_id: string | null;
  worldbook_version_id: string | null;
  prompt_mode: CreateRoleReleaseBody["prompt_mode"];
  model_capabilities: RoleModelCapabilitiesGrant | null;
  model_slots: RoleReleaseModelSlot[];
  default_user_id: string;
  default_user_snapshot: Record<string, unknown>;
  openings: RoleReleaseOpening[];
  created_at: number;
};

export type RoleReleaseSnapshot = RoleRelease & {
  opening_snapshots: RoleReleaseOpeningSnapshot[];
};

type RoleReleaseRow = {
  id: string;
  account_id: string;
  name: string;
  character_id: string;
  character_version_id: string;
  character_snapshot_json: string;
  preset_id: string;
  preset_version_id: string;
  state_preset_id: string | null;
  state_preset_version_id: string | null;
  state_history_turns: number;
  regex_profile_id: string | null;
  regex_profile_version_id: string | null;
  worldbook_id: string | null;
  worldbook_version_id: string | null;
  prompt_mode: CreateRoleReleaseBody["prompt_mode"];
  model_slots_json: string;
  default_user_id: string;
  default_user_snapshot_json: string;
  openings_json: string;
  model_capabilities_json: string | null;
  created_at: number;
  is_active: number;
};

export type CreateRoleReleaseSnapshot = Omit<
  CreateRoleReleaseBody,
  "model_slots"
> & {
  accountId: string;
  modelSlots: RoleReleaseModelSlot[];
  characterSnapshot: SessionCharacterSnapshot;
  defaultUserSnapshot: Record<string, unknown>;
  openings: RoleReleaseOpeningSnapshot[];
  now?: number;
};

type OpeningMetadata = {
  defaultOpeningId?: unknown;
  items?: unknown;
};

export class RoleReleaseService {
  constructor(private readonly db: AppDb) {}

  /**
   * Creates the release in a caller-owned transaction. Native package
   * publication uses this so the immutable character/resource snapshot, the
   * active release row, and its publication record commit together.
   */
  createInTransaction(
    tx: DbExecutor,
    input: CreateRoleReleaseSnapshot,
  ): RoleReleaseSnapshot {
    const id = nanoid();
    const createdAt = input.now ?? Date.now();
    const modelSlots: RoleReleaseModelSlot[] = input.modelSlots.map(
      (binding) => ({ ...binding, params: binding.params ?? null }),
    );
    const release: RoleRelease = {
      id,
      name: input.name,
      character_id: input.character_id,
      character_version_id: input.character_version_id,
      character_snapshot: input.characterSnapshot,
      preset_id: input.preset_id,
      preset_version_id: input.preset_version_id,
      state_preset_id: input.statePresetId ?? null,
      state_preset_version_id: input.statePresetVersionId ?? null,
      state_history_turns:
        input.stateHistoryTurns ?? roleStatePolicy.defaultHistoryTurns,
      regex_profile_id: input.regex_profile_id,
      regex_profile_version_id: input.regex_profile_version_id,
      worldbook_id: input.worldbook_id,
      worldbook_version_id: input.worldbook_version_id,
      prompt_mode: input.prompt_mode,
      model_capabilities: input.model_capabilities ?? null,
      model_slots: modelSlots,
      default_user_id: input.default_user_id,
      default_user_snapshot: input.defaultUserSnapshot,
      openings: input.openings.map(toPublicOpening),
      created_at: createdAt,
    };
    tx.update(roleReleases)
      .set({ isActive: false })
      .where(
        and(
          eq(roleReleases.accountId, input.accountId),
          eq(roleReleases.characterId, input.character_id),
        ),
      )
      .run();
    tx.insert(roleReleases)
      .values({
        id,
        accountId: input.accountId,
        name: input.name,
        characterId: input.character_id,
        characterVersionId: input.character_version_id,
        characterSnapshotJson: JSON.stringify(input.characterSnapshot),
        presetId: input.preset_id,
        presetVersionId: input.preset_version_id,
        statePresetId: input.statePresetId ?? null,
        statePresetVersionId: input.statePresetVersionId ?? null,
        stateHistoryTurns:
          input.stateHistoryTurns ?? roleStatePolicy.defaultHistoryTurns,
        regexProfileId: input.regex_profile_id,
        regexProfileVersionId: input.regex_profile_version_id,
        worldbookId: input.worldbook_id,
        worldbookVersionId: input.worldbook_version_id,
        promptMode: input.prompt_mode,
        modelCapabilitiesJson: input.model_capabilities
          ? JSON.stringify(input.model_capabilities)
          : null,
        modelSlotsJson: JSON.stringify(modelSlots),
        defaultUserId: input.default_user_id,
        defaultUserSnapshotJson: JSON.stringify(input.defaultUserSnapshot),
        // Keep the private opening source index and initial variables in the
        // immutable database snapshot. The public `openings` field stays
        // stripped, while session creation reloads this complete snapshot.
        openingsJson: JSON.stringify(input.openings),
        createdAt: createdAt,
        isActive: true,
      })
      .run();
    return { ...release, opening_snapshots: input.openings };
  }

  create(input: CreateRoleReleaseSnapshot): RoleReleaseSnapshot {
    const id = nanoid();
    const createdAt = input.now ?? Date.now();
    const modelSlots: RoleReleaseModelSlot[] = input.modelSlots.map(
      (binding) => ({
        ...binding,
        params: binding.params ?? null,
      }),
    );

    this.db.$client.transaction(() => {
      this.db.$client
        .prepare(
          "UPDATE role_release SET is_active = 0 WHERE account_id = ? AND character_id = ?",
        )
        .run(input.accountId, input.character_id);
      this.db.$client
        .prepare(
          `
      INSERT INTO role_release (
        id, account_id, name, character_id, character_version_id,
        character_snapshot_json, preset_id, preset_version_id,
        regex_profile_id, regex_profile_version_id, worldbook_id,
        worldbook_version_id, prompt_mode, model_capabilities_json, model_slots_json,
        state_preset_id, state_preset_version_id, state_history_turns,
        default_user_id, default_user_snapshot_json, openings_json, created_at, is_active
      ) VALUES (
        @id, @account_id, @name, @character_id, @character_version_id,
        @character_snapshot_json, @preset_id, @preset_version_id,
        @regex_profile_id, @regex_profile_version_id, @worldbook_id,
        @worldbook_version_id, @prompt_mode, @model_capabilities_json, @model_slots_json,
        @state_preset_id, @state_preset_version_id, @state_history_turns,
        @default_user_id, @default_user_snapshot_json, @openings_json, @created_at, 1
      )
    `,
        )
        .run({
          id,
          account_id: input.accountId,
          name: input.name,
          character_id: input.character_id,
          character_version_id: input.character_version_id,
          character_snapshot_json: JSON.stringify(input.characterSnapshot),
          preset_id: input.preset_id,
          preset_version_id: input.preset_version_id,
          regex_profile_id: input.regex_profile_id,
          regex_profile_version_id: input.regex_profile_version_id,
          worldbook_id: input.worldbook_id,
          worldbook_version_id: input.worldbook_version_id,
          prompt_mode: input.prompt_mode,
          model_capabilities_json: input.model_capabilities
            ? JSON.stringify(input.model_capabilities)
            : null,
          model_slots_json: JSON.stringify(modelSlots),
          state_preset_id: input.statePresetId ?? null,
          state_preset_version_id: input.statePresetVersionId ?? null,
          state_history_turns:
            input.stateHistoryTurns ?? roleStatePolicy.defaultHistoryTurns,
          default_user_id: input.default_user_id,
          default_user_snapshot_json: JSON.stringify(input.defaultUserSnapshot),
          openings_json: JSON.stringify(input.openings),
          created_at: createdAt,
        });
    })();
    const created = this.get(input.accountId, id);
    if (!created) {
      throw new Error("Failed to read created role release");
    }
    return created;
  }

  list(
    accountId: string,
    latestPerCharacter = false,
    activeOnly = false,
  ): RoleReleaseSnapshot[] {
    const rows = this.db.$client
      .prepare(
        `
      SELECT * FROM role_release
      WHERE account_id = ?
      ORDER BY created_at DESC, rowid DESC
    `,
      )
      .all(accountId) as RoleReleaseRow[];
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        if (activeOnly && !row.is_active) return false;
        if (!latestPerCharacter) return true;
        if (seen.has(row.character_id)) return false;
        seen.add(row.character_id);
        return true;
      })
      .map(toRoleReleaseSnapshot);
  }


  publicCatalogue(query: { keyword?: string; tag?: string; limit?: number; offset?: number } = {}) {
    const rows = this.db.$client.prepare(`
      SELECT role_release.* FROM role_release
      JOIN character ON character.id = role_release.character_id
      JOIN account ON account.id = role_release.account_id
      WHERE role_release.is_active = 1 AND character.status = 'active' AND account.status = 'active'
      ORDER BY role_release.created_at DESC, role_release.rowid DESC
    `).all() as RoleReleaseRow[];
    const roles = rows.map(toRoleReleaseSnapshot).map(toPublicCatalogueRole);
    const tags = [...new Set(roles.flatMap(role => role.tags))].sort();
    const keyword = query.keyword?.trim().toLocaleLowerCase() ?? "";
    const filtered = roles.filter(role =>
      (!query.tag || role.tags.includes(query.tag)) &&
      (!keyword || [role.name, role.description, ...role.tags, ...role.openings.map(item => item.summary)].some(value => value.toLocaleLowerCase().includes(keyword)))
    );
    const limit = query.limit ?? 24;
    const offset = query.offset ?? 0;
    return { data: filtered.slice(offset, offset + limit), meta: { total: filtered.length, limit, offset, tags } };
  }

  getPublicRole(id: string): import("@tavern/shared").PublicRole | null {
    const found = this.getPublishedSnapshot(id);
    return found ? toPublicCatalogueRole(found.snapshot) : null;
  }

  getPublishedSnapshot(id: string): { snapshot: RoleReleaseSnapshot; accountId: string } | null {
    const row = this.db.$client.prepare(`
      SELECT role_release.* FROM role_release
      JOIN character ON character.id = role_release.character_id
      JOIN account ON account.id = role_release.account_id
      WHERE role_release.id = ? AND role_release.is_active = 1 AND character.status = 'active' AND account.status = 'active'
      LIMIT 1
    `).get(id) as RoleReleaseRow | undefined;
    return row ? { snapshot: toRoleReleaseSnapshot(row), accountId: row.account_id } : null;
  }

  isActive(accountId: string, id: string): boolean {
    return !!this.db.$client
      .prepare(
        "SELECT 1 FROM role_release WHERE account_id = ? AND id = ? AND is_active = 1",
      )
      .get(accountId, id);
  }

  setPublication(
    accountId: string,
    id: string,
    active: boolean,
  ): RoleReleaseSnapshot | null {
    return this.db.$client.transaction(() => {
      const release = this.get(accountId, id);
      if (!release) return null;
      if (active)
        this.db.$client
          .prepare(
            "UPDATE role_release SET is_active = 0 WHERE account_id = ? AND character_id = ?",
          )
          .run(accountId, release.character_id);
      this.db.$client
        .prepare(
          "UPDATE role_release SET is_active = ?, model_capabilities_revoked_at = ? WHERE account_id = ? AND id = ?",
        )
        .run(active ? 1 : 0, active ? null : Date.now(), accountId, id);
      return release;
    })();
  }

  get(accountId: string, id: string): RoleReleaseSnapshot | null {
    const row = this.db.$client
      .prepare(
        `
      SELECT * FROM role_release
      WHERE id = ? AND account_id = ?
      LIMIT 1
    `,
      )
      .get(id, accountId) as RoleReleaseRow | undefined;
    return row ? toRoleReleaseSnapshot(row) : null;
  }
}

export function toPublicCatalogueRole(release: RoleReleaseSnapshot): import("@tavern/shared").PublicRole {
  const snapshot = release.character_snapshot;
  return {
    id: release.id,
    character_id: release.character_id,
    name: release.name,
    description: typeof snapshot.description === "string" ? snapshot.description : "",
    creator: typeof snapshot.creator === "string" ? snapshot.creator : "",
    tags: Array.isArray(snapshot.tags) ? snapshot.tags.filter((tag): tag is string => typeof tag === "string") : [],
    openings: release.opening_snapshots.map((opening) => ({
      id: opening.id, title: opening.title, summary: opening.summary,
      kind: opening.kind, display_text: opening.display_text, is_default: opening.default,
      default_for: opening.default_for ?? [],
    })),
    created_at: release.created_at,
  };
}

export function toPublicRoleRelease(release: RoleReleaseSnapshot): RoleRelease {
  const { opening_snapshots: _openingSnapshots, ...publicRelease } = release;
  return publicRelease;
}

export function selectRoleReleaseOpening(
  openings: readonly RoleReleaseOpeningSnapshot[],
  openingId?: string,
  sessionType?: "individual" | "group",
): RoleReleaseOpeningSnapshot | null {
  const hasTypedDefaults = openings.some(
    (opening) => opening.default_for !== undefined,
  );
  const effectiveSessionType =
    sessionType ?? (hasTypedDefaults ? "individual" : undefined);
  const eligible = effectiveSessionType
    ? openings.filter(
        (opening) =>
          !opening.audience ||
          opening.audience === "both" ||
          opening.audience === effectiveSessionType,
      )
    : [...openings];
  if (openingId)
    return eligible.find((opening) => opening.id === openingId) ?? null;
  if (hasTypedDefaults && effectiveSessionType) {
    const selected = eligible.find((opening) =>
      opening.default_for?.includes(effectiveSessionType),
    );
    if (!selected) {
      throw new RoleReleaseOpeningError(
        "role_release_default_opening_not_found",
        apiErrorMessages.ROLE_RELEASE_DEFAULT_OPENING_NOT_FOUND,
      );
    }
    return selected;
  }
  return eligible.find((opening) => opening.default) ?? eligible[0] ?? null;
}

export function buildRoleReleaseOpenings(
  snapshot: SessionCharacterSnapshot,
): RoleReleaseOpeningSnapshot[] {
  const native = readNativePackageOpenings(snapshot);
  if (native) return native;
  const primary = getPrimaryGreeting(snapshot);
  const candidates = getGreetingCandidates(snapshot);
  const sources = candidates.map((text, index) => ({
    id:
      primary && index === 0
        ? "first"
        : `alternate-${primary ? index : index + 1}`,
    text,
    sourceIndex: index,
  }));

  if (sources.length === 0) {
    return [];
  }

  const metadata = readOpeningMetadata(snapshot);
  const metadataItems = readMetadataItems(metadata.items);
  const defaultOpeningId =
    typeof metadata.defaultOpeningId === "string"
      ? metadata.defaultOpeningId
      : sources[0]!.id;

  if (!sources.some((source) => source.id === defaultOpeningId)) {
    throw new RoleReleaseOpeningError(
      "role_release_default_opening_not_found",
      `Default opening does not exist in character greetings: ${defaultOpeningId}`,
    );
  }

  for (const id of metadataItems.keys()) {
    if (!sources.some((source) => source.id === id)) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_metadata_mismatch",
        `Opening metadata does not match a character greeting: ${id}`,
      );
    }
  }

  return sources.map((source, index) => {
    const item = metadataItems.get(source.id);
    const kind = item?.kind ?? "story";
    const alternateOrdinal = sources[0]?.id === "first" ? index : index + 1;
    if (kind !== "story" && kind !== "introduction") {
      throw new RoleReleaseOpeningError(
        "role_release_opening_kind_invalid",
        `Opening kind must be story or introduction: ${source.id}`,
      );
    }

    return {
      id: source.id,
      title:
        nonEmptyString(item?.title) ??
        (source.id === "first" ? "主开场" : `备用开场 ${alternateOrdinal}`),
      summary:
        stringValue(item?.summary) ??
        (source.id === "first"
          ? "角色卡的主开场。"
          : `角色卡的第 ${alternateOrdinal} 个备用开场。`),
      kind,
      text: source.text,
      display_text: stringValue(item?.displayText) ?? source.text,
      variables: plainObject(item?.variables),
      default: source.id === defaultOpeningId,
      source_index: source.sourceIndex,
    };
  });
}

function readNativePackageOpenings(
  snapshot: SessionCharacterSnapshot,
): RoleReleaseOpeningSnapshot[] | null {
  const extension = snapshot.extensions?.tavern_headless;
  if (!extension || typeof extension !== "object" || Array.isArray(extension))
    return null;
  if (!(extension as Record<string, unknown>).nativePackage) return null;
  const openingsValue = (extension as Record<string, unknown>).openings;
  if (
    !openingsValue ||
    typeof openingsValue !== "object" ||
    Array.isArray(openingsValue)
  )
    return null;
  const openings = openingsValue as {
    items?: unknown;
    defaultOpeningIds?: unknown;
  };
  if (!Array.isArray(openings.items)) return null;
  const defaults =
    openings.defaultOpeningIds && typeof openings.defaultOpeningIds === "object"
      ? (openings.defaultOpeningIds as Record<string, unknown>)
      : {};
  return openings.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_invalid",
        `Opening at index ${index} is invalid.`,
      );
    }
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      typeof item.displayText !== "string"
    ) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_invalid",
        `Opening at index ${index} is missing its id or text.`,
      );
    }
    if (item.kind !== "story" && item.kind !== "introduction") {
      throw new RoleReleaseOpeningError(
        "role_release_opening_kind_invalid",
        `Opening ${item.id} has an invalid kind.`,
      );
    }
    const audience = item.audience;
    if (
      audience !== "individual" &&
      audience !== "group" &&
      audience !== "both"
    ) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_audience_invalid",
        `Opening ${item.id} has an invalid audience.`,
      );
    }
    const defaultFor = [
      ...(defaults.individual === item.id ? ["individual" as const] : []),
      ...(defaults.group === item.id ? ["group" as const] : []),
    ];
    return {
      id: item.id,
      title: typeof item.title === "string" ? item.title : item.id,
      summary: typeof item.summary === "string" ? item.summary : "",
      kind: item.kind,
      display_text: item.displayText,
      text: item.text,
      variables: plainObject(item.variables),
      default: defaultFor.length > 0,
      default_for: defaultFor,
      source_index: index,
      audience,
    };
  });
}

export class RoleReleaseOpeningError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoleReleaseOpeningError";
  }
}

function toRoleReleaseSnapshot(row: RoleReleaseRow): RoleReleaseSnapshot {
  const openingSnapshots = roleReleaseOpeningSnapshotSchema
    .array()
    .parse(JSON.parse(row.openings_json));
  return {
    id: row.id,
    name: row.name,
    character_id: row.character_id,
    character_version_id: row.character_version_id,
    character_snapshot: JSON.parse(
      row.character_snapshot_json,
    ) as SessionCharacterSnapshot,
    preset_id: row.preset_id,
    preset_version_id: row.preset_version_id,
    state_preset_id: row.state_preset_id,
    state_preset_version_id: row.state_preset_version_id,
    state_history_turns: row.state_history_turns,
    regex_profile_id: row.regex_profile_id,
    regex_profile_version_id: row.regex_profile_version_id,
    worldbook_id: row.worldbook_id,
    worldbook_version_id: row.worldbook_version_id,
    prompt_mode: row.prompt_mode,
    model_capabilities: readRoleModelCapabilities(row.model_capabilities_json),
    model_slots: readModelSlots(row.model_slots_json),
    default_user_id: row.default_user_id,
    default_user_snapshot: JSON.parse(row.default_user_snapshot_json) as Record<
      string,
      unknown
    >,
    openings: openingSnapshots.map(toPublicOpening),
    opening_snapshots: openingSnapshots,
    created_at: row.created_at,
  };
}

function readModelSlots(value: string): RoleReleaseModelSlot[] {
  const parsed = JSON.parse(value) as Array<
    Omit<RoleReleaseModelSlot, "profile_snapshot"> & {
      profile_snapshot?: RoleReleaseModelSlot["profile_snapshot"];
    }
  >;
  return parsed.map((binding) => ({
    ...binding,
    profile_snapshot: binding.profile_snapshot ?? null,
  }));
}

function readOpeningMetadata(
  snapshot: SessionCharacterSnapshot,
): OpeningMetadata {
  const extensions = plainObject(snapshot.extensions);
  const tavernHeadless = plainObject(extensions.tavern_headless);
  return plainObject(tavernHeadless.openings) as OpeningMetadata;
}

function readMetadataItems(
  value: unknown,
): Map<string, Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return new Map();
  }

  const entries: Array<[string, Record<string, unknown>]> = [];
  for (const raw of value) {
    const item = plainObject(raw);
    const id = nonEmptyString(item.id);
    if (!id) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_metadata_invalid",
        "Every opening metadata item must have an id",
      );
    }
    if (entries.some(([existingId]) => existingId === id)) {
      throw new RoleReleaseOpeningError(
        "role_release_opening_metadata_invalid",
        `Opening metadata id is duplicated: ${id}`,
      );
    }
    entries.push([id, item]);
  }
  return new Map(entries);
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  const text = stringValue(value)?.trim();
  return text ? text : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function buildRoleReleaseSnapshot(
  input: CreateRoleReleaseSnapshot,
): RoleReleaseSnapshot {
  return {
    id: nanoid(),
    name: input.name,
    character_id: input.character_id,
    character_version_id: input.character_version_id,
    character_snapshot: input.characterSnapshot,
    preset_id: input.preset_id,
    preset_version_id: input.preset_version_id,
    state_preset_id: input.statePresetId ?? null,
    state_preset_version_id: input.statePresetVersionId ?? null,
    state_history_turns:
      input.stateHistoryTurns ?? roleStatePolicy.defaultHistoryTurns,
    regex_profile_id: input.regex_profile_id,
    regex_profile_version_id: input.regex_profile_version_id,
    worldbook_id: input.worldbook_id,
    worldbook_version_id: input.worldbook_version_id,
    prompt_mode: input.prompt_mode,
    model_capabilities: input.model_capabilities ?? null,
    model_slots: input.modelSlots,
    default_user_id: input.default_user_id,
    default_user_snapshot: input.defaultUserSnapshot,
    created_at: input.now ?? Date.now(),
    opening_snapshots: input.openings,
    openings: input.openings.map(toPublicOpening),
  };
}

function readRoleModelCapabilities(
  value: string | null | undefined,
): RoleModelCapabilitiesGrant | null {
  if (typeof value !== "string") return null;
  return roleModelCapabilitiesGrantSchema.parse(JSON.parse(value));
}

function toPublicOpening({
  text: _text,
  variables: _variables,
  source_index: _sourceIndex,
  default_for: _defaultFor,
  ...opening
}: RoleReleaseOpeningSnapshot): RoleReleaseOpening {
  return opening;
}
