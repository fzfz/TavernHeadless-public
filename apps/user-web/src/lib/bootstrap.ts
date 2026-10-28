import { createTavernClient } from "@tavern/sdk";
import {
  apiErrorMessages,
  publicConfigurationFiles,
  rolePreviewSessionMetadataSchema,
  roleFormalSessionMetadataSchema,
  roleRuntimeValidators,
  roleUserWebConfigSchema,
  type RoleRuntimePolicy,
} from "@tavern/shared";
export async function bootstrapRoleApplication(
  location: URL,
  fetchImpl: typeof fetch = fetch,
) {
  const configResponse = await fetchImpl(
      `/config/${publicConfigurationFiles.roleUserWeb.filename}`,
    ),
    policyResponse = await fetchImpl(
      `/config/${publicConfigurationFiles.resourcePolicy.filename}`,
    );
  if (!configResponse.ok || !policyResponse.ok)
    throw Object.assign(new Error(apiErrorMessages.ROLE_USER_CONFIG_INVALID), {
      code: "ROLE_USER_CONFIG_INVALID",
    });
  const parsed = roleUserWebConfigSchema.safeParse(await configResponse.json());
  const policy: unknown = await policyResponse.json();
  if (!parsed.success || !roleRuntimeValidators.resourcePolicy(policy))
    throw Object.assign(new Error(apiErrorMessages.ROLE_USER_CONFIG_INVALID), {
      code: "ROLE_USER_CONFIG_INVALID",
    });
  const config = {
      ...parsed.data,
      apiBaseUrl: new URL(parsed.data.apiBaseUrl, location.origin).href.replace(
        /\/$/,
        "",
      ),
    },
    sessionId = location.searchParams.get("sessionId");
  const publicClient = createTavernClient({
    baseUrl: config.apiBaseUrl,
    credentials: "include",
    fetchImpl: async (input, init) => {
      const response = await fetchImpl(input, init);
      if (
        response.status === 401 &&
        typeof window !== "undefined" &&
        !String(input).includes("/auth/")
      ) {
        window.dispatchEvent(new Event("user-web:identity-expired"));
      }
      return response;
    },
  });
  try {
    const session = sessionId
      ? await publicClient.sessions.getDetail({ sessionId })
      : null;
    const metadata = rolePreviewSessionMetadataSchema.safeParse(
      session?.metadata,
    );
    const formalMetadata = roleFormalSessionMetadataSchema.safeParse(
      session?.metadata,
    );
    return {
      config,
      policy: policy as RoleRuntimePolicy,
      client: publicClient,
      sessionId,
      snapshotId: location.searchParams.get("snapshotId"),
      preview: metadata.success ? metadata.data.role_preview : null,
      characterName:
        session?.characterBinding?.snapshotSummary?.name?.trim() || null,
      roleReleaseId:
        metadata.success || !formalMetadata.success
          ? null
          : formalMetadata.data.role_release_id,
    };
  } catch (error) {
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error(apiErrorMessages.ROLE_USER_REQUEST_FAILED, {
            cause: error,
          }),
      { adminBaseUrl: config.adminBaseUrl },
    );
  }
}
export type RoleApplicationContext = Awaited<
  ReturnType<typeof bootstrapRoleApplication>
>;
