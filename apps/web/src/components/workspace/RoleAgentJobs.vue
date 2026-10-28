<script setup lang="ts">
import { ref, watch } from "vue";
import {
  apiErrorMessages,
  projectAgentJobCancellableStatuses,
} from "@tavern/shared";
import { apiClient } from "../../lib/api.js";
import words from "../../config/role-agent-jobs.json";
type Job = Awaited<ReturnType<typeof apiClient.projects.agentJobs.get>>;
const props = defineProps<{ projectId: string; revision: number }>();
const items = ref<Job[]>([]),
  selected = ref<Job>(),
  total = ref(0),
  offset = ref(0);
const busy = ref(false),
  failure = ref("");
let request = 0;
function report(error: unknown, operation: "load" | "inspect" | "cancel") {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const message = apiErrorMessages[code as keyof typeof apiErrorMessages];
  failure.value =
    typeof message === "string" ? message : words[`${operation}Failed`];
}
async function load() {
  const token = ++request,
    projectId = props.projectId;
  if (!projectId) {
    busy.value = false;
    items.value = [];
    total.value = 0;
    return;
  }
  busy.value = true;
  failure.value = "";
  try {
    const page = await apiClient.projects.agentJobs.list(projectId, {
      offset: offset.value,
      limit: words.pageSize,
    });
    if (token !== request) return;
    items.value = page.items;
    total.value = page.total;
  } catch (error) {
    if (token === request) report(error, "load");
  } finally {
    if (token === request) busy.value = false;
  }
}
async function inspect(job: Job) {
  const token = ++request,
    projectId = props.projectId;
  busy.value = true;
  failure.value = "";
  try {
    const detail = await apiClient.projects.agentJobs.get(projectId, job.id);
    if (token === request) selected.value = detail;
  } catch (error) {
    if (token === request) report(error, "inspect");
  } finally {
    if (token === request) busy.value = false;
  }
}
async function cancel(job: Job) {
  const projectId = props.projectId;
  busy.value = true;
  failure.value = "";
  try {
    const result = await apiClient.projects.agentJobs.cancel(projectId, job.id);
    if (projectId !== props.projectId) return;
    if (selected.value?.id === result.id) selected.value = result;
    await load();
  } catch (error) {
    if (projectId === props.projectId) report(error, "cancel");
  } finally {
    if (projectId === props.projectId) busy.value = false;
  }
}
function page(delta: number) {
  offset.value += delta * words.pageSize;
  void load();
}
watch(
  () => [props.projectId, props.revision],
  () => {
    selected.value = undefined;
    items.value = [];
    total.value = 0;
    offset.value = 0;
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="box">
    <div class="toolbar">
      <h2>{{ words.title }}</h2>
      <button :disabled="busy" @click="load">{{ words.refresh }}</button>
    </div>
    <p v-if="failure" role="alert">{{ failure }}</p>
    <p v-if="!items.length && !busy && !failure">{{ words.empty }}</p>
    <table v-else>
      <thead>
        <tr>
          <th>{{ words.id }}</th>
          <th>{{ words.status }}</th>
          <th>{{ words.actions }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="job in items" :key="job.id">
          <td>{{ job.id }}</td>
          <td>{{ job.status }}</td>
          <td>
            <button :disabled="busy" @click="inspect(job)">
              {{ words.detail }}
            </button>
            <button
              :disabled="
                busy ||
                !projectAgentJobCancellableStatuses.some(
                  (status) => status === job.status,
                )
              "
              @click="cancel(job)"
            >
              {{ words.cancel }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="actions">
      <button :disabled="busy || offset === 0" @click="page(-1)">
        {{ words.previous }}</button
      ><span>{{ offset + items.length }} / {{ total }}</span
      ><button
        :disabled="busy || offset + items.length >= total"
        @click="page(1)"
      >
        {{ words.next }}
      </button>
    </div>
    <section v-if="selected">
      <h3>{{ words.detail }}</h3>
      <pre>{{ JSON.stringify(selected, null, 2) }}</pre>
    </section>
  </section>
</template>
