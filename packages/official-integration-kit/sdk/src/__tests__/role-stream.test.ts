import { describe, expect, it, vi } from "vitest";
import { readSseStream } from "../stream/read-sse.js";

const done = 'event: done\ndata: {"floor_id":"floor-1","floor_no":1}\n\n';
function stream(parts: string[], close = true, cancel = vi.fn()) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(new TextEncoder().encode(part));
      if (close) controller.close();
    },
    cancel,
  });
  return { body, response: new Response(body), cancel };
}

describe("role response SSE", () => {
  it("delivers projected text across chunks and releases the reader", async () => {
    const input = stream([
      'event: role_text\ndata: {"text":"你好","phase":"stream',
      'ing"}\n\n',
      done,
    ]);
    const onRoleText = vi.fn();
    const result = await readSseStream(input.response, { onRoleText });
    expect(onRoleText).toHaveBeenCalledWith({
      text: "你好",
      phase: "streaming",
    });
    expect(result.floorId).toBe("floor-1");
    expect(input.body.locked).toBe(false);
  });

  it("rejects malformed projected text and cancels the unread stream", async () => {
    const input = stream(
      ['event: role_text\ndata: {"text":42,"phase":"streaming"}\n\n'],
      false,
    );
    await expect(readSseStream(input.response)).rejects.toThrow();
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(input.body.locked).toBe(false);
  });

  it("preserves a callback failure and releases the stream", async () => {
    const input = stream(
      ['event: role_text\ndata: {"text":"a","phase":"completed"}\n\n'],
      false,
    );
    const error = new Error("callback failed");
    await expect(
      readSseStream(input.response, {
        onRoleText() {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(input.body.locked).toBe(false);
  });

  it("retains both processing and cancellation failures", async () => {
    const processing = new Error("processing");
    const cleanup = new Error("cleanup");
    const input = stream(
      ['event: role_text\ndata: {"text":"a","phase":"completed"}\n\n'],
      false,
      vi.fn(() => {
        throw cleanup;
      }),
    );
    const result = await readSseStream(input.response, {
      onRoleText() {
        throw processing;
      },
    }).catch((error) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.errors).toEqual([processing, cleanup]);
    expect(input.body.locked).toBe(false);
  });

  it("preserves the failure stage and causes from an SSE error", async () => {
    const details = {
      call_id: "call",
      stage: "succeeded",
      error: {
        code: "MODEL_CALL_SAVE_FAILED",
        message: "save failed",
        causes: [{ code: "SQLITE_BUSY", message: "database locked" }],
      },
    };
    const input = stream([
      "event: error\ndata: " +
        JSON.stringify({
          code: "MODEL_CALL_SAVE_FAILED",
          message: "save failed",
          details,
        }) +
        "\n\n",
    ]);
    await expect(readSseStream(input.response)).rejects.toMatchObject({
      code: "MODEL_CALL_SAVE_FAILED",
      details,
    });
    expect(input.body.locked).toBe(false);
  });

  it("rejects an incomplete response and releases the reader", async () => {
    const input = stream([]);
    await expect(readSseStream(input.response)).rejects.toThrow(
      "Stream ended without final done payload",
    );
    expect(input.body.locked).toBe(false);
  });
});
