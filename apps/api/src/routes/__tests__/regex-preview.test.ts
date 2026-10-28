import Fastify from "fastify";
import { describe, it, expect } from "vitest";
import { registerRegexPreviewRoutes } from "../regex-preview.js";
import { buildTestApp } from "../../../test/helpers/create-test-db.js";
const script = (name: string, extra: Record<string, unknown> = {}) => ({
  scriptName: name,
  findRegex: "a",
  replaceString: "b",
  placement: [2],
  maxDepth: -1,
  ...extra,
});
async function preview(payload: unknown) {
  const app = Fastify();
  await registerRegexPreviewRoutes(app);
  const response = await app.inject({
    method: "POST",
    url: "/regex-profiles/preview",
    payload: payload as object,
  });
  await app.close();
  return response;
}
describe("formal regex preview", () => {
  it("registers the preview and model tools in the built API", async () => {
    const built = await buildTestApp({ databasePath: ":memory:", logger: false, auth: { mode: "off" } });
    try {
      await built.app.ready();
      expect(built.app.hasRoute({ method: "POST", url: "/regex-profiles/preview" })).toBe(true);
      expect(built.app.hasRoute({ method: "POST", url: "/llm-profiles/models/discover" })).toBe(true);
      expect(built.app.hasRoute({ method: "POST", url: "/llm-profiles/models/test" })).toBe(true);
      const response = await built.app.inject({
        method: "POST", url: "/regex-profiles/preview",
        payload: { text: "a", scripts: [script("replace")], placement: 2, channel: "persist" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.text).toBe("b");
    } finally {
      await built.app.close();
    }
  });
  it("uses real channel/depth/placement filters and order", async () => {
    const response = await preview({
      text: "a",
      placement: 2,
      channel: "display",
      depth: 2,
      scripts: [
        script("display", { markdownOnly: true }),
        script("next", {
          findRegex: "b",
          replaceString: "c",
          markdownOnly: true,
        }),
        script("prompt", { promptOnly: true }),
        script("depth", { markdownOnly: true, minDepth: 5 }),
        script("input", { placement: [1] }),
      ],
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.text).toBe("c");
    expect(result.matched_rule_names).toEqual(["display", "next"]);
    expect(result.skipped_rules).toEqual([
      { rule_name: "prompt", reason: "channel_filtered" },
      { rule_name: "depth", reason: "depth_filtered" },
    ]);
  });
  it("reports invalid patterns and respects disabled", async () => {
    const r = await preview({
      text: "a",
      placement: 2,
      channel: "persist",
      scripts: [
        script("disabled", { disabled: true }),
        script("invalid", { findRegex: "[" }),
      ],
    });
    expect(r.json().data.text).toBe("a");
    expect(r.json().data.skipped_rules[0].reason).toBe("invalid_regex");
  });
  it("accepts empty input and rejects invalid context", async () => {
    expect(
      (
        await preview({
          text: "",
          scripts: [],
          placement: 2,
          channel: "persist",
        })
      ).json().data.text,
    ).toBe("");
    expect(
      (
        await preview({
          text: "a",
          scripts: [],
          placement: 5,
          channel: "display",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("uses the server variable substituter", async () => {
    const r = await preview({
      text: "a",
      placement: 2,
      channel: "persist",
      variables: { name: "actor" },
      scripts: [script("replace", { replaceString: "{{name}}" })],
    });
    expect(r.json().data.text).toBe("actor");
  });
});
