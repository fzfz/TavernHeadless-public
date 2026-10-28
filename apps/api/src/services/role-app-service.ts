import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  apiErrorMessages,
  roleAppSchema,
  type CreateRoleReleaseBody,
} from "@tavern/shared";
import type { AppDb } from "../db/client.js";
import { roleAppDrafts, sessions } from "../db/schema.js";
import type { RoleReleaseSnapshot } from "./role-release-service.js";
export class RoleAppError extends Error {
  constructor(
    readonly code: "ROLE_APP_NOT_FOUND" | "ROLE_APP_REVISION_CONFLICT",
  ) {
    super(apiErrorMessages[code]);
  }
}
export class RoleAppService {
  constructor(private readonly db: AppDb) {}
  private present(row: typeof roleAppDrafts.$inferSelect) {
    return roleAppSchema.parse({
      id: row.id,
      revision: row.revision,
      configuration: JSON.parse(row.inputJson),
      updated_at: row.updatedAt,
    });
  }
  list(accountId: string) {
    return this.db
      .select()
      .from(roleAppDrafts)
      .where(eq(roleAppDrafts.accountId, accountId))
      .orderBy(desc(roleAppDrafts.updatedAt), desc(roleAppDrafts.id))
      .all()
      .map((row) => this.present(row));
  }
  get(accountId: string, id: string, revision?: number) {
    const row = this.db
      .select()
      .from(roleAppDrafts)
      .where(
        and(eq(roleAppDrafts.accountId, accountId), eq(roleAppDrafts.id, id)),
      )
      .get();
    if (!row) throw new RoleAppError("ROLE_APP_NOT_FOUND");
    if (revision !== undefined && row.revision !== revision)
      throw new RoleAppError("ROLE_APP_REVISION_CONFLICT");
    return {
      draft: this.present(row),
      snapshot: JSON.parse(row.snapshotJson) as RoleReleaseSnapshot,
    };
  }
  save(
    accountId: string,
    creatorId: string,
    input: CreateRoleReleaseBody,
    snapshot: RoleReleaseSnapshot,
    existing?: { id: string; revision: number },
  ) {
    const updatedAt = Date.now();
    if (existing) {
      const row = this.db
        .update(roleAppDrafts)
        .set({
          revision: existing.revision + 1,
          inputJson: JSON.stringify(input),
          snapshotJson: JSON.stringify(snapshot),
          updatedAt,
        })
        .where(
          and(
            eq(roleAppDrafts.id, existing.id),
            eq(roleAppDrafts.accountId, accountId),
            eq(roleAppDrafts.revision, existing.revision),
          ),
        )
        .returning()
        .get();
      if (!row) {
        this.get(accountId, existing.id);
        throw new RoleAppError("ROLE_APP_REVISION_CONFLICT");
      }
      return this.present(row);
    }
    const row = this.db
      .insert(roleAppDrafts)
      .values({
        id: nanoid(),
        accountId,
        creatorId,
        revision: 1,
        inputJson: JSON.stringify(input),
        snapshotJson: JSON.stringify(snapshot),
        updatedAt,
      })
      .returning()
      .get();
    return this.present(row);
  }
  previews(accountId: string, creatorId: string, draftId: string) {
    this.get(accountId, draftId);
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.accountId, accountId),
          sql`json_extract(${sessions.metadataJson}, '$.role_preview.draft_id') = ${draftId}`,
          sql`json_extract(${sessions.metadataJson}, '$.role_preview.creator_id') = ${creatorId}`,
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        created_at: row.createdAt,
        draft_revision: JSON.parse(row.metadataJson!).role_preview
          .draft_revision,
      }));
  }
}
