import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";

describe("SDK persona creation receipts", () => {
  it("sends the caller operation id for safe HTTP retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "persona-a",
            name: "林远",
            status: "active",
            revision: 0,
            created_at: 1,
            updated_at: 1,
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const client = createTavernClient({
      baseUrl: "http://example.test",
      fetchImpl,
    });
    await client.users.create({
      operationId: "create-lin-1",
      snapshot: { name: "林远", description: "书商" },
    });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toEqual({
      operation_id: "create-lin-1",
      snapshot: { name: "林远", description: "书商" },
    });
  });
});
