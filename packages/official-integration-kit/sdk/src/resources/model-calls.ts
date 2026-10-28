import {
  modelCallDetailSchema,
  modelCallListSchema,
  modelCallQuerySchema,
  type ModelCallDetail,
  type ModelCallQuery,
} from "@tavern/shared";
import {
  buildAccountHeaders,
  type AccountIdHint,
  type TransportClient,
} from "../client/transport.js";

export type ModelCallsListOptions = Partial<ModelCallQuery> & {
  floorId: string;
  accountId?: AccountIdHint;
};
export type ModelCallsGetOptions = {
  floorId: string;
  callId: string;
  accountId?: AccountIdHint;
};
export interface ModelCallsResource {
  list(
    options: ModelCallsListOptions,
  ): Promise<{ data: ModelCallDetail[]; nextCursor: string | null }>;
  get(options: ModelCallsGetOptions): Promise<ModelCallDetail>;
}

export function createModelCallsResource(
  client: TransportClient,
): ModelCallsResource {
  return {
    async list({ floorId, accountId, ...input }) {
      const query = modelCallQuerySchema.parse(input);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const response = await client.fetchJson(
        `/floors/${encodeURIComponent(floorId)}/model-calls?${params}`,
        {
          headers: buildAccountHeaders(accountId),
          method: "GET",
        },
      );
      return modelCallListSchema.parse(response.body);
    },
    async get({ floorId, callId, accountId }) {
      const response = await client.fetchJson(
        `/floors/${encodeURIComponent(floorId)}/model-calls/${encodeURIComponent(callId)}`,
        {
          headers: buildAccountHeaders(accountId),
          method: "GET",
        },
      );
      return modelCallDetailSchema.parse(response.body);
    },
  };
}
