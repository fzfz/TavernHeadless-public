import {
  buildAuthHeaders,
  normalizeBaseUrl,
  type BackendConnection,
} from "./connection";

export const DEFAULT_BACKEND_CONNECTION: BackendConnection = {
  id: "default",
  name: "Default",
  baseUrl: "/api",
  authMode: "dev",
  credential: null,
  accountHint: null,
  persistCredential: false,
};

let active: BackendConnection = { ...DEFAULT_BACKEND_CONNECTION };

export function getActiveConnection(): BackendConnection {
  return active;
}

export function setActiveConnection(connection: BackendConnection): void {
  active = { ...connection, baseUrl: normalizeBaseUrl(connection.baseUrl) };
}

/** 当前后端基址（供第一方 NodeGraph 客户端与 SDK 工厂使用）。 */
export function getActiveBaseUrl(): string {
  return active.baseUrl;
}

/** 当前后端鉴权头（动态读取，切换凭证无需重建客户端）。 */
export function getActiveAuthHeaders(): Record<string, string> | undefined {
  return buildAuthHeaders(active);
}
