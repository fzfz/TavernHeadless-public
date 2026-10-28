import { roleRuntimeHistoryPagination } from "./schemas/role-runtime-history-pagination.js";
import { historyCursor as validateHistoryCursor } from "./generated/role-runtime-validators.js";

export type RoleHistoryCursorResource = "snapshots" | "floors";
export type RoleHistoryCursorScope = {
  resource: RoleHistoryCursorResource;
  sessionId: string;
  branchId: string;
};

type RoleHistoryCursor = RoleHistoryCursorScope & {
  version: 1;
  beforeNo: number;
};

export function encodeRoleHistoryCursor(
  input: RoleHistoryCursorScope & { beforeNo: number },
): string {
  const value: RoleHistoryCursor = { version: 1, ...input };
  if (!validateHistoryCursor(value))
    throw new Error("History cursor does not match the shared cursor schema.");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  const cursor = globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  if (cursor.length > roleRuntimeHistoryPagination.maxCursorLength)
    throw Object.assign(
      new Error("History cursor exceeds its configured maximum length."),
      { code: "ROLE_HISTORY_CURSOR_INVALID" },
    );
  return cursor;
}

export function decodeRoleHistoryCursor(
  cursor: string,
  expected: RoleHistoryCursorScope,
): number | null {
  try {
    if (
      cursor.length > roleRuntimeHistoryPagination.maxCursorLength ||
      !/^[A-Za-z0-9_-]+$/.test(cursor)
    )
      return null;
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const canonical = globalThis
      .btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    if (canonical !== cursor) return null;
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!validateHistoryCursor(value)) return null;
    const decoded = value as RoleHistoryCursor;
    if (
      decoded.resource !== expected.resource ||
      decoded.sessionId !== expected.sessionId ||
      decoded.branchId !== expected.branchId
    )
      return null;
    return decoded.beforeNo;
  } catch {
    return null;
  }
}
