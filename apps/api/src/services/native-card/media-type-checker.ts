import { nativeCardFileRules } from "@tavern/shared";

type AssetMediaFormat = (typeof nativeCardFileRules.assetMediaFormats)[number];
type SignaturePart = NonNullable<AssetMediaFormat["signatures"]>[number][number];

export type NativeCardMediaCheck =
  | { status: "matched"; formatId: string }
  | { status: "unsupported" }
  | { status: "mismatch"; formatId: string };

function matchesSignature(bytes: Uint8Array, signature: readonly SignaturePart[]): boolean {
  return signature.every((part) => part.bytes.every((expected, index) => {
    const actual = bytes[part.offset + index];
    if (actual === undefined) return false;
    const mask = part.mask?.[index] ?? 0xff;
    return (actual & mask) === (expected & mask);
  }));
}

function matchesConfiguredFormat(bytes: Uint8Array, format: AssetMediaFormat): boolean {
  if (format.signatures?.length && !format.signatures.some((signature) => matchesSignature(bytes, signature))) return false;
  if (format.textPattern) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return false; }
    let pattern: RegExp;
    try { pattern = new RegExp(format.textPattern); }
    catch { return false; }
    if (!pattern.test(text)) return false;
  }
  return true;
}

function mp3FrameAt(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + 4 > bytes.length) return false;
  const header = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return false;
  const version = (header >>> 19) & 0b11;
  const layer = (header >>> 17) & 0b11;
  const bitrate = (header >>> 12) & 0b1111;
  const sampleRate = (header >>> 10) & 0b11;
  return version !== 0b01 && layer !== 0 && bitrate !== 0 && bitrate !== 0b1111 && sampleRate !== 0b11;
}

function hasValidMp3Frame(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes.length < 10) return false;
    for (let index = 6; index < 10; index += 1) if ((bytes[index]! & 0x80) !== 0) return false;
    const tagSize = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
    const footerSize = (bytes[5]! & 0x10) !== 0 ? 10 : 0;
    const frameOffset = 10 + tagSize + footerSize;
    return frameOffset <= bytes.length - 4 && mp3FrameAt(bytes, frameOffset);
  }
  return mp3FrameAt(bytes, 0);
}

function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; next: number } | undefined {
  const first = bytes[offset];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  let marker = 0x80;
  while ((first & marker) === 0 && length <= 8) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (marker - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return Number.isSafeInteger(value) ? { value, next: offset + length } : undefined;
}

function hasWebmDocType(bytes: Uint8Array): boolean {
  if (bytes.length < 5 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return false;
  const headerSize = readVint(bytes, 4, false);
  if (!headerSize) return false;
  const end = headerSize.next + headerSize.value;
  if (end > bytes.length) return false;
  let offset = headerSize.next;
  while (offset < end) {
    const id = readVint(bytes, offset, true);
    if (!id) return false;
    const size = readVint(bytes, id.next, false);
    if (!size) return false;
    const valueEnd = size.next + size.value;
    if (valueEnd > end) return false;
    if (id.value === 0x4282) {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(size.next, valueEnd)) === "webm"; }
      catch { return false; }
    }
    offset = valueEnd;
  }
  return false;
}

function expectedMajorBrands(format: AssetMediaFormat): Uint8Array[] {
  return (format.signatures ?? [])
    .flatMap((signature) => {
      const part = signature.find((item) => item.offset === 4 && item.bytes.length >= 8);
      return part ? [Uint8Array.from(part.bytes.slice(4, 8))] : [];
    });
}

function hasValidFtypBox(bytes: Uint8Array, format: AssetMediaFormat): boolean {
  if (bytes.length < 16 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (boxSize < 16 || boxSize > bytes.length) return false;
  const majorBrand = bytes.subarray(8, 12);
  return expectedMajorBrands(format).some((brand) => brand.every((byte, index) => majorBrand[index] === byte));
}

function hasRequiredContainerStructure(bytes: Uint8Array, format: AssetMediaFormat): boolean {
  switch (format.id) {
    case "mp3": return hasValidMp3Frame(bytes);
    case "webm": return hasWebmDocType(bytes);
    case "mp4":
    case "avif": return hasValidFtypBox(bytes, format);
    default: return true;
  }
}

export function checkNativeCardMediaType(mediaType: string, bytes: Uint8Array): NativeCardMediaCheck {
  const format = nativeCardFileRules.assetMediaFormats.find((candidate) => candidate.mediaTypes.includes(mediaType));
  if (!format) return { status: "unsupported" };
  if (!matchesConfiguredFormat(bytes, format) || !hasRequiredContainerStructure(bytes, format)) {
    return { status: "mismatch", formatId: format.id };
  }
  return { status: "matched", formatId: format.id };
}

export function validateNativeCardMediaFiles(
  entries: readonly { path: string; mediaType: string; purpose: string }[],
  files: ReadonlyMap<string, Uint8Array>,
): Array<{ code: string; path: string; formatId?: string }> {
  const issues: Array<{ code: string; path: string; formatId?: string }> = [];
  for (const entry of entries) {
    if (entry.purpose !== "media") continue;
    const bytes = files.get(entry.path);
    if (!bytes) continue;
    const checked = checkNativeCardMediaType(entry.mediaType, bytes);
    if (checked.status === "unsupported") issues.push({ code: "NATIVE_CARD_MEDIA_TYPE_UNSUPPORTED", path: entry.path });
    else if (checked.status === "mismatch") issues.push({ code: "NATIVE_CARD_MEDIA_TYPE_MISMATCH", path: entry.path, formatId: checked.formatId });
  }
  return issues;
}
