import { ChatServiceError } from "./chat/errors.js";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { presets, presetVersions, sessions } from "../db/schema.js";

import { presetOutputSchema } from "../routes/schemas/preset-output.js";
export {
  presetOutputSchema,
  roleTextEventSchema,
  roleMessagesQuerySchema,
  roleMessagesSchema,
} from "../routes/schemas/preset-output.js";

import { getSessionResourceAccountId } from "./public-role-session-binding.js";

export function createPresetOutput(config: unknown) {
  const policy = config === undefined ? null : presetOutputSchema.parse(config);
  const rules =
    policy?.rules.map((rule) => ({
      ...rule,
      regex: new RegExp(rule.pattern, rule.flags),
    })) ?? [];
  return {
    project(text: string, phase: "streaming" | "completed") {
      if (policy && phase === "streaming") {
        if (policy.delivery === "complete") return "";
        const config = policy.streaming!;
        let start = -1;
        for (const marker of config.startMarkers) {
          let index = text.lastIndexOf(marker);
          while (index >= 0) {
            const end = index + marker.length;
            if (
              !config.startMarkerLineBreak ||
              /^[ \t\r]*\n/.test(text.slice(end))
            ) {
              start = Math.max(start, end);
              break;
            }
            index = index > 0 ? text.lastIndexOf(marker, index - 1) : -1;
          }
        }
        if (start < 0) return "";
        text = text.slice(start);
        const tokens = [
          ...config.removedTokens,
          ...config.startMarkers,
          ...config.hiddenBlocks.map((block) => block.start),
        ];
        let visible = "";
        for (let i = 0; i < text.length; ) {
          const tail = text.slice(i);
          const block = config.hiddenBlocks.find((block) =>
            tail.startsWith(block.start),
          );
          if (block?.startSuffix) {
            const suffix = text.slice(i + block.start.length).trimStart();
            if (block.startSuffix.startsWith(suffix)) break;
            if (!suffix.startsWith(block.startSuffix)) {
              visible += block.start;
              i += block.start.length;
              continue;
            }
          }
          if (block) {
            const end = text.indexOf(block.end, i + block.start.length);
            if (end < 0) break;
            i = end + block.end.length;
            if (block.removeFollowingWhitespace && /\s/.test(text[i] ?? ""))
              i++;
            continue;
          }
          const token = config.removedTokens.find((token) =>
            tail.startsWith(token),
          );
          if (token) {
            i += token.length;
            continue;
          }
          if (tokens.some((token) => token.startsWith(tail))) break;
          visible += text[i];
          i++;
        }
        text = visible;
      }
      return rules.reduce(
        (result, rule) => result.replace(rule.regex, rule.replacement),
        text,
      );
    },
  };
}

export function loadSessionOutput(
  db: AppDb,
  accountId: string,
  sessionId: string,
) {
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
    .get();
  if (!session)
    throw new ChatServiceError("session_not_found", "Session not found");
  if (!session.presetId) return createPresetOutput(undefined);
  const resourceAccountId = getSessionResourceAccountId(db, accountId, sessionId);
  const preset = db
    .select()
    .from(presets)
    .where(
      and(eq(presets.id, session.presetId), eq(presets.accountId, resourceAccountId)),
    )
    .get();
  if (!preset) throw new Error("PRESET_NOT_FOUND");
  const version = session.presetVersionId
    ? db
        .select()
        .from(presetVersions)
        .where(
          and(
            eq(presetVersions.id, session.presetVersionId),
            eq(presetVersions.presetId, preset.id),
          ),
        )
        .get()
    : preset;
  if (!version) throw new Error("PRESET_VERSION_NOT_FOUND");
  return createPresetOutput(
    JSON.parse(version.dataJson).extensions?.tavern_headless?.outputProcessing,
  );
}
