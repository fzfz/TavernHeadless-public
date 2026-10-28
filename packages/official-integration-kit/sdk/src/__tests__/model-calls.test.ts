import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("model call history SDK", () => {
  it("sends encoded floor, run and pagination identifiers through the shared client", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [], nextCursor: null }));
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer test" }),
    });
    await expect(
      client.modelCalls.list({
        floorId: "floor/a",
        runId: "run b",
        attemptNo: 2,
        cursor: "call c",
        limit: 5,
      }),
    ).resolves.toEqual({ data: [], nextCursor: null });
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.test/floors/floor%2Fa/model-calls?runId=run+b&attemptNo=2&limit=5&cursor=call+c",
    );
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer test",
    );
  });

  it("rejects malformed successful payloads instead of inventing an empty history", async () => {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json({})),
    });
    await expect(
      client.modelCalls.list({ floorId: "floor" }),
    ).rejects.toThrow();
  });

  it("propagates detail access errors with the backend error code", async () => {
    const client = createTavernClient({
      baseUrl: "https://api.test",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json(
            {
              error: {
                code: "MODEL_CALL_ACCESS_DENIED",
                message: "Access denied",
              },
            },
            403,
          ),
        ),
    });
    await expect(
      client.modelCalls.get({ floorId: "floor", callId: "call" }),
    ).rejects.toMatchObject({ code: "MODEL_CALL_ACCESS_DENIED" });
  });
});
