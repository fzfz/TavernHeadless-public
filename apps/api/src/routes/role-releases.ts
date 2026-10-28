import { RoleAssetError } from "../services/role-runtime/role-asset-service.js";
import { validateMigratedMvu } from "../services/role-runtime/state-contract.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { AppDb } from "../db/client.js";
import {
  normalizeSessionCharacterSnapshot,
  type SessionCharacterSnapshot,
} from "../lib/character-snapshot.js";
import { llmProfileConfigSnapshotSchema } from "../lib/llm-profile-config-snapshot.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import {
  apiErrorMessages,
  rolePublicationBodySchema,
  rolePublicationBodyJsonSchema,
  roleReleaseModelSlots,
  roleStateBundleSchema,
  roleStatePolicy,
  roleStateRuntimeConfigurationSchema,
} from "@tavern/shared";
import { getRequestAuthContext, authHasCapability } from "../plugins/auth.js";
import {
  RoleReleaseOpeningError,
  RoleReleaseService,
  buildRoleReleaseOpenings,
  selectRoleReleaseOpening,
  toPublicRoleRelease,
  type RoleRelease,
  type RoleReleaseSnapshot,
  type RoleReleaseOpeningSnapshot,
} from "../services/role-release-service.js";
import {
  normalizeRoleModelCapabilitiesGrant,
  persistRoleModelCapabilitySessionSnapshot,
} from "../services/role-model-capabilities.js";
import { loadRoleModelCapabilitiesSystemConfig } from "../config.js";
import {
  errorResponseJsonSchema,
  idParamsJsonSchema,
} from "./schemas/common.js";
import {
  createRoleReleaseBodyJsonSchema,
  createRoleReleaseBodySchema,
  createRoleReleaseSessionBodyJsonSchema,
  createRoleReleaseSessionBodySchema,
  roleReleaseIdParamsSchema,
  roleReleaseListQueryJsonSchema,
  roleReleaseListResponseJsonSchema,
  roleReleaseResponseJsonSchema,
  roleReleaseSessionResponseJsonSchema,
  type CreateRoleReleaseBody,
  type CreateRoleReleaseSessionBody,
  type RoleReleaseModelSlot,
} from "./schemas/role-releases.js";

type JsonObject = Record<string, unknown>;

export type RoleReleaseSessionCreatedInput = {
  session: JsonObject;
  release: RoleRelease;
  opening: RoleReleaseOpeningSnapshot | null;
  headers: Record<string, string>;
};

export type RegisterRoleReleaseRoutesOptions = {
  requireAssetBundle?: (
    accountId: string,
    versionId: string,
  ) => void | Promise<void>;
  onSessionCreated?: (
    input: RoleReleaseSessionCreatedInput,
  ) => void | Promise<void>;
};

export type RoleReleaseRouteConnection =
  | AppDb
  | {
      db: AppDb;
      sqlite?: AppDb["$client"];
    };

