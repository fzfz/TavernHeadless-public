import { describe, expect, it } from "vitest";
import { nativeCardFileRules } from "@tavern/shared";
import { checkNativeCardMediaType, validateNativeCardMediaFiles } from "../media-type-checker.js";

const formats = nativeCardFileRules.assetMediaFormats;

function signatureBytes(signature: NonNullable<(typeof formats)[number]["signatures"]>[number]): Uint8Array {
  const size = Math.max(24, ...signature.map((part) => part.offset + part.bytes.length));
  const bytes = new Uint8Array(size);
  for (const part of signature) {
    part.bytes.forEach((expected, index) => {
      const mask = part.mask?.[index] ?? 0xff;
      bytes[part.offset + index] = expected & mask;
    });
  }
  return bytes;
}

function validSample(formatId: string): Uint8Array {
  const format = formats.find((candidate) => candidate.id === formatId)!;
  if (format.id === "svg") return new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  if (format.id === "webm") return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
  if (format.id === "mp3") return Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
  const bytes = signatureBytes(format.signatures![0]!);
  if (format.id === "mp4" || format.id === "avif") bytes.set([0, 0, 0, bytes.length], 0);
  return bytes;
}

describe("native card media byte signatures", () => {
  it("accepts every configured media type using its actual signature or configured text pattern", () => {
    for (const format of formats) {
      for (const mediaType of format.mediaTypes) {
        expect(checkNativeCardMediaType(mediaType, validSample(format.id)), `${format.id} ${mediaType}`).toEqual({ status: "matched", formatId: format.id });
      }
    }
  });

  it("rejects mismatching bytes for every configured media type and reports unsupported declarations", () => {
    for (const format of formats) {
      for (const mediaType of format.mediaTypes) {
        expect(checkNativeCardMediaType(mediaType, new Uint8Array(64)), `${format.id} ${mediaType}`).toEqual({ status: "mismatch", formatId: format.id });
      }
    }
    expect(checkNativeCardMediaType("image/x-unlisted", new Uint8Array())).toEqual({ status: "unsupported" });
  });

  it("checks the WebM DocType, ISO-BMFF ftyp size and major brand, and MP3 frame following ID3", () => {
    const malformedWebm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);
    expect(checkNativeCardMediaType("video/webm", malformedWebm).status).toBe("mismatch");

    const malformedMp4 = validSample("mp4");
    malformedMp4.set([0, 0, 0, 8], 0);
    expect(checkNativeCardMediaType("video/mp4", malformedMp4).status).toBe("mismatch");
    const wrongBrand = validSample("avif");
    expect(checkNativeCardMediaType("video/mp4", wrongBrand).status).toBe("mismatch");

    expect(checkNativeCardMediaType("audio/mpeg", Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ status: "mismatch" });
    expect(checkNativeCardMediaType("audio/mpeg", Uint8Array.from([0xff, 0xe0, 0, 0]))).toMatchObject({ status: "mismatch" });
  });

  it("validates only manifest media records and returns actionable file-specific problems", () => {
    const files = new Map<string, Uint8Array>([
      ["assets/good.svg", validSample("svg")],
      ["assets/bad.png", new Uint8Array([0, 1, 2])],
    ]);
    expect(validateNativeCardMediaFiles([
      { path: "assets/good.svg", mediaType: "image/svg+xml", purpose: "media" },
      { path: "assets/bad.png", mediaType: "image/png", purpose: "media" },
      { path: "data/file.json", mediaType: "application/json", purpose: "data" },
    ], files)).toEqual([
      { code: "NATIVE_CARD_MEDIA_TYPE_MISMATCH", path: "assets/bad.png", formatId: "png" },
    ]);
    expect(validateNativeCardMediaFiles([
      { path: "assets/unlisted", mediaType: "image/x-unlisted", purpose: "media" },
    ], new Map([["assets/unlisted", new Uint8Array([1])]]))).toEqual([
      { code: "NATIVE_CARD_MEDIA_TYPE_UNSUPPORTED", path: "assets/unlisted" },
    ]);
  });
});
