import { pngCard } from "./source-config.ts";

export function readPngCard(bytes: Buffer): Buffer {
  const signature = Buffer.from(pngCard.signature);
  if (!bytes.subarray(0, signature.length).equals(signature))
    throw new Error(pngCard.errors.signature);
  const texts = new Map<string, string>();
  let offset = signature.length;
  let ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(pngCard.errors.chunk);
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error(pngCard.errors.chunk);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === pngCard.textChunk) {
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const separator = data.indexOf(0);
      if (separator < 0) throw new Error(pngCard.errors.text);
      const key = data.toString("latin1", 0, separator).toLowerCase();
      if (!texts.has(key))
        texts.set(key, data.toString("latin1", separator + 1));
    }
    offset = end;
    if (type === pngCard.endChunk) {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error(pngCard.errors.end);
  for (const key of pngCard.metadataKeys) {
    const text = texts.get(key);
    if (text === undefined) continue;
    const decoded = Buffer.from(text, "base64");
    return decoded;
  }
  throw new Error(pngCard.errors.metadata);
}
