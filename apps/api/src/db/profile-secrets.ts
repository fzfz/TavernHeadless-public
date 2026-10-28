import { asc, getTableName, ne } from "drizzle-orm";

import {
  decryptSecret,
  SecretFormatError,
  SecretUnavailableError,
} from "../lib/secrets.js";
import type { DatabaseConnection } from "./client.js";
import { llmProfiles } from "./schema.js";

export type ProfileSecretResult = {
  ok: boolean;
  checked: number;
  issues: {
    id: string;
    errorType:
      | "secret_unavailable"
      | "secret_invalid_format"
      | "secret_decryption_failed";
  }[];
};

export function validateDatabaseProfileSecrets(
  connection: DatabaseConnection,
  masterKey: string,
): ProfileSecretResult {
  const result: ProfileSecretResult = { ok: true, checked: 0, issues: [] };
  if (
    !connection.db.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(getTableName(llmProfiles))
  )
    return result;
  const profiles = connection.db
    .select({ id: llmProfiles.id, encrypted: llmProfiles.apiKeyEncrypted })
    .from(llmProfiles)
    .where(ne(llmProfiles.apiKeyEncrypted, ""))
    .orderBy(asc(llmProfiles.id))
    .all();
  for (const profile of profiles) {
    result.checked++;
    try {
      decryptSecret(profile.encrypted, masterKey);
    } catch (error) {
      result.issues.push({
        id: profile.id,
        errorType:
          error instanceof SecretUnavailableError
            ? "secret_unavailable"
            : error instanceof SecretFormatError
              ? "secret_invalid_format"
              : "secret_decryption_failed",
      });
    }
  }
  result.ok = result.issues.length === 0;
  return result;
}
