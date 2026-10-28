import { deflateRawSync, inflateRawSync } from "node:zlib";
import { roleAssetPathSchema } from "@tavern/shared";
import type { NativeCardPackageFile } from "@tavern/shared";

export class NativeCardZipError extends Error {
  constructor(readonly code: "NATIVE_CARD_ZIP_INVALID" | "NATIVE_CARD_ZIP_TOO_LARGE", message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "NativeCardZipError";
  }
}

export type NativeCardZipLimits = {
  maxUploadBytes: number;
  maxExpandedBytes: number;
  maxFileCount: number;
  maxFileBytes: number;
  maxPathBytes: number;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.byteLength) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP record is truncated.");
  return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.byteLength) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP record is truncated.");
  return buffer.readUInt32LE(offset);
}

function decodeName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "Non-ASCII ZIP paths must use the UTF-8 filename flag.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP filename is not valid UTF-8."); }
}

function findEndRecord(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = readU16(buffer, offset + 20);
      if (offset + 22 + commentLength === buffer.byteLength) return offset;
    }
  }
  throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP end-of-central-directory record is missing.");
}

function checkPath(name: string, isDirectory: boolean, maxPathBytes: number): string {
  if (Buffer.byteLength(name, "utf8") > maxPathBytes) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP path exceeds the configured path size limit.", { path: name, maxPathBytes });
  const path = isDirectory ? name.slice(0, -1) : name;
  if (!path || !roleAssetPathSchema.safeParse(path).success) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP contains a path that is not safe and package-relative.", { path: name });
  return path;
}

