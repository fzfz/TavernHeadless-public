<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { SessionDetail } from "@tavern/sdk";
import { apiClient } from "../../lib/api.js";
import { apiErrorMessages } from "@tavern/shared";
import { useRoleLabels } from "../../composables/useRoleLabels.js";
import tables from "../../config/role-inspection-tables.json";
import RoleInspectionTable from "./RoleInspectionTable.vue";
import RoleAgentManagement from "./RoleAgentManagement.vue";
import type { RoleInspectionTableSpec } from "../../lib/role-inspection.schema.js";
const { labels } = useRoleLabels();
const tableSpec = computed(
  () =>
    (tables as Record<string, unknown>)[props.panel] as
      | RoleInspectionTableSpec
      | undefined,
);
const memoryStats = ref<unknown[]>([]),
  memoryJobs = ref<unknown[]>([]),
  staged = ref<unknown[]>([]),
  promotions = ref<unknown[]>([]);

const props = defineProps<{
  panel: string;
  sessionId: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const agentPanel = ref<InstanceType<typeof RoleAgentManagement> | null>(null);
const savedSessionFields = ref("");
function editableSessionFields() {
  return JSON.stringify([
    session.value?.title ?? "",
    session.value?.promptMode,
  ]);
}
const dirty = computed(
  () =>
    Boolean(agentPanel.value?.dirty) ||
    (props.panel === "session-config" &&
      Boolean(session.value) &&
      editableSessionFields() !== savedSessionFields.value),
);
defineExpose({ dirty });
const busy = ref(false),
  failure = ref(""),
  items = ref<unknown[]>([]),
  session = ref<SessionDetail>();
const title = computed(() =>
  props.panel === "session-config"
    ? labels.sessionConfiguration
    : (labels.runtimeItems.find((item) => item.key === props.panel)?.label ??
      labels.trialDetail),
);
async function load() {
  busy.value = true;
  failure.value = "";
  try {
    if (!props.sessionId) return;
    if (props.panel === "variables")
      items.value = (
        await apiClient.variables.resolveContext({
          sessionId: props.sessionId,
          branchId: props.branchId,
          floorId: props.floorId,
          pageId: props.pageId,
          includeLayers: true,
        })
      ).resolved;
    if (props.panel === "variables" && props.floorId) {
      const sections = await apiClient.generationInspection.load({
        floorId: props.floorId,
      });
      const records = (key: string) =>
        sections
          .filter((section) => section.key.split(":").at(-1) === key)
          .flatMap((section) => {
            if (section.error)
              throw Object.assign(new Error(), { code: section.error });
            const value = section.value as
              | { items?: unknown[] }
              | unknown[]
              | undefined;
            return Array.isArray(value) ? value : (value?.items ?? []);
          });
      staged.value = records("staged");
      promotions.value = records("promotions");
    }
    if (props.panel === "memory") {
      const stats = await apiClient.memories.getStats({
        scope: "chat",
        scopeId: props.sessionId,
      });
      memoryStats.value = [{ ...stats, ...stats.byType }];
      memoryJobs.value = (
        await apiClient.memoryJobs.list({
          scope: "chat",
          scopeId: props.sessionId,
        })
      ).jobs;
      items.value = await apiClient.memories.list({
        scope: "chat",
        scopeId: props.sessionId,
      });
    }
    if (props.panel === "branches")
      items.value = await apiClient.sessions.listBranches({
        sessionId: props.sessionId,
      });
    if (props.panel === "live-tools")
      items.value = (
        await apiClient.tools.listExecutions({ sessionId: props.sessionId })
      ).records;
    if (props.panel === "session-config") {
      session.value = await apiClient.sessions.getDetail({
        sessionId: props.sessionId,
      });
      savedSessionFields.value = editableSessionFields();
    }
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
function report(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  failure.value = String(
    apiErrorMessages[code as keyof typeof apiErrorMessages] ??
      apiErrorMessages.ROLE_USER_REQUEST_FAILED,
  );
}
async function save() {
  if (!session.value || busy.value) return;
  busy.value = true;
  failure.value = "";
  const submittedFields = editableSessionFields();
  try {
    await apiClient.sessions.update({
      sessionId: props.sessionId,
      title: session.value.title ?? "",
      promptMode: (session.value.promptMode ?? undefined) as
        | "compat_plus"
        | "compat_strict"
        | "native"
        | undefined,
    });
    savedSessionFields.value = submittedFields;
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (!props.panel.startsWith("agent-")) void load();
});
</script>
<template>
  <RoleAgentManagement
    v-if="panel === 'agent-types' || panel === 'agent-bindings'"
    ref="agentPanel"
    :panel="panel"
    :session-id="sessionId"
    @close="emit('close')"
    @changed="emit('changed')"
  />
  <section v-else class="panel">
    <div class="toolbar">
      <h1>{{ title }}</h1>
      <button @click="emit('close')">{{ labels.returnTrial }}</button
      ><button :disabled="busy" @click="load">{{ labels.refresh }}</button>
    </div>
    <p v-if="!sessionId && !panel.startsWith('agent-')">
      {{ labels.chooseTrial }}
    </p>
    <form v-if="session" @submit.prevent="save">
      <label class="field"
        >{{ labels.namePrompt
        }}<input v-model="session.title" required /></label
      ><label class="field"
        >{{ labels.promptMode
        }}<select v-model="session.promptMode">
          <option value="compat_plus">compat_plus</option>
          <option value="compat_strict">compat_strict</option>
          <option value="native">native</option>
        </select></label
      ><button class="primary" :disabled="busy">{{ labels.save }}</button>
      <details>
        <summary>{{ labels.bindings }}</summary>
        <pre>{{ session }}</pre>
      </details>
    </form>
    <RoleInspectionTable
      v-if="panel === 'memory'"
      :spec="tables.memoryStats"
      :rows="memoryStats"
    />
    <RoleInspectionTable v-if="tableSpec" :spec="tableSpec" :rows="items" />
    <template v-if="panel === 'variables'"
      ><RoleInspectionTable
        :spec="tables.staged"
        :rows="staged" /><RoleInspectionTable
        :spec="tables.promotions"
        :rows="promotions"
    /></template>
    <RoleInspectionTable
      v-if="panel === 'memory'"
      :spec="tables.memoryJobs"
      :rows="memoryJobs"
    />
    <p v-if="!busy && !items.length && !session" class="empty">
      {{ labels.recordEmpty }}
    </p>
    <p v-if="busy" role="status">{{ labels.loading }}</p>
    <p v-if="failure" role="alert" class="danger">{{ failure }}</p>
  </section>
</template>
