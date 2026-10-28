import { apiErrorMessages } from "@tavern/shared";
export function userError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return typeof code === "string" && code in apiErrorMessages
    ? String(apiErrorMessages[code as keyof typeof apiErrorMessages])
    : apiErrorMessages.ROLE_USER_REQUEST_FAILED;
}
