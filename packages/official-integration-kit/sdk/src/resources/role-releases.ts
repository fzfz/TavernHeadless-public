import {
  createRoleReleaseBodySchema,
  rolePublicationBodySchema,
  createRoleReleaseSessionBodySchema,
  roleReleaseResponseSchema,
  roleReleaseListResponseSchema,
  roleReleaseSessionResponseSchema,
  type CreateRoleReleaseBody,
  type CreateRoleReleaseSessionBody,
  type RoleReleasePublic,
} from "@tavern/shared";
import {
  buildAccountHeaders,
  type AccountIdHint,
  type TransportClient,
} from "../client/transport.js";

type Scope = { accountId?: AccountIdHint };
export interface RoleReleasesResource {
  list(
    options?: Scope & { latestPerCharacter?: boolean; activeOnly?: boolean },
  ): Promise<RoleReleasePublic[]>;
  setPublication(
    options: Scope & { releaseId: string; active: boolean },
  ): Promise<RoleReleasePublic>;
  get(options: Scope & { releaseId: string }): Promise<RoleReleasePublic>;
  create(
    options: Scope & { input: CreateRoleReleaseBody },
  ): Promise<RoleReleasePublic>;
  createSession(
    options: Scope & {
      releaseId: string;
      input?: CreateRoleReleaseSessionBody;
    },
  ): Promise<{
    release: RoleReleasePublic;
    session: Record<string, unknown>;
    opening_id: string | null;
  }>;
}
export function createRoleReleasesResource(
  client: TransportClient,
): RoleReleasesResource {
  return {
    async list({
      accountId,
      latestPerCharacter = false,
      activeOnly = false,
    } = {}) {
      const result = await client.fetchJson(
        `/role-releases?latest_per_character=${latestPerCharacter}${activeOnly ? "&active_only=true" : ""}`,
        { headers: buildAccountHeaders(accountId) },
      );
      return roleReleaseListResponseSchema.parse(result.body).data;
    },
    async setPublication({ accountId, releaseId, active }) {
      const result = await client.fetchJson(
        `/role-releases/${encodeURIComponent(releaseId)}/publication`,
        {
          method: "PUT",
          headers: buildAccountHeaders(accountId),
          body: rolePublicationBodySchema.parse({ active }),
        },
      );
      return roleReleaseResponseSchema.parse(result.body).data;
    },
    async get({ accountId, releaseId }) {
      const result = await client.fetchJson(
        `/role-releases/${encodeURIComponent(releaseId)}`,
        { headers: buildAccountHeaders(accountId) },
      );
      return roleReleaseResponseSchema.parse(result.body).data;
    },
    async create({ accountId, input }) {
      const result = await client.fetchJson("/role-releases", {
        method: "POST",
        headers: buildAccountHeaders(accountId),
        body: createRoleReleaseBodySchema.parse(input),
      });
      return roleReleaseResponseSchema.parse(result.body).data;
    },
    async createSession({ accountId, releaseId, input = {} }) {
      const result = await client.fetchJson(
        `/role-releases/${encodeURIComponent(releaseId)}/sessions`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          body: createRoleReleaseSessionBodySchema.parse(input),
        },
      );
      return roleReleaseSessionResponseSchema.parse(result.body).data;
    },
  };
}
