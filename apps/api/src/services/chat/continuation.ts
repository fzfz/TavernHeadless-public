export function markConversationContinuation(
  metadataJson: string | null,
  sourceFloorId: string,
): string {
  const metadata: Record<string, unknown> = metadataJson
    ? JSON.parse(metadataJson)
    : {};
  return JSON.stringify({ ...metadata, continuation: { sourceFloorId } });
}

export function readConversationContinuation(
  metadataJson: string | null,
): string | undefined {
  const metadata: { continuation?: { sourceFloorId?: unknown } } = metadataJson
    ? JSON.parse(metadataJson)
    : {};
  return typeof metadata.continuation?.sourceFloorId === "string"
    ? metadata.continuation.sourceFloorId
    : undefined;
}
