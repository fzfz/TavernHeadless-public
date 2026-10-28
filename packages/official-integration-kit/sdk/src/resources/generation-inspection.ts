import {
  generationInspectionFloorSchema,
  generationInspectionPageSchema,
  generationInspectionMessageSchema,
  generationInspectionConfig as config,
  generationInspectionListSchema,
  type GenerationInspectionSection,
} from "@tavern/shared";
import {
  buildAccountHeaders,
  type AccountIdHint,
  type TransportClient,
} from "../client/transport.js";
export interface GenerationInspectionResource {
  load(options: {
    floorId: string;
    accountId?: AccountIdHint;
  }): Promise<GenerationInspectionSection[]>;
}
export function createGenerationInspectionResource(
  client: TransportClient,
): GenerationInspectionResource {
  return {
    async load({ floorId, accountId }) {
      const get = async (path: string) =>
        (
          await client.fetchJson<{ data: unknown }>(path, {
            method: "GET",
            headers: buildAccountHeaders(accountId),
          })
        ).body!.data;
      const list = async (path: string) => {
        const records: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 100) {
          const response = await client.fetchJson(
            `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`,
            { method: "GET", headers: buildAccountHeaders(accountId) },
          );
          const body = generationInspectionListSchema.parse(response.body);
          records.push(...body.data);
          if (!body.meta?.has_more) return records;
        }
      };
      const floor = generationInspectionFloorSchema.parse(
        await get(`/floors/${encodeURIComponent(floorId)}`),
      );
      const pages = (
        await list(`/pages?floor_id=${encodeURIComponent(floorId)}`)
      ).map((page) => generationInspectionPageSchema.parse(page));
      const specs = config.floor.map((s) => ({
        ...s,
        path: s.path
          .replaceAll("{floor}", encodeURIComponent(floorId))
          .replaceAll("{session}", encodeURIComponent(floor.session_id)),
      }));
      for (const page of pages) {
        for (const spec of config.page)
          specs.push({
            ...spec,
            key: `${page.id}:${spec.key}`,
            label: `${config.ui.page} ${page.page_no} · ${spec.label}`,
            path: spec.path.replaceAll(
              "{page}",
              encodeURIComponent(String(page.id)),
            ),
          });
        const messages = (
          await list(`/messages?page_id=${encodeURIComponent(String(page.id))}`)
        ).map((message) => generationInspectionMessageSchema.parse(message));
        for (const message of messages)
          for (const spec of config.message)
            specs.push({
              ...spec,
              key: `${message.id}:${spec.key}`,
              label: `${config.ui.page} ${page.page_no} · ${config.ui.message} ${message.seq} · ${spec.label}`,
              path: spec.path.replaceAll(
                "{message}",
                encodeURIComponent(String(message.id)),
              ),
            });
      }
      const selected = specs.filter(
        (s) => !s.committed || floor.state === "committed",
      );
      return Promise.all(
        selected.map(async (spec) => {
          try {
            return {
              key: spec.key,
              label: spec.label,
              value: spec.list ? await list(spec.path) : await get(spec.path),
            };
          } catch (error) {
            return {
              key: spec.key,
              label: spec.label,
              error:
                error &&
                typeof error === "object" &&
                "code" in error &&
                typeof error.code === "string"
                  ? error.code
                  : "ROLE_USER_REQUEST_FAILED",
            };
          }
        }),
      );
    },
  };
}
