<script setup lang="ts">
import { vModalFocus } from "../../directives/modal-focus.js";
import { createResponseError } from "@tavern/sdk";
import { computed, onMounted, ref, watch } from "vue";
import { apiClient } from "../../lib/api.js";
import { apiErrorMessages, createBrowserUuid } from "@tavern/shared";
import labels from "../../config/role-apps.json";
import config from "../../config/role-resource-fields.json";
import testLabels from "../../config/role-resource-tests.json";
import {
  previewRoleRegex,
  modelProbeOptions,
  snapshotRoleResource,
  createResourceTestTracker,
  type RegexPreviewResult,
} from "../../lib/role-resource-tests.js";
import type { LlmDiscoveredModel, LlmModelTestResult } from "@tavern/sdk";
import {
  listRoleResources,
  readRoleResource,
  saveRoleResource,
  removeRoleResource,
  exportRoleResource,
  previewRoleResourceImport,
  newRoleEntry,
  updatePresetOrder,
  newRoleDocument,
  createRoleResource,
} from "../../lib/role-resources.js";
import type {
  RoleResourceKind,
  RoleResourceDocument,
  RoleResourceRow,
} from "../../lib/role-resource.schema.js";
import RoleResourceField from "./RoleResourceField.vue";
import { roleResourceImportAction } from "./role-resource-import.js";
const props = defineProps<{ kind: string; resourceId?: string }>();
const emit = defineEmits<{
  close: [];
  changed: [];
  editing: [value: boolean];
}>();
const libraryDialog = ref<HTMLDialogElement>(),
  fileInput = ref<HTMLInputElement>();
const removeTarget = ref<RoleResourceRow>();
const status = ref("active"),
  favoritesOnly = ref(false),
  favorites = ref<string[]>([]);
const original = ref(""),
  discardOpen = ref(false);
const savedModel = ref<RoleResourceDocument>();
const testTracker = createResourceTestTracker();
const testBusy = ref(false),
  testFailure = ref(""),
  regexResult = ref<RegexPreviewResult>(),
  discoveredModels = ref<LlmDiscoveredModel[]>(),
  modelTestResult = ref<LlmModelTestResult>();
const regexInput = ref(""),
  regexPlacement = ref<1 | 2>(2),
  regexChannel = ref<"persist" | "prompt" | "display" | "edit">("persist"),
  regexDepth = ref(0),
  regexVariables = ref("{}");
const dirty = computed(
  () =>
    !!doc.value &&
    (JSON.stringify(doc.value) !== original.value ||
      invalidFields.value.size > 0),
);
defineExpose({ dirty });
const kind = props.kind as RoleResourceKind;
const importAction = computed(() => roleResourceImportAction(kind));
const rows = ref<RoleResourceRow[]>([]),
  doc = ref<RoleResourceDocument>(),
  busy = ref(false),
  failure = ref(""),
  notice = ref("");
watch(doc, (value) => emit("editing", !!value));
const search = ref(""),
  sort = ref("updated"),
  entryIndex = ref(0),
  invalidFields = ref(new Set<string>());
