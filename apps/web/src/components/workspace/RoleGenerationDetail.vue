<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  FloorCommittedResultSnapshot,
  FloorRecord,
  FloorRunSnapshot,
  FloorRunRecord,
  TimelineFloor,
} from "@tavern/sdk";
import {
  type GenerationInspectionSection,
  type ModelCallDetail,
  generationInspectionConfig as inspection,
  modelCallUi as callLabels,
} from "@tavern/shared";
import { apiClient } from "../../lib/api.js";
import { modelCallLoadError } from "../../lib/model-call-errors.js";
import { useModelCallHistory } from "../../composables/useModelCallHistory.js";
import { useGenerationDryRun } from "../../composables/useGenerationDryRun.js";
import labels from "../../config/role-apps.json";
import categories from "../../config/role-generation-categories.json";
import dryRunCopy from "../../config/generation-dry-run.json";
const props = defineProps<{
  floor: TimelineFloor;
  floorRecord?: FloorRecord;
  sessionId: string;
  sessionTitle?: string;
  branchId: string;
  floors?: TimelineFloor[];
  initialCall?: ModelCallDetail;
  initialRunId?: string;
  initialPageId?: string;
  pending?: boolean;
  presentation?: "categories" | "accordion";
}>();
const emit = defineEmits<{
  close: [];
  refresh: [];
  select: [floor: TimelineFloor];
}>();
const dryRun = useGenerationDryRun(apiClient);
watch(
  () => [props.sessionId, props.branchId],
  () => dryRun.clear(),
);
const {
  calls,
  selectedId,
  selected,
  busy,
  error,
  nextCursor,
  runId,
  attempt,
  load,
  dispose,
} = useModelCallHistory(apiClient, props.floor.id);
const selectedPageId = ref(props.initialPageId);
let initialized = false;
watch(selectedId, (id) => {
  const call = calls.value.find((item) => item.call.callId === id)?.call;
  const url = new URL(window.location.href);
  if (!call) {
    if (initialized) {
      selectedPageId.value = undefined;
      for (const key of ["callId", "runId", "pageId"]) url.searchParams.delete(key);
      window.history.replaceState(null, "", url);
    }
    return;
  }
  url.searchParams.set("callId", call.callId);
  url.searchParams.set("runId", call.runId);
  if (initialized) {
    selectedPageId.value = call.outputPageId ?? undefined;
    if (selectedPageId.value) url.searchParams.set("pageId", selectedPageId.value);
    else url.searchParams.delete("pageId");
  }
  window.history.replaceState(null, "", url);
}, { flush: "sync" });
const sections = ref<GenerationInspectionSection[]>([]),
  sectionError = ref(""),
  category = ref(
    props.initialCall || props.initialRunId ? "stages" : "overview",
  ),
  expanded = ref(true);
const visibleSections = computed(() =>
  sections.value.filter((section) =>
    categories
      .find((item) => item.key === category.value)
      ?.sections.includes(section.key.split(":").at(-1)!),
  ),
);
const messages = computed(() => {
  if (props.presentation === "accordion") return props.floor.messages;
  return [
    ...new Map(
      [
        ...props.floor.messages,
        ...props.floor.activePages.flatMap((page) => page.messages),
      ].map((message) => [message.id, message]),
    ).values(),
  ];
});
const userInput = computed(() =>
  messages.value.find((message) => message.role === "user"),
);
const reply = computed(() =>
  messages.value.find((message) => message.role === "assistant"),
);
const currentRun = ref<FloorRunSnapshot | null>(null);
const currentRunRecord = ref<FloorRunRecord | null>(null);
const currentResult = ref<FloorCommittedResultSnapshot | null>(null);
const resultError = ref("");
const attempts = computed(() => (currentRun.value ? [currentRun.value] : []));
const timing = computed(() => ({
  start: currentRun.value?.startedAt ?? null,
  end: currentRun.value?.completedAt ?? null,
}));
const time = (value: number | null) =>
  value === null ? "—" : new Date(value).toLocaleString();
