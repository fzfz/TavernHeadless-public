import { apiErrorMessages, getNativeCardPackageFileRule, nativeCardFileRules, nativeCardPackagePathSchema } from "@tavern/shared";

export function nativeCardPathFailure(path: string, invalidSyntaxMessage: string, expectedPurpose?: string): string | undefined {
  if (!nativeCardPackagePathSchema.safeParse(path).success) return invalidSyntaxMessage;
  const rule = getNativeCardPackageFileRule(path);
  if (!rule) return issueMessage("NATIVE_CARD_FILE_PATH_UNSUPPORTED");
  if (expectedPurpose && rule.purpose !== expectedPurpose) return issueMessage("NATIVE_CARD_FILE_PURPOSE_MISMATCH");
  return undefined;
}

function issueMessage(code: "NATIVE_CARD_FILE_PATH_UNSUPPORTED" | "NATIVE_CARD_FILE_PURPOSE_MISMATCH"): string {
  const issue = nativeCardFileRules.issueMessages[code];
  return issue
    ? `${issue.message}${issue.action}`
    : apiErrorMessages.API_ERROR_UNMAPPED.replaceAll("{code}", code);
}
