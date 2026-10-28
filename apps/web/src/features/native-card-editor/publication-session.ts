import { roleAdminWebConfigSchema, roleSessionParamsSchema } from "@tavern/shared";
import type { TavernClient } from "@tavern/sdk";

export async function createPublishedReleaseSession(options: {
  releaseId: string;
  userWebBaseUrl: string;
  createSession: TavernClient["roleReleases"]["createSession"];
  openUrl: (url: string) => void;
}): Promise<{ sessionId: string; url: string }> {
  const config = roleAdminWebConfigSchema.parse({ userWebBaseUrl: options.userWebBaseUrl });
  const target = new URL(config.userWebBaseUrl);
  const result = await options.createSession({ releaseId: options.releaseId, input: {} });
  const { id: sessionId } = roleSessionParamsSchema.parse({ id: result.session.id });
  target.search = "";
  target.hash = "";
  target.searchParams.set("sessionId", sessionId);
  const url = target.href;
  options.openUrl(url);
  return { sessionId, url };
}
