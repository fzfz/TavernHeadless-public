import type { TransportClient } from "../client/transport.js";
import {
  compactObject,
  readBoolean,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type AuthAccount = {
  id: string;
  name: string;
  email: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  defaultPersonaId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AuthPreferences = { defaultPersonaId: string | null };
export type AuthLoginInput = { email: string; password: string };
export type AuthRegisterInput = AuthLoginInput & {
  name: string;
  operationId?: string;
};
export type AuthRegistrationResolution = {
  operationId: string;
  status: "created" | "not_created";
};
export type AuthResource = {
  register(input: AuthRegisterInput): Promise<AuthAccount>;
  resolveRegistration(input: {
    operationId: string;
  }): Promise<AuthRegistrationResolution>;
  login(input: AuthLoginInput): Promise<AuthAccount>;
  logout(): Promise<boolean>;
  me(): Promise<AuthAccount>;
  updateMe(input: { name: string }): Promise<AuthAccount>;
  getPreferences(): Promise<AuthPreferences>;
  updatePreferences(input: AuthPreferences): Promise<AuthPreferences>;
};

export function createAuthResource(client: TransportClient): AuthResource {
  const accountRequest = async (
    path: string,
    method: "POST" | "GET" | "PATCH",
    body?: unknown,
  ): Promise<AuthAccount> => {
    const response = await client.fetchJson<Record<string, unknown>>(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    return mapAuthAccount(readRecord(response.body)?.data);
  };
  const preferencesRequest = async (
    method: "GET" | "PATCH",
    body?: unknown,
  ): Promise<AuthPreferences> => {
    const response = await client.fetchJson<Record<string, unknown>>(
      "/auth/preferences",
      { method, ...(body === undefined ? {} : { body }) },
    );
    const data = readRecord(readRecord(response.body)?.data);
    if (
      !data ||
      !(
        typeof data.default_persona_id === "string" ||
        data.default_persona_id === null
      )
    )
      throw new Error("Account preferences returned an invalid payload");
    return { defaultPersonaId: data.default_persona_id };
  };
  return {
    register: (input) =>
      accountRequest(
        "/auth/register",
        "POST",
        compactObject({
          name: input.name,
          email: input.email,
          password: input.password,
          operation_id: input.operationId,
        }),
      ),
    async resolveRegistration({ operationId }) {
      const response = await client.fetchJson<Record<string, unknown>>(
        "/auth/register/operations/resolve",
        {
          method: "POST",
          body: { operation_id: operationId },
        },
      );
      const data = readRecord(readRecord(response.body)?.data);
      if (
        !data ||
        data.operation_id !== operationId ||
        (data.status !== "created" && data.status !== "not_created")
      )
        throw new Error("Registration resolution returned an invalid payload");
      return { operationId, status: data.status };
    },
    login: (input) => accountRequest("/auth/login", "POST", input),
    me: () => accountRequest("/auth/me", "GET"),
    updateMe: (input) => accountRequest("/auth/me", "PATCH", input),
    getPreferences: () => preferencesRequest("GET"),
    updatePreferences: (input) =>
      preferencesRequest("PATCH", {
        default_persona_id: input.defaultPersonaId,
      }),
    async logout() {
      const response = await client.fetchJson<Record<string, unknown>>(
        "/auth/logout",
        { method: "POST" },
      );
      return readBoolean(
        readRecord(readRecord(response.body)?.data)?.logged_out,
      );
    },
  };
}

function mapAuthAccount(value: unknown): AuthAccount {
  const record = readRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !(typeof record.email === "string" || record.email === null) ||
    !(
      typeof record.default_persona_id === "string" ||
      record.default_persona_id === null
    )
  )
    throw new Error("Account identity returned an invalid payload");
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: readString(record.role, "user") as AuthAccount["role"],
    status: readString(record.status, "active") as AuthAccount["status"],
    defaultPersonaId: record.default_persona_id,
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}
