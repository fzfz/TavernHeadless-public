import { apiErrorMessages } from "@tavern/shared";
export class RoleImportError extends Error {
  constructor(
    readonly code: Extract<
      keyof typeof apiErrorMessages,
      `ROLE_IMPORT_${string}`
    >,
    readonly details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(apiErrorMessages[code], { cause });
  }
}