const fields = computed(() =>
  ((config.fields as Record<string, string[][]>)[kind] ?? []).filter(
    (field) => doc.value?.id || field[0] !== "status",
  ),
);
const title = computed(() =>
  kind === "persona" ? labels.personaResource : labels[kind],
);
const filtered = computed(() =>
  rows.value
    .filter(
      (item) =>
        item.name
          .toLocaleLowerCase()
          .includes(search.value.toLocaleLowerCase()) &&
        (!favoritesOnly.value || favorites.value.includes(item.id)) &&
        (status.value === "all" || (item.status ?? "active") === status.value),
    )
    .sort((a, b) =>
      sort.value === "name"
        ? a.name.localeCompare(b.name)
        : b.updatedAt - a.updatedAt,
    ),
);
const target = computed(() =>
  doc.value?.entries ? doc.value.entries[entryIndex.value] : doc.value?.value,
);
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
function reportTest(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "invalidVariables" ||
    message === "invalidDepth" ||
    message === "invalidRules"
  )
    testFailure.value = testLabels.regex[message];
  else if (message === "keyRequired" || message === "modelRequired")
    testFailure.value = testLabels.model[message];
  else {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    testFailure.value = String(
      apiErrorMessages[code as keyof typeof apiErrorMessages] ??
        apiErrorMessages.ROLE_USER_REQUEST_FAILED,
    );
  }
}
function resetTests() {
  testTracker.invalidate();
  testBusy.value = false;
  notice.value = "";
  testFailure.value = "";
  regexResult.value = undefined;
  discoveredModels.value = undefined;
  modelTestResult.value = undefined;
}
async function runRegexTest() {
  if (!doc.value || testBusy.value || invalidFields.value.size) return;
  const token = testTracker.begin();
  testBusy.value = true;
  testFailure.value = "";
  regexResult.value = undefined;
  try {
    const result = await previewRoleRegex(apiClient, doc.value, {
      text: regexInput.value,
      placement: regexPlacement.value,
      channel: regexChannel.value,
      depth: regexDepth.value,
      variables: regexVariables.value,
    });
    if (testTracker.isCurrent(token)) {
      regexResult.value = result;
      notice.value = testLabels.regex.done;
    }
  } catch (error) {
    if (testTracker.isCurrent(token)) reportTest(error);
  } finally {
    if (testTracker.isCurrent(token)) testBusy.value = false;
  }
}
async function discoverModels() {
  if (!doc.value || testBusy.value) return;
  const token = testTracker.begin();
  testBusy.value = true;
  testFailure.value = "";
  discoveredModels.value = undefined;
  try {
    const options = modelProbeOptions(doc.value, savedModel.value, "discover");
    const result = await apiClient.llmProfiles.discoverModels(options);
    if (testTracker.isCurrent(token)) {
      discoveredModels.value = result;
      notice.value = testLabels.model.discovered;
    }
  } catch (error) {
    if (testTracker.isCurrent(token)) reportTest(error);
  } finally {
    if (testTracker.isCurrent(token)) testBusy.value = false;
  }
}
async function testModel() {
  if (!doc.value || testBusy.value) return;
  const token = testTracker.begin();
  testBusy.value = true;
  testFailure.value = "";
  modelTestResult.value = undefined;
  try {
    const options = modelProbeOptions(doc.value, savedModel.value, "test");
    const result = await apiClient.llmProfiles.testModel(options);
    if (testTracker.isCurrent(token)) {
      modelTestResult.value = result;
      notice.value = testLabels.model.tested;
    }
  } catch (error) {
    if (testTracker.isCurrent(token)) reportTest(error);
  } finally {
    if (testTracker.isCurrent(token)) testBusy.value = false;
  }
}
async function load() {
  busy.value = true;
  try {
    rows.value = await listRoleResources(apiClient, kind);
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function edit(id: string) {
  busy.value = true;
  failure.value = "";
  try {
    const loaded = await readRoleResource(apiClient, kind, id);
    savedModel.value =
      kind === "model" ? snapshotRoleResource(loaded) : undefined;
    doc.value = loaded;
    resetTests();
    entryIndex.value = 0;
    invalidFields.value.clear();
    original.value = JSON.stringify(doc.value);
    libraryDialog.value?.close();
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function save() {
  if (!doc.value || busy.value || invalidFields.value.size) return;
  busy.value = true;
  failure.value = "";
  try {
    if (kind === "preset") updatePresetOrder(doc.value);
    if (doc.value.id) await saveRoleResource(apiClient, kind, doc.value);
    else doc.value.id = await createRoleResource(apiClient, kind, doc.value);
    const loaded = await readRoleResource(apiClient, kind, doc.value.id);
    savedModel.value =
      kind === "model" ? snapshotRoleResource(loaded) : undefined;
    doc.value = loaded;
    resetTests();
    original.value = JSON.stringify(doc.value);
    notice.value = labels.resourceSaved;
    await load();
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
function move(delta: number) {
  const entries = doc.value?.entries,
    index = entryIndex.value;
  if (!entries || !entries[index] || !entries[index + delta]) return;
  [entries[index], entries[index + delta]] = [
    entries[index + delta]!,
    entries[index]!,
  ];
  if (doc.value?.entryKeys) {
    const keys = doc.value.entryKeys;
    [keys[index], keys[index + delta]] = [keys[index + delta]!, keys[index]!];
  }
  entryIndex.value += delta;
}
function create() {
  doc.value = newRoleDocument(kind);
  savedModel.value = undefined;
  resetTests();
  entryIndex.value = 0;
  invalidFields.value.clear();
  original.value = JSON.stringify(doc.value);
  libraryDialog.value?.close();
}
function addEntry() {
  if (!doc.value?.entries) return;
  doc.value.entries.push(newRoleEntry(kind));
  doc.value.entryKeys?.push(createBrowserUuid());
  entryIndex.value = doc.value.entries.length - 1;
}
function deleteEntry() {
  doc.value?.entries?.splice(entryIndex.value, 1);
  doc.value?.entryKeys?.splice(entryIndex.value, 1);
  entryIndex.value = Math.max(0, entryIndex.value - 1);
}
function validity(key: string, valid: boolean) {
  if (valid) invalidFields.value.delete(key);
  else invalidFields.value.add(key);
}
async function closeEditor() {
  if (dirty.value) {
    discardOpen.value = true;
    return;
  }
  await discard();
}
async function discard() {
  discardOpen.value = false;
  resetTests();
  doc.value = undefined;
  emit("close");
}
async function confirmRemove() {
  if (!removeTarget.value || busy.value) return;
  busy.value = true;
  try {
    await removeRoleResource(apiClient, kind, removeTarget.value);
    removeTarget.value = undefined;
    notice.value = labels.resourceDeleted;
    await load();
    emit("changed");
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function download(row: RoleResourceRow) {
  try {
    const response = await exportRoleResource(apiClient, kind, row.id);
    if (!response.ok) throw await createResponseError(response);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = row.name + ".json";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    report(error);
  }
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object")
      throw Object.assign(new Error(), {
        code: "ROLE_RESOURCE_IMPORT_INVALID",
      });
    doc.value = previewRoleResourceImport(
      kind,
      file.name.replace(/\.json$/i, ""),
      payload,
    );
    resetTests();
    original.value = "";
    entryIndex.value = 0;
    invalidFields.value.clear();
    failure.value = "";
    libraryDialog.value?.close();
  } catch (error) {
    if (error instanceof SyntaxError) failure.value = labels.invalidJson;
    else report(error);
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = "";
  }
}
async function copy(row: RoleResourceRow) {
  busy.value = true;
  try {
    const source = await readRoleResource(apiClient, kind, row.id);
    doc.value = {
      ...source,
      id: "",
      name: source.name + " " + labels.copySuffix,
      revision: undefined,
      version: undefined,
    };
    if (kind === "model") doc.value.value.api_key = "";
    savedModel.value = undefined;
    resetTests();
    original.value = JSON.stringify(doc.value);
    entryIndex.value = 0;
    invalidFields.value.clear();
    libraryDialog.value?.close();
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
function toggleFavorite(id: string) {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter((item) => item !== id)
    : [...favorites.value, id];
  try {
    localStorage.setItem(
      labels.favoriteStorageKey,
      JSON.stringify(favorites.value),
    );
  } catch (error) {
    report(error);
  }
}
onMounted(async () => {
  await load();
  const stored = localStorage.getItem(labels.favoriteStorageKey);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      )
        favorites.value = parsed;
    } catch (error) {
      report(error);
    }
  }
  if (props.resourceId) await edit(props.resourceId);
  else libraryDialog.value?.showModal();
});
</script>
<template>
  <section class="editor-shell" :class="{ 'library-only': !doc }">
    <template v-if="doc">
      <div class="toolbar">
        <div>
          <span class="small">{{ labels.library }} / {{ title }}</span>
          <h1>{{ doc.id ? labels.edit : labels.newResource }}{{ title }}</h1>
        </div>
        <button :disabled="busy" @click="closeEditor">
          {{ labels.cancelEdit }}</button
        ><button
          class="primary"
          :disabled="
            busy ||
            !!invalidFields.size ||
            !doc.name.trim() ||
            (kind === 'model' && !doc.id && !doc.value.api_key)
          "
          @click="save"
        >
          {{ labels.saveResource }}
        </button>
      </div>
      <p class="small">{{ labels.resourceVersionHint }}</p>
      <label class="field"
        >{{ labels.resourceTitle }}<input v-model="doc.name" maxlength="200"
      /></label>
      <section v-if="kind === 'worldbook'" class="box">
        <RoleResourceField
          v-for="field in config.worldbookSettings"
          :key="field[0]"
          :field="field"
          :model-value="doc.value[field[0]!]"
          @update:model-value="doc.value[field[0]!] = $event"
        />
      </section>
      <div :class="{ 'editor-grid': doc.entries }">
        <div v-if="doc.entries">
          <h2>{{ labels.entries }} · {{ doc.entries.length }}</h2>
          <div v-for="(entry, index) in doc.entries" :key="index" class="entry">
            <button
              :class="{ active: entryIndex === index }"
              :disabled="!!invalidFields.size && entryIndex !== index"
              @click="entryIndex = index"
            >
              {{
                entry.name ||
                entry.comment ||
                entry.scriptName ||
                `${labels.entries} ${index + 1}`
              }}
            </button>
          </div>
          <button :disabled="!!invalidFields.size" @click="addEntry">
            {{ labels.addEntry }}
          </button>
        </div>
        <div class="editor-fields">
          <template v-if="target"
            ><div v-if="doc.entries" class="actions">
              <button
                :disabled="!entryIndex || !!invalidFields.size"
                @click="move(-1)"
              >
                {{ labels.moveUp }}</button
              ><button
                :disabled="
                  entryIndex >= doc.entries.length - 1 || !!invalidFields.size
                "
                @click="move(1)"
              >
                {{ labels.moveDown }}</button
              ><button
                class="danger"
                :disabled="!!invalidFields.size"
                @click="deleteEntry"
              >
                {{ labels.deleteEntry }}
              </button>
            </div>
            <RoleResourceField
              v-for="field in fields"
              :key="entryIndex + ':' + field[0]"
              :field="field"
              :model-value="target[field[0]!]"
              @update:model-value="target && (target[field[0]!] = $event)"
              @validity="validity(entryIndex + ':' + field[0], $event)"
          /></template>
          <p v-else>{{ labels.noEntries }}</p>
        </div>
      </div>
      <section v-if="kind === 'regex'" class="box">
        <h2>{{ testLabels.regex.title }}</h2>
        <label class="field"
          >{{ testLabels.regex.input }}
          <textarea v-model="regexInput" rows="5" />
        </label>
        <label class="field"
          >{{ testLabels.regex.placement }}
          <select v-model.number="regexPlacement">
            <option
              v-for="option in config.placements.filter(
                (item) => item[0] === 1 || item[0] === 2,
              )"
              :key="option[0]"
              :value="option[0]"
            >
              {{ option[1] }}
            </option>
          </select>
        </label>
        <label class="field"
          >{{ testLabels.regex.channel }}
          <select v-model="regexChannel">
            <option
              v-for="option in testLabels.regex.channels"
              :key="option[0]"
              :value="option[0]"
            >
              {{ option[1] }}
            </option>
          </select>
        </label>
        <label class="field"
          >{{ testLabels.regex.depth }}
          <input v-model.number="regexDepth" type="number" min="0" step="1" />
        </label>
        <label class="field"
          >{{ testLabels.regex.variables }}
          <textarea v-model="regexVariables" rows="4" />
        </label>
        <button
          :disabled="testBusy || !!invalidFields.size"
          @click="runRegexTest"
        >
          {{ testLabels.regex.run }}
        </button>
        <div v-if="regexResult" class="readonly" role="status">
          <h3>{{ testLabels.regex.output }}</h3>
          <p style="white-space: pre-wrap">{{ regexResult.text }}</p>
          <p>
            {{ testLabels.regex.candidates }}：{{
              regexResult.candidate_rule_names.join("、") ||
              testLabels.regex.none
            }}
          </p>
          <p>
            {{ testLabels.regex.matched }}：{{
              regexResult.matched_rule_names.join("、") || testLabels.regex.none
            }}
          </p>
          <details v-if="regexResult.skipped_rules.length">
            <summary>{{ testLabels.regex.skipped }}</summary>
            <p v-for="(item, index) in regexResult.skipped_rules" :key="index">
              {{ item.rule_name }}：{{ item.reason }}
            </p>
          </details>
        </div>
      </section>
      <section v-if="kind === 'model'" class="box">
        <div class="actions">
          <button :disabled="testBusy" @click="discoverModels">
            {{ testLabels.model.discover }}
          </button>
          <button :disabled="testBusy" @click="testModel">
            {{ testLabels.model.test }}
          </button>
        </div>
        <div v-if="discoveredModels" class="readonly" role="status">
          <h3>{{ testLabels.model.models }}</h3>
          <p v-if="!discoveredModels.length">{{ testLabels.model.none }}</p>
          <ul v-else>
            <li v-for="model in discoveredModels" :key="model.id">
              {{ model.label }} ({{ model.id }})
            </li>
          </ul>
        </div>
        <div v-if="modelTestResult" class="readonly" role="status">
          <p>
            {{ testLabels.model.request }}：{{ modelTestResult.requestText }}
          </p>
          <p>
            {{ testLabels.model.response }}：{{ modelTestResult.responseText }}
          </p>
        </div>
      </section>
      <p v-if="testFailure" role="alert" class="danger">{{ testFailure }}</p>
    </template>
    <dialog
      v-else
      id="library"
      ref="libraryDialog"
      v-modal-focus="() => emit('close')"
      @cancel.prevent="emit('close')"
    >
      <div class="toolbar">
        <h2>{{ labels.manage }}{{ title }}</h2>
        <button @click="emit('close')">{{ labels.close }}</button>
      </div>
      <div class="actions">
        <button class="primary" :disabled="busy" @click="create">
          {{ labels.newResource }}{{ title }}</button
        ><button v-if="importAction.type === 'json-file'" @click="fileInput?.click()">
          {{ labels.importResource }}</button
        ><input
          v-if="importAction.type === 'json-file'"
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="importFile"
        />
      </div>
      <div class="toolbar library-filters">
        <label>{{ labels.resourceSearch }}<input v-model="search" /></label
        ><label
          >{{ labels.resourceSort
          }}<select v-model="sort">
            <option value="updated">{{ labels.recent }}</option>
            <option value="name">{{ labels.resourceTitle }}</option>
          </select></label
        ><label
          >{{ labels.resourceStatus
          }}<select v-model="status">
            <option value="active">{{ labels.available }}</option>
            <option value="disabled">{{ labels.disabled }}</option>
            <option value="deleted">{{ labels.resourceDeletedStatus }}</option>
            <option value="all">{{ labels.all }}</option>
          </select></label
        ><label
          ><input v-model="favoritesOnly" type="checkbox" />{{
            labels.favoritesOnly
          }}</label
        >
      </div>
      <div v-for="item in filtered" :key="item.id" class="resource-card">
        <div class="row">
          <strong>{{ item.name }}</strong
          ><span>{{
            item.status === "deleted"
              ? labels.resourceDeletedStatus
              : item.version !== undefined
                ? `v${item.version}`
                : item.revision !== undefined
                  ? `${labels.configurationRevision} ${item.revision}`
                  : ""
          }}</span>
        </div>
        <div class="actions">
          <button @click="toggleFavorite(item.id)">
            {{
              favorites.includes(item.id) ? labels.unfavorite : labels.favorite
            }}</button
          ><template v-if="item.status !== 'deleted'"
            ><button :disabled="busy" @click="edit(item.id)">
              {{ labels.edit }}</button
            ><button :disabled="busy" @click="copy(item)">
              {{ labels.copyResource }}</button
            ><button
              v-if="!['model', 'persona'].includes(kind)"
              :disabled="busy"
              @click="download(item)"
            >
              {{ labels.exportResource }}</button
            ><button
              class="danger"
              :disabled="busy"
              @click="removeTarget = item"
            >
              {{ labels.deleteShort }}
            </button></template
          >
        </div>
      </div>
      <p v-if="!filtered.length && !busy">{{ labels.noResources }}</p>
      <p v-if="failure" role="alert" class="danger">{{ failure }}</p>
      <div v-if="removeTarget" v-modal-focus="() => { if (!busy) removeTarget = undefined; }" class="box" role="alertdialog" aria-modal="true" :aria-label="labels.deleteResource">
        <h2>{{ labels.deleteResource }} · {{ removeTarget.name }}</h2>
        <p>{{ labels.deleteResourceConfirm }}</p>
        <div class="actions">
          <button :disabled="busy" @click="removeTarget = undefined">{{ labels.cancel }}</button
          ><button class="danger" :disabled="busy" @click="confirmRemove">
            {{ labels.confirm }}
          </button>
        </div>
      </div>
    </dialog>
    <p v-if="busy" role="status">{{ labels.loading }}</p>
    <p v-if="failure" role="alert" class="danger">
      {{ failure }}<button @click="load">{{ labels.retry }}</button>
    </p>
    <p v-if="invalidFields.size" role="alert" class="danger">
      {{ labels.invalidJson }}
    </p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="discardOpen" class="modal-backdrop">
      <div v-modal-focus="() => { discardOpen = false; }" class="modal-card" role="dialog" aria-modal="true">
        <p>{{ labels.resourceChanges }}</p>
        <button @click="discardOpen = false">{{ labels.keepEditing }}</button
        ><button @click="discard">{{ labels.discard }}</button>
      </div>
    </div>
  </section>
</template>
