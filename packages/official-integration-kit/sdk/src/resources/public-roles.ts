import {
  createPublicRoleSessionBodySchema,
  publicRoleListResponseSchema,
  publicRoleResponseSchema,
  publicRoleSessionResponseSchema,
  publicRoleSessionPendingResponseSchema,
  type PublicRole,
  type PublicRoleListMeta,
  type PublicRoleSessionResult,
  type PublicRoleSessionPending,
} from "@tavern/shared";
import {
  buildAccountHeaders,
  type AccountIdHint,
  type TransportClient,
} from "../client/transport.js";

type Scope = { accountId?: AccountIdHint };
export interface PublicRolesResource {
  list(options?: {
    keyword?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): Promise<PublicRoleListMeta & { items: PublicRole[] }>;
  get(options: { roleId: string }): Promise<PublicRole>;
  createSession(
    options: Scope & {
      roleId: string;
      userId: string;
      expectedUserRevision?: number;
      openingId?: string;
      operationId: string;
      sessionType?: "individual" | "group";
    },
  ): Promise<PublicRoleSessionResult | PublicRoleSessionPending>;
  getSessionOperation(
    options: Scope & { operationId: string },
  ): Promise<PublicRoleSessionResult | PublicRoleSessionPending>;
}
export function createPublicRolesResource(
  client: TransportClient,
): PublicRolesResource {
  const parseCreation = (status: number, body: unknown) =>
    status === 202
      ? publicRoleSessionPendingResponseSchema.parse(body).data
      : publicRoleSessionResponseSchema.parse(body).data;
  return {
    async list(options = {}) {
      const params = new URLSearchParams();
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined) params.set(key, String(value));
      });
      const result = await client.fetchJson(
        `/public/roles${params.size ? `?${params}` : ""}`,
      );
      const { data, meta } = publicRoleListResponseSchema.parse(result.body);
      return { ...meta, items: data };
    },
    async get({ roleId }) {
      const result = await client.fetchJson(
        `/public/roles/${encodeURIComponent(roleId)}`,
      );
      return publicRoleResponseSchema.parse(result.body).data;
    },
    async createSession({
      accountId,
      roleId,
      userId,
      expectedUserRevision,
      openingId,
      operationId,
      sessionType,
    }) {
      const result = await client.fetchJson(
        `/public/roles/${encodeURIComponent(roleId)}/sessions`,
        {
          method: "POST",
          headers: buildAccountHeaders(accountId),
          body: createPublicRoleSessionBodySchema.parse({
            user_id: userId,
            expected_user_revision: expectedUserRevision,
            opening_id: openingId,
            operation_id: operationId,
            session_type: sessionType,
          }),
        },
      );
      return parseCreation(result.status, result.body);
    },
    async getSessionOperation({ accountId, operationId }) {
      const result = await client.fetchJson(
        `/public/role-session-operations/${encodeURIComponent(operationId)}`,
        { headers: buildAccountHeaders(accountId) },
      );
      return parseCreation(result.status, result.body);
    },
  };
}
