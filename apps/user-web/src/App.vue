<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import {
  roleFormalSessionMetadataSchema,
  modelCallUi,
  type RoleReleasePublic,
  type RoleSnapshotPointer,
  type RoleRuntimeSession,
} from "@tavern/shared";
import type { SessionRecord } from "@tavern/sdk";
import type { RoleApplicationContext } from "./lib/bootstrap.js";
import { roleSessionUrl } from "./lib/session-navigation.js";
import { openingSessionInput } from "./lib/opening-session.js";
import { userError } from "./lib/errors.js";
import labels from "./config/ui.json";
import ChatSession from "./features/chat/ChatSession.vue";
const props = defineProps<{ context: RoleApplicationContext }>();
const targetSnapshotId = ref(props.context.snapshotId);
const sessionId = ref(props.context.sessionId),
  name = ref(""),
  failure = ref(""),
  busy = ref(false),
  creatingSession = ref(false),
  renamingSessionId = ref<string | null>(null),
  renameTitle = ref(""),
  tab = ref<"catalog" | "history">("catalog");
const roles = ref<RoleReleasePublic[]>([]),
  history = ref<SessionRecord[]>([]),
  selected = ref<RoleReleasePublic>(),
  opening = ref("");
const current = ref<RoleRuntimeSession["current"]>(),
  currentCharacterName = ref(props.context.characterName);
const currentSessionReleaseId = ref(props.context.roleReleaseId),
  historySnapshots = ref<RoleSnapshotPointer[]>([]),
  snapshotHistoryHasMore = ref(false),
  historySelection = ref("latest"),
  historyRefreshVersion = ref(0),
  historyMoreVersion = ref(0),
  historyRetryCursor = ref<string | null>(null),
  historySelectionRetryVersion = ref(0),
  historyRetrySnapshotId = ref(""),
  historyLoading = ref(false),
  historyFailure = ref(""),
  historyFailureAction = ref<HistoryFailureAction | null>(null),
  runtimeBusy = ref(false),
  roleOptionsLoading = ref(false),
  roleOptionsFailure = ref("");
const openingDialog = shallowRef<HTMLElement | null>(null);
const openingTrigger = shallowRef<HTMLElement | null>(null);
const chatRegion = shallowRef<HTMLElement | null>(null);
const libraryRegion = shallowRef<HTMLElement | null>(null);
const historyOffset = ref(0),
  historyHasMore = ref(false);
const currentRoleOptionValue = "__current_session_role__";
const availableRoleChoices = computed(() =>
  roles.value.filter((role) => role.id !== currentSessionReleaseId.value),
);
const roleSelectorValue = computed(
  () => selected.value?.id ?? (sessionId.value ? currentRoleOptionValue : ""),
);
const currentRoleOptionLabel = computed(() =>
  props.context.preview
    ? currentCharacterName.value
      ? `${currentCharacterName.value} · ${labels.fixedPreviewRole.replace(
          "{revision}",
          String(props.context.preview.draft_revision),
        )}`
      : labels.fixedPreviewRole.replace(
          "{revision}",
          String(props.context.preview.draft_revision),
        )
    : currentCharacterName.value
      ? `${currentCharacterName.value} · ${labels.fixedSessionRole}`
      : labels.fixedSessionRole,
);

type HistoryFailureAction =
  | { kind: "list"; cursor: string | null }
  | { kind: "snapshot"; snapshotId: string }
  | { kind: "latest" };

