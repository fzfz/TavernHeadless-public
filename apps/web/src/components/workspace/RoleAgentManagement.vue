<script setup lang="ts">
import { vModalFocus } from "../../directives/modal-focus.js";
import RoleAgentJobs from "./RoleAgentJobs.vue";
import { computed, onMounted, ref } from "vue";
import type { ProjectRecord, LlmProfile } from "@tavern/sdk";
import { apiErrorMessages } from "@tavern/shared";
import { apiClient } from "../../lib/api.js";
import words from "../../config/role-agent-management.json";
import roleLabels from "../../config/role-apps.json";
import {
  agentFormFromRecord,
  bindingFormForType,
  blankAgentForm,
  createAgentManagement,
} from "../../lib/role-agent-management.js";
import type {
  AgentForm,
  AgentTypeRecord,
  ProjectAgentBindingRecord,
  AgentScopeKind,
  WorkspaceRecord,
} from "../../lib/role-agent-management.schema.js";

const props = defineProps<{
  panel: "agent-types" | "agent-bindings";
  sessionId: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const commands = createAgentManagement(apiClient);
const projects = ref<ProjectRecord[]>([]);
const workspaces = ref<WorkspaceRecord[]>([]);
const profiles = ref<LlmProfile[]>([]);
const workspaceId = ref("");
const projectId = ref("");
const types = ref<AgentTypeRecord[]>([]);
const bindings = ref<ProjectAgentBindingRecord[]>([]);
const busy = ref(false);
const failure = ref("");
const notice = ref("");
const editor = ref<"create" | "edit" | null>(null);
const editingType = ref<AgentTypeRecord | null>(null);
const editingBinding = ref<ProjectAgentBindingRecord | null>(null);
const form = ref<AgentForm>(
  blankAgentForm(props.panel === "agent-types" ? "floor" : "project"),
);
const selectedTypeId = ref("");
const baseline = ref("");
const pendingEditorAction = ref<() => void>();
function requestEditorAction(action: () => void) {
  if (dirty.value) pendingEditorAction.value = action;
  else action();
}
const pendingSelection = ref<{
  kind: "workspace" | "project";
  id: string;
} | null>(null);
function snapshot() {
  return JSON.stringify({
    form: form.value,
    typeId:
      props.panel === "agent-bindings" && editor.value === "create"
        ? selectedTypeId.value
        : null,
  });
}
const dirty = computed(
  () => editor.value !== null && snapshot() !== baseline.value,
);
defineExpose({ dirty });
let rowsRequest = 0;
const jobsRevision = ref(0);
const workspaceIds = computed(() =>
  workspaces.value.map((workspace) => workspace.id),
);
const selectedProject = computed(() =>
  projects.value.find((project) => project.id === projectId.value),
);
const activeTypes = computed(() =>
  types.value.filter((type) => type.status === "active"),
);
const scopes: { value: AgentScopeKind; label: string }[] = [
  { value: "floor", label: words.floor },
  { value: "session", label: words.session },
  { value: "project", label: words.projectScope },
  { value: "workspace", label: words.workspaceScope },
];
function report(error: unknown) {
  if (error instanceof SyntaxError) {
    failure.value = words.invalidMetadata;
    return;
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  failure.value = String(
    apiErrorMessages[code as keyof typeof apiErrorMessages] ??
      words.requestFailed,
  );
}
async function listProjects() {
  const all: ProjectRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await apiClient.projects.list({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  projects.value = all;
}
async function loadContext() {
  busy.value = true;
  failure.value = "";
  try {
    await Promise.all([
      listProjects(),
      apiClient.workspaces.list().then((items) => {
        workspaces.value = items;
      }),
      apiClient.llmProfiles.list().then((items) => {
        profiles.value = items;
      }),
    ]);
    if (props.sessionId) {
      const scope = await apiClient.sessions.getScope({
        sessionId: props.sessionId,
      });
      if (workspaceIds.value.includes(scope.workspaceId))
        workspaceId.value = scope.workspaceId;
      if (projects.value.some((project) => project.id === scope.projectId))
        projectId.value = scope.projectId;
    }
    if (!workspaceId.value || !workspaceIds.value.includes(workspaceId.value))
      workspaceId.value = workspaceIds.value[0] ?? "";
    if (
      !projectId.value ||
      !projects.value.some((project) => project.id === projectId.value)
    )
      projectId.value = projects.value[0]?.id ?? "";
    await loadRows();
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function loadRows() {
  const request = ++rowsRequest;
  failure.value = "";
  if (props.panel === "agent-types") {
    const targetWorkspaceId = workspaceId.value;
    const result = targetWorkspaceId
      ? await apiClient.workspaces.agentTypes.list(targetWorkspaceId)
      : [];
    if (request === rowsRequest && targetWorkspaceId === workspaceId.value)
      types.value = result;
  } else {
    const targetProject = selectedProject.value;
    const [nextTypes, nextBindings] = await Promise.all([
      targetProject
        ? apiClient.workspaces.agentTypes.list(targetProject.workspaceId)
        : Promise.resolve([]),
      targetProject
        ? apiClient.projects.agentBindings.list(targetProject.id)
        : Promise.resolve([]),
    ]);
    if (request !== rowsRequest || targetProject?.id !== projectId.value)
      return;
    types.value = nextTypes;
    bindings.value = nextBindings;
    const nextActiveTypes = nextTypes.filter(
      (type) => type.status === "active",
    );
    if (!nextActiveTypes.some((type) => type.id === selectedTypeId.value))
      selectedTypeId.value = nextActiveTypes[0]?.id ?? "";
  }
}
async function reload() {
  busy.value = true;
  failure.value = "";
  try {
    await loadRows();
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
function startCreate() {
  failure.value = "";
  notice.value = "";
  editingType.value = null;
  editingBinding.value = null;
  if (props.panel === "agent-bindings") {
    const type = activeTypes.value.find(
      (item) => item.id === selectedTypeId.value,
    );
    if (!type) return;
    form.value = bindingFormForType(type);
  } else form.value = blankAgentForm("floor");
  editor.value = "create";
  baseline.value = snapshot();
}
function chooseType(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const type = activeTypes.value.find((item) => item.id === id);
  if (!type) return;
  selectedTypeId.value = id;
  form.value.scopeKind = type.scopeKind;
}
function startEdit(record: AgentTypeRecord | ProjectAgentBindingRecord) {
  failure.value = "";
  notice.value = "";
  editingType.value = null;
  editingBinding.value = null;
  if ("defaults" in record) editingType.value = record;
  else editingBinding.value = record;
  form.value = agentFormFromRecord(record);
  editor.value = "edit";
  baseline.value = snapshot();
}
function requestSelection(kind: "workspace" | "project", event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  const current = kind === "workspace" ? workspaceId.value : projectId.value;
  if (id === current) return;
  select.value = current;
  if (dirty.value) {
    pendingSelection.value = { kind, id };
    return;
  }
  applySelection(kind, id);
}
function applySelection(kind: "workspace" | "project", id: string) {
  editor.value = null;
  notice.value = "";
  if (kind === "workspace") workspaceId.value = id;
  else projectId.value = id;
  void reload();
}
function discardAndSelect() {
  const action = pendingEditorAction.value;
  pendingEditorAction.value = undefined;
  action?.();
  const target = pendingSelection.value;
  pendingSelection.value = null;
  if (target) applySelection(target.kind, target.id);
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  try {
    if (props.panel === "agent-types") {
      if (editingType.value)
        await commands.updateType(
          workspaceId.value,
          editingType.value,
          form.value,
        );
      else await commands.createType(workspaceId.value, form.value);
      notice.value = words.typeSaved;
    } else {
      if (editingBinding.value)
        await commands.updateBinding(
          projectId.value,
          editingBinding.value,
          form.value,
        );
      else
        await commands.createBinding(
          projectId.value,
          selectedTypeId.value,
          form.value,
        );
      notice.value = words.bindingSaved;
    }
    editor.value = null;
    await loadRows();
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function toggle(record: AgentTypeRecord | ProjectAgentBindingRecord) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  try {
    if ("defaults" in record)
      await commands.toggleType(workspaceId.value, record);
    else await commands.toggleBinding(projectId.value, record);
    await loadRows();
    notice.value = words.statusSaved;
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function run(record: ProjectAgentBindingRecord) {
  if (busy.value || record.status !== "enabled") return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  try {
    await commands.runBinding(projectId.value, record);
    await loadRows();
    notice.value = words.runSubmitted;
    jobsRevision.value++;
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
onMounted(loadContext);
</script>
<template>
  <section class="panel">
    <div class="toolbar">
      <h1>
        {{ panel === "agent-types" ? words.typesTitle : words.bindingsTitle }}
      </h1>
      <button type="button" @click="emit('close')">{{ words.return }}</button>
      <button type="button" :disabled="busy" @click="reload">
        {{ words.refresh }}
      </button>
    </div>
    <label v-if="panel === 'agent-types'" class="field"
      >{{ words.workspace }}
      <select
        :value="workspaceId"
        :disabled="busy || !workspaceIds.length"
        @change="requestSelection('workspace', $event)"
      >
        <option value="">{{ words.choose }}</option>
        <option
          v-for="workspace in workspaces"
          :key="workspace.id"
          :value="workspace.id"
        >
          {{ workspace.name }}
        </option>
      </select>
    </label>
    <label v-else class="field"
      >{{ words.project }}
      <select
        :value="projectId"
        :disabled="busy || !projects.length"
        @change="requestSelection('project', $event)"
      >
        <option value="">{{ words.choose }}</option>
        <option
          v-for="project in projects"
          :key="project.id"
          :value="project.id"
        >
          {{ project.name }}
        </option>
      </select>
    </label>
    <p
      v-if="panel === 'agent-types' && !workspaceIds.length && !busy"
      class="empty"
    >
      {{ words.noWorkspace }}
    </p>
    <p
      v-if="panel === 'agent-bindings' && !projects.length && !busy"
      class="empty"
    >
      {{ words.noProject }}
    </p>
    <template
      v-if="
        (panel === 'agent-types' && workspaceId) ||
        (panel === 'agent-bindings' && projectId)
      "
    >
      <button
        v-if="!editor"
        type="button"
        class="primary"
        :disabled="busy || (panel === 'agent-bindings' && !activeTypes.length)"
        @click="requestEditorAction(startCreate)"
      >
        {{ panel === "agent-types" ? words.createType : words.createBinding }}
      </button>
      <p
        v-if="panel === 'agent-bindings' && !activeTypes.length && !busy"
        class="empty"
      >
        {{ words.noTypes }}
      </p>
      <form v-if="editor" @submit.prevent="save">
        <label
          v-if="panel === 'agent-types' && editor === 'create'"
          class="field"
          >{{ words.key }}<input v-model="form.key" required maxlength="120"
        /></label>
        <label v-if="panel === 'agent-types'" class="field"
          >{{ words.name }}<input v-model="form.name" required maxlength="200"
        /></label>
        <label
          v-if="panel === 'agent-bindings' && editor === 'create'"
          class="field"
          >{{ words.type }}
          <select :value="selectedTypeId" required @change="chooseType">
            <option v-for="type in activeTypes" :key="type.id" :value="type.id">
              {{ type.name }}
            </option>
          </select>
        </label>
        <label
          v-if="editor === 'create' || panel === 'agent-bindings'"
          class="field"
          >{{ words.scope }}
          <select
            v-model="form.scopeKind"
            :disabled="panel === 'agent-bindings'"
          >
            <option
              v-for="scope in scopes"
              :key="scope.value"
              :value="scope.value"
            >
              {{ scope.label }}
            </option>
          </select>
        </label>
        <label class="field"
          >{{ words.model }}
          <select v-model="form.llmProfileId">
            <option value="">
              {{
                panel === "agent-types" ? words.modelNone : words.modelDefault
              }}
            </option>
            <option
              v-for="profile in profiles"
              :key="profile.id"
              :value="profile.id"
            >
              {{ profile.presetName }}
            </option>
          </select>
        </label>
        <label class="field"
          >{{ words.mcpIds }}<input v-model="form.mcpIds"
        /></label>
        <label class="field"
          >{{ words.events }}<input v-model="form.eventTypes"
        /></label>
        <label class="field"
          >{{ words.outputs }}<input v-model="form.outputTargets"
        /></label>
        <label class="field"
          >{{ words.reads }}<input v-model="form.reads"
        /></label>
        <label class="field"
          >{{ words.metadata }}<textarea v-model="form.metadata" rows="5" />
        </label>
        <button
          type="submit"
          class="primary"
          :disabled="
            busy ||
            (panel === 'agent-bindings' &&
              editor === 'create' &&
              !selectedTypeId)
          "
        >
          {{
            editor === "create"
              ? panel === "agent-types"
                ? words.createType
                : words.createBinding
              : words.save
          }}
        </button>
        <button type="button" :disabled="busy" @click="editor = null">
          {{ words.cancel }}
        </button>
      </form>
      <div v-if="!editor" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ panel === "agent-types" ? words.name : words.type }}</th>
              <th>{{ words.scope }}</th>
              <th>{{ words.status }}</th>
              <th>{{ words.actions }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="type in panel === 'agent-types' ? types : []"
              :key="type.id"
            >
              <td>{{ type.name }} ({{ type.key }})</td>
              <td>{{ type.scopeKind }}</td>
              <td>{{ type.status }}</td>
              <td>
                <button
                  type="button"
                  :disabled="busy"
                  @click="requestEditorAction(() => startEdit(type))"
                >
                  {{ words.edit }}</button
                ><button type="button" :disabled="busy" @click="toggle(type)">
                  {{ type.status === "active" ? words.disable : words.enable }}
                </button>
              </td>
            </tr>
            <tr
              v-for="binding in panel === 'agent-bindings' ? bindings : []"
              :key="binding.id"
            >
              <td>
                {{
                  types.find((type) => type.id === binding.agentTypeId)?.name ??
                  binding.agentTypeId
                }}
              </td>
              <td>{{ binding.scopeKind }}</td>
              <td>{{ binding.status }}</td>
              <td>
                <button
                  type="button"
                  :disabled="busy"
                  @click="requestEditorAction(() => startEdit(binding))"
                >
                  {{ words.edit }}</button
                ><button
                  type="button"
                  :disabled="busy"
                  @click="toggle(binding)"
                >
                  {{
                    binding.status === "enabled" ? words.disable : words.enable
                  }}</button
                ><button
                  type="button"
                  :disabled="busy || binding.status !== 'enabled'"
                  @click="run(binding)"
                >
                  {{ words.run }}
                </button>
              </td>
            </tr>
            <tr
              v-if="(panel === 'agent-types' ? types : bindings).length === 0"
            >
              <td colspan="4" class="empty">{{ words.empty }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p v-if="notice" role="status">{{ notice }}</p>
    <RoleAgentJobs
      v-if="panel === 'agent-bindings' && projectId"
      :project-id="projectId"
      :revision="jobsRevision"
    />
    <p v-if="failure" role="alert" class="danger">{{ failure }}</p>
    <div v-if="pendingSelection || pendingEditorAction" class="modal-backdrop">
      <div
        v-modal-focus="() => { pendingSelection = null; pendingEditorAction = undefined; }"
        class="modal-card"
        role="dialog"
        aria-modal="true"
        :aria-label="words.unsavedChanges"
      >
        <p>{{ words.unsavedChanges }}</p>
        <button
          type="button"
          @click="
            pendingSelection = null;
            pendingEditorAction = undefined;
          "
        >
          {{ roleLabels.keepEditing }}
        </button>
        <button type="button" @click="discardAndSelect">
          {{ roleLabels.discard }}
        </button>
      </div>
    </div>
  </section>
</template>
