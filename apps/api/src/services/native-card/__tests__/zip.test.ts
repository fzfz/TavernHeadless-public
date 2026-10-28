import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { NativeCardPackageFile } from "@tavern/shared";
import { NativeCardZipError, readNativeCardZip, writeNativeCardZip } from "../zip.js";

const limits = { maxUploadBytes: 4096, maxExpandedBytes: 1024, maxFileCount: 8, maxFileBytes: 512, maxPathBytes: 128 };

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ path: string; content?: string; method?: 0 | 8; fileType?: number }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const content = Buffer.from(entry.content ?? "", "utf8");
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(content) : content;
    const crc = crc32(content);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(content.length, 22); lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, compressed);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20); ch.writeUInt32LE(content.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((((entry.fileType ?? 0x8000) | 0o644) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, eocd]);
}

function addDataDescriptor(zip: Buffer): Buffer {
  const endOffset = zip.length - 22;
  const centralOffset = zip.readUInt32LE(endOffset + 16);
  const centralSize = zip.readUInt32LE(endOffset + 12);
  const central = Buffer.from(zip.subarray(centralOffset, centralOffset + centralSize));
  const local = Buffer.from(zip.subarray(0, centralOffset));
  local.writeUInt16LE(0x0808, 6);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(0, 18);
  local.writeUInt32LE(0, 22);
  central.writeUInt16LE(0x0808, 8);
  const descriptor = Buffer.alloc(12);
  descriptor.writeUInt32LE(central.readUInt32LE(16), 0);
  descriptor.writeUInt32LE(central.readUInt32LE(20), 4);
  descriptor.writeUInt32LE(central.readUInt32LE(24), 8);
  const end = Buffer.from(zip.subarray(endOffset));
  end.writeUInt32LE(centralOffset + descriptor.length, 16);
  return Buffer.concat([local, descriptor, central, end]);
}

function expectZipFailure(input: Uint8Array, expectedCode: "NATIVE_CARD_ZIP_INVALID" | "NATIVE_CARD_ZIP_TOO_LARGE", customLimits = limits) {
  try {
    readNativeCardZip(input, customLimits);
    throw new Error("Expected ZIP parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(NativeCardZipError);
    expect((error as NativeCardZipError).code).toBe(expectedCode);
  }
}

describe("native ZIP format", () => {
  it("round trips writer output with deflate and supports externally stored entries", () => {
    const files: NativeCardPackageFile[] = [{ path: "character.json", content: Buffer.from('{"name":"Rin"}') }];
    expect(readNativeCardZip(writeNativeCardZip(files), limits).map((file) => [file.path, Buffer.from(file.content).toString()])).toEqual([["character.json", '{"name":"Rin"}']]);
    expect(readNativeCardZip(makeZip([{ path: "character.json", content: '{"name":"Rin"}' }]), limits)[0]?.path).toBe("character.json");
    expect(readNativeCardZip(makeZip([{ path: "worldbooks/", fileType: 0x4000 }, { path: "worldbooks/main.json", content: "{}" }]), limits)).toHaveLength(1);
    expect(Buffer.from(readNativeCardZip(addDataDescriptor(makeZip([{ path: "a.txt", content: "descriptor" }])), limits)[0]!.content).toString()).toBe("descriptor");
  });

  it("rejects a bad CRC and truncated records", () => {
    const badCrc = makeZip([{ path: "a.txt", content: "abc" }]);
    const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    badCrc.writeUInt32LE(1, central + 16);
    expectZipFailure(badCrc, "NATIVE_CARD_ZIP_INVALID");
    expectZipFailure(Buffer.from([0x50, 0x4b, 0x03]), "NATIVE_CARD_ZIP_INVALID");
  });

  it("rejects unsafe paths, duplicate paths, and file-directory collisions", () => {
    expectZipFailure(makeZip([{ path: "../outside.txt" }]), "NATIVE_CARD_ZIP_INVALID");
    expectZipFailure(makeZip([{ path: "a.txt" }, { path: "a.txt" }]), "NATIVE_CARD_ZIP_INVALID");
    expectZipFailure(makeZip([{ path: "parent", content: "x" }, { path: "parent/child.txt", content: "y" }]), "NATIVE_CARD_ZIP_INVALID");
    expectZipFailure(makeZip([{ path: "parent/child.txt", content: "y" }, { path: "parent", content: "x" }]), "NATIVE_CARD_ZIP_INVALID");
  });

  it("rejects symlink entries and unsupported compression methods", () => {
    expectZipFailure(makeZip([{ path: "link", content: "target", fileType: 0xa000 }]), "NATIVE_CARD_ZIP_INVALID");
    const unsupported = makeZip([{ path: "a.txt", content: "x" }]);
    unsupported.writeUInt16LE(12, unsupported.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])) + 8);
    unsupported.writeUInt16LE(12, unsupported.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    expectZipFailure(unsupported, "NATIVE_CARD_ZIP_INVALID");
  });

  it("enforces upload, expanded, per-file, count, and path limits", () => {
    const valid = makeZip([{ path: "a.txt", content: "12345" }]);
    expectZipFailure(valid, "NATIVE_CARD_ZIP_TOO_LARGE", { ...limits, maxUploadBytes: valid.length - 1 });
    expectZipFailure(valid, "NATIVE_CARD_ZIP_TOO_LARGE", { ...limits, maxFileBytes: 4 });
    expectZipFailure(valid, "NATIVE_CARD_ZIP_TOO_LARGE", { ...limits, maxExpandedBytes: 4 });
    expectZipFailure(makeZip([{ path: "a.txt" }, { path: "b.txt" }]), "NATIVE_CARD_ZIP_TOO_LARGE", { ...limits, maxFileCount: 1 });
    expectZipFailure(makeZip([{ path: "long-file-name.txt" }]), "NATIVE_CARD_ZIP_TOO_LARGE", { ...limits, maxPathBytes: 3 });
  });

  it("rejects writer duplicates and unsupported archive signatures", () => {
    expect(() => writeNativeCardZip([{ path: "a", content: Buffer.alloc(0) }, { path: "a", content: Buffer.alloc(0) }])).toThrow(NativeCardZipError);
    expectZipFailure(Buffer.alloc(22), "NATIVE_CARD_ZIP_INVALID");
  });

  it("rejects local-header disagreement, split archives, and ZIP64 markers", () => {
    const flagsMismatch = makeZip([{ path: "a.txt", content: "x" }]);
    flagsMismatch.writeUInt16LE(0, 6);
    expectZipFailure(flagsMismatch, "NATIVE_CARD_ZIP_INVALID");
    const split = makeZip([{ path: "a.txt", content: "x" }]);
    split.writeUInt16LE(1, split.length - 18);
    expectZipFailure(split, "NATIVE_CARD_ZIP_INVALID");
    const zip64 = makeZip([{ path: "a.txt", content: "x" }]);
    zip64.writeUInt16LE(0xffff, zip64.length - 12);
    expectZipFailure(zip64, "NATIVE_CARD_ZIP_INVALID");
  });
});
