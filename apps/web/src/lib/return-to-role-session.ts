import {
  apiErrorMessages,
  publicConfigurationFiles,
  roleAdminWebConfigSchema,
} from "@tavern/shared";
import type { TavernClient } from "@tavern/sdk";
export async function returnToRoleSession(
  client: TavernClient,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
  snapshotId?: string,
): Promise<string> {
  const response = await fetchImpl(
    `/config/${publicConfigurationFiles.roleAdminWeb.filename}`,
  );
  if (!response.ok)
    throw Object.assign(new Error(apiErrorMessages.ROLE_APP_CONFIG_INVALID), {
      code: "ROLE_APP_CONFIG_INVALID",
    });
  const config = roleAdminWebConfigSchema.parse(await response.json());
  await client.sessions.getDetail({ sessionId });
  const target = new URL(config.userWebBaseUrl);
  target.searchParams.set("sessionId", sessionId);
  if (snapshotId) target.searchParams.set("snapshotId", snapshotId);
  return target.href;
}
