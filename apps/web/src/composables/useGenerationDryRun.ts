import { ref } from "vue";
import type { RespondDryRunResult, TavernClient } from "@tavern/sdk";
import { apiErrorMessages } from "@tavern/shared";
import copy from "../config/generation-dry-run.json";

export function useGenerationDryRun(client: Pick<TavernClient, "sessions">) {
  const input = ref("");
  const result = ref<RespondDryRunResult | null>(null);
  const busy = ref(false);
  const error = ref("");
  let generation = 0;

  function clear() {
    generation++;
    result.value = null;
    error.value = "";
    busy.value = false;
  }

  async function run(sessionId: string, branchId: string) {
    const message = input.value.trim();
    const request = ++generation;
    result.value = null;
    error.value = "";
    if (!message) {
      busy.value = false;
      error.value = copy.emptyInput;
      return;
    }
    busy.value = true;
    try {
      const response = await client.sessions.respondDryRun({
        sessionId,
        branchId,
        message,
        debugOptions: { includeWorldbookMatches: true },
      });
      if (request === generation) result.value = response;
    } catch (cause) {
      if (request === generation) {
        const code =
          cause && typeof cause === "object" && "code" in cause
            ? String(cause.code)
            : "";
        const knownMessage =
          apiErrorMessages[code as keyof typeof apiErrorMessages];
        error.value =
          typeof knownMessage === "string" ? knownMessage : copy.failed;
      }
    } finally {
      if (request === generation) busy.value = false;
    }
  }

  return { input, result, busy, error, run, clear };
}
