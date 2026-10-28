import { apiErrorMessages } from "@tavern/shared";

export function modelCallLoadError(cause: unknown): string {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : "";
  const message = apiErrorMessages[code as keyof typeof apiErrorMessages];
  return typeof message === "string"
    ? message
    : apiErrorMessages.MODEL_CALL_LOAD_FAILED;
}
