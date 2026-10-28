<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { SessionRecord } from "@tavern/sdk";
import {
  apiCollectionPolicy,
  createBrowserUuid,
  userResourcePolicy,
} from "@tavern/shared";
import {
  accountDraftKey,
  errorMessage,
  errorStatus,
  portalKey,
} from "./context.js";
import PortalDialog from "../../components/PortalDialog.vue";
import SessionSettingsDialog from "../../components/SessionSettingsDialog.vue";
import text from "../../config/portal-ui.json";

type RunState =
  | "checking"
  | "available"
  | "busy"
  | "unknown"
  | "missing"
  | "forbidden";
type DeleteState =
  | "checking"
  | "ready"
  | "submitting"
  | "unknown"
  | "deleted"
  | "not_found"
  | "busy"
  | "forbidden"
  | "failed"
  | "exists";
type DeleteTarget = { item: SessionRecord; state: DeleteState };
type DeleteReceipt = {
  focusId?: string;
  id: string;
  started: boolean;
  targets: DeleteTarget[];
};
type Anchor = { id: string; offset: number; scroll: number };
type HistoryCache = {
  items: SessionRecord[];
  keyword: string;
  applied: string;
  total: number | null;
  selected: string[];
  managing: boolean;
  anchor: Anchor | null;
};

const portal = inject(portalKey)!;
const owner = portal.account.value!.id;
const cacheKey = accountDraftKey(owner, "history");
const receiptKey = accountDraftKey(owner, "history-delete");
const items = ref<SessionRecord[]>([]);
const keyword = ref("");
const applied = ref("");
const displayed = ref("");
const total = ref<number | null>(null);
const busy = ref(false);
const loaded = ref(false);
const failure = ref("");
const failedAppend = ref(false);
const selected = ref<string[]>([]);
const runs = ref<Record<string, RunState>>({});
const managing = ref(false);
const mobile = ref(window.matchMedia("(max-width: 760px)").matches);
const receipt = ref<DeleteReceipt | null>(null);
const showDelete = ref(false);
const saving = ref(false);
const verifying = ref(false);
const deleteFailure = ref("");
const menu = ref<SessionRecord | null>(null);
const renaming = ref<SessionRecord | null>(null);
const allCheckbox = ref<HTMLInputElement>();
const heading = ref<HTMLElement>();
const menuPanel = ref<HTMLElement>();
const pageSize = userResourcePolicy.historyPageSize;
let generation = 0;
let mounted = true;
let scrollFrame = 0;
let restoredAnchor: Anchor | null = null;

function runReason(state?: RunState) {
  return state === "busy"
    ? text.runningDelete
    : state === "checking"
      ? text.checkingRun
      : state === "missing"
        ? text.resourceMissingHelp
        : state === "forbidden"
          ? text.noPermission
          : text.viewFailed;
}
function title(item: SessionRecord) {
  return item.title || item.characterBinding?.snapshotSummary?.name || item.id;
}
function identity(item: SessionRecord) {
  return [
    item.characterBinding?.snapshotSummary?.name,
    item.userBinding?.snapshotSummary?.name,
  ]
    .filter(Boolean)
    .join(" · ");
}
function rowElement(id: string) {
  return document.getElementById("history-" + id);
}
function terminal(state: DeleteState) {
  return state === "deleted" || state === "not_found";
}
const hasMore = computed(
  () =>
    loaded.value &&
    (total.value === null
      ? items.value.length > 0 && items.value.length % pageSize === 0
      : items.value.length < total.value),
);
const pendingIds = computed(
  () =>
    new Set(
      receipt.value?.targets
        .filter(
          (target) =>
            target.state === "submitting" || target.state === "unknown",
        )
        .map((target) => target.item.id),
    ),
);
const eligible = computed(() =>
  items.value
    .filter(
      (item) =>
        runs.value[item.id] === "available" && !pendingIds.value.has(item.id),
    )
    .map((item) => item.id),
);
const selectedEligible = computed(() =>
  selected.value.filter((id) => eligible.value.includes(id)),
);
const allSelected = computed(
  () =>
    eligible.value.length > 0 &&
    eligible.value.every((id) => selected.value.includes(id)),
);
const mixedSelected = computed(
  () => selectedEligible.value.length > 0 && !allSelected.value,
);
const selectionVisible = computed(() => !mobile.value || managing.value);
const processed = computed(
  () =>
    receipt.value?.targets.filter((target) => terminal(target.state)).length ||
    0,
);
const unresolved = computed(
  () =>
    receipt.value?.targets.some((target) => target.state === "unknown") ||
    false,
);
const retryTargets = computed(
  () =>
    receipt.value?.targets.filter(
      (target) =>
        ["ready", "exists", "failed"].includes(target.state) &&
        runs.value[target.item.id] === "available",
    ) || [],
);

