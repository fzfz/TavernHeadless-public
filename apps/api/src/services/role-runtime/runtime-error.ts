import { apiErrorMessages } from "@tavern/shared";

export class RoleRuntimeError extends Error {
  constructor(
    readonly code: Extract<keyof typeof apiErrorMessages, `ROLE_${string}`>,
    readonly statusCode = 409,
    readonly details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(apiErrorMessages[code], { cause });
  }
}

export class RoleStateOperationReplayError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}