function createdCharacterName(session: unknown): string | null {
  if (!session || typeof session !== "object" || Array.isArray(session))
    return null;
  const binding = (session as Record<string, unknown>).character_binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding))
    return null;
  const summary = (binding as Record<string, unknown>).snapshot_summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return null;
  const name = (summary as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

let roleChoicesGeneration = 0;

function isOpeningElementDisabled(element: HTMLElement) {
  return (
    ("disabled" in element &&
      Boolean((element as HTMLButtonElement).disabled)) ||
    element.getAttribute("disabled") !== null
  );
}

function getOpeningFocusableElements(dialog: HTMLElement): HTMLElement[] {
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "a[href], area[href], button, input, select, textarea, iframe, object, embed, [tabindex]",
    ),
  ).filter((element) => {
    const tagName = element.tagName;
    const tabIndex = element.getAttribute("tabindex");
    const hasTabIndex = tabIndex !== null;
    const isNativeFocusable =
      ((tagName === "A" || tagName === "AREA") &&
        element.getAttribute("href") !== null) ||
      [
        "BUTTON",
        "INPUT",
        "SELECT",
        "TEXTAREA",
        "IFRAME",
        "OBJECT",
        "EMBED",
      ].includes(tagName);
    if (!isNativeFocusable && !hasTabIndex) return false;
    if (hasTabIndex && element.tabIndex < 0) return false;
    if (isOpeningElementDisabled(element)) return false;
    if (
      tagName === "INPUT" &&
      element.getAttribute("type")?.toLowerCase() === "hidden"
    )
      return false;
    if (element.hidden || element.getAttribute("hidden") !== null) return false;
    return element.getAttribute("aria-hidden") !== "true";
  });
  const radioGroups = new Map<string, HTMLElement[]>();
  for (const element of focusable) {
    if (element.tagName !== "INPUT") continue;
    const name = element.getAttribute("name");
    if (element.getAttribute("type") !== "radio" || !name) continue;
    const group = radioGroups.get(name) ?? [];
    group.push(element);
    radioGroups.set(name, group);
  }

  const radioTabStops = new Set<HTMLElement>();
  for (const group of radioGroups.values()) {
    radioTabStops.add(
      group.find((radio) => (radio as HTMLInputElement).checked) ?? group[0]!,
    );
  }
  return focusable.filter((element) => {
    if (element.tagName !== "INPUT") return true;
    return (
      element.getAttribute("type") !== "radio" ||
      !element.getAttribute("name") ||
      radioTabStops.has(element)
    );
  });
}

function focusOpeningDialog() {
  const dialog = openingDialog.value;
  if (!dialog) return;
  const focusable = getOpeningFocusableElements(dialog);
  const selectedOpening = focusable.find(
    (input) =>
      input.tagName === "INPUT" &&
      input.getAttribute("type") === "radio" &&
      (input as HTMLInputElement).checked,
  );
  const firstFocusable = focusable[0];
  (selectedOpening ?? firstFocusable ?? dialog).focus();
}

function handleOpeningKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelOpening();
    return;
  }
  if (event.key !== "Tab") return;

  const dialog = openingDialog.value;
  if (!dialog) return;
  const focusable = getOpeningFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const index = focusable.indexOf(event.target as HTMLElement);
  if (index < 0) {
    event.preventDefault();
    focusable[event.shiftKey ? focusable.length - 1 : 0]!.focus();
  } else if (event.shiftKey && index === 0) {
    event.preventDefault();
    focusable[focusable.length - 1]!.focus();
  } else if (!event.shiftKey && index === focusable.length - 1) {
    event.preventDefault();
    focusable[0]!.focus();
  }
}

