import type { InjectionKey, Ref } from "vue";
import type { TavernClient, AuthAccount } from "@tavern/sdk";
import text from "../../config/portal-ui.json";
import { errorStatus } from "../../lib/request-outcome.js";
import type { RoleApplicationContext } from "../../lib/bootstrap.js";
export type PortalRoute = { name: string; id: string; query: URLSearchParams };
export type PortalContext = {
  beforeLeave: Ref<((target: string) => boolean) | null>;
  client: TavernClient;
  runtime: RoleApplicationContext;
  account: Readonly<Ref<AuthAccount | null>>;
  route: Ref<PortalRoute>;
  online: Ref<boolean>;
  notice: Ref<string>;
  go: (route: string) => void;
  refreshIdentity: () => Promise<void>;
  signOut: () => Promise<void>;
  requireLogin: (target: string) => void;
};
export const portalKey: InjectionKey<PortalContext> = Symbol("user-web");
export function readPortalRoute(): PortalRoute {
  const hash = window.location.hash.slice(1) || "discover";
  const [pathname = "discover", query = ""] = hash.split("?");
  const [name = "discover", ...parts] = pathname.split("/");
  return {
    name,
    id: parts.map(decodeURIComponent).join("/"),
    query: new URLSearchParams(query),
  };
}
export function accountDraftKey(accountId: string, purpose: string) {
  return `user-web:${accountId}:${purpose}`;
}
export function errorMessage(error: unknown): string {
  const status = errorStatus(error);
  if (status === 401) return text.loginRequired;
  if (status === 403) return text.noPermission;
  if (status === 404) return text.resourceMissingHelp;
  if (status === 429) return text.rateLimited;
  if (error instanceof TypeError) return text.connection;
  if (error instanceof Error) return error.message;
  return text.error;
}
export { errorStatus, isUncertainWrite } from "../../lib/request-outcome.js";
