import { apiErrorMessages } from "@tavern/shared";

type ErrorMessageMap = Readonly<Record<string, unknown>>;

export function nativeCardHumanError(
  error: unknown,
  fallbackLabel: string,
  messages: ErrorMessageMap = apiErrorMessages as ErrorMessageMap,
): string {
  const unmappedError = (code: string): string => {
    const unmapped = messages.API_ERROR_UNMAPPED;
    if (typeof unmapped === "string") return unmapped.replaceAll("{code}", code);
    return String(messages.ROLE_USER_REQUEST_FAILED ?? fallbackLabel);
  };
  if (isRecord(error) && typeof error.code === "string") {
    const message = messages[error.code.toUpperCase()];
    if (typeof message === "string") return message;
    return unmappedError(error.code);
  }
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return String(messages.NETWORK_ERROR ?? fallbackLabel);
  }
  if (error instanceof Error) return unmappedError("（未返回）");
  return fallbackLabel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
