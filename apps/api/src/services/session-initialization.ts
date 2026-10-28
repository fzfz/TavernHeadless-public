import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";
import type { DbExecutor } from "../db/client.js";
import { floors, messagePages, messages, sessions } from "../db/schema.js";
import { parseSessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  roleSessionMetadataSchema,
  roleSessionPersonaSchema,
} from "@tavern/shared";
import { renderRoleOpeningGreetingCandidates } from "./role-opening-greetings.js";
import { SessionBranchRegistryService } from "./variables/host/session-branch-registry-service.js";

export function insertSessionWithGreeting(
  tx: DbExecutor,
  values: typeof sessions.$inferInsert,
) {
  const snapshot = parseSessionCharacterSnapshot(
    values.characterSnapshotJson ?? null,
  );
  const persona = roleSessionPersonaSchema.safeParse(
    JSON.parse(values.userSnapshotJson ?? "null"),
  );
  const metadata = roleSessionMetadataSchema.safeParse(
    JSON.parse(values.metadataJson ?? "{}"),
  );
  const greetings = renderRoleOpeningGreetingCandidates(
    snapshot,
    persona.success ? persona.data : undefined,
    metadata.success ? metadata.data.opening_id : undefined,
  );
  const created = tx.insert(sessions).values(values).returning().get();
  if (!created) throw new Error("Failed to create session");
  const now = created.createdAt;
  new SessionBranchRegistryService(tx).ensure({
    accountId: created.accountId,
    sessionId: created.id,
    branchId: "main",
    createdAt: now,
    updatedAt: now,
  });
  if (greetings.length) {
    const counter = new SimpleTokenCounter();
    const floorId = nanoid();
    tx.insert(floors)
      .values({
        id: floorId,
        sessionId: created.id,
        floorNo: 0,
        branchId: "main",
        parentFloorId: null,
        metadataJson: JSON.stringify({
          user_binding: {
            user_id: created.userId,
            snapshot_summary:
              persona.success && persona.data.name?.trim()
                ? { name: persona.data.name.trim() }
                : null,
            replaced_at: now,
          },
        }),
        state: "committed",
        tokenIn: 0,
        tokenOut: counter.count(greetings[0]!),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    greetings.forEach((content, index) => {
      const pageId = nanoid();
      tx.insert(messagePages)
        .values({
          id: pageId,
          floorId,
          pageNo: 0,
          pageKind: "output",
          isActive: index === 0,
          version: index + 1,
          checksum: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(messages)
        .values({
          id: nanoid(),
          pageId,
          seq: 0,
          role: "assistant",
          content,
          contentFormat: "text",
          tokenCount: counter.count(content),
          isHidden: false,
          source: "greeting",
          createdAt: now,
        })
        .run();
    });
  }
  return { session: created, greetingCount: greetings.length };
}