const detailRoot = ref<HTMLElement>();
const floorIndex = computed(
  () => props.floors?.findIndex((item) => item.id === props.floor.id) ?? -1,
);
function expandAll(value: boolean) {
  expanded.value = value;
  detailRoot.value?.querySelectorAll("details").forEach((element) => {
    element.open = value;
  });
}
let disposed = false;
async function refresh() {
  sectionError.value = "";
  if (!initialized) runId.value = props.initialRunId ?? "";
  await load();
  if (!initialized && props.initialCall) {
    if (
      !calls.value.some(
        (item) => item.call.callId === props.initialCall!.call.callId,
      )
    )
      calls.value.unshift(props.initialCall);
    selectedId.value = props.initialCall.call.callId;
  }
  initialized = true;
  try {
    resultError.value = "";
    const run = await apiClient.floors.getRun({ floorId: props.floor.id });
    if (disposed) return;
    currentRun.value = run.run;
    currentRunRecord.value = run;
    const committedResultRequest =
      props.presentation === "accordion" &&
      props.floor.state === "committed" &&
      run.run
        ? apiClient.floors
            .getResult({ floorId: props.floor.id })
            .then((result) => ({ result, error: "" }))
            .catch((cause: unknown) => ({
              result: null,
              error: modelCallLoadError(cause),
            }))
        : Promise.resolve({ result: null, error: "" });
    const committedResult = await committedResultRequest;
    if (!disposed) {
      currentResult.value = committedResult.result;
      resultError.value = committedResult.error;
    }
    const result = await apiClient.generationInspection.load({
      floorId: props.floor.id,
    });
    if (!disposed) sections.value = result;
  } catch (cause) {
    if (!disposed) sectionError.value = modelCallLoadError(cause);
  }
}
function requestRefresh() {
  if (props.presentation === "accordion") emit("refresh");
  else void refresh();
}
function floorOptionLabel(item: TimelineFloor) {
  const branchId = "branchId" in item ? item.branchId : props.branchId;
  const round =
    item.floorNo === 0
      ? labels.opening
      : `${labels.roundPrefix} ${item.floorNo} ${labels.round}`;
  const state =
    (labels.floorStates as Record<string, string>)[item.state] ?? item.state;
  return `${round} · ${state} · ${branchId}`;
}
const stateLabel = computed(
  () =>
    (labels.floorStates as Record<string, string>)[props.floor.state] ??
    props.floor.state,
);
const json = (value: unknown) => JSON.stringify(value, null, 2);
const dryRunRoleLabel = (role: "system" | "user" | "assistant") =>
  ({
    system: dryRunCopy.roleSystem,
    user: dryRunCopy.roleUser,
    assistant: dryRunCopy.roleAssistant,
  })[role];