export function readNativeCardZip(input: Uint8Array, limits: NativeCardZipLimits): NativeCardPackageFile[] {
  const buffer = Buffer.from(input);
  if (buffer.byteLength > limits.maxUploadBytes) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP exceeds the configured upload size limit.", { maxUploadBytes: limits.maxUploadBytes, actualBytes: buffer.byteLength });
  if (buffer.byteLength < 22) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP is too short to contain an end record.");
  const eocd = findEndRecord(buffer);
  const diskNo = readU16(buffer, eocd + 4);
  const centralDisk = readU16(buffer, eocd + 6);
  const diskEntries = readU16(buffer, eocd + 8);
  const totalEntries = readU16(buffer, eocd + 10);
  const centralSize = readU32(buffer, eocd + 12);
  const centralOffset = readU32(buffer, eocd + 16);
  if (diskNo !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "Multi-disk ZIP archives are not supported.");
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP64 archives are not supported.");
  if (centralOffset + centralSize > eocd || centralOffset > buffer.byteLength) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP central directory points outside the archive.");

  const files: NativeCardPackageFile[] = [];
  const seen = new Map<string, "file" | "directory">();
  const localRanges: Array<{ start: number; end: number; path: string }> = [];
  let expandedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (readU32(buffer, cursor) !== 0x02014b50) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP central directory entry is malformed.", { index });
    const madeBy = readU16(buffer, cursor + 4);
    const flags = readU16(buffer, cursor + 8);
    const method = readU16(buffer, cursor + 10);
    const expectedCrc = readU32(buffer, cursor + 16);
    const compressedSize = readU32(buffer, cursor + 20);
    const expandedSize = readU32(buffer, cursor + 24);
    const nameLength = readU16(buffer, cursor + 28);
    const extraLength = readU16(buffer, cursor + 30);
    const commentLength = readU16(buffer, cursor + 32);
    const startDisk = readU16(buffer, cursor + 34);
    const externalAttributes = readU32(buffer, cursor + 38);
    const localOffset = readU32(buffer, cursor + 42);
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff || startDisk !== 0) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP64 or split archive entries are not supported.", { index });
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralOffset + centralSize) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP central directory entry is truncated.", { index });
    const filenameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const rawName = decodeName(filenameBytes, (flags & 0x0800) !== 0);
    const isDirectory = rawName.endsWith("/");
    const path = checkPath(rawName, isDirectory, limits.maxPathBytes);
    if ((flags & 0x0001) !== 0) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "Encrypted ZIP entries are not supported.", { path });
    if ((flags & 0x0040) !== 0) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "Strongly encrypted ZIP entries are not supported.", { path });
    if (method !== 0 && method !== 8) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "Only stored and deflated ZIP entries are supported.", { path, method });
    const allowedFlags = 0x0800 | 0x0008 | (method === 8 ? 0x0006 : 0);
    if ((flags & ~allowedFlags) !== 0) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP entry uses unsupported general-purpose flags.", { path, flags });
    const hostSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0xf000;
    if (hostSystem === 3 && fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP links and special filesystem entries are not supported.", { path, fileType });
    if (isDirectory && fileType !== 0 && fileType !== 0x4000) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory entry has an incompatible filesystem type.", { path });
    const priorKind = seen.get(path);
    if (priorKind) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP contains duplicate paths or file-directory collisions.", { path });
    seen.set(path, isDirectory ? "directory" : "file");
    for (const parent of path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))) {
      if (seen.get(parent) === "file") throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP path is nested under an entry that is also a file.", { path, parent });
    }
    if (!isDirectory && [...seen.keys()].some((existing) => existing.startsWith(`${path}/`))) {
      throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP file entry conflicts with an already declared directory path.", { path });
    }
    if (expandedSize > limits.maxFileBytes) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP entry exceeds the configured file size limit.", { path, maxFileBytes: limits.maxFileBytes });
    expandedBytes += expandedSize;
    if (expandedBytes > limits.maxExpandedBytes) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP expanded contents exceed the configured total size limit.", { maxExpandedBytes: limits.maxExpandedBytes });
    if (isDirectory && (expandedSize !== 0 || compressedSize !== 0)) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory entries cannot contain file data.", { path });
    if (!isDirectory && files.length >= limits.maxFileCount) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP contains more files than the configured limit.", { maxFileCount: limits.maxFileCount });

    if (!isDirectory) {
      if (readU32(buffer, localOffset) !== 0x04034b50) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP local file header is malformed.", { path });
      const localFlags = readU16(buffer, localOffset + 6);
      const localMethod = readU16(buffer, localOffset + 8);
      const localNameLength = readU16(buffer, localOffset + 26);
      const localExtraLength = readU16(buffer, localOffset + 28);
      const localNameStart = localOffset + 30;
      const localNameEnd = localNameStart + localNameLength;
      const dataStart = localNameEnd + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (localFlags !== flags || localMethod !== method) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP local and central headers disagree.", { path });
      if (localNameEnd > buffer.byteLength || dataEnd > centralOffset || dataEnd > buffer.byteLength) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP compressed data points outside the archive.", { path });
      if (!buffer.subarray(localNameStart, localNameEnd).equals(filenameBytes)) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP local and central filenames disagree.", { path });
      const localCrc = readU32(buffer, localOffset + 14);
      const localCompressedSize = readU32(buffer, localOffset + 18);
      const localExpandedSize = readU32(buffer, localOffset + 22);
      const usesDataDescriptor = (flags & 0x0008) !== 0;
      if (!usesDataDescriptor && (localCrc !== expectedCrc || localCompressedSize !== compressedSize || localExpandedSize !== expandedSize)) {
        throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP local sizes or CRC disagree with the central directory.", { path });
      }
      if (usesDataDescriptor && ((localCrc !== 0 && localCrc !== expectedCrc) || (localCompressedSize !== 0 && localCompressedSize !== compressedSize) || (localExpandedSize !== 0 && localExpandedSize !== expandedSize))) {
        throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP data-descriptor local header contains conflicting values.", { path });
      }
      let content: Buffer;
      try {
        const compressed = buffer.subarray(dataStart, dataEnd);
        content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: limits.maxFileBytes });
      } catch (cause) {
        throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP entry data is damaged or exceeds its size limit.", { path, cause: String(cause) });
      }
      if (content.byteLength !== expandedSize) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP expanded size does not match the central directory.", { path, expected: expandedSize, actual: content.byteLength });
      if (crc32(content) !== expectedCrc) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP CRC-32 check failed for this file.", { path });
      let rangeEnd = dataEnd;
      if (usesDataDescriptor) {
        let descriptorStart = dataEnd;
        if (readU32(buffer, descriptorStart) === 0x08074b50) descriptorStart += 4;
        const descriptorEnd = descriptorStart + 12;
        if (descriptorEnd > centralOffset || readU32(buffer, descriptorStart) !== expectedCrc || readU32(buffer, descriptorStart + 4) !== compressedSize || readU32(buffer, descriptorStart + 8) !== expandedSize) {
          throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP data descriptor is missing or disagrees with the central directory.", { path });
        }
        rangeEnd = descriptorEnd;
      }
      localRanges.push({ start: localOffset, end: rangeEnd, path });
      files.push({ path, content });
    } else {
      if (readU32(buffer, localOffset) !== 0x04034b50) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory local header is malformed.", { path });
      const localFlags = readU16(buffer, localOffset + 6);
      const localMethod = readU16(buffer, localOffset + 8);
      const localNameLength = readU16(buffer, localOffset + 26);
      const localExtraLength = readU16(buffer, localOffset + 28);
      const localNameStart = localOffset + 30;
      const localNameEnd = localNameStart + localNameLength;
      let rangeEnd = localNameEnd + localExtraLength;
      if (localFlags !== flags || localMethod !== method || localNameEnd > centralOffset || rangeEnd > centralOffset) {
        throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory local and central headers disagree.", { path });
      }
      if (!buffer.subarray(localNameStart, localNameEnd).equals(filenameBytes)) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory local and central filenames disagree.", { path });
      const usesDataDescriptor = (flags & 0x0008) !== 0;
      const localCrc = readU32(buffer, localOffset + 14);
      const localCompressedSize = readU32(buffer, localOffset + 18);
      const localExpandedSize = readU32(buffer, localOffset + 22);
      if ((!usesDataDescriptor && (localCrc !== 0 || localCompressedSize !== 0 || localExpandedSize !== 0)) ||
          (usesDataDescriptor && ((localCrc !== 0 && localCrc !== expectedCrc) || (localCompressedSize !== 0) || (localExpandedSize !== 0)))) {
        throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory local sizes or CRC are invalid.", { path });
      }
      if (usesDataDescriptor) {
        let descriptorStart = rangeEnd;
        if (readU32(buffer, descriptorStart) === 0x08074b50) descriptorStart += 4;
        const descriptorEnd = descriptorStart + 12;
        if (descriptorEnd > centralOffset || readU32(buffer, descriptorStart) !== 0 || readU32(buffer, descriptorStart + 4) !== 0 || readU32(buffer, descriptorStart + 8) !== 0) {
          throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP directory data descriptor is invalid.", { path });
        }
        rangeEnd = descriptorEnd;
      }
      localRanges.push({ start: localOffset, end: rangeEnd, path });
    }
    cursor = entryEnd;
  }
  if (cursor !== centralOffset + centralSize) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP central directory size does not match its entries.");
  localRanges.sort((a, b) => a.start - b.start);
  for (let index = 0; index < localRanges.length; index++) {
    const current = localRanges[index]!;
    if (current.end > centralOffset || (index > 0 && current.start < localRanges[index - 1]!.end)) {
      throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP local file records overlap or intersect the central directory.", { path: current.path });
    }
  }
  return files;
}

export function writeNativeCardZip(files: readonly NativeCardPackageFile[]): Buffer {
  const paths = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    roleAssetPathSchema.parse(file.path);
    if (paths.has(file.path)) throw new NativeCardZipError("NATIVE_CARD_ZIP_INVALID", "ZIP output contains duplicate package paths.", { path: file.path });
    paths.add(file.path);
    const name = Buffer.from(file.path, "utf8");
    const source = Buffer.from(file.content);
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    if (name.byteLength > 0xffff || source.byteLength > 0xffffffff || compressed.byteLength > 0xffffffff || offset > 0xffffffff) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP32 output limit was exceeded.", { path: file.path });
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(source.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(source.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.byteLength + name.byteLength + compressed.byteLength;
  }
  const central = Buffer.concat(centralParts);
  if (files.length > 0xffff || central.byteLength > 0xffffffff || offset > 0xffffffff) throw new NativeCardZipError("NATIVE_CARD_ZIP_TOO_LARGE", "ZIP32 output limit was exceeded.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}
