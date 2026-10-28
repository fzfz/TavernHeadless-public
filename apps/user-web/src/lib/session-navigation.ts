export function roleSessionUrl(location: URL, sessionId: string | null): URL {
  const target = new URL(location);
  target.searchParams.delete("floorId");
  target.searchParams.delete("snapshotId");
  if (sessionId) target.searchParams.set("sessionId", sessionId);
  else target.searchParams.delete("sessionId");
  return target;
}