watch(
  selected,
  (role, previousRole) => {
    if (role) {
      focusOpeningDialog();
      return;
    }
    if (previousRole) {
      const trigger = openingTrigger.value;
      openingTrigger.value = null;
      trigger?.focus();
    }
  },
  { flush: "post" },
);
const detailUrl = computed(() => {
  if (!props.context.preview || !sessionId.value || !current.value?.floorId)
    return null;
  const url = new URL(
    modelCallUi.detailPath,
    props.context.config.adminBaseUrl,
  );
  if (current.value.source.runId)
    url.searchParams.set("runId", current.value.source.runId);
  url.searchParams.set("sessionId", sessionId.value);
  url.searchParams.set("branchId", current.value.branchId);
  url.searchParams.set("floorId", current.value.floorId);
  return url.href;
});
async function load() {
  if (props.context.preview) return;
  const roleGeneration = ++roleChoicesGeneration;
  roleOptionsLoading.value = false;
  roleOptionsFailure.value = "";
  busy.value = true;
  failure.value = "";
  try {
    const available = await props.context.client.roleReleases.list({
      activeOnly: true,
    });
    if (roleGeneration === roleChoicesGeneration) roles.value = available;
    historyOffset.value = 0;
    history.value = [];
    await moreHistory();
  } catch (error) {
    failure.value = userError(error);
  } finally {
    busy.value = false;
  }
}
async function loadRoleChoices() {
  const generation = ++roleChoicesGeneration;
  roleOptionsLoading.value = true;
  roleOptionsFailure.value = "";
  try {
    const available = await props.context.client.roleReleases.list({
      activeOnly: true,
    });
    if (generation === roleChoicesGeneration) roles.value = available;
  } catch (error) {
    if (generation === roleChoicesGeneration)
      roleOptionsFailure.value = userError(error);
  } finally {
    if (generation === roleChoicesGeneration) roleOptionsLoading.value = false;
  }
}
async function moreHistory() {
  const page = await props.context.client.sessions.list({
    limit: 100,
    offset: historyOffset.value,
    sortBy: "updated_at",
    sortOrder: "desc",
  });
  history.value.push(
    ...page.filter(
      (item) =>
        roleFormalSessionMetadataSchema.safeParse(item.metadata).success,
    ),
  );
  historyOffset.value += page.length;
  historyHasMore.value = page.length === 100;
}
async function more() {
  if (busy.value) return;
  busy.value = true;
  try {
    await moreHistory();
  } catch (error) {
    failure.value = userError(error);
  } finally {
    busy.value = false;
  }
}
function open(
  id: string,
  releaseId: string | null = null,
  characterName: string | null = null,
) {
  roleChoicesGeneration += 1;
  roleOptionsLoading.value = false;
  roleOptionsFailure.value = "";
  sessionId.value = id;
  currentSessionReleaseId.value = releaseId;
  currentCharacterName.value = characterName;
  targetSnapshotId.value = null;
  historySnapshots.value = [];
  snapshotHistoryHasMore.value = false;
  historySelection.value = "latest";
  historyFailure.value = "";
  historyFailureAction.value = null;
  historyRetryCursor.value = null;
  historyLoading.value = false;
  runtimeBusy.value = false;
  name.value = "";
  current.value = undefined;
  failure.value = "";
  const url = roleSessionUrl(new URL(window.location.href), id);
  window.history.replaceState(null, "", url);
}
function continueHistorySession(item: SessionRecord) {
  const metadata = roleFormalSessionMetadataSchema.safeParse(item.metadata);
  open(
    item.id,
    metadata.success ? metadata.data.role_release_id : null,
    item.characterBinding?.snapshotSummary?.name.trim() || null,
  );
}
function choose(role: RoleReleasePublic, event?: MouseEvent) {
  openingTrigger.value = (event?.currentTarget as HTMLElement | null) ?? null;
  selected.value = role;
  opening.value = role.openings.find((item) => item.default)?.id ?? "";
}
function chooseRoleFromSelector(event: Event) {
  const releaseId = (event.target as HTMLSelectElement).value;
  const role = roles.value.find((item) => item.id === releaseId);
  if (!role) return;
  choose(role, event as MouseEvent);
}
function selectHistoryFromSelector(event: Event) {
  if (runtimeBusy.value) return;
  historyFailure.value = "";
  historyFailureAction.value = null;
  historyRetryCursor.value = null;
  historySelection.value = (event.target as HTMLSelectElement).value;
}
function onHistoryPage(page: {
  items: RoleSnapshotPointer[];
  append: boolean;
  hasMore: boolean;
}) {
  historySnapshots.value = page.append
    ? [...historySnapshots.value, ...page.items]
    : page.items;
  snapshotHistoryHasMore.value = page.hasMore;
  historyFailure.value = "";
  historyFailureAction.value = null;
  historyRetryCursor.value = null;
}
function historySnapshotLabel(item: RoleSnapshotPointer, index: number) {
  if (item.floorId === null && item.attemptId === null)
    return labels.historyInitialState;
  return labels.historySnapshotOption.replace("{number}", String(index + 1));
}
function loadMoreRoleHistory() {
  if (runtimeBusy.value || historyLoading.value) return;
  historyMoreVersion.value += 1;
}
function onHistoryState(state: {
  busy: boolean;
  following: boolean;
  view: RoleRuntimeSession["current"];
}) {
  const startedSending = state.busy && !runtimeBusy.value;
  runtimeBusy.value = state.busy;
  historySelection.value = state.following ? "latest" : state.view.snapshotId;
  if (startedSending && historyFailureAction.value?.kind === "snapshot") {
    historyFailure.value = "";
    historyFailureAction.value = null;
  }
}
function onHistoryFailure(failure: {
  error: unknown;
  action: HistoryFailureAction;
}) {
  historyFailure.value = userError(failure.error);
  historyFailureAction.value = failure.action;
}
function retryHistory() {
  if (runtimeBusy.value) return;
  const action = historyFailureAction.value;
  historyFailure.value = "";
  historyFailureAction.value = null;
  historyRetryCursor.value = action?.kind === "list" ? action.cursor : null;
  if (action?.kind === "snapshot") {
    historyRetrySnapshotId.value = action.snapshotId;
    historySelectionRetryVersion.value += 1;
  } else if (action?.kind === "latest") {
    historySelection.value = "latest";
  } else {
    historyRefreshVersion.value += 1;
  }
}
function cancelOpening() {
  if (!creatingSession.value) selected.value = undefined;
}
async function reloadOpeningCatalog() {
  selected.value = undefined;
  openingTrigger.value = null;
  failure.value = "";
  const reloading = sessionId.value ? loadRoleChoices() : load();
  await nextTick();
  (sessionId.value ? chatRegion.value : libraryRegion.value)?.focus();
  await reloading;
}
async function start() {
  if (busy.value || !selected.value) return;
  creatingSession.value = true;
  busy.value = true;
  failure.value = "";
  try {
    await nextTick();
    focusOpeningDialog();
    const result = await props.context.client.roleReleases.createSession({
      releaseId: selected.value.id,
      input: openingSessionInput(
        selected.value.openings.find((item) => item.id === opening.value),
      ),
    });
    if (typeof result.session.id !== "string") throw new Error();
    const createdReleaseId = selected.value.id;
    if (props.context.preview) {
      const url = roleSessionUrl(
        new URL(window.location.href),
        result.session.id,
      );
      window.location.assign(url.href);
      return;
    }
    open(
      result.session.id,
      createdReleaseId,
      createdCharacterName(result.session),
    );
    openingTrigger.value = null;
    selected.value = undefined;
    await nextTick();
    chatRegion.value?.focus();
  } catch (error) {
    failure.value = userError(error);
  } finally {
    creatingSession.value = false;
    busy.value = false;
    if (selected.value) {
      await nextTick();
      if (selected.value) focusOpeningDialog();
    }
  }
}
async function remove(id: string) {
  if (busy.value || !window.confirm(labels.deleteConfirm)) return;
  busy.value = true;
  failure.value = "";
  try {
    await props.context.client.sessions.remove({ sessionId: id });
    history.value = history.value.filter((item) => item.id !== id);
  } catch (error) {
    failure.value = userError(error);
  } finally {
    busy.value = false;
  }
}
function beginRename(item: SessionRecord) {
  renamingSessionId.value = item.id;
  renameTitle.value = item.title ?? "";
}
function cancelRename() {
  renamingSessionId.value = null;
  renameTitle.value = "";
}
function updateRenameTitle(event: Event) {
  renameTitle.value = (event.target as HTMLInputElement).value;
}
async function saveRename(id: string) {
  const title = renameTitle.value.trim();
  if (busy.value || renamingSessionId.value !== id || !title) return;
  busy.value = true;
  failure.value = "";
  try {
    const updated = await props.context.client.sessions.update({
      sessionId: id,
      title,
    });
    history.value = history.value.map((item) =>
      item.id === id ? updated : item,
    );
    cancelRename();
  } catch (error) {
    failure.value = userError(error);
  } finally {
    busy.value = false;
  }
}
async function back() {
  roleChoicesGeneration += 1;
  roleOptionsLoading.value = false;
  roleOptionsFailure.value = "";
  tab.value = "catalog";
  sessionId.value = null;
  currentSessionReleaseId.value = null;
  historySnapshots.value = [];
  snapshotHistoryHasMore.value = false;
  historySelection.value = "latest";
  historyFailure.value = "";
  historyFailureAction.value = null;
  historyRetryCursor.value = null;
  runtimeBusy.value = false;
  currentCharacterName.value = null;
  targetSnapshotId.value = null;
  name.value = "";
  current.value = undefined;
  const url = roleSessionUrl(new URL(window.location.href), null);
  window.history.replaceState(null, "", url);
  await load();
}
onMounted(() => {
  if (!sessionId.value) void load();
  else void loadRoleChoices();
});
</script>
<template>
  <div class="application" :class="{ chatting: sessionId }">
    <header class="topbar" :inert="Boolean(selected)">
      <strong>{{ name || labels.title }}</strong>
      <nav>
        <label class="toolbar-control">
          <span>{{ labels.roleSelectorLabel }}</span>
          <select
            :aria-label="labels.roleSelectorAria"
            :value="roleSelectorValue"
            :disabled="roleOptionsLoading || !availableRoleChoices.length"
            @change="chooseRoleFromSelector"
          >
            <option v-if="sessionId" :value="currentRoleOptionValue" disabled>
              {{ currentRoleOptionLabel }}
            </option>
            <option v-else value="">
              {{ labels.roleSelectorPlaceholder }}
            </option>
            <option
              v-for="role in availableRoleChoices"
              :key="role.id"
              :value="role.id"
            >
              {{ role.name }}
            </option>
            <option
              v-if="sessionId && !availableRoleChoices.length"
              value=""
              disabled
            >
              {{ labels.noOtherPublishedRoles }}
            </option>
          </select>
        </label>
        <label v-if="sessionId" class="toolbar-control">
          <span>{{ labels.historySelectorLabel }}</span>
          <select
            :aria-label="labels.historySelectorAria"
            :value="historySelection"
            :disabled="runtimeBusy"
            @change="selectHistoryFromSelector"
          >
            <option value="latest">{{ labels.historyCurrentState }}</option>
            <option
              v-for="(item, index) in historySnapshots"
              :key="item.snapshotId"
              :value="item.snapshotId"
            >
              {{ historySnapshotLabel(item, index) }}
            </option>
          </select>
        </label>
        <button
          v-if="sessionId && snapshotHistoryHasMore"
          type="button"
          :disabled="runtimeBusy || historyLoading"
          @click="loadMoreRoleHistory"
        >
          {{ labels.historyMore }}
        </button>
        <span
          v-if="sessionId && historyLoading"
          role="status"
          class="toolbar-status"
        >
          {{ labels.historyLoading }}
        </span>
        <p
          v-if="sessionId && historyFailure"
          role="alert"
          class="toolbar-error"
        >
          {{ labels.historyLoadFailure }}: {{ historyFailure }}
          <button :disabled="runtimeBusy" @click="retryHistory">
            {{ labels.retry }}
          </button>
        </p>
        <p
          v-if="sessionId && roleOptionsFailure"
          role="alert"
          class="toolbar-error"
        >
          {{ labels.roleOptionsLoadFailure }}: {{ roleOptionsFailure }}
          <button @click="loadRoleChoices">{{ labels.retry }}</button>
        </p>
        <template v-if="context.preview"
          ><span class="preview"
            >{{ labels.preview }} · {{ labels.revision }}
            {{ context.preview.draft_revision }}</span
          ><a
            :href="context.config.adminBaseUrl"
            target="_blank"
            rel="noopener"
            >{{ labels.returnAdmin }}</a
          ><a
            v-if="detailUrl"
            :href="detailUrl"
            target="_blank"
            rel="noopener"
            >{{ labels.details }}</a
          ></template
        >
        <button v-else-if="sessionId" @click="back">{{ labels.back }}</button>
        <template v-else
          ><button :aria-pressed="tab === 'catalog'" @click="tab = 'catalog'">
            {{ labels.catalog }}</button
          ><button :aria-pressed="tab === 'history'" @click="tab = 'history'">
            {{ labels.history }}
          </button></template
        >
      </nav>
    </header>
    <div v-if="failure && !selected" class="error" role="alert">
      {{ failure
      }}<button v-if="!sessionId" @click="load">{{ labels.retry }}</button>
    </div>
    <main
      v-if="sessionId"
      ref="chatRegion"
      class="chat"
      tabindex="-1"
      :inert="Boolean(selected)"
    >
      <ChatSession
        :key="sessionId"
        :client="context.client"
        :session-id="sessionId"
        :snapshot-id="targetSnapshotId"
        :history-selection="historySelection"
        :history-refresh-version="historyRefreshVersion"
        :history-more-version="historyMoreVersion"
        :history-retry-cursor="historyRetryCursor"
        :history-selection-retry-version="historySelectionRetryVersion"
        :history-retry-snapshot-id="historyRetrySnapshotId"
        :policy="context.policy"
        :asset-base-url="context.config.apiBaseUrl"
        @ready="(value) => (name = value)"
        @failure="(error) => (failure = userError(error))"
        @current="(value) => (current = value)"
        @history="onHistoryPage"
        @history-state="onHistoryState"
        @history-loading="(value) => (historyLoading = value)"
        @history-failure="onHistoryFailure"
      />
    </main>
    <main
      v-else
      ref="libraryRegion"
      class="library"
      tabindex="-1"
      :inert="Boolean(selected)"
    >
      <p v-if="busy" role="status">{{ labels.loading }}</p>
      <template v-if="tab === 'catalog'"
        ><h1>{{ labels.catalog }}</h1>
        <p v-if="!busy && !roles.length">{{ labels.emptyCatalog }}</p>
        <div class="cards">
          <button
            v-for="role in roles"
            :key="role.id"
            class="role-card"
            @click="choose(role, $event)"
          >
            <h2>{{ role.name }}</h2>
            <p>{{ role.openings.find((item) => item.default)?.summary }}</p>
            <span>{{ labels.start }} →</span>
          </button>
        </div></template
      >
      <template v-else
        ><h1>{{ labels.history }}</h1>
        <p v-if="!busy && !history.length">{{ labels.emptyHistory }}</p>
        <article v-for="item in history" :key="item.id" class="history-row">
          <div>
            <template v-if="renamingSessionId === item.id">
              <input
                :value="renameTitle"
                :placeholder="labels.renameSessionPlaceholder"
                @input="updateRenameTitle"
              />
              <button
                :disabled="busy || !renameTitle.trim()"
                @click="saveRename(item.id)"
              >
                {{ labels.saveSessionName }}
              </button>
              <button :disabled="busy" @click="cancelRename">
                {{ labels.cancelSessionRename }}
              </button>
            </template>
            <h2 v-else>{{ item.title }}</h2>
            <time>{{ new Date(item.updatedAt).toLocaleString() }}</time>
          </div>
          <button
            v-if="renamingSessionId !== item.id"
            :disabled="busy"
            @click="beginRename(item)"
          >
            {{ labels.renameSession }}
          </button>
          <button
            v-if="renamingSessionId !== item.id"
            :disabled="busy"
            @click="continueHistorySession(item)"
          >
            {{ labels.continue }}</button
          ><button :disabled="busy" @click="remove(item.id)">
            {{ labels.delete }}
          </button>
        </article>
        <button v-if="historyHasMore" :disabled="busy" @click="more">
          {{ labels.more }}
        </button></template
      >
    </main>
    <div v-if="selected" class="modal-backdrop">
      <section
        ref="openingDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="opening-title"
        class="opening-dialog"
        tabindex="-1"
        @keydown="handleOpeningKeydown"
      >
        <h2 id="opening-title">{{ selected.name }} · {{ labels.opening }}</h2>
        <label
          v-for="item in selected.openings"
          :key="item.id"
          class="opening-option"
          ><input
            v-model="opening"
            type="radio"
            name="opening"
            :value="item.id"
          /><span
            ><strong>{{ item.title }}</strong>
            <p>{{ item.summary }}</p></span
          ></label
        >
        <div v-if="failure" class="error" role="alert">
          {{ failure
          }}<button :disabled="busy" @click="reloadOpeningCatalog">
            {{ labels.retry }}
          </button>
        </div>
        <footer>
          <button :disabled="creatingSession" @click="cancelOpening">
            {{ labels.cancel }}</button
          ><button class="primary" :disabled="busy || !opening" @click="start">
            {{ busy ? labels.creating : labels.start }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>
