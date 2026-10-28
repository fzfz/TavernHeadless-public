import { modelCallLoadError } from "../lib/model-call-errors.js";
import { computed, ref } from "vue";
import { type ModelCallDetail } from "@tavern/shared";
import type { TavernClient } from "@tavern/sdk";

export function useModelCallHistory(client: TavernClient, floorId: string) {
  const calls = ref<ModelCallDetail[]>([]);
  const selectedId = ref<string>();
  const selected = computed(() =>
    calls.value.find((item) => item.call.callId === selectedId.value),
  );
  const busy = ref(false);
  const error = ref("");
  const nextCursor = ref<string | null>(null);
  const runId = ref("");
  const attempt = ref("");
  let generation = 0;
  let query: { runId?: string; attemptNo?: number } = {};

  async function load(append = false) {
    if (busy.value) return;
    const request = ++generation;
    busy.value = true;
    error.value = "";
    try {
      if (!append) {
        query = {
          ...(runId.value.trim() ? { runId: runId.value.trim() } : {}),
          ...(attempt.value ? { attemptNo: Number(attempt.value) } : {}),
        };
        calls.value = [];
        selectedId.value = undefined;
        nextCursor.value = null;
      }
      const page = await client.modelCalls.list({
        floorId: floorId,
        ...query,
        ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
      });
      if (request !== generation) return;
      calls.value = append
        ? [
            ...new Map(
              [...calls.value, ...page.data].map((item) => [
                item.call.callId,
                item,
              ]),
            ).values(),
          ]
        : page.data;
      nextCursor.value = page.nextCursor;
      if (!selectedId.value && calls.value.length)
        selectedId.value = calls.value[0]!.call.callId;
    } catch (cause) {
      if (request !== generation) return;
      error.value = modelCallLoadError(cause);
    } finally {
      if (request === generation) busy.value = false;
    }
  }
  return {
    calls,
    selectedId,
    selected,
    busy,
    error,
    nextCursor,
    runId,
    attempt,
    load,
    dispose() {
      generation++;
    },
  };
}
