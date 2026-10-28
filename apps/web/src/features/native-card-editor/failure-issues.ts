import type { NativeCardIssue } from "@tavern/shared";

export function nativeCardIssuesFromError(error: unknown): NativeCardIssue[] {
  if (!isRecord(error) || !isRecord(error.details) || !Array.isArray(error.details.issues)) return [];
  return error.details.issues.filter(isNativeCardIssue);
}

function isNativeCardIssue(value: unknown): value is NativeCardIssue {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.path === "string" &&
    typeof value.message === "string" &&
    typeof value.action === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