function readAnchor(): Anchor | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>(".history-row"),
  );
  const row =
    rows.find((element) => element.getBoundingClientRect().bottom > 72) ||
    rows.at(-1);
  return row
    ? {
        id: row.dataset.sessionId!,
        offset: row.getBoundingClientRect().top,
        scroll: window.scrollY,
      }
    : null;
}
function saveCache() {
  if (!mounted) return;
  const cache: HistoryCache = {
    items: items.value,
    keyword: keyword.value,
    applied: displayed.value,
    total: total.value,
    selected: selected.value,
    managing: managing.value,
    anchor: readAnchor() || restoredAnchor,
  };
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(cache));
  } catch {
    /* The current page remains usable when browser storage is unavailable. */
  }
}
function persistReceipt() {
  try {
    if (receipt.value?.started)
      sessionStorage.setItem(receiptKey, JSON.stringify(receipt.value));
    else sessionStorage.removeItem(receiptKey);
  } catch {
    /* The visible receipt still carries the current request result. */
  }
}
function restoreCache() {
  try {
    const cache = JSON.parse(
      sessionStorage.getItem(cacheKey) || "null",
    ) as HistoryCache | null;
    if (
      cache &&
      Array.isArray(cache.items) &&
      cache.items.every((item) => typeof item.id === "string") &&
      typeof cache.applied === "string"
    ) {
      items.value = cache.items;
      keyword.value = cache.keyword;
      applied.value = displayed.value = cache.applied;
      total.value = cache.total;
      selected.value = cache.selected || [];
      managing.value = cache.managing;
      restoredAnchor = cache.anchor;
      loaded.value = true;
    }
    const saved = JSON.parse(
      sessionStorage.getItem(receiptKey) || "null",
    ) as DeleteReceipt | null;
    if (
      saved?.started &&
      Array.isArray(saved.targets) &&
      saved.targets.every(
        (target) => target.item?.id && typeof target.state === "string",
      )
    ) {
      receipt.value = {
        ...saved,
        targets: saved.targets.map((target) => ({
          ...target,
          state: target.state === "submitting" ? "unknown" : target.state,
        })),
      };
      applyDeleted();
    }
  } catch {
    /* Invalid browser storage is ignored before reading the owned collection. */
  }
}
async function restorePosition(anchor: Anchor | null) {
  if (!anchor || !mounted) return;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const row = rowElement(anchor.id);
  if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.offset);
  else window.scrollTo(0, anchor.scroll);
}
function scrolled() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    saveCache();
  });
}
async function checkRuns(rows: SessionRecord[], ticket = generation) {
  await Promise.all(
    rows.map(async (item) => {
      runs.value[item.id] = "checking";
      let state: RunState = "unknown";
      try {
        state = (
          await portal.client.sessions.getActiveRun({ sessionId: item.id })
        ).activeRun?.busy
          ? "busy"
          : "available";
      } catch (error) {
        state =
          errorStatus(error) === 404
            ? "missing"
            : errorStatus(error) === 403
              ? "forbidden"
              : "unknown";
      }
      if (
        mounted &&
        ticket === generation &&
        items.value.some((row) => row.id === item.id)
      )
        runs.value[item.id] = state;
    }),
  );
  const invalid = selected.value.filter(
    (id) =>
      !items.value.some((item) => item.id === id) ||
      ["busy", "missing", "forbidden"].includes(runs.value[id] || ""),
  );
  selected.value = selected.value.filter((id) => !invalid.includes(id));
  if (invalid.length)
    portal.notice.value = text.selectionRemoved.replace(
      "{count}",
      String(invalid.length),
    );
  saveCache();
}
async function readRange(
  condition: string,
  limit: number,
  offset: number,
  ticket: number,
) {
  const collected: SessionRecord[] = [];
  let count: number | null = null;
  while (collected.length < limit && mounted && ticket === generation) {
    const take = Math.min(
      apiCollectionPolicy.listMaxItems,
      limit - collected.length,
    );
    const page = await portal.client.sessions.listPage({
      keyword: condition || undefined,
      limit: take,
      offset: offset + collected.length,
      sortBy: "updated_at",
      sortOrder: "desc",
    });
    collected.push(...page.items);
    count = page.total;
    if (
      page.items.length < take ||
      (count !== null && offset + collected.length >= count)
    )
      break;
  }
  return { items: collected, total: count };
}
async function load(append = false, retainPosition = true) {
  if (append && busy.value) return;
  const ticket = ++generation;
  const anchor = retainPosition ? restoredAnchor || readAnchor() : null;
  const condition = applied.value;
  const limit = append
    ? pageSize
    : Math.max(
        pageSize,
        condition === displayed.value ? items.value.length : 0,
      );
  const offset = append ? items.value.length : 0;
  busy.value = true;
  failure.value = "";
  failedAppend.value = append;
  try {
    const result = await readRange(condition, limit, offset, ticket);
    if (!mounted || ticket !== generation) return;
    const removed = new Set(
      receipt.value?.targets
        .filter((target) => terminal(target.state))
        .map((target) => target.item.id),
    );
    items.value = [
      ...new Map(
        (append ? [...items.value, ...result.items] : result.items)
          .filter((item) => !removed.has(item.id))
          .map((item) => [item.id, item]),
      ).values(),
    ];
    total.value = result.total;
    displayed.value = condition;
    loaded.value = true;
    selected.value = selected.value.filter((id) =>
      items.value.some((item) => item.id === id),
    );
    saveCache();
    await restorePosition(anchor);
    restoredAnchor = null;
    void checkRuns(items.value, ticket);
  } catch (error) {
    if (ticket === generation && mounted) failure.value = errorMessage(error);
  } finally {
    if (ticket === generation && mounted) busy.value = false;
  }
}
function search(event?: Event) {
  if (
    (event as SubmitEvent | undefined)?.submitter instanceof
      HTMLButtonElement &&
    busy.value
  )
    return;
  applied.value = keyword.value.trim();
  selected.value = [];
  void load(false, false);
}
function resetSearch() {
  keyword.value = "";
  applied.value = "";
  selected.value = [];
  void load(false, false);
}
function searchKey(event: KeyboardEvent) {
  if (event.key === "Enter" && event.isComposing) event.preventDefault();
}
function toggleAll() {
  selected.value = allSelected.value ? [] : [...eligible.value];
}
function finishManagement() {
  managing.value = false;
  selected.value = [];
  saveCache();
}
function continueSession(item: SessionRecord) {
  saveCache();
  portal.go("chat/" + item.id);
}
function focusRow(id?: string) {
  void nextTick(() => {
    const target = id
      ? rowElement(id)?.querySelector<HTMLElement>(
          ".history-more, .history-continue",
        )
      : null;
    (
      target ||
      (!items.value.length
        ? document.querySelector<HTMLElement>(".empty a, .empty button")
        : null) ||
      heading.value
    )?.focus();
  });
}
function openMenu(item: SessionRecord) {
  menu.value = item;
  void nextTick(() =>
    menuPanel.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
  );
}
async function closeMenu(action?: () => void) {
  if (!menu.value) return;
  const wait = history.state?.userWebDialog
    ? new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      )
    : Promise.resolve();
  menu.value = null;
  await nextTick();
  await wait;
  action?.();
}
function menuKeys(event: KeyboardEvent) {
  const buttons = Array.from(
    menuPanel.value?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) || [],
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | undefined;
  if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
  if (event.key === "ArrowUp")
    next = (index - 1 + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  if (next !== undefined) {
    event.preventDefault();
    buttons[next]?.focus();
  }
}
function renameFromMenu() {
  const item = menu.value;
  if (item) void closeMenu(() => rename(item));
}
function deleteFromMenu() {
  const item = menu.value;
  if (item)
    void closeMenu(() => {
      void beginDelete([item]);
    });
}
function rename(item: SessionRecord) {
  renaming.value = item;
  saveCache();
}
function renamed(item: SessionRecord) {
  const index = items.value.findIndex((row) => row.id === item.id);
  if (index !== -1) items.value[index] = item;
  saveCache();
}
function closeRename() {
  const id = renaming.value?.id;
  renaming.value = null;
  focusRow(id);
}
async function beginDelete(targets: SessionRecord[]) {
  if (!targets.length) return;
  if (
    receipt.value?.started &&
    (saving.value ||
      receipt.value.targets.some(
        (target) => target.state === "unknown" || target.state === "submitting",
      ))
  ) {
    showDelete.value = true;
    return;
  }
  receipt.value = {
    id: createBrowserUuid(),
    started: false,
    targets: targets.map((item) => ({ item, state: "checking" })),
  };
  deleteFailure.value = "";
  showDelete.value = true;
  await verifyTargets(false);
}
function deleteStateLabel(state: DeleteState) {
  const labels: Record<DeleteState, string> = {
    checking: text.checkingRun,
    ready: text.deleteWaiting,
    submitting: text.deleting,
    unknown: text.deleteUnknown,
    deleted: text.deletedItem,
    not_found: text.deleteMissing,
    busy: text.deleteBusy,
    forbidden: text.deleteForbidden,
    failed: text.deleteFailed,
    exists: text.deleteExists,
  };
  return labels[state];
}
function applyDeleted() {
  const removed = new Set(
    receipt.value?.targets
      .filter((target) => terminal(target.state))
      .map((target) => target.item.id),
  );
  const before = items.value.length;
  items.value = items.value.filter((item) => !removed.has(item.id));
  const invalid = new Set(
    receipt.value?.targets
      .filter(
        (target) => target.state === "busy" || target.state === "forbidden",
      )
      .map((target) => target.item.id),
  );
  const invalidSelection = selected.value.filter((id) => invalid.has(id));
  selected.value = selected.value.filter(
    (id) => !removed.has(id) && !invalid.has(id),
  );
  if (invalidSelection.length)
    portal.notice.value = text.selectionRemoved.replace(
      "{count}",
      String(invalidSelection.length),
    );
  if (total.value !== null)
    total.value = Math.max(0, total.value - (before - items.value.length));
  saveCache();
  persistReceipt();
}
async function verifyTargets(includeKnown = true) {
  const current = receipt.value;
  if (!current || verifying.value || saving.value || !portal.online.value)
    return;
  verifying.value = true;
  deleteFailure.value = "";
  const targets = current.targets.filter(
    (target) =>
      !terminal(target.state) &&
      target.state !== "submitting" &&
      (includeKnown || target.state === "checking"),
  );
  await Promise.all(
    targets.map(async (target) => {
      try {
        await portal.client.sessions.getDetail({ sessionId: target.item.id });
        const run = await portal.client.sessions.getActiveRun({
          sessionId: target.item.id,
        });
        runs.value[target.item.id] = run.activeRun?.busy ? "busy" : "available";
        target.state = run.activeRun?.busy
          ? "busy"
          : current.started
            ? "exists"
            : "ready";
      } catch (error) {
        const status = errorStatus(error);
        target.state =
          status === 404
            ? "not_found"
            : status === 403
              ? "forbidden"
              : "unknown";
        runs.value[target.item.id] =
          status === 404 ? "missing" : status === 403 ? "forbidden" : "unknown";
        if (target.state === "unknown")
          deleteFailure.value = errorMessage(error);
      }
    }),
  );
  verifying.value = false;
  applyDeleted();
  if (
    current.started &&
    current.targets.every((target) => terminal(target.state))
  )
    completeDelete();
}
function completeDelete() {
  portal.notice.value = text.deleteDone;
  const focusId = receipt.value?.focusId || items.value[0]?.id;
  showDelete.value = false;
  receipt.value = null;
  deleteFailure.value = "";
  persistReceipt();
  focusRow(focusId);
}
async function remove() {
  const current = receipt.value;
  if (
    !current ||
    saving.value ||
    verifying.value ||
    !portal.online.value ||
    unresolved.value
  )
    return;
  const targets = [...retryTargets.value];
  if (!targets.length) return;
  const ids = new Set(targets.map((target) => target.item.id));
  const firstIndex = items.value.findIndex((item) => ids.has(item.id));
  current.focusId =
    items.value.slice(firstIndex + 1).find((item) => !ids.has(item.id))?.id ||
    items.value
      .slice(0, firstIndex)
      .reverse()
      .find((item) => !ids.has(item.id))?.id;
  current.started = true;
  saving.value = true;
  deleteFailure.value = "";
  persistReceipt();
  for (
    let offset = 0;
    offset < targets.length;
    offset += apiCollectionPolicy.batchMaxItems
  ) {
    const batch = targets.slice(
      offset,
      offset + apiCollectionPolicy.batchMaxItems,
    );
    batch.forEach((target) => {
      target.state = "submitting";
    });
    persistReceipt();
    try {
      const result = await portal.client.sessions.batchDelete({
        ids: batch.map((target) => target.item.id),
      });
      const byId = new Map(result.results.map((row) => [row.id, row.action]));
      for (const target of batch) {
        const action = byId.get(target.item.id);
        target.state =
          action === "deleted"
            ? "deleted"
            : action === "not_found"
              ? "not_found"
              : action === "conflict"
                ? "busy"
                : action === "project_access_denied" || action === "forbidden"
                  ? "forbidden"
                  : action
                    ? "failed"
                    : "unknown";
        if (target.state === "busy") runs.value[target.item.id] = "busy";
      }
    } catch (error) {
      const status = errorStatus(error);
      for (const target of batch)
        target.state =
          status && status >= 400 && status < 500
            ? status === 403
              ? "forbidden"
              : status === 409
                ? "busy"
                : "failed"
            : "unknown";
      deleteFailure.value = errorMessage(error);
    }
    applyDeleted();
    if (batch.some((target) => target.state === "unknown")) break;
  }
  saving.value = false;
  persistReceipt();
  if (current.targets.every((target) => terminal(target.state)))
    completeDelete();
}
function closeDelete() {
  const id = receipt.value?.targets.find((target) => !terminal(target.state))
    ?.item.id;
  showDelete.value = false;
  if (!receipt.value?.started) {
    receipt.value = null;
    deleteFailure.value = "";
  }
  persistReceipt();
  focusRow(id);
}
function visibility() {
  if (document.visibilityState === "visible" && portal.online.value) {
    void load();
    if (receipt.value?.started) void verifyTargets();
  }
}
watch([selected, keyword, managing], saveCache, { deep: true });
watch(
  [allSelected, mixedSelected, allCheckbox],
  () => {
    if (allCheckbox.value)
      allCheckbox.value.indeterminate = mixedSelected.value;
  },
  { flush: "post" },
);
watch(
  () => portal.online.value,
  (online) => {
    if (online) {
      void load();
      if (receipt.value?.started) void verifyTargets();
    }
  },
);
const media = window.matchMedia("(max-width: 760px)");
function resized() {
  mobile.value = media.matches;
}
onMounted(() => {
  restoreCache();
  void load();
  if (receipt.value?.started) void verifyTargets();
  window.addEventListener("scroll", scrolled, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pageshow", visibility);
  media.addEventListener("change", resized);
});
onBeforeUnmount(() => {
  mounted = false;
  generation++;
  window.removeEventListener("scroll", scrolled);
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pageshow", visibility);
  media.removeEventListener("change", resized);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
</script>

<template>
  <section class="history-page">
    <div class="history-heading">
      <h1 ref="heading" tabindex="-1">{{ text.history }}</h1>
      <div class="actions">
        <a
          href="#discover"
          @click.prevent="
            saveCache();
            portal.go('discover');
          "
          >{{ text.newSession }}</a
        >
        <button
          v-if="mobile"
          @click="managing ? finishManagement() : (managing = true)"
        >
          {{ managing ? text.finishManagement : text.manageHistory }}
        </button>
      </div>
    </div>
    <form class="search-bar" @submit.prevent="search">
      <label for="history-search">{{ text.searchHistory }}</label>
      <div class="inline">
        <input
          id="history-search"
          v-model="keyword"
          type="search"
          :placeholder="text.historyPlaceholder"
          @keydown="searchKey"
        /><button class="primary" :disabled="busy">{{ text.search }}</button
        ><button v-if="keyword || applied" type="button" @click="resetSearch">
          {{ text.reset }}
        </button>
      </div>
    </form>
    <p class="query-status" role="status">
      {{
        busy && displayed !== applied
          ? text.updatingConditions
          : text.appliedConditions
      }}：{{ displayed || text.all
      }}<span v-if="total !== null">
        · {{ total }} {{ text.sessionCount }}</span
      >
    </p>
    <div v-if="receipt?.started" class="receipt-banner surface" role="status">
      <span>{{
        text.deleteProcessed
          .replace("{done}", String(processed))
          .replace("{total}", String(receipt.targets.length))
      }}</span>
      <span v-if="saving">{{ text.deleting }}</span
      ><span v-else-if="unresolved">{{ text.deleteUnknown }}</span>
      <button @click="showDelete = true">
        {{ unresolved ? text.verifyDelete : text.retryRemaining }}
      </button>
    </div>
    <div v-if="items.length && selectionVisible" class="selection-bar">
      <label class="select-loaded"
        ><input
          ref="allCheckbox"
          type="checkbox"
          :checked="allSelected"
          :disabled="!eligible.length"
          :aria-label="
            text.historySelection.replace('{count}', String(eligible.length))
          "
          @change="toggleAll"
        />{{ text.selectVisible }}</label
      >
      <span role="status">{{ text.selected }} {{ selected.length }}</span>
      <button
        :disabled="!selectedEligible.length || saving || !portal.online.value"
        class="danger-text"
        @click="
          beginDelete(
            items.filter((item) => selectedEligible.includes(item.id)),
          )
        "
      >
        {{ text.batchDelete }}
      </button>
      <button v-if="selected.length" @click="selected = []">
        {{ text.clearSelection }}
      </button>
    </div>
    <div class="history-list" :aria-busy="busy">
      <article
        v-for="item in items"
        :id="'history-' + item.id"
        :key="item.id"
        :data-session-id="item.id"
        class="surface history-row"
      >
        <input
          v-if="selectionVisible"
          v-model="selected"
          type="checkbox"
          :value="item.id"
          :disabled="!eligible.includes(item.id)"
          :aria-label="text.select + ' ' + title(item)"
        />
        <div class="history-info">
          <h2>
            <a
              :href="'#chat/' + item.id"
              @click.prevent="continueSession(item)"
              >{{ title(item) }}</a
            >
          </h2>
          <p>{{ identity(item) }}</p>
          <time :datetime="new Date(item.updatedAt).toISOString()">{{
            new Date(item.updatedAt).toLocaleString()
          }}</time>
          <p v-if="runs[item.id] === 'busy'" class="run-reason">
            {{ text.runningDelete }}
          </p>
          <p v-else-if="runs[item.id] === 'checking'" class="run-reason">
            {{ text.checkingRun }}
          </p>
          <template
            v-else-if="
              ['unknown', 'missing', 'forbidden'].includes(runs[item.id] || '')
            "
          >
            <p class="run-reason">{{ runReason(runs[item.id]) }}</p>
            <button class="run-retry" @click="checkRuns([item])">
              {{ text.retry }}
            </button>
          </template>
        </div>
        <div class="history-row-actions">
          <button
            class="primary history-continue"
            @click="continueSession(item)"
          >
            {{ text.continue }}
          </button>
          <button
            class="history-more"
            aria-haspopup="menu"
            :aria-expanded="menu?.id === item.id"
            :aria-label="text.moreActions + ' ' + title(item)"
            @click="openMenu(item)"
            @keydown.down.prevent="openMenu(item)"
          >
            {{ text.moreActions }}
          </button>
        </div>
      </article>
    </div>
    <div v-if="!busy && !failure && loaded && !items.length" class="empty">
      <h2>{{ displayed ? text.historyNoMatch : text.historyEmpty }}</h2>
      <p v-if="!displayed">{{ text.historyEmptyHelp }}</p>
      <button v-if="displayed" @click="resetSearch">{{ text.reset }}</button
      ><a v-else href="#discover" @click.prevent="portal.go('discover')">{{
        text.backDiscover
      }}</a>
    </div>
    <p v-if="busy" role="status">{{ text.loading }}</p>
    <div v-if="failure" role="alert" class="error-panel">
      <p>{{ failure }}</p>
      <p v-if="items.length">
        {{ text.previousConditions }}：{{ displayed || text.all }}
      </p>
      <button @click="load(failedAppend)">
        {{ failedAppend ? text.retryHistoryMore : text.retry }}
      </button>
    </div>
    <button
      v-if="hasMore && !failure"
      class="history-load-more"
      :disabled="busy"
      @click="load(true)"
    >
      {{ text.more }}
    </button>
  </section>
  <PortalDialog
    v-if="menu"
    :title="text.moreActions + ' · ' + title(menu)"
    @close="closeMenu()"
  >
    <div
      ref="menuPanel"
      class="history-menu"
      role="menu"
      :aria-label="text.moreActions"
      @keydown="menuKeys"
    >
      <button role="menuitem" @click="renameFromMenu">
        {{ text.rename }}
      </button>
      <button
        role="menuitem"
        class="danger-text"
        :disabled="
          runs[menu.id] !== 'available' ||
          pendingIds.has(menu.id) ||
          !portal.online.value
        "
        @click="deleteFromMenu"
      >
        {{ text.delete }}
      </button>
      <p v-if="runs[menu.id] === 'busy'">{{ text.runningDelete }}</p>
      <p v-else-if="runs[menu.id] !== 'available'">
        {{ runReason(runs[menu.id]) }}
      </p>
      <button
        v-if="['unknown', 'missing', 'forbidden'].includes(runs[menu.id] || '')"
        role="menuitem"
        @click="checkRuns([menu!])"
      >
        {{ text.retry }}
      </button>
    </div>
  </PortalDialog>
  <SessionSettingsDialog
    v-if="renaming"
    :session="renaming"
    @close="closeRename"
    @updated="renamed"
  />
  <PortalDialog
    v-if="showDelete && receipt"
    :title="text.deleteTitle"
    @close="closeDelete"
  >
    <p>{{ text.deleteSessionWarning }}</p>
    <p>{{ text.selected }} {{ receipt.targets.length }}</p>
    <ul class="delete-targets">
      <li v-for="target in receipt.targets" :key="target.item.id">
        <strong>{{ title(target.item) }}</strong>
        <p>{{ identity(target.item) }}</p>
        <span role="status">{{ deleteStateLabel(target.state) }}</span>
      </li>
    </ul>
    <p v-if="receipt.started" role="status">
      {{
        text.deleteProcessed
          .replace("{done}", String(processed))
          .replace("{total}", String(receipt.targets.length))
      }}
    </p>
    <p v-if="deleteFailure" role="alert" class="error">{{ deleteFailure }}</p>
    <template #actions>
      <button autofocus @click="closeDelete">
        {{ receipt.started ? text.backToList : text.cancel }}
      </button>
      <button
        v-if="
          unresolved ||
          receipt.targets.some((target) =>
            ['busy', 'forbidden', 'checking'].includes(target.state),
          )
        "
        :disabled="verifying || saving || !portal.online.value"
        @click="verifyTargets()"
      >
        {{ verifying ? text.checkingRun : text.verifyDelete }}
      </button>
      <button
        class="danger"
        :disabled="
          saving ||
          verifying ||
          !retryTargets.length ||
          unresolved ||
          !portal.online.value
        "
        @click="remove"
      >
        {{
          saving
            ? text.deleting
            : receipt.started
              ? text.retryRemaining
              : text.deleteConfirm
        }}
      </button>
    </template>
  </PortalDialog>
</template>

<style scoped>
.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
  flex-wrap: wrap;
}
.query-status {
  color: var(--color-text-secondary);
}
.select-loaded {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.history-row {
  scroll-margin-top: var(--space-2xl);
}
.history-info {
  min-width: 0;
  flex: 1;
}
.history-info h2,
.history-info p {
  overflow-wrap: anywhere;
}
.history-info time,
.run-reason {
  font-size: var(--font-size-meta);
  color: var(--color-text-secondary);
}
.history-row-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  align-items: center;
}
.history-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.history-menu button {
  text-align: left;
}
.receipt-banner {
  padding: var(--space-lg);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-block: var(--space-lg);
}
.delete-targets {
  padding-inline-start: var(--space-xl);
}
.delete-targets li {
  margin-block: var(--space-lg);
  overflow-wrap: anywhere;
}
.delete-targets p {
  margin-block: var(--space-sm);
}
.history-load-more {
  display: block;
  margin: var(--space-xl) auto;
}
@media (max-width: 760px) {
  .history-heading {
    align-items: flex-start;
  }
  .history-heading > .actions {
    width: 100%;
    justify-content: space-between;
  }
  .history-row {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--space-md);
  }
  .history-row-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .history-info {
    flex-basis: calc(100% - 3rem);
  }
  .selection-bar {
    flex-wrap: wrap;
  }
}
</style>
