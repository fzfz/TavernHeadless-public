import { describe, expect, it, vi } from "vitest";
import { createBrowserUuid } from "../index.js";

describe("createBrowserUuid", () => {
  it.each([
    {
      bytes: new Uint8Array(16),
      expected: "00000000-0000-4000-8000-000000000000",
    },
    {
      bytes: new Uint8Array(16).fill(0xff),
      expected: "ffffffff-ffff-4fff-bfff-ffffffffffff",
    },
    {
      bytes: Uint8Array.from([
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
        0xcc, 0xdd, 0xee, 0xff,
      ]),
      expected: "00112233-4455-4677-8899-aabbccddeeff",
    },
  ])(
    "creates UUID v4 $expected using Web Crypto bytes",
    ({ bytes, expected }) => {
      const getRandomValues = vi.fn((target: Uint8Array) => {
        target.set(bytes);
        return target;
      });
      vi.stubGlobal("crypto", { getRandomValues });
      const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => {
        throw new Error("Math.random must not generate UUIDs");
      });
      try {
        expect(createBrowserUuid()).toBe(expected);
        expect(getRandomValues).toHaveBeenCalledOnce();
        expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
        expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
      } finally {
        mathRandom.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );
});