export async function registerRoleReleaseRoutes(
  app: FastifyInstance,
  connection: RoleReleaseRouteConnection,
  options: RegisterRoleReleaseRoutesOptions = {},
): Promise<void> {
  const db = "db" in connection ? connection.db : connection;
  const service = new RoleReleaseService(db);

  app.get(
    "/role-releases",
    {
      schema: {
        tags: ["role-releases"],
        summary: "List immutable role releases",
        operationId: "listRoleReleases",
        querystring: roleReleaseListQueryJsonSchema,
        response: {
          200: roleReleaseListResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = getRequestAuthContext(request);
      return reply.send({
        data: service
          .list(
            auth.accountId,
            (request.query as { latest_per_character?: boolean })
              .latest_per_character,
            (request.query as { active_only?: boolean }).active_only,
          )
          .map(toPublicRoleRelease),
      });
    },
  );

  app.post(
    "/role-releases",
    {
      schema: {
        tags: ["role-releases"],
        summary: "Create an immutable role release",
        operationId: "createRoleRelease",
        body: createRoleReleaseBodyJsonSchema,
        response: {
          201: roleReleaseResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseWithSchema(
        createRoleReleaseBodySchema,
        request.body,
        reply,
      );
      if (!parsed.ok) return;

      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      )
        return sendError(
          reply,
          403,
          "ROLE_APP_ADMIN_REQUIRED",
          apiErrorMessages.ROLE_APP_ADMIN_REQUIRED,
        );
      const headers = forwardedAuthHeaders(request);

      try {
        const created = service.create(
          await resolveRoleReleaseConfiguration(
            app,
            headers,
            parsed.data,
            auth.accountId,
            options.requireAssetBundle,
          ),
        );

        return reply.code(201).send({ data: toPublicRoleRelease(created) });
      } catch (error) {
        return sendRoleReleaseError(reply, error);
      }
    },
  );

  app.get(
    "/role-releases/:id",
    {
      schema: {
        tags: ["role-releases"],
        summary: "Get an immutable role release",
        operationId: "getRoleRelease",
        params: idParamsJsonSchema,
        response: {
          200: roleReleaseResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseWithSchema(
        roleReleaseIdParamsSchema,
        request.params,
        reply,
      );
      if (!parsed.ok) return;
      const auth = getRequestAuthContext(request);
      const release = service.get(auth.accountId, parsed.data.id);
      if (!release)
        return sendError(
          reply,
          404,
          "role_release_not_found",
          "Role release not found. Select an existing release.",
        );
      return reply.send({ data: toPublicRoleRelease(release) });
    },
  );

  app.put(
    "/role-releases/:id/publication",
    {
      schema: {
        tags: ["role-releases"],
        summary: "Enable or stop a role publication",
        operationId: "setRolePublication",
        params: idParamsJsonSchema,
        body: rolePublicationBodyJsonSchema,
        response: {
          200: roleReleaseResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const params = parseWithSchema(
        roleReleaseIdParamsSchema,
        request.params,
        reply,
      );
      if (!params.ok) return;
      const input = parseWithSchema(
        rolePublicationBodySchema,
        request.body,
        reply,
      );
      if (!input.ok) return;
      const auth = getRequestAuthContext(request);
      if (
        auth.role !== "admin" ||
        !authHasCapability(auth, "project.config.write")
      )
        return sendError(
          reply,
          403,
          "ROLE_APP_ADMIN_REQUIRED",
          apiErrorMessages.ROLE_APP_ADMIN_REQUIRED,
        );
      const release = service.setPublication(
        auth.accountId,
        params.data.id,
        input.data.active,
      );
      if (!release)
        return sendError(
          reply,
          404,
          "role_release_not_found",
          "Role release not found. Select an existing release.",
        );
      return reply.send({ data: toPublicRoleRelease(release) });
    },
  );

  app.post(
    "/role-releases/:id/sessions",
    {
      schema: {
        tags: ["role-releases"],
        summary: "Create a formal session from an immutable role release",
        operationId: "createRoleReleaseSession",
        params: idParamsJsonSchema,
        body: createRoleReleaseSessionBodyJsonSchema,
        response: {
          201: roleReleaseSessionResponseJsonSchema,
          400: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
          500: errorResponseJsonSchema,
          502: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const parsedParams = parseWithSchema(
        roleReleaseIdParamsSchema,
        request.params,
        reply,
      );
      if (!parsedParams.ok) return;
      const parsedBody = parseWithSchema(
        createRoleReleaseSessionBodySchema,
        request.body ?? {},
        reply,
      );
      if (!parsedBody.ok) return;

      const auth = getRequestAuthContext(request);
      const releaseSnapshot = service.get(auth.accountId, parsedParams.data.id);
      if (!releaseSnapshot)
        return sendError(
          reply,
          404,
          "role_release_not_found",
          "Role release not found. Select an existing release.",
        );

      if (!service.isActive(auth.accountId, releaseSnapshot.id))
        return sendError(
          reply,
          409,
          "ROLE_RELEASE_INACTIVE",
          apiErrorMessages.ROLE_RELEASE_INACTIVE,
        );

      return createRoleSessionFromSnapshot(
        db,
        app,
        request,
        reply,
        releaseSnapshot,
        parsedBody.data,
        options,
      );
    },
  );
}

export function forwardedAuthHeaders(
  request: FastifyRequest,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [
    "authorization",
    "x-api-key",
    "x-tavern-client-key",
    "cookie",
    "origin",
    "host",
  ] as const) {
    const value = request.headers[name];
    if (typeof value === "string" && value.length > 0) headers[name] = value;
  }
  return headers;
}

async function loadCharacterVersion(
  app: FastifyInstance,
  headers: Record<string, string>,
  characterId: string,
  versionId: string,
): Promise<JsonObject> {
  let offset = 0;
  while (true) {
    const response = await injectOk(
      app,
      headers,
      "GET",
      `/characters/${encodeURIComponent(characterId)}/versions?limit=100&offset=${offset}&sort_order=asc`,
    );
    const body = asObject(response, "Character versions response is invalid");
    const data = Array.isArray(body.data) ? body.data : [];
    const matched = data.find(
      (value) => asObjectOrNull(value)?.id === versionId,
    );
    if (matched) {
      const version = asObject(
        matched,
        "Character version response is invalid",
      );
      if (version.character_id !== characterId) {
        throw new RoleReleaseRouteError(
          400,
          "role_release_character_version_mismatch",
          "Character version does not belong to the selected character. Select a version of that character.",
        );
      }
      return version;
    }
    const meta = asObjectOrNull(body.meta);
    if (meta?.has_more !== true || data.length === 0) break;
    offset += data.length;
  }

  throw new RoleReleaseRouteError(
    404,
    "role_release_character_version_not_found",
    "Character version not found. Select an existing version.",
  );
}

async function validateAssetVersion(
  app: FastifyInstance,
  headers: Record<string, string>,
  collection: "presets" | "worldbooks" | "regex-profiles",
  assetId: string,
  versionId: string,
): Promise<void> {
  const data = await injectData(
    app,
    headers,
    "GET",
    `/${collection}/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}`,
  );
  if (data.asset_id !== assetId || data.id !== versionId) {
    throw new RoleReleaseRouteError(
      400,
      "role_release_asset_version_mismatch",
      "Asset version does not belong to the selected resource. Select a version of that resource.",
      {
        asset_id: assetId,
        version_id: versionId,
      },
    );
  }
}

async function activateOpeningPage(
  app: FastifyInstance,
  headers: Record<string, string>,
  sessionId: string,
  opening: RoleReleaseOpeningSnapshot,
): Promise<void> {
  const timeline = await injectData(
    app,
    headers,
    "GET",
    `/sessions/${encodeURIComponent(sessionId)}/timeline?limit=1&offset=0&branch_id=main`,
  );
  const floors = Array.isArray(timeline.floors) ? timeline.floors : [];
  const greetingFloor = asObjectOrNull(floors[0]);
  const floorId = requiredString(
    greetingFloor?.id,
    "Greeting floor was not created",
  );
  const pagesResponse = await injectOk(
    app,
    headers,
    "GET",
    `/pages?floor_id=${encodeURIComponent(floorId)}&limit=100&offset=0&sort_by=version&sort_order=asc`,
  );
  const pagesBody = asObject(pagesResponse, "Pages response is invalid");
  const pages = Array.isArray(pagesBody.data) ? pagesBody.data : [];
  const expectedVersion = opening.source_index + 1;
  const target = pages
    .map(asObjectOrNull)
    .find((page) => page?.version === expectedVersion);
  const pageId = requiredString(
    target?.id,
    `Greeting page version ${expectedVersion} was not created`,
  );
  await injectData(
    app,
    headers,
    "PATCH",
    `/pages/${encodeURIComponent(pageId)}/activate`,
  );
}

function resolveOpening(
  openings: RoleReleaseOpeningSnapshot[],
  openingId: string | undefined,
  sessionType?: "individual" | "group",
): RoleReleaseOpeningSnapshot | null {
  return selectRoleReleaseOpening(openings, openingId, sessionType);
}

async function injectData(
  app: FastifyInstance,
  headers: Record<string, string>,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: JsonObject,
): Promise<JsonObject> {
  const body = asObject(
    await injectOk(app, headers, method, url, payload),
    `Response from ${method} ${url} is invalid`,
  );
  return asObject(
    body.data,
    `Response from ${method} ${url} does not contain data`,
  );
}

async function injectOk(
  app: FastifyInstance,
  headers: Record<string, string>,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: JsonObject,
): Promise<unknown> {
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  const body = parseJsonBody(response.body);
  if (response.statusCode >= 400) {
    const error = asObjectOrNull(asObjectOrNull(body)?.error);
    throw new RoleReleaseRouteError(
      response.statusCode,
      typeof error?.code === "string"
        ? error.code
        : "role_release_dependency_failed",
      typeof error?.message === "string"
        ? error.message
        : `${method} ${url} failed. Retry after checking the resource endpoint.`,
      error?.details,
    );
  }
  return body;
}

class RoleReleaseRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "RoleReleaseRouteError";
  }
}

export function sendRoleReleaseError(
  reply: Parameters<typeof sendError>[0],
  error: unknown,
) {
  if (error instanceof RoleAssetError) {
    return sendError(reply, 409, error.code, error.message, error.details);
  }
  if (error instanceof RoleReleaseOpeningError) {
    return sendError(reply, 400, error.code, error.message);
  }
  const mapped = toRoleReleaseRouteError(error);
  return sendError(
    reply,
    mapped.statusCode,
    mapped.code,
    mapped.message,
    mapped.details,
  );
}

function toRoleReleaseRouteError(error: unknown): RoleReleaseRouteError {
  if (error instanceof RoleReleaseRouteError) return error;
  return new RoleReleaseRouteError(
    500,
    "role_release_initialization_failed",
    "Role session initialization failed. Check the release configuration and retry creating the session.",
    { cause: error instanceof Error ? error.message : String(error) },
  );
}

function asObject(value: unknown, message: string): JsonObject {
  const object = asObjectOrNull(value);
  if (!object)
    throw new RoleReleaseRouteError(
      502,
      "role_release_dependency_response_invalid",
      `${message}. Inspect the resource API response and retry.`,
    );
  return object;
}

function asObjectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RoleReleaseRouteError(
      502,
      "role_release_dependency_response_invalid",
      `${message}. Inspect the resource API response and retry.`,
    );
  }
  return value;
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export async function resolveRoleReleaseConfiguration(
  app: FastifyInstance,
  headers: Record<string, string>,
  input: CreateRoleReleaseBody,
  accountId: string,
  requireAssetBundle?: RegisterRoleReleaseRoutesOptions["requireAssetBundle"],
  characterSnapshotOverride?: SessionCharacterSnapshot,
) {
  const characterVersion = characterSnapshotOverride
    ? undefined
    : await loadCharacterVersion(
        app,
        headers,
        input.character_id,
        input.character_version_id,
      );
  const characterSnapshot = characterSnapshotOverride
    ? normalizeSessionCharacterSnapshot(characterSnapshotOverride)
    : normalizeSessionCharacterSnapshot(characterVersion?.snapshot);
  if (!characterSnapshot) {
    throw new RoleReleaseRouteError(
      400,
      "role_release_character_snapshot_invalid",
      "Character version snapshot is invalid. Correct the character configuration and publish a new version.",
    );
  }

  const stateUpdate = (
    characterSnapshot.extensions?.tavern_headless as
      | Record<string, unknown>
      | undefined
  )?.stateUpdate;
  const stateProfile = stateUpdate
    ? roleStateBundleSchema.parse(stateUpdate).profile
    : undefined;
  const requiredSlots = stateUpdate
    ? [
        "narrator",
        stateProfile!.modelSlot ??
          roleStatePolicy.defaultModelSlot,
      ]
    : ["narrator"];
  const missingSlots = requiredSlots.filter(
    (slot) =>
      !input.model_slots.some(
        (binding) => binding.slot === slot || binding.slot === "*",
      ),
  );
  if (missingSlots.length)
    throw new RoleReleaseRouteError(
      400,
      "ROLE_RELEASE_MODEL_SLOT_MISSING",
      apiErrorMessages.ROLE_RELEASE_MODEL_SLOT_MISSING,
      { slots: missingSlots },
    );

  const stateConfiguration = roleStateRuntimeConfigurationSchema.parse({
    ...(input.statePresetId === undefined
      ? {}
      : { statePresetId: input.statePresetId }),
    ...(input.statePresetVersionId === undefined
      ? {}
      : { statePresetVersionId: input.statePresetVersionId }),
    ...(input.stateHistoryTurns === undefined
      ? {}
      : { stateHistoryTurns: input.stateHistoryTurns }),
  });
  const statePresetId =
    stateConfiguration.statePresetId ?? stateProfile?.presetRef?.presetId;
  const statePresetVersionId =
    stateConfiguration.statePresetVersionId ??
    stateProfile?.presetRef?.presetVersionId;
  if (stateUpdate && (!statePresetId || !statePresetVersionId)) {
    throw new RoleReleaseRouteError(
      400,
      "ROLE_STATE_PRESET_MISSING",
      apiErrorMessages.ROLE_STATE_PRESET_MISSING,
    );
  }
  if (!stateUpdate && statePresetId) {
    throw new RoleReleaseRouteError(
      400,
      "ROLE_RELEASE_STATE_PROFILE_MISSING",
      apiErrorMessages.ROLE_RELEASE_STATE_PROFILE_MISSING,
    );
  }
  if (statePresetId && statePresetVersionId) {
    await validateAssetVersion(
      app,
      headers,
      "presets",
      statePresetId,
      statePresetVersionId,
    );
  }

  await validateAssetVersion(
    app,
    headers,
    "presets",
    input.preset_id,
    input.preset_version_id,
  );
  if (input.regex_profile_id && input.regex_profile_version_id) {
    await validateAssetVersion(
      app,
      headers,
      "regex-profiles",
      input.regex_profile_id,
      input.regex_profile_version_id,
    );
  }
  if (input.worldbook_id && input.worldbook_version_id) {
    await validateAssetVersion(
      app,
      headers,
      "worldbooks",
      input.worldbook_id,
      input.worldbook_version_id,
    );
  }

  if (input.worldbook_id && input.worldbook_version_id) {
    const book = await injectData(
      app,
      headers,
      "GET",
      `/worldbooks/${input.worldbook_id}/versions/${input.worldbook_version_id}`,
    );
    const extension = characterSnapshot.extensions?.tavern_headless as
      | Record<string, unknown>
      | undefined;
    const issues = validateMigratedMvu(extension?.stateUpdate, book.snapshot);
    if (issues.length)
      throw new RoleReleaseRouteError(
        400,
        "role_release_mvu_conflict",
        "Variable rules contain migration conflicts. Correct the listed entries or rule files before publishing.",
        { issues },
      );
  }
  await requireAssetBundle?.(accountId, input.character_version_id);
  const modelSlots: RoleReleaseModelSlot[] = [];
  for (const binding of input.model_slots) {
    const profile = await injectData(
      app,
      headers,
      "GET",
      `/llm-profiles/${encodeURIComponent(binding.profile_id)}`,
    );
    if (profile.status !== "active") {
      throw new RoleReleaseRouteError(
        409,
        "role_release_profile_inactive",
        `LLM profile ${binding.profile_id} is inactive. Select an active model profile.`,
        { profile_id: binding.profile_id, slot: binding.slot },
      );
    }
    const profileSnapshot = llmProfileConfigSnapshotSchema.safeParse({
      preset_name: profile.preset_name,
      provider: profile.provider,
      model_id: profile.model_id,
      base_url: profile.base_url,
    });
    if (!profileSnapshot.success) {
      throw new RoleReleaseRouteError(
        502,
        "role_release_profile_response_invalid",
        `LLM profile ${binding.profile_id} did not return a valid non-secret configuration. Correct the profile and retry publishing.`,
        { profile_id: binding.profile_id, slot: binding.slot },
      );
    }
    modelSlots.push({
      ...binding,
      params: binding.params ?? null,
      profile_snapshot: profileSnapshot.data,
    });
  }

  const defaultUser = await injectData(
    app,
    headers,
    "GET",
    `/users/${encodeURIComponent(input.default_user_id)}`,
  );
  if (defaultUser.status !== "active") {
    throw new RoleReleaseRouteError(
      409,
      "role_release_default_user_inactive",
      `Default persona ${input.default_user_id} is inactive. Select an active persona.`,
    );
  }
  const defaultUserSnapshot = asObject(
    defaultUser.snapshot,
    "User response does not contain a snapshot",
  );
  const openings = buildRoleReleaseOpenings(characterSnapshot);
  let modelCapabilities: CreateRoleReleaseBody["model_capabilities"];
  try {
    modelCapabilities = normalizeRoleModelCapabilitiesGrant(
      input.model_capabilities,
      loadRoleModelCapabilitiesSystemConfig(),
    );
  } catch {
    throw new RoleReleaseRouteError(
      400,
      "VALIDATION_ERROR",
      apiErrorMessages.VALIDATION_ERROR,
      { field: "model_capabilities" },
    );
  }
  return {
    ...input,
    statePresetId: statePresetId ?? undefined,
    statePresetVersionId: statePresetVersionId ?? undefined,
    stateHistoryTurns:
      stateConfiguration.stateHistoryTurns ?? roleStatePolicy.defaultHistoryTurns,
    model_capabilities: modelCapabilities,
    accountId: accountId,
    modelSlots,
    characterSnapshot,
    defaultUserSnapshot,
    openings,
  };
}

export async function createRoleSessionFromSnapshot(
  db: AppDb,
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  releaseSnapshot: RoleReleaseSnapshot,
  input: CreateRoleReleaseSessionBody,
  options: RegisterRoleReleaseRoutesOptions,
  preview?: { draft_id: string; draft_revision: number; creator_id: string },
) {
  const headers = forwardedAuthHeaders(request);
  const missingProfileSnapshot = releaseSnapshot.model_slots.find(
    (binding) => binding.profile_snapshot === null,
  );
  if (missingProfileSnapshot) {
    return sendError(
      reply,
      409,
      "role_release_profile_snapshot_missing",
      "This release predates frozen model configuration. Publish a new release before creating a session.",
      {
        profile_id: missingProfileSnapshot.profile_id,
        slot: missingProfileSnapshot.slot,
      },
    );
  }
  const userId = input.user_id ?? releaseSnapshot.default_user_id;
  const opening = resolveOpening(
    releaseSnapshot.opening_snapshots,
    input.opening_id,
    input.session_type,
  );
  if (input.opening_id && !opening) {
    return sendError(
      reply,
      404,
      "role_release_opening_not_found",
      "Opening does not exist in this role release. Select one of the release openings.",
      {
        opening_id: input.opening_id,
      },
    );
  }

  let createdSession: JsonObject | null = null;
  try {
    const selectedUser =
      userId === releaseSnapshot.default_user_id
        ? {
            status: "active",
            snapshot: releaseSnapshot.default_user_snapshot,
          }
        : await injectData(
            app,
            headers,
            "GET",
            `/users/${encodeURIComponent(userId)}`,
          );
    if (selectedUser.status !== "active") {
      throw new RoleReleaseRouteError(
        409,
        "role_release_user_inactive",
        `Persona ${userId} is inactive. Select an active persona.`,
      );
    }
    const selectedUserSnapshot = asObject(
      selectedUser.snapshot,
      "User response does not contain a snapshot",
    );
    const openingId = opening?.id ?? null;
    const sessionMetadata = {
      ...(preview
        ? {
            role_preview: preview,
            draft_revision: preview.draft_revision,
          }
        : { role_release_id: releaseSnapshot.id }),
      model_capabilities: releaseSnapshot.model_capabilities ?? null,
      opening_id: openingId,
      ...(releaseSnapshot.state_preset_id &&
      releaseSnapshot.state_preset_version_id
        ? {
            statePrompt: {
              presetId: releaseSnapshot.state_preset_id,
              presetVersionId: releaseSnapshot.state_preset_version_id,
              historyTurns: releaseSnapshot.state_history_turns,
            },
          }
        : {}),
    };
    createdSession = await injectData(app, headers, "POST", "/sessions", {
      title: releaseSnapshot.name,
      character_id: releaseSnapshot.character_id,
      character_version_id: releaseSnapshot.character_version_id,
      character_sync_policy: "pin",
      character_snapshot: releaseSnapshot.character_snapshot,
      user_id: userId,
      user_snapshot: selectedUserSnapshot,
      preset_id: releaseSnapshot.preset_id,
      preset_version_id: releaseSnapshot.preset_version_id,
      regex_profile_id: releaseSnapshot.regex_profile_id,
      regex_profile_version_id: releaseSnapshot.regex_profile_version_id,
      worldbook_profile_id: releaseSnapshot.worldbook_id,
      worldbook_version_id: releaseSnapshot.worldbook_version_id,
      deep_binding: true,
      prompt_mode: releaseSnapshot.prompt_mode,
      metadata: sessionMetadata,
    });

    const sessionId = requiredString(
      createdSession.id,
      "Session response does not contain an id",
    );
    persistRoleModelCapabilitySessionSnapshot(db, {
      sessionId,
      accountId: getRequestAuthContext(request).accountId,
      metadata: sessionMetadata,
    });
    for (const binding of releaseSnapshot.model_slots) {
      await injectData(
        app,
        headers,
        "POST",
        `/llm-profiles/${encodeURIComponent(binding.profile_id)}/activate`,
        {
          scope: "session",
          session_id: sessionId,
          instance_slot: binding.slot,
          params: binding.params,
          profile_snapshot: binding.profile_snapshot,
        },
      );
    }

    const extension = releaseSnapshot.character_snapshot.extensions
      ?.tavern_headless as Record<string, unknown> | undefined;
    const updaterSlot = extension?.stateUpdate
      ? (roleStateBundleSchema.parse(extension.stateUpdate).profile.modelSlot ??
        roleStatePolicy.defaultModelSlot)
      : null;
    const boundSlots = new Set(
      releaseSnapshot.model_slots.map((binding) => binding.slot),
    );
    for (const slot of roleReleaseModelSlots) {
      await injectData(app, headers, "PUT", `/llm-instances/${slot}`, {
        scope: "session",
        session_id: sessionId,
        enabled:
          slot !== "*" &&
          slot !== updaterSlot &&
          (boundSlots.has(slot) || boundSlots.has("*")),
        preset_id: null,
        model_id_override: null,
        params: null,
        capabilities: null,
      });
    }

    if (opening && !hasNativePackage(releaseSnapshot.character_snapshot)) {
      await activateOpeningPage(app, headers, sessionId, opening);
    }

    const release = toPublicRoleRelease(releaseSnapshot);
    await options.onSessionCreated?.({
      session: createdSession,
      release,
      opening,
      headers,
    });

    return reply.code(201).send({
      data: preview
        ? {
            draft_id: preview.draft_id,
            draft_revision: preview.draft_revision,
            session: createdSession,
            opening_id: openingId,
          }
        : {
            release,
            session: createdSession,
            opening_id: openingId,
          },
    });
  } catch (error) {
    if (createdSession) {
      const sessionId =
        typeof createdSession.id === "string" ? createdSession.id : null;
      if (sessionId) {
        const cleanup = await app.inject({
          method: "DELETE",
          url: `/sessions/${encodeURIComponent(sessionId)}`,
          headers,
        });
        if (cleanup.statusCode >= 400) {
          const original = toRoleReleaseRouteError(error);
          return sendError(
            reply,
            500,
            "role_release_session_cleanup_failed",
            "Session initialization failed and the created session could not be deleted. Inspect the session identified in the error details before retrying.",
            {
              session_id: sessionId,
              initialization_error: original.code,
              cleanup_status: cleanup.statusCode,
              cleanup_error: parseJsonBody(cleanup.body),
            },
          );
        }
      }
    }
    return sendRoleReleaseError(reply, error);
  }
}

function hasNativePackage(snapshot: SessionCharacterSnapshot): boolean {
  const extension = snapshot.extensions?.tavern_headless;
  return (
    !!extension &&
    typeof extension === "object" &&
    !!(extension as Record<string, unknown>).nativePackage
  );
}
