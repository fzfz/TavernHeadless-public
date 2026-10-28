import {
  roleFormalSessionMetadataSchema,
  rolePreviewSessionMetadataSchema,
} from "@tavern/shared";
import type { SessionRecord, TavernClient } from "@tavern/sdk";
export function isFormalRoleSession(session: SessionRecord) {
  return (
    roleFormalSessionMetadataSchema.safeParse(session.metadata).success &&
    !rolePreviewSessionMetadataSchema.safeParse(session.metadata).success
  );
}
export async function listFormalRoleSessions(
  client: TavernClient,
  pageSize: number,
) {
  const result: SessionRecord[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.sessions.list({
      limit: pageSize,
      offset,
      sortBy: "updated_at",
      sortOrder: "desc",
    });
    result.push(...page.filter(isFormalRoleSession));
    if (page.length < pageSize) return result;
  }
}
