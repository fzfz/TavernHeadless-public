import { z } from "zod";
import {
  roleAppSchema,
  roleAppValidationSchema,
  createRoleAppSchema,
  updateRoleAppSchema,
  roleAppRevisionSchema,
  createRolePreviewSessionSchema,
  rolePreviewSessionSummarySchema,
  roleReleaseResponseSchema,
  rolePreviewSessionCreatedSchema,
  type CreateRoleReleaseBody,
} from "@tavern/shared";
import type { TransportClient } from "../client/transport.js";
export function createRoleAppsResource(client: TransportClient) {
  const data = async <T>(
    path: string,
    schema: z.ZodType<T, unknown>,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ): Promise<T> => {
    const response = await client.fetchJson(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    return schema.parse(
      z.object({ data: z.unknown() }).parse(response.body).data,
    );
  };
  return {
    validate: ({ configuration }: { configuration: CreateRoleReleaseBody }) =>
      data(
        "/role-apps/validate",
        roleAppValidationSchema,
        createRoleAppSchema.parse({ configuration }),
      ),
    list: () => data("/role-apps", z.array(roleAppSchema)),
    get: ({ id }: { id: string }) =>
      data(`/role-apps/${encodeURIComponent(id)}`, roleAppSchema),
    create: ({ configuration }: { configuration: CreateRoleReleaseBody }) =>
      data(
        "/role-apps",
        roleAppSchema,
        createRoleAppSchema.parse({ configuration }),
      ),
    update: ({
      id,
      configuration,
      expectedRevision,
    }: {
      id: string;
      configuration: CreateRoleReleaseBody;
      expectedRevision: number;
    }) =>
      data(
        `/role-apps/${encodeURIComponent(id)}`,
        roleAppSchema,
        updateRoleAppSchema.parse({
          configuration,
          expected_revision: expectedRevision,
        }),
        "PUT",
      ),
    listPreviews: ({ id }: { id: string }) =>
      data(
        `/role-apps/${encodeURIComponent(id)}/preview-sessions`,
        z.array(rolePreviewSessionSummarySchema),
      ),
    async createPreview({
      id,
      expectedRevision,
      openingId,
      userId,
    }: {
      id: string;
      expectedRevision: number;
      openingId?: string;
      userId?: string;
    }) {
      const response = await client.fetchJson(
        `/role-apps/${encodeURIComponent(id)}/preview-sessions`,
        {
          method: "POST",
          body: createRolePreviewSessionSchema.parse({
            expected_revision: expectedRevision,
            opening_id: openingId,
            user_id: userId,
          }),
        },
      );
      return z
        .object({ data: rolePreviewSessionCreatedSchema })
        .parse(response.body).data;
    },
    async publish({
      id,
      expectedRevision,
    }: {
      id: string;
      expectedRevision: number;
    }) {
      const response = await client.fetchJson(
        `/role-apps/${encodeURIComponent(id)}/releases`,
        {
          method: "POST",
          body: roleAppRevisionSchema.parse({
            expected_revision: expectedRevision,
          }),
        },
      );
      return roleReleaseResponseSchema.parse(response.body).data;
    },
  };
}
export type RoleAppsResource = ReturnType<typeof createRoleAppsResource>;
