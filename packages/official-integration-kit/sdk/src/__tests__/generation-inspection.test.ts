import { expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
it.each(["committed", "failed"])(
  "loads %s classifications, page/message records and paginated entries",
  async (state) => {
    const paths: string[] = [];
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn(async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname + url.search);
        if (url.pathname === "/floors/f")
          return response({ data: { id: "f", session_id: "s", state } });
        if (url.pathname === "/pages")
          return response({ data: [{ id: "p", page_no: 1 }] });
        if (url.pathname === "/messages")
          return response({ data: [{ id: "m", seq: 2 }] });
        if (url.pathname.endsWith("/tool-executions"))
          return response({
            data: [{ offset: url.searchParams.get("offset") }],
            meta: { has_more: url.searchParams.get("offset") === "0" },
          });
        if (url.pathname.endsWith("/operation-logs"))
          return response(
            { error: { code: "denied", message: "Denied" } },
            403,
          );
        if (url.searchParams.has("limit")) return response({ data: [] });
        return response({ data: { present: true } });
      }),
    });
    const sections = await client.generationInspection.load({ floorId: "f" });
    expect(sections.find((s) => s.key === "tools")?.value).toHaveLength(2);
    expect(sections.find((s) => s.key === "operations")?.error).toBe("denied");
    expect(sections.some((s) => s.key === "p:staged")).toBe(true);
    expect(sections.some((s) => s.key === "m:messageRevisions")).toBe(
      state === "committed",
    );
    expect(sections.some((s) => s.key === "prompt")).toBe(
      state === "committed",
    );
    expect(paths).toContain("/floors/f/tool-executions?limit=100&offset=100");
  },
);
it("propagates missing floor and rejects malformed pagination", async () => {
  for (const body of [
    { error: { code: "missing", message: "Missing" } },
    { data: [] },
  ]) {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn(async (input) =>
        String(input).endsWith("/floors/f")
          ? response(body, "error" in body ? 404 : 200)
          : response({ data: "invalid" }),
      ),
    });
    await expect(
      client.generationInspection.load({ floorId: "f" }),
    ).rejects.toThrow();
  }
});

it.each(["floor", "page", "message"])(
  "rejects malformed %s identifiers before requesting category paths",
  async (invalid) => {
    const requested: string[] = [];
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn(async (input) => {
        const path = new URL(String(input)).pathname;
        requested.push(path);
        if (path === "/floors/f")
          return response({
            data:
              invalid === "floor"
                ? { id: "f", state: "committed" }
                : { id: "f", session_id: "s", state: "committed" },
          });
        if (path === "/pages")
          return response({
            data: [
              invalid === "page"
                ? { id: "p", page_no: "one" }
                : { id: "p", page_no: 1 },
            ],
          });
        return response({ data: [{ id: "m", seq: "invalid" }] });
      }),
    });
    await expect(
      client.generationInspection.load({ floorId: "f" }),
    ).rejects.toThrow();
    expect(requested.some((path) => path.includes("undefined"))).toBe(false);
  },
);
