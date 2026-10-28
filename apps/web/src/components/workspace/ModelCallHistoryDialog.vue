<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TavernClient } from "@tavern/sdk";
import { useModelCallHistory } from "../../composables/useModelCallHistory.js";
import { modelCallUi as labels, type ModelCallDetail } from "@tavern/shared";

const props = defineProps<{
  client: TavernClient;
  floorId: string;
  runId?: string;
  initialCall?: ModelCallDetail;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const {
  calls,
  selectedId,
  selected,
  busy,
  error,
  nextCursor,
  runId: runFilter,
  attempt,
  load,
  dispose,
} = useModelCallHistory(props.client, props.floorId);
runFilter.value = props.runId ?? "";
const detailHref = computed(() => {
  const call = selected.value?.call;
  if (!call) return undefined;
  const query = new URLSearchParams({
    sessionId: call.sessionId,
    branchId: call.branchId,
    floorId: call.floorId,
    runId: call.runId,
    callId: call.callId,
  });
  if (call.outputPageId) query.set("pageId", call.outputPageId);
  return `${labels.detailPath}?${query}`;
});
const json = (value: unknown) => JSON.stringify(value, null, 2);
let disposed = false;
onMounted(async () => {
  dialog.value!.showModal();
  await load();
  if (disposed || error.value || !props.initialCall) return;
  if (
    !calls.value.some(
      (item) => item.call.callId === props.initialCall!.call.callId,
    )
  )
    calls.value.unshift(props.initialCall);
  selectedId.value = props.initialCall.call.callId;
});
onBeforeUnmount(() => {
  disposed = true;
  dispose();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="call-dialog"
    aria-labelledby="call-history-title"
    @close="emit('close')"
  >
    <header>
      <h2 id="call-history-title">{{ labels.title }}</h2>
      <button type="button" @click="dialog?.close()">{{ labels.close }}</button>
    </header>
    <form class="filters" @submit.prevent="load()">
      <label
        >{{ labels.run
        }}<input
          v-model="runFilter"
          :placeholder="labels.allRuns"
          :disabled="busy"
      /></label>
      <label
        >{{ labels.attempt
        }}<input
          v-model="attempt"
          type="number"
          min="1"
          step="1"
          :placeholder="labels.allAttempts"
          :disabled="busy"
      /></label>
      <button type="submit" :disabled="busy">{{ labels.filter }}</button>
    </form>
    <p v-if="error" role="alert">
      {{ error }}
      <button :disabled="busy" @click="load()">{{ labels.reload }}</button>
    </p>
    <p v-if="busy" role="status">{{ labels.loading }}</p>
    <p v-if="!busy && !error && !calls.length">{{ labels.empty }}</p>
    <div class="call-grid">
      <nav :aria-label="labels.title">
        <button
          v-for="item in calls"
          :key="item.call.callId"
          class="call-choice"
          :aria-pressed="selectedId === item.call.callId"
          @click="selectedId = item.call.callId"
        >
          <strong>{{ item.call.purpose }} · {{ item.call.model }}</strong>
          <span>{{ labels.run }}：{{ item.call.runId }}</span>
          <span
            >{{ labels.attempt }}：{{ item.call.attemptNo }} ·
            {{ labels.step }}：{{ item.call.stepIndex }} ·
            {{ labels.requestAttempt }}：{{ item.call.requestAttemptNo }}</span
          >
          <span
            >{{ labels.status[item.call.status] }} ·
            {{ labels.commit[item.turnCommitStatus] }}</span
          >
        </button>
        <button v-if="nextCursor" :disabled="busy" @click="load(true)">
          {{ labels.more }}
        </button>
      </nav>
      <section v-if="selected" class="call-detail">
        <a :href="detailHref" target="_blank" rel="noopener">{{
          labels.openPage
        }}</a>
        <p>
          {{ labels.callStatus }}：{{ labels.status[selected.call.status] }} ·
          {{ labels.turnStatus }}：{{
            labels.commit[selected.turnCommitStatus]
          }}
        </p>
        <p v-if="selected.completionEvidence === 'missing'" role="status">
          {{ labels.evidenceMissing }}
        </p>
        <details open>
          <summary>{{ labels.identity }}</summary>
          <pre>{{
            json({
              callId: selected.call.callId,
              invocationId: selected.call.invocationId,
              accountId: selected.call.accountId,
              sessionId: selected.call.sessionId,
              branchId: selected.call.branchId,
              floorId: selected.call.floorId,
              runId: selected.call.runId,
              attemptNo: selected.call.attemptNo,
              stepIndex: selected.call.stepIndex,
              requestAttemptNo: selected.call.requestAttemptNo,
              purpose: selected.call.purpose,
              slot: selected.call.slot,
              provider: selected.call.provider,
              model: selected.call.model,
              endpoint: selected.call.endpoint,
              releaseId: selected.call.releaseId,
              draftRevision: selected.call.draftRevision,
              resourceVersions: selected.call.resourceVersions,
              inputPageId: selected.call.inputPageId,
              inputMessageId: selected.call.inputMessageId,
              outputPageId: selected.call.outputPageId,
              outputMessageId: selected.call.outputMessageId,
            })
          }}</pre>
        </details>
        <details open>
          <summary>{{ labels.request }}</summary>
          <pre>{{ selected.call.requestBody }}</pre>
        </details>
        <details open>
          <summary>{{ labels.response }}</summary>
          <pre>{{
            selected.call.responseBody === null
              ? labels.noResponse
              : selected.call.responseBody
          }}</pre>
        </details>
        <details>
          <summary>{{ labels.result }}</summary>
          <pre>{{
            json({
              text: selected.call.text,
              reasoning: selected.call.reasoning,
              toolData: selected.call.toolData,
              finishReason: selected.call.finishReason,
              error: selected.call.error,
            })
          }}</pre>
        </details>
        <details>
          <summary>{{ labels.timing }}</summary>
          <pre>{{
            json({
              preparedAt: selected.call.preparedAt,
              sentAt: selected.call.sentAt,
              firstResponseAt: selected.call.firstResponseAt,
              endedAt: selected.call.endedAt,
              httpStatus: selected.call.httpStatus,
              usage: selected.call.usage,
            })
          }}</pre>
        </details>
      </section>
      <p v-else-if="calls.length">{{ labels.select }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.call-dialog {
  width: min(1120px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  margin: auto;
  padding: 24px;
  color: #e4e4e7;
  background: #18181b;
  border: 1px solid #52525b;
  border-radius: 12px;
  overflow: auto;
}
.call-dialog::backdrop {
  background: #000b;
}
header,
.filters {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
h2 {
  font-size: 20px;
  font-weight: 600;
}
label {
  display: grid;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
button,
input {
  border: 1px solid #71717a;
  padding: 8px 12px;
  border-radius: 6px;
  background: #27272a;
  color: inherit;
}
button:disabled {
  opacity: 0.5;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: 3px;
}
.call-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: 24px;
}
.call-choice {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
  text-align: left;
  overflow-wrap: anywhere;
}
.call-choice[aria-pressed="true"] {
  border-color: #a5b4fc;
  background: #312e4b;
}
.call-choice span {
  font-size: 12px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  padding: 12px;
  background: #09090b;
}
details,
p {
  margin-bottom: 16px;
}
summary {
  cursor: pointer;
  padding: 8px 0;
}
@media (max-width: 700px) {
  .call-grid {
    grid-template-columns: 1fr;
  }
  .filters {
    flex-wrap: wrap;
  }
  .call-dialog {
    padding: 16px;
  }
}
</style>
