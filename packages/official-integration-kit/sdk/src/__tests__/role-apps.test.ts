import { expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
import type { CreateRoleReleaseBody } from "@tavern/shared";
const configuration: CreateRoleReleaseBody = {
  name: "role",
  character_id: "c",
  character_version_id: "cv",
  preset_id: "p",
  preset_version_id: "pv",
  regex_profile_id: "r",
  regex_profile_version_id: "rv",
  worldbook_id: null,
  worldbook_version_id: null,
  prompt_mode: "native",
  default_user_id: "u",
  model_slots: [{ slot: "narrator", profile_id: "model" }],
};
it("preserves the selected versions and optimistic revision in draft writes", async () => {
  const fetchImpl = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          id: "draft",
          revision: input.expected_revision ? 2 : 1,
          configuration: input.configuration,
          updated_at: 100,
        },
      });
    },
  );
  const client = createTavernClient({
    baseUrl: "https://api.example",
    fetchImpl,
  });
  const draft = await client.roleApps.create({ configuration });
  expect(draft.configuration).toEqual(configuration);
  const updated = await client.roleApps.update({
    id: draft.id,
    expectedRevision: 1,
    configuration: { ...configuration, name: "updated" },
  });
  expect(updated.revision).toBe(2);
  expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("PUT");
  expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
    expected_revision: 1,
    configuration: { character_version_id: "cv", preset_version_id: "pv" },
  });
});
it("rejects invalid draft revisions and incomplete bindings before network requests", async () => {
  const fetchImpl = vi.fn();
  const client = createTavernClient({
    baseUrl: "https://api.example",
    fetchImpl,
  });
  expect(() =>
    client.roleApps.update({ id: "d", expectedRevision: 0, configuration }),
  ).toThrow();
  expect(() =>
    client.roleApps.create({
      configuration: { ...configuration, character_version_id: "" },
    }),
  ).toThrow();
  await expect(
    client.roleApps.createPreview({ id: "d", expectedRevision: 0 }),
  ).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("rejects malformed server draft and preview session responses", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ data: { id: "d" } }));
  const client = createTavernClient({
    baseUrl: "https://api.example",
    fetchImpl,
  });
  await expect(client.roleApps.get({ id: "d" })).rejects.toThrow();
  await expect(
    client.roleApps.createPreview({ id: "d", expectedRevision: 1 }),
  ).rejects.toThrow();
});
