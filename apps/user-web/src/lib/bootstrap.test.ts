import { expect, it, vi } from "vitest";
import { bootstrapRoleApplication } from "./bootstrap.js";
import policy from "../../public/config/runtime-policy.json";
const config = {
  apiBaseUrl: "https://api.example",
  adminBaseUrl: "https://admin.example",
};
const preview = { draft_id: "draft", draft_revision: 3, creator_id: "local" };
function setup(
  metadata: unknown = { role_preview: preview },
  characterName: string | null = "Snapshot character",
) {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/config/application.json") return Response.json(config);
      if (path === "/config/runtime-policy.json") return Response.json(policy);
      if (path === "https://api.example/sessions/s") {
        expect(new Headers(init?.headers).has("x-tavern-preview-key")).toBe(
          false,
        );
        return Response.json({
          data: {
            id: "s",
            title: "Renamed conversation title",
            metadata,
            character_binding: characterName
              ? { snapshot_summary: { name: characterName } }
              : null,
          },
        });
      }
      throw new Error("Unexpected request " + path);
    },
  );
  return fetchImpl;
}
it("opens and reloads a draft preview directly from its session URL", async () => {
  const fetchImpl = setup();
  for (let visit = 0; visit < 2; visit++) {
    const context = await bootstrapRoleApplication(
      new URL(
        "https://user.example/?sessionId=s&snapshotId=snapshot-f&floorId=legacy-floor",
      ),
      fetchImpl,
    );
    expect(context.preview).toEqual(preview);
    expect(context.sessionId).toBe("s");
    expect(context.snapshotId).toBe("snapshot-f");
    expect(context).not.toHaveProperty("floorId");
    expect(context.characterName).toBe("Snapshot character");
    expect(context.roleReleaseId).toBeNull();
  }
  expect(fetchImpl).toHaveBeenCalledTimes(6);
});
it("opens the catalog with no session request", async () => {
  const fetchImpl = setup();
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/"),
    fetchImpl,
  );
  expect(context.preview).toBeNull();
  expect(context.sessionId).toBeNull();
  expect(context.characterName).toBeNull();
  expect(context.roleReleaseId).toBeNull();
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it.each([
  { metadata: null, roleReleaseId: null },
  { metadata: { role_release_id: "release" }, roleReleaseId: "release" },
  { metadata: { role_preview: { draft_id: "draft" } }, roleReleaseId: null },
])(
  "does not classify ordinary or incomplete metadata as a draft preview: %j",
  async ({ metadata, roleReleaseId }) => {
    const context = await bootstrapRoleApplication(
      new URL("https://user.example/?sessionId=s"),
      setup(metadata),
    );
    expect(context.preview).toBeNull();
    expect(context.roleReleaseId).toBe(roleReleaseId);
    expect(context.characterName).toBe("Snapshot character");
  },
);
it("exposes the exact formal release identity bound to a session", async () => {
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/?sessionId=s"),
    setup({ role_release_id: "release-pinned" }),
  );
  expect(context.roleReleaseId).toBe("release-pinned");
  expect(context.preview).toBeNull();
});
it("reads the fixed character name from binding instead of the mutable session title", async () => {
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/?sessionId=s"),
    setup({ role_release_id: "release-pinned" }, "Pinned character name"),
  );
  expect(context.characterName).toBe("Pinned character name");
});
it("keeps the fixed role label when the session binding has no character name", async () => {
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/?sessionId=s"),
    setup({ role_release_id: "release-pinned" }, null),
  );
  expect(context.characterName).toBeNull();
});
it("keeps preview identity when metadata also contains a release id", async () => {
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/?sessionId=s"),
    setup({ role_preview: preview, role_release_id: "release-pinned" }),
  );
  expect(context.preview).toEqual(preview);
  expect(context.roleReleaseId).toBeNull();
});
it("rejects invalid runtime configuration before requesting a session", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
    Response.json(String(input).endsWith("application.json") ? config : {}),
  );
  await expect(
    bootstrapRoleApplication(
      new URL("https://user.example/?sessionId=s"),
      fetchImpl,
    ),
  ).rejects.toMatchObject({ code: "ROLE_USER_CONFIG_INVALID" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it("preserves a session request failure and the return address", async () => {
  const fetchImpl = setup();
  fetchImpl
    .mockImplementationOnce(async () => Response.json(config))
    .mockImplementationOnce(async () => Response.json(policy))
    .mockImplementationOnce(async () =>
      Response.json(
        { error: { code: "session_not_found", message: "missing" } },
        { status: 404 },
      ),
    );
  await expect(
    bootstrapRoleApplication(
      new URL("https://user.example/?sessionId=s"),
      fetchImpl,
    ),
  ).rejects.toMatchObject({
    code: "session_not_found",
    adminBaseUrl: config.adminBaseUrl,
  });
});
it("resolves a same-origin API prefix and sends browser credentials", async () => {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/config/application.json")
        return Response.json({ ...config, apiBaseUrl: "/api" });
      if (path === "/config/runtime-policy.json") return Response.json(policy);
      expect(path).toBe("https://user.example/api/sessions/s");
      expect(init?.credentials).toBe("include");
      return Response.json({ data: { id: "s", metadata: null } });
    },
  );
  const context = await bootstrapRoleApplication(
    new URL("https://user.example/?sessionId=s"),
    fetchImpl,
  );
  expect(context.config.apiBaseUrl).toBe("https://user.example/api");
});