onMounted(refresh);
onBeforeUnmount(() => {
  disposed = true;
  dispose();
  dryRun.clear();
});
</script>
<template>
  <section ref="detailRoot" class="generation-detail">
    <template v-if="presentation === 'accordion'">
      <p class="small">{{ sessionTitle ?? labels.trial }} · {{ sessionId }}</p>
      <h2 class="generation-accordion-title">{{ labels.generationDetail }}</h2>
      <label class="field generation-floor-select"
        >{{ labels.generationDetailRound
        }}<select
          :value="floor.id"
          @change="
            emit(
              'select',
              (floors ?? [floor]).find(
                (item) =>
                  item.id === ($event.target as HTMLSelectElement).value,
              )!,
            )
          "
        >
          <option
            v-for="item in floors ?? [floor]"
            :key="item.id"
            :value="item.id"
          >
            {{ floorOptionLabel(item) }}
          </option>
        </select></label
      >
      <div class="actions generation-accordion-actions">
        <button :disabled="busy || pending" @click="requestRefresh">
          {{ labels.generationDetailRefresh }}
        </button>
      </div>
    </template>
    <template v-else>
      <header class="generation-header">
        <div>
          <div class="small">
            {{ sessionTitle ?? labels.trial }} / {{ labels.records }}
          </div>
          <h1>
            {{ labels.roundPrefix }} {{ floor.floorNo }} {{ labels.round }} ·
            {{ labels.generationDetail }}
          </h1>
        </div>
        <button @click="emit('close')">{{ labels.returnTrial }}</button>
      </header>
      <div class="generation-context">
        <label class="field"
          >{{ labels.correspondingMessage
          }}<select
            :value="floor.id"
            @change="
              emit(
                'select',
                (floors ?? [floor]).find(
                  (item) =>
                    item.id === ($event.target as HTMLSelectElement).value,
                )!,
              )
            "
          >
            <option
              v-for="item in floors ?? [floor]"
              :key="item.id"
              :value="item.id"
            >
              {{ labels.roundPrefix }} {{ item.floorNo }} {{ labels.round }} ·
              {{
                item.messages
                  .find((message) => message.role === "user")
                  ?.content.slice(0, 42)
              }}
            </option>
          </select></label
        >
        <div class="actions">
          <button
            :disabled="floorIndex <= 0"
            @click="floors && emit('select', floors[floorIndex - 1]!)"
          >
            {{ labels.previousRecord }}</button
          ><button
            :disabled="!floors || floorIndex >= floors.length - 1"
            @click="floors && emit('select', floors[floorIndex + 1]!)"
          >
            {{ labels.nextRecord }}</button
          ><button :disabled="busy" @click="refresh">
            {{ labels.refresh }}
          </button>
        </div>
      </div>
      <div class="generation-status">
        <span>{{ stateLabel }}</span
        ><span>{{ callLabels.branch }} {{ branchId }}</span>
      </div>
    </template>
    <div v-if="presentation === 'accordion'" class="generation-accordion">
      <dl class="generation-meta">
        <dt>{{ callLabels.branch }}</dt>
        <dd>{{ branchId }}</dd>
        <dt>{{ labels.generationOverview.inputTokens }}</dt>
        <dd>{{ floor.tokenIn }}</dd>
        <dt>{{ labels.generationOverview.outputTokens }}</dt>
        <dd>{{ floor.tokenOut }}</dd>
        <template v-if="currentRun">
          <dt>{{ callLabels.run }}</dt>
          <dd>{{ currentRun.runId }}</dd>
          <dt>{{ callLabels.attempt }}</dt>
          <dd>{{ currentRun.attemptNo }}</dd>
          <dt>{{ labels.generationOverview.duration }}</dt>
          <dd>
            {{
              timing.start !== null && timing.end !== null
                ? `${timing.end - timing.start} ms`
                : labels.runStates.running
            }}
          </dd>
        </template>
      </dl>
      <p v-if="!floor.pages.length" class="generation-missing">
        {{ labels.noRecords }}
      </p>
      <details class="generation-section">
        <summary>{{ labels.generationDetailExecution }}</summary>
        <div class="generation-section-body">
          <pre class="generation-text" tabindex="0">{{
            json(currentRunRecord)
          }}</pre>
        </div>
      </details>
      <details v-if="currentRun?.error" class="generation-section">
        <summary>{{ labels.generationDetailError }}</summary>
        <div class="generation-section-body">
          <pre class="generation-text" tabindex="0">{{
            json(currentRun.error)
          }}</pre>
        </div>
      </details>
      <details
        v-for="page in floor.pages"
        :key="page.id"
        class="generation-section"
        :open="page.pageKind === 'input' || page.id === selectedPageId"
      >
        <summary>
          {{
            page.pageKind === "input"
              ? labels.generationDetailInputPage
              : labels.generationDetailOutputPage
          }}
          · {{ labels.roundPrefix }} {{ page.pageNo }} 页
        </summary>
        <div class="generation-section-body">
          <p
            v-for="message in page.messages"
            :key="message.id"
            class="generation-text"
          >
            {{ message.content }}
          </p>
          <details class="generation-section">
            <summary>{{ labels.generationDetailPageRecord }}</summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{ json(page) }}</pre>
            </div>
          </details>
        </div>
      </details>
      <details v-if="currentResult || resultError" class="generation-section">
        <summary>{{ labels.generationDetailResult }}</summary>
        <div class="generation-section-body">
          <p v-if="resultError" role="alert" class="generation-error">
            {{ resultError }}
          </p>
          <pre v-if="currentResult" class="generation-text" tabindex="0">{{
            json(currentResult)
          }}</pre>
        </div>
      </details>
      <details v-if="floorRecord" class="generation-section">
        <summary>{{ labels.generationDetailFloorRecord }}</summary>
        <div class="generation-section-body">
          <pre class="generation-text" tabindex="0">{{
            json(floorRecord)
          }}</pre>
        </div>
      </details>
      <details
        v-for="section in sections"
        :key="section.key"
        class="generation-section"
      >
        <summary>{{ section.label }}</summary>
        <div class="generation-section-body">
          <p v-if="section.error" role="alert" class="generation-error">
            {{ modelCallLoadError({ code: section.error }) }}
          </p>
          <p
            v-else-if="Array.isArray(section.value) && !section.value.length"
            class="generation-missing"
          >
            {{ inspection.ui.empty }}
          </p>
          <template
            v-else-if="
              section.key === 'prompt' &&
              section.value &&
              typeof section.value === 'object'
            "
            ><details
              v-for="(value, key) in section.value"
              :key="key"
              class="generation-section"
            >
              <summary>{{ inspection.promptFields[key] || key }}</summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  json(value)
                }}</pre>
              </div>
            </details></template
          >
          <pre v-else class="generation-text" tabindex="0">{{
            json(section.value)
          }}</pre>
        </div>
      </details>
      <p v-if="sectionError" role="alert" class="generation-error">
        {{ sectionError }}
      </p>
      <details
        class="generation-section"
        :open="Boolean(initialCall || initialRunId)"
      >
        <summary>{{ callLabels.modelCalls }}</summary>
        <div class="generation-section-body">
          <form class="actions" @submit.prevent="load()">
            <label class="field"
              >{{ callLabels.run
              }}<input
                v-model="runId"
                :placeholder="callLabels.allRuns" /></label
            ><label class="field"
              >{{ callLabels.attempt
              }}<input
                v-model="attempt"
                type="number"
                min="1"
                :placeholder="callLabels.allAttempts" /></label
            ><button :disabled="busy">{{ callLabels.filter }}</button>
          </form>
          <div class="cards">
            <button
              v-for="item in calls"
              :key="item.call.callId"
              class="card"
              :class="{ active: selectedId === item.call.callId }"
              @click="selectedId = item.call.callId"
            >
              <strong>{{ item.call.purpose }} · {{ item.call.model }}</strong>
              <span
                >{{ callLabels.status[item.call.status] }} ·
                {{ callLabels.commit[item.turnCommitStatus] }}</span
              >
              <span
                >{{ callLabels.attempt }} {{ item.call.attemptNo }} ·
                {{ callLabels.step }} {{ item.call.stepIndex }} ·
                {{ callLabels.requestAttempt }}
                {{ item.call.requestAttemptNo }}</span
              >
            </button>
          </div>
          <button v-if="nextCursor" :disabled="busy" @click="load(true)">
            {{ callLabels.more }}
          </button>
          <p v-if="!busy && !calls.length" class="generation-missing">
            {{ callLabels.empty }}
          </p>
          <p v-if="busy" role="status">{{ callLabels.loading }}</p>
          <p v-if="error" role="alert" class="generation-error">
            {{ error }}
          </p>
          <template v-if="selected">
            <p
              v-if="selected.completionEvidence === 'missing'"
              class="generation-missing"
            >
              {{ callLabels.evidenceMissing }}
            </p>
            <details class="generation-section">
              <summary>{{ callLabels.request }}</summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  selected.call.requestBody
                }}</pre>
              </div>
            </details>
            <details class="generation-section">
              <summary>{{ callLabels.response }}</summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  selected.call.responseBody ?? callLabels.noResponse
                }}</pre>
              </div>
            </details>
            <details class="generation-section">
              <summary>{{ callLabels.result }}</summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  json({
                    text: selected.call.text,
                    reasoning: selected.call.reasoning,
                    toolData: selected.call.toolData,
                    error: selected.call.error,
                  })
                }}</pre>
              </div>
            </details>
            <details class="generation-section">
              <summary>{{ callLabels.timing }}</summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  json({
                    preparedAt: selected.call.preparedAt,
                    sentAt: selected.call.sentAt,
                    endedAt: selected.call.endedAt,
                    usage: selected.call.usage,
                  })
                }}</pre>
              </div>
            </details>
          </template>
          <p v-else class="generation-missing">{{ callLabels.select }}</p>
        </div>
      </details>
    </div>
    <div v-else class="generation-layout">
      <nav class="generation-nav" :aria-label="labels.generationCategories">
        <button
          v-for="item in categories"
          :key="item.key"
          :aria-selected="category === item.key"
          :class="{ active: category === item.key }"
          @click="category = item.key"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="generation-content">
        <div class="generation-content-header">
          <h2>{{ categories.find((item) => item.key === category)?.label }}</h2>
          <div class="actions">
            <button @click="expandAll(true)">{{ labels.expandAll }}</button
            ><button @click="expandAll(false)">{{ labels.collapseAll }}</button>
          </div>
        </div>
        <template v-if="category === 'overview'">
          <details class="generation-section" :open="expanded">
            <summary>
              {{ labels.generationOverview.input
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{
                userInput?.content
              }}</pre>
            </div>
          </details>
          <details class="generation-section" :open="expanded">
            <summary>
              {{ labels.generationOverview.reply
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <dl class="generation-fields">
                <div>
                  <dt>{{ labels.generationOverview.commit }}</dt>
                  <dd>{{ stateLabel }}</dd>
                </div>
                <div>
                  <dt>{{ labels.generationOverview.replyId }}</dt>
                  <dd>{{ reply?.id ?? "—" }}</dd>
                </div>
              </dl>
              <pre class="generation-text" tabindex="0">{{
                reply?.content ?? labels.generationOverview.noReply
              }}</pre>
            </div>
          </details>
          <details class="generation-section" :open="expanded">
            <summary>
              {{ labels.generationOverview.execution
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <dl class="generation-fields">
                <div>
                  <dt>{{ labels.generationOverview.start }}</dt>
                  <dd>{{ time(timing.start) }}</dd>
                </div>
                <div>
                  <dt>{{ labels.generationOverview.end }}</dt>
                  <dd>{{ time(timing.end) }}</dd>
                </div>
                <div>
                  <dt>{{ labels.generationOverview.duration }}</dt>
                  <dd>
                    {{
                      timing.start !== null && timing.end !== null
                        ? `${timing.end - timing.start} ms`
                        : "—"
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ labels.generationOverview.inputTokens }}</dt>
                  <dd>{{ floor.tokenIn }}</dd>
                </div>
                <div>
                  <dt>{{ labels.generationOverview.outputTokens }}</dt>
                  <dd>{{ floor.tokenOut }}</dd>
                </div>
              </dl>
            </div>
          </details>
          <details class="generation-section" :open="expanded">
            <summary>
              <span
                >{{ labels.generationOverview.attempts }}
                <small>{{ attempts.length }}</small></span
              ><span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <details
                v-for="runAttempt in attempts"
                :key="runAttempt.runId + ':' + runAttempt.attemptNo"
                class="generation-section"
              >
                <summary>
                  {{ callLabels.attempt }} {{ runAttempt.attemptNo }} ·
                  {{ labels.runStates[runAttempt.status]
                  }}<span class="generation-disclosure" aria-hidden="true"
                    >⌄</span
                  >
                </summary>
                <div class="generation-section-body">
                  <dl class="generation-fields">
                    <div>
                      <dt>{{ callLabels.run }}</dt>
                      <dd>{{ runAttempt.runId }}</dd>
                    </div>
                    <div>
                      <dt>{{ labels.generationOverview.start }}</dt>
                      <dd>{{ time(runAttempt.startedAt) }}</dd>
                    </div>
                    <div>
                      <dt>{{ labels.generationOverview.end }}</dt>
                      <dd>{{ time(runAttempt.completedAt ?? null) }}</dd>
                    </div>
                  </dl>
                  <pre
                    v-if="runAttempt.error"
                    class="generation-text"
                    tabindex="0"
                    >{{ json(runAttempt.error) }}</pre
                  >
                </div>
              </details>
              <p v-if="!attempts.length" class="generation-missing">
                {{ labels.generationOverview.noAttempts }}
              </p>
            </div>
          </details>
        </template>
        <template v-if="category === 'stages' || category === 'prompt'">
          <form class="actions" @submit.prevent="load()">
            <label class="field"
              >{{ callLabels.run
              }}<input
                v-model="runId"
                :placeholder="callLabels.allRuns" /></label
            ><label class="field"
              >{{ callLabels.attempt
              }}<input
                v-model="attempt"
                type="number"
                min="1"
                :placeholder="callLabels.allAttempts" /></label
            ><button :disabled="busy">{{ callLabels.filter }}</button>
          </form>
          <div class="cards">
            <button
              v-for="item in calls"
              :key="item.call.callId"
              class="card"
              :class="{ active: selectedId === item.call.callId }"
              @click="selectedId = item.call.callId"
            >
              <strong>{{ item.call.purpose }} · {{ item.call.model }}</strong
              ><span
                >{{ callLabels.status[item.call.status] }} ·
                {{ callLabels.commit[item.turnCommitStatus] }}</span
              ><span
                >{{ callLabels.attempt }} {{ item.call.attemptNo }} ·
                {{ callLabels.step }} {{ item.call.stepIndex }} ·
                {{ callLabels.requestAttempt }}
                {{ item.call.requestAttemptNo }}</span
              >
            </button>
          </div>
          <button v-if="nextCursor" :disabled="busy" @click="load(true)">
            {{ callLabels.more }}
          </button>
          <p v-if="!busy && !calls.length" class="generation-missing">
            {{ callLabels.empty }}
          </p>
          <template v-if="selected"
            ><p
              v-if="selected.completionEvidence === 'missing'"
              class="generation-missing"
            >
              {{ callLabels.evidenceMissing }}
            </p>
            <details class="generation-section" :open="expanded">
              <summary>
                {{ callLabels.request
                }}<span class="generation-disclosure" aria-hidden="true"
                  >⌄</span
                >
              </summary>
              <div class="generation-section-body">
                <pre class="generation-text" tabindex="0">{{
                  selected.call.requestBody
                }}</pre>
              </div>
            </details>
            <template v-if="category === 'stages'"
              ><details class="generation-section" :open="expanded">
                <summary>
                  {{ callLabels.response
                  }}<span class="generation-disclosure" aria-hidden="true"
                    >⌄</span
                  >
                </summary>
                <div class="generation-section-body">
                  <pre class="generation-text" tabindex="0">{{
                    selected.call.responseBody ?? callLabels.noResponse
                  }}</pre>
                </div>
              </details>
              <details class="generation-section" :open="expanded">
                <summary>
                  {{ callLabels.result
                  }}<span class="generation-disclosure" aria-hidden="true"
                    >⌄</span
                  >
                </summary>
                <div class="generation-section-body">
                  <pre class="generation-text" tabindex="0">{{
                    json({
                      text: selected.call.text,
                      reasoning: selected.call.reasoning,
                      toolData: selected.call.toolData,
                      error: selected.call.error,
                    })
                  }}</pre>
                </div>
              </details>
              <details class="generation-section" :open="expanded">
                <summary>
                  {{ callLabels.timing
                  }}<span class="generation-disclosure" aria-hidden="true"
                    >⌄</span
                  >
                </summary>
                <div class="generation-section-body">
                  <pre class="generation-text" tabindex="0">{{
                    json({
                      preparedAt: selected.call.preparedAt,
                      sentAt: selected.call.sentAt,
                      endedAt: selected.call.endedAt,
                      usage: selected.call.usage,
                    })
                  }}</pre>
                </div>
              </details></template
            ></template
          >
        </template>
        <details
          v-for="section in visibleSections"
          :key="section.key"
          class="generation-section"
          :open="expanded"
        >
          <summary>
            {{ section.label
            }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
          </summary>
          <div class="generation-section-body">
            <p v-if="section.error" role="alert" class="generation-error">
              {{ modelCallLoadError({ code: section.error }) }}
            </p>
            <p
              v-else-if="Array.isArray(section.value) && !section.value.length"
              class="generation-missing"
            >
              {{ inspection.ui.empty }}
            </p>
            <template
              v-else-if="
                section.key === 'prompt' &&
                section.value &&
                typeof section.value === 'object'
              "
              ><details
                v-for="(value, key) in section.value"
                :key="key"
                class="generation-section"
                :open="expanded"
              >
                <summary>
                  {{ inspection.promptFields[key] || key
                  }}<span class="generation-disclosure" aria-hidden="true"
                    >⌄</span
                  >
                </summary>
                <div class="generation-section-body">
                  <pre class="generation-text" tabindex="0">{{
                    json(value)
                  }}</pre>
                </div>
              </details></template
            >
            <pre v-else class="generation-text" tabindex="0">{{
              json(section.value)
            }}</pre>
          </div>
        </details>
        <details
          v-if="category === 'raw'"
          class="generation-section"
          :open="expanded"
        >
          <summary>
            {{ labels.readDetail
            }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
          </summary>
          <div class="generation-section-body">
            <pre class="generation-text" tabindex="0">{{
              json({ floor, calls, sections })
            }}</pre>
          </div>
        </details>
        <p v-if="busy" role="status">{{ callLabels.loading }}</p>
        <p v-if="error || sectionError" role="alert" class="generation-error">
          {{ error || sectionError }}
        </p>
      </div>
    </div>
    <details class="generation-section generation-preview">
      <summary>
        {{ dryRunCopy.title
        }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
      </summary>
      <div class="generation-section-body">
        <p>{{ dryRunCopy.description }}</p>
        <form @submit.prevent="dryRun.run(sessionId, branchId)">
          <label class="field">
            {{ dryRunCopy.input }}
            <textarea v-model="dryRun.input.value" rows="3" required />
          </label>
          <button type="submit" :disabled="dryRun.busy.value">
            {{ dryRunCopy.submit }}
          </button>
        </form>
        <p v-if="dryRun.busy.value" role="status">{{ dryRunCopy.loading }}</p>
        <p v-if="dryRun.error.value" role="alert" class="generation-error">
          {{ dryRun.error.value }}
        </p>
        <template v-if="dryRun.result.value">
          <p>{{ dryRunCopy.resultScope }}</p>
          <dl class="generation-fields">
            <div>
              <dt>{{ dryRunCopy.tokenEstimate }}</dt>
              <dd>{{ dryRun.result.value.tokenEstimate }}</dd>
            </div>
            <div>
              <dt>{{ dryRunCopy.availableForReply }}</dt>
              <dd>{{ dryRun.result.value.availableForReply }}</dd>
            </div>
          </dl>
          <h3>{{ dryRunCopy.messages }}</h3>
          <p
            v-if="!dryRun.result.value.messages.length"
            class="generation-missing"
          >
            {{ dryRunCopy.noMessages }}
          </p>
          <ol v-else>
            <li
              v-for="(message, index) in dryRun.result.value.messages"
              :key="index"
            >
              <strong>{{ dryRunRoleLabel(message.role) }}</strong>
              <pre class="generation-text" tabindex="0">{{
                message.content
              }}</pre>
            </li>
          </ol>
          <details class="generation-section">
            <summary>
              {{ dryRunCopy.assembly
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{
                json(dryRun.result.value.assembly)
              }}</pre>
            </div>
          </details>
          <details class="generation-section">
            <summary>
              {{ dryRunCopy.promptSnapshot
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{
                json(dryRun.result.value.promptSnapshot)
              }}</pre>
            </div>
          </details>
          <details class="generation-section">
            <summary>
              {{ dryRunCopy.runtimeTrace
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{
                dryRun.result.value.runtimeTrace
                  ? json(dryRun.result.value.runtimeTrace)
                  : dryRunCopy.noRuntimeTrace
              }}</pre>
            </div>
          </details>
          <details
            v-if="dryRun.result.value.memorySummary"
            class="generation-section"
          >
            <summary>
              {{ dryRunCopy.memorySummary
              }}<span class="generation-disclosure" aria-hidden="true">⌄</span>
            </summary>
            <div class="generation-section-body">
              <pre class="generation-text" tabindex="0">{{
                dryRun.result.value.memorySummary
              }}</pre>
            </div>
          </details>
        </template>
        <p
          v-else-if="!dryRun.busy.value && !dryRun.error.value"
          class="generation-missing"
        >
          {{ dryRunCopy.noResult }}
        </p>
      </div>
    </details>
  </section>
</template>
