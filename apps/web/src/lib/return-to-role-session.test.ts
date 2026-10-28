import { describe, expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import { returnToRoleSession } from "./return-to-role-session.js";
const config = vi.fn(
  async () =>
    new Response(JSON.stringify({ userWebBaseUrl: "http://127.0.0.1:5174" }), {
      status: 200,
    }),
);
function client(metadata: unknown) {
  return {
    sessions: { getDetail: vi.fn(async () => ({ metadata })) },
  } as unknown as TavernClient;
}
describe("return to the original role session", () => {
  it("returns directly to the selected formal session", async () => {
    const api = client({ role_release_id: "release" });
    expect(await returnToRoleSession(api, "session", config)).toBe(
      "http://127.0.0.1:5174/?sessionId=session",
    );
  });
  it("returns directly to the inspected preview session and floor", async () => {
    const api = client({
      role_preview: {
        draft_id: "draft",
        draft_revision: 2,
        creator_id: "admin",
      },
    });
    const url = new URL(
      await returnToRoleSession(api, "preview", config, "snapshot-selected"),
    );
    expect(url.searchParams.get("sessionId")).toBe("preview");
    expect(url.searchParams.get("snapshotId")).toBe("snapshot-selected");
    expect(url.searchParams.get("handoff")).toBeNull();
  });
  it("stops when the user application destination cannot be loaded", async () => {
    const api = client({});
    await expect(
      returnToRoleSession(
        api,
        "session",
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toMatchObject({ code: "ROLE_APP_CONFIG_INVALID" });
    expect(api.sessions.getDetail).not.toHaveBeenCalled();
  });
  it("propagates an expired or unauthorized session rather than opening a different one", async () => {
    const api = client({});
    vi.mocked(api.sessions.getDetail).mockRejectedValue(new Error("denied"));
    await expect(returnToRoleSession(api, "session", config)).rejects.toThrow(
      "denied",
    );
  });
});
