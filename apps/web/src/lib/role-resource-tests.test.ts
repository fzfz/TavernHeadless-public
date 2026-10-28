import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "@tavern/sdk";
import { reactive } from "vue";
import { createResourceTestTracker, modelProbeOptions, previewRoleRegex, snapshotRoleResource } from "./role-resource-tests.js";
import type { RoleResourceDocument } from "./role-resource.schema.js";

const regexDocument: RoleResourceDocument = {
  id: "regex-1",
  name: "测试",
  value: {},
  entries: [{ scriptName: "替换", findRegex: "/旧/g", replaceString: "新", placement: [2] }],
};
const modelDocument: RoleResourceDocument = {
  id: "profile-1",
  name: "模型",
  value: { provider: "openai", model_id: "current-model", base_url: "https://example.test/v1", api_key: "" },
};

describe("resource test tools", () => {
  it("previews unsaved regex rules with the selected execution context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        text: "新",
        candidate_rule_names: ["替换"],
        matched_rule_names: ["替换"],
        skipped_rules: [],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createTavernClient({ baseUrl: "http://local.test", fetchImpl });
    const result = await previewRoleRegex(client, regexDocument, {
      text: "旧", placement: 2, channel: "display", depth: 3,
      variables: '{"name":"甲"}',
    });
    expect(result.text).toBe("新");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://local.test/regex-profiles/preview");
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({
      text: "旧", scripts: regexDocument.entries, placement: 2,
      channel: "display", depth: 3, variables: { name: "甲" },
    });
  });

  it.each(["[]", "null", "{bad"])("rejects invalid macro variables %s before sending", async (variables) => {
    const fetchImpl = vi.fn();
    const client = createTavernClient({ baseUrl: "http://local.test", fetchImpl });
    await expect(previewRoleRegex(client, regexDocument, {
      text: "", placement: 1, channel: "prompt", depth: 0, variables,
    })).rejects.toThrow("invalidVariables");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid depth and rule structure before sending", async () => {
    const fetchImpl = vi.fn();
    const client = createTavernClient({ baseUrl: "http://local.test", fetchImpl });
    const options = { text: "", placement: 2 as const, channel: "persist" as const, depth: -1, variables: "{}" };
    await expect(previewRoleRegex(client, regexDocument, options)).rejects.toThrow("invalidDepth");
    await expect(previewRoleRegex(client, { ...regexDocument, entries: [{}] }, { ...options, depth: 0 })).rejects.toThrow("invalidRules");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a server rejection and rejects an incomplete preview response", async () => {
    const rejected = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: { code: "INVALID_REQUEST", message: "规则格式无效" },
      }), { status: 400, headers: { "content-type": "application/json" } })),
    });
    const options = { text: "旧", placement: 2 as const, channel: "persist" as const, depth: 0, variables: "{}" };
    await expect(previewRoleRegex(rejected, regexDocument, options)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const malformed = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { text: "新" } }), {
        status: 200, headers: { "content-type": "application/json" },
      })),
    });
    await expect(previewRoleRegex(malformed, regexDocument, options)).rejects.toThrow();
  });

  it("uses the edited key, provider, URL and model for an unsaved model", () => {
    expect(modelProbeOptions({ ...modelDocument, id: "", value: {
      ...modelDocument.value, provider: "anthropic", api_key: "new-key",
    } }, undefined, "test")).toEqual({
      provider: "anthropic", apiKey: "new-key", baseUrl: "https://example.test/v1", modelId: "current-model",
    });
  });

  it("reuses a saved secret while honoring edited URL and model", () => {
    expect(modelProbeOptions({ ...modelDocument, value: {
      ...modelDocument.value, base_url: "https://changed.test/v1", model_id: "edited-model",
    } }, modelDocument, "test")).toEqual({
      profileId: "profile-1", baseUrl: "https://changed.test/v1", modelId: "edited-model",
    });
    expect(modelProbeOptions(modelDocument, modelDocument, "discover")).toEqual({
      profileId: "profile-1", baseUrl: "https://example.test/v1",
    });
  });

  it("snapshots a reactive edited model for saved-secret reuse", () => {
    const edited = reactive(structuredClone(modelDocument));
    const saved = snapshotRoleResource(edited);
    edited.value.model_id = "next-model";
    expect(saved.value.model_id).toBe("current-model");
    expect(modelProbeOptions(edited, saved, "discover")).toEqual({
      profileId: "profile-1", baseUrl: "https://example.test/v1",
    });
  });

  it("invalidates an earlier test when the selected resource changes", () => {
    const tracker = createResourceTestTracker();
    const oldToken = tracker.begin();
    tracker.invalidate();
    const newToken = tracker.begin();
    expect(tracker.isCurrent(oldToken)).toBe(false);
    expect(tracker.isCurrent(newToken)).toBe(true);
  });

  it("requires a key when a saved secret cannot represent edited settings", () => {
    expect(() => modelProbeOptions({ ...modelDocument, value: {
      ...modelDocument.value, provider: "google",
    } }, modelDocument, "discover")).toThrow("keyRequired");
    expect(() => modelProbeOptions({ ...modelDocument, value: {
      ...modelDocument.value, base_url: "",
    } }, modelDocument, "discover")).toThrow("keyRequired");
    expect(() => modelProbeOptions({ ...modelDocument, value: {
      ...modelDocument.value, model_id: "",
    } }, modelDocument, "test")).toThrow("modelRequired");
  });
});
