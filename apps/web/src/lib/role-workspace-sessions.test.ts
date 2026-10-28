import { describe, it, expect, vi } from "vitest";
import { createTavernClient, type SessionRecord } from "@tavern/sdk";
import {
  isFormalRoleSession,
  listFormalRoleSessions,
} from "./role-workspace-sessions.js";
import { roleConfigurationIssues } from "./role-configuration-validation.js";
import defaults from "../config/role-app-defaults.json";
const response = (sessions: unknown[]) =>
  new Response(JSON.stringify({ data: sessions }), {
    headers: { "content-type": "application/json" },
  });
describe("management session navigation", () => {
  it("separates released role conversations from preview and unrelated sessions", () => {
    const session = (metadata: unknown) => ({ metadata }) as SessionRecord;
    expect(isFormalRoleSession(session({ role_release_id: "release" }))).toBe(
      true,
    );
    expect(
      isFormalRoleSession(
        session({
          role_preview: {
            draft_id: "draft",
            draft_revision: 1,
            creator_id: "admin",
          },
          role_release_id: "release",
        }),
      ),
    ).toBe(false);
    expect(isFormalRoleSession(session({}))).toBe(false);
    expect(isFormalRoleSession(session(null))).toBe(false);
  });
  it("continues pagination across a page with no formal sessions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: "ordinary", metadata: {} }]))
      .mockResolvedValueOnce(
        response([{ id: "formal", metadata: { role_release_id: "release" } }]),
      )
      .mockResolvedValueOnce(response([]));
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });
    expect(
      (await listFormalRoleSessions(client, 1)).map((item) => item.id),
    ).toEqual(["formal"]);
    expect(
      fetch.mock.calls.map(([url]) =>
        new URL(String(url)).searchParams.get("offset"),
      ),
    ).toEqual(["0", "1", "2"]);
  });
  it("reports request failure rather than presenting incomplete history as complete", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      listFormalRoleSessions(
        createTavernClient({ baseUrl: "http://local.test", fetchImpl: fetch }),
        30,
      ),
    ).rejects.toThrow("offline");
  });
});
describe("publication field feedback", () => {
  const valid = {
    ...defaults,
    name: "角色",
    character_id: "c",
    character_version_id: "cv",
    preset_id: "p",
    preset_version_id: "pv",
    regex_profile_id: "r",
    regex_profile_version_id: "rv",
    default_user_id: "u",
    model_slots: [{ slot: "narrator", profile_id: "model" }],
  };
  it("accepts a complete configuration", () =>
    expect(roleConfigurationIssues(valid)).toEqual([]));
  it("names each missing resource and model binding", () => {
    const errors = roleConfigurationIssues({
      ...valid,
      character_id: "",
      preset_id: "",
      model_slots: [{ slot: "narrator", profile_id: "" }],
    });
    expect(errors.map((error) => error.path)).toEqual([
      "角色卡",
      "提示词预设",
      "模型槽位 · 1 · LLM Profile",
    ]);
  });
  it("reports a missing worldbook version when a worldbook is selected", () => {
    expect(
      roleConfigurationIssues({
        ...valid,
        worldbook_id: "book",
        worldbook_version_id: null,
      }).map((error) => error.path),
    ).toContain("世界书 / 世界书版本");
  });
});
