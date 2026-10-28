import type {
  CreateRoleReleaseSessionBody,
  RoleReleasePublic,
} from "@tavern/shared";

export function openingSessionInput(
  opening:
    | Pick<RoleReleasePublic["openings"][number], "id" | "audience">
    | undefined,
): CreateRoleReleaseSessionBody {
  if (!opening) return {};
  return {
    opening_id: opening.id,
    ...(opening.audience === "group" ? { session_type: "group" as const } : {}),
  };
}
