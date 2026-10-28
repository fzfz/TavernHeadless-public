import { and, eq } from "drizzle-orm";
import {
  apiErrorMessages,
  type CreatePublicRoleSessionInput,
} from "@tavern/shared";
import { nanoid } from "nanoid";
import type { AppDb } from "../db/client.js";
import { publicRoleSessions } from "../db/public-role-session-schema.js";
import { accountUsers, llmProfiles } from "../db/schema.js";
import { SessionScopeResolver } from "./session-scope-resolver.js";
import {
  RoleReleaseService,
  selectRoleReleaseOpening,
} from "./role-release-service.js";
import { insertSessionWithGreeting } from "./session-initialization.js";
import { persistRoleModelCapabilitySessionSnapshot } from "./role-model-capabilities.js";
import { getPublicRoleSessionBinding } from "./public-role-session-binding.js";

export class PublicRoleSessionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type PublicRoleSessionInput = CreatePublicRoleSessionInput;

export function getPublicRoleSessionOperation(
  db: AppDb,
  accountId: string,
  operationId: string,
) {
  return (
    db
      .select()
      .from(publicRoleSessions)
      .where(
        and(
          eq(publicRoleSessions.accountId, accountId),
          eq(publicRoleSessions.operationId, operationId),
        ),
      )
      .get() ?? null
  );
}
export function createPublicRoleSession(
  db: AppDb,
  accountId: string,
  releaseId: string,
  input: PublicRoleSessionInput,
) {
  return db.transaction((tx) => {
    const existing = getPublicRoleSessionOperation(
      db,
      accountId,
      input.operation_id,
    );
    if (existing) {
      if (
        existing.releaseId !== releaseId ||
        existing.userId !== input.user_id ||
        existing.openingId !== (input.opening_id ?? null) ||
        existing.sessionType !== (input.session_type ?? "individual")
      )
        throw new PublicRoleSessionError(
          409,
          "PUBLIC_ROLE_OPERATION_CONFLICT",
          "本次创建所选的角色、人格或开场与此前不同，请核对演绎创建结果。",
        );
      return { existing: true as const, binding: existing };
    }
    const published = new RoleReleaseService(db).getPublishedSnapshot(
      releaseId,
    );
    if (!published)
      throw new PublicRoleSessionError(
        404,
        "PUBLIC_ROLE_NOT_FOUND",
        "这个角色已停止发布，请返回角色广场选择其他角色。",
      );
    const release = published.snapshot;
    if (
      release.model_slots.some(
        (slot) =>
          slot.profile_snapshot === null ||
          !tx
            .select({ id: llmProfiles.id })
            .from(llmProfiles)
            .where(
              and(
                eq(llmProfiles.id, slot.profile_id),
                eq(llmProfiles.accountId, published.accountId),
                eq(llmProfiles.status, "active"),
              ),
            )
            .get(),
      )
    )
      throw new PublicRoleSessionError(
        409,
        "PUBLIC_ROLE_MODEL_UNAVAILABLE",
        "角色的模型配置暂不可用，请稍后再试。",
      );
    const user = tx
      .select()
      .from(accountUsers)
      .where(
        and(
          eq(accountUsers.id, input.user_id),
          eq(accountUsers.accountId, accountId),
          eq(accountUsers.status, "active"),
        ),
      )
      .get();
    if (!user)
      throw new PublicRoleSessionError(
        404,
        "PUBLIC_ROLE_PERSONA_NOT_FOUND",
        "这个演绎人格不可用，请重新选择自己的人格。",
      );
    if (
      input.expected_user_revision !== undefined &&
      input.expected_user_revision !== user.revision
    )
      throw new PublicRoleSessionError(
        409,
        "PUBLIC_ROLE_PERSONA_CHANGED",
        apiErrorMessages.PUBLIC_ROLE_PERSONA_CHANGED,
      );
    const opening = selectRoleReleaseOpening(
      release.opening_snapshots,
      input.opening_id,
      input.session_type,
    );
    if (!opening)
      throw new PublicRoleSessionError(
        404,
        "PUBLIC_ROLE_OPENING_NOT_FOUND",
        "这个开场不可用，请重新选择角色开场。",
      );
    const now = Date.now();
    const sessionId = nanoid();
    const scope = new SessionScopeResolver(tx).resolveForCreate({
      accountId,
      sessionId,
      title: release.name,
      now,
    });
    if (user.workspaceId !== scope.workspaceId)
      throw new PublicRoleSessionError(
        404,
        "PUBLIC_ROLE_PERSONA_NOT_FOUND",
        "这个演绎人格不可用，请重新选择自己的人格。",
      );
    const metadata = {
      role_release_id: release.id,
      opening_id: opening.id,
      model_capabilities: release.model_capabilities ?? null,
      ...(release.state_preset_id && release.state_preset_version_id
        ? {
            statePrompt: {
              presetId: release.state_preset_id,
              presetVersionId: release.state_preset_version_id,
              historyTurns: release.state_history_turns,
            },
          }
        : {}),
    };
    const { session } = insertSessionWithGreeting(tx, {
      id: sessionId,
      accountId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      title: release.name,
      userId: user.id,
      userSnapshotJson: user.snapshotJson,
      characterId: release.character_id,
      characterVersionId: release.character_version_id,
      characterSnapshotJson: JSON.stringify(release.character_snapshot),
      characterSyncPolicy: "pin",
      status: "active",
      presetId: release.preset_id,
      presetVersionId: release.preset_version_id,
      regexProfileId: release.regex_profile_id,
      regexProfileVersionId: release.regex_profile_version_id,
      worldbookProfileId: release.worldbook_id,
      worldbookVersionId: release.worldbook_version_id,
      deepBinding: true,
      promptMode: release.prompt_mode,
      metadataJson: JSON.stringify(metadata),
      createdAt: now,
      updatedAt: now,
    });
    tx.insert(publicRoleSessions)
      .values({
        sessionId,
        accountId,
        releaseId,
        publisherAccountId: published.accountId,
        operationId: input.operation_id,
        userId: input.user_id,
        openingId: input.opening_id ?? null,
        sessionType: input.session_type ?? "individual",
        createdAt: now,
      })
      .run();
    persistRoleModelCapabilitySessionSnapshot(db, {
      sessionId,
      accountId,
      metadata,
    });
    return {
      existing: false as const,
      binding: getPublicRoleSessionBinding(db, accountId, sessionId)!,
      session,
      release,
      opening,
    };
  });
}
