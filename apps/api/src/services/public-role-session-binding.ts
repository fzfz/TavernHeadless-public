import { and, eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { publicRoleSessions } from "../db/public-role-session-schema.js";
import { sessions } from "../db/schema.js";
import { RoleReleaseService } from "./role-release-service.js";

export function getPublicRoleSessionBinding(
  db: AppDb,
  accountId: string,
  sessionId?: string,
) {
  if (!sessionId) return null;
  return (
    db
      .select({ binding: publicRoleSessions })
      .from(publicRoleSessions)
      .innerJoin(
        sessions,
        and(
          eq(sessions.id, publicRoleSessions.sessionId),
          eq(sessions.accountId, publicRoleSessions.accountId),
        ),
      )
      .where(
        and(
          eq(publicRoleSessions.sessionId, sessionId),
          eq(publicRoleSessions.accountId, accountId),
        ),
      )
      .get()?.binding ?? null
  );
}
export function getSessionResourceAccountId(
  db: AppDb,
  accountId: string,
  sessionId?: string,
): string {
  return (
    getPublicRoleSessionBinding(db, accountId, sessionId)?.publisherAccountId ??
    accountId
  );
}
export function getRoleAssetAccountId(
  db: AppDb,
  accountId: string,
  versionId: string,
): string {
  const row = db.$client
    .prepare(
      `SELECT p.publisher_account_id AS account_id FROM public_role_session p
    JOIN session s ON s.id = p.session_id AND s.account_id = p.account_id
    JOIN role_release r ON r.id = p.release_id AND r.account_id = p.publisher_account_id
    WHERE p.account_id = ? AND r.character_version_id = ? LIMIT 1`,
    )
    .get(accountId, versionId) as { account_id: string } | undefined;
  return row?.account_id ?? accountId;
}
export function loadPublicRoleSessionRelease(
  db: AppDb,
  accountId: string,
  sessionId: string,
) {
  const binding = getPublicRoleSessionBinding(db, accountId, sessionId);
  return binding
    ? new RoleReleaseService(db).get(
        binding.publisherAccountId,
        binding.releaseId,
      )
    : null;
}
