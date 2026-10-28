import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";
describe("user Web paged resources", () => {
  it("preserves total counts separately from loaded records and sends browser credentials", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              data: [],
              meta: { total: 27, limit: 1, offset: 0 },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );
    const client = createTavernClient({
      baseUrl: "http://example.test",
      fetchImpl,
      credentials: "include",
    });
    expect(await client.users.listPage({ limit: 1 })).toEqual({
      items: [],
      total: 27,
    });
    expect(await client.sessions.listPage({ limit: 1 })).toEqual({
      items: [],
      total: 27,
    });
    expect(await client.sessions.list({ limit: 1 })).toEqual([]);
    expect(
      fetchImpl.mock.calls.every(([, init]) => init?.credentials === "include"),
    ).toBe(true);
  });
});
