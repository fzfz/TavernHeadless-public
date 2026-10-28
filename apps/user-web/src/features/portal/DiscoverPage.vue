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
import { publicRoleSchema, type PublicRole } from "@tavern/shared";
import { portalKey, errorMessage, errorStatus } from "./context.js";
import text from "../../config/portal-ui.json";

const props = defineProps<{ roleId?: string }>();
const portal = inject(portalKey)!;
const listKey = "user-web:public-role-list";
const detailKey = `user-web:public-role:${props.roleId ?? ""}`;
type Anchor = { id: string; index: number; top: number; y: number };
type ListCache = {
  keyword: string;
  draft: string;
  tag: string;
  items: PublicRole[];
  tags: string[];
  total: number;
  anchor: Anchor | null;
};
function readCache(key: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
const saved = readCache(listKey);
const explicitQuery =
  portal.route.value.query.has("q") || portal.route.value.query.has("tag");
const appliedKeyword = ref(
  explicitQuery
    ? (portal.route.value.query.get("q") ?? "")
    : typeof saved?.keyword === "string"
      ? saved.keyword
      : "",
);
const tag = ref(
  explicitQuery
    ? (portal.route.value.query.get("tag") ?? "")
    : typeof saved?.tag === "string"
      ? saved.tag
      : "",
);
const sameSavedQuery =
  saved?.keyword === appliedKeyword.value && saved?.tag === tag.value;
const keyword = ref(
  sameSavedQuery && typeof saved?.draft === "string"
    ? saved.draft
    : appliedKeyword.value,
);
const items = ref<PublicRole[]>(
  sameSavedQuery && Array.isArray(saved?.items)
    ? saved.items.flatMap((item) => {
        const parsed = publicRoleSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [],
);
const tags = ref<string[]>(
  Array.isArray(saved?.tags)
    ? saved.tags.filter((item): item is string => typeof item === "string")
    : [],
);
const total = ref(
  sameSavedQuery && typeof saved?.total === "number" ? saved.total : 0,
);
const hasResults = ref(
  Boolean(sameSavedQuery && typeof saved?.total === "number"),
);
const displayedKeyword = ref(appliedKeyword.value),
  displayedTag = ref(tag.value);
const savedDetail = readCache(detailKey);
const parsedRole = publicRoleSchema.safeParse(savedDetail?.role);
const role = ref<PublicRole | null>(
  parsedRole.success ? parsedRole.data : null,
);
const expanded = ref(
  new Set(
    Array.isArray(savedDetail?.expanded)
      ? savedDetail.expanded.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  ),
);
const openingId = ref(
  typeof savedDetail?.openingId === "string" ? savedDetail.openingId : "",
);
const busy = ref(false),
  loadingMore = ref(false),
  failure = ref(""),
  failedMore = ref(false),
  verified = ref(false);
const list = ref<HTMLElement | null>(null),
  heading = ref<HTMLElement | null>(null),
  searchButton = ref<HTMLButtonElement | null>(null);
let generation = 0,
  active = true,
  saveFrame = 0;
let anchor =
  sameSavedQuery && saved?.anchor && typeof saved.anchor === "object"
    ? (saved.anchor as Anchor)
    : null;
let detailY = typeof savedDetail?.y === "number" ? savedDetail.y : 0;
const filtered = computed(() => Boolean(appliedKeyword.value || tag.value));
const condition = (query: string, category: string) =>
  [query, category].filter(Boolean).join(" · ") || text.all;
const appliedCondition = computed(() =>
  condition(appliedKeyword.value, tag.value),
);
const displayedCondition = computed(() =>
  condition(displayedKeyword.value, displayedTag.value),
);
const startDisabled = computed(
  () => !portal.online.value || busy.value || !verified.value || !role.value,
);
const startStatus = computed(() =>
  !portal.online.value
    ? text.offline
    : busy.value
      ? text.loading
      : !verified.value
        ? text.roleUnavailable
        : "",
);
const catalogueRoute = computed(() => {
  const params = new URLSearchParams();
  const cache = readCache(listKey);
  if (typeof cache?.keyword === "string" && cache.keyword)
    params.set("q", cache.keyword);
  if (typeof cache?.tag === "string" && cache.tag) params.set("tag", cache.tag);
  return `discover${params.size ? `?${params}` : ""}`;
});
function listAnchor(): Anchor | null {
  const cards = Array.from(
    list.value?.querySelectorAll<HTMLElement>("[data-role-id]") ?? [],
  );
  const index = cards.findIndex(
    (card) => card.getBoundingClientRect().bottom > 100,
  );
  const card = cards[index];
  return card
    ? {
        id: card.dataset.roleId!,
        index,
        top: card.getBoundingClientRect().top,
        y: window.scrollY,
      }
    : null;
}
function remember() {
  if (!active) return;
  try {
    if (props.roleId)
      sessionStorage.setItem(
        detailKey,
        JSON.stringify({
          role: role.value,
          openingId: openingId.value,
          expanded: [...expanded.value],
          y: window.scrollY,
        }),
      );
    else {
      anchor = listAnchor() ?? anchor;
      const value: ListCache = {
        keyword: displayedKeyword.value,
        draft: keyword.value,
        tag: displayedTag.value,
        items: items.value,
        tags: tags.value,
        total: total.value,
        anchor,
      };
      sessionStorage.setItem(listKey, JSON.stringify(value));
    }
  } catch {
    /* Browser storage is optional for live browsing. */
  }
}
function onScroll() {
  if (saveFrame) return;
  saveFrame = requestAnimationFrame(() => {
    saveFrame = 0;
    remember();
  });
}
async function restorePosition(target: Anchor | null, y?: number) {
  await nextTick();
  if (!active) return;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      if (!active) {
        resolve();
        return;
      }
      if (props.roleId) {
        window.scrollTo({ top: y ?? detailY, behavior: "instant" });
        resolve();
        return;
      }
      if (!target) {
        resolve();
        return;
      }
      const cards = Array.from(
        list.value?.querySelectorAll<HTMLElement>("[data-role-id]") ?? [],
      );
      const card =
        cards.find((item) => item.dataset.roleId === target.id) ??
        cards[Math.min(target.index, cards.length - 1)];
      if (card)
        window.scrollTo({
          top: window.scrollY + card.getBoundingClientRect().top - target.top,
          behavior: "instant",
        });
      else heading.value?.scrollIntoView({ block: "start" });
      resolve();
    }),
  );
}
async function load(more = false, preservePosition = true) {
  const ticket = ++generation;
  const target = preservePosition ? (listAnchor() ?? anchor) : null;
  const readY = window.scrollY;
  const requestedKeyword = appliedKeyword.value,
    requestedTag = tag.value;
  busy.value = true;
  loadingMore.value = more;
  failure.value = "";
  failedMore.value = false;
  if (props.roleId) verified.value = false;
  try {
    if (!portal.online.value) throw new Error(text.offline);
    if (props.roleId) {
      const result = await portal.client.publicRoles.get({
        roleId: props.roleId,
      });
      if (ticket !== generation || !active) return;
      role.value = result;
      verified.value = true;
      if (!result.openings.some((item) => item.id === openingId.value))
        openingId.value =
          result.openings.find((item) => item.is_default)?.id ??
          result.openings[0]?.id ??
          "";
      await restorePosition(null, readY || detailY);
    } else {
      const wanted = more
        ? 12
        : Math.max(
            12,
            items.value.length &&
              displayedKeyword.value === requestedKeyword &&
              displayedTag.value === requestedTag
              ? items.value.length
              : 12,
          );
      const offset = more ? items.value.length : 0;
      const result = await portal.client.publicRoles.list({
        keyword: requestedKeyword || undefined,
        tag: requestedTag || undefined,
        limit: Math.min(wanted, 100),
        offset,
      });
      const nextItems = [...result.items];
      while (!more && nextItems.length < Math.min(wanted, result.total)) {
        const next = await portal.client.publicRoles.list({
          keyword: requestedKeyword || undefined,
          tag: requestedTag || undefined,
          limit: Math.min(100, wanted - nextItems.length),
          offset: nextItems.length,
        });
        if (ticket !== generation || !active) return;
        if (!next.items.length) break;
        nextItems.push(...next.items);
      }
      if (ticket !== generation || !active) return;
      const combined = more ? [...items.value, ...nextItems] : nextItems;
      items.value = combined.filter(
        (item, index) =>
          combined.findIndex((candidate) => candidate.id === item.id) === index,
      );
      hasResults.value = true;
      total.value = result.total;
      tags.value = result.tags;
      displayedKeyword.value = requestedKeyword;
      displayedTag.value = requestedTag;
      if (preservePosition) await restorePosition(target);
    }
  } catch (error) {
    if (ticket !== generation || !active) return;
    if (props.roleId && [403, 404].includes(errorStatus(error) ?? 0)) {
      remember();
      portal.go("unavailable");
      return;
    }
    failure.value = errorMessage(error);
    failedMore.value = more;
  } finally {
    if (ticket === generation && active) {
      busy.value = false;
      loadingMore.value = false;
      await nextTick();
      remember();
    }
  }
}
function updateRoute() {
  const params = new URLSearchParams();
  if (appliedKeyword.value) params.set("q", appliedKeyword.value);
  if (tag.value) params.set("tag", tag.value);
  window.history.replaceState(
    window.history.state,
    "",
    `#discover${params.size ? `?${params}` : ""}`,
  );
}
function search() {
  appliedKeyword.value = keyword.value.trim();
  updateRoute();
  anchor = null;
  if (window.matchMedia("(max-width: 767px)").matches)
    searchButton.value?.focus({ preventScroll: true });
  void load(false, false);
}
function applyTag(value: string) {
  tag.value = value;
  updateRoute();
  anchor = null;
  void load(false, false);
}
function reset() {
  keyword.value = "";
  appliedKeyword.value = "";
  tag.value = "";
  updateRoute();
  anchor = null;
  void load(false, false);
}
function searchEnter(event: KeyboardEvent) {
  if (event.isComposing) event.preventDefault();
}
function openRole(id: string) {
  remember();
  portal.go(`role/${encodeURIComponent(id)}`);
}
function start(id: string, chosenOpening?: string) {
  if (!portal.online.value) return;
  remember();
  const target = `start/${encodeURIComponent(id)}${chosenOpening ? `?opening=${encodeURIComponent(chosenOpening)}` : ""}`;
  if (portal.account.value) portal.go(target);
  else portal.requireLogin(target);
}
function openingToggle(id: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) expanded.value.add(id);
  else expanded.value.delete(id);
  remember();
}

function back() {
  remember();
  portal.go(catalogueRoute.value);
}
function onVisible() {
  if (document.visibilityState === "visible") void load(false, true);
}
function onPageshow(event: PageTransitionEvent) {
  if (event.persisted) void load(false, true);
}
watch(keyword, remember);
watch(openingId, remember);
watch(
  () => portal.online.value,
  (online) => {
    if (online) void load(false, true);
    else verified.value = false;
  },
);
onMounted(async () => {
  await nextTick();
  heading.value?.focus({ preventScroll: true });
  await restorePosition(anchor, detailY);
  void load(false, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", remember);
  window.addEventListener("pageshow", onPageshow);
  document.addEventListener("visibilitychange", onVisible);
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  cancelAnimationFrame(saveFrame);
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("pagehide", remember);
  window.removeEventListener("pageshow", onPageshow);
  document.removeEventListener("visibilitychange", onVisible);
});
</script>

<template>
  <section v-if="roleId" class="detail-page">
    <a :href="`#${catalogueRoute}`" @click.prevent="back">{{
      text.backDiscover
    }}</a>
    <h1 ref="heading" tabindex="-1">{{ role?.name || text.details }}</h1>
    <p v-if="busy" role="status">{{ text.loading }}</p>
    <template v-if="role">
      <div class="detail-art role-art" aria-hidden="true">
        {{ role.name.slice(0, 1) }}
      </div>
      <p v-if="role.creator">{{ text.creator }} · {{ role.creator }}</p>
      <p v-if="role.tags.length" class="eyebrow">{{ role.tags.join(" · ") }}</p>
      <section class="surface">
        <h2>{{ text.story }}</h2>
        <p class="prose">{{ role.description }}</p>
      </section>
      <section v-if="role.openings.length" class="surface">
        <h2>{{ text.openings }}</h2>
        <fieldset>
          <legend>{{ text.chooseOpening }}</legend>
          <article
            v-for="opening in role.openings"
            :key="opening.id"
            class="opening-preview"
          >
            <label class="choice"
              ><input
                v-model="openingId"
                type="radio"
                name="preview-opening"
                :value="opening.id"
              /><span>{{ opening.title }}</span></label
            >
            <details
              :open="expanded.has(opening.id)"
              @toggle="openingToggle(opening.id, $event)"
            >
              <summary>
                {{ expanded.has(opening.id) ? text.collapse : text.expand
                }}<span class="sr-only"> · {{ opening.title }}</span>
              </summary>
              <p class="prose">{{ opening.display_text || opening.summary }}</p>
            </details>
          </article>
        </fieldset>
      </section>
      <footer class="detail-start">
        <p id="role-start-status" role="status">{{ startStatus }}</p>
        <button
          class="primary"
          :disabled="startDisabled"
          aria-describedby="role-start-status"
          @click="start(role.id, openingId)"
        >
          {{ text.start }}
        </button>
      </footer>
    </template>
  </section>
  <section v-else>
    <h1 ref="heading" tabindex="-1">{{ text.discover }}</h1>
    <form class="search-bar" @submit.prevent="search">
      <label for="role-search">{{ text.searchRoles }}</label>
      <div class="inline">
        <input
          id="role-search"
          v-model="keyword"
          type="search"
          :placeholder="text.searchPlaceholder"
          :aria-describedby="failure ? 'role-list-error' : undefined"
          @keydown.enter="searchEnter"
        /><button ref="searchButton" class="primary">{{ text.search }}</button>
      </div>
    </form>
    <fieldset class="tag-filter">
      <legend>{{ text.category }}</legend>
      <label
        v-for="category in ['', ...tags]"
        :key="category"
        class="category-choice"
        :class="{ checked: tag === category }"
        ><input
          type="radio"
          name="role-category"
          :value="category"
          :checked="tag === category"
          @change="applyTag(category)"
        /><span>{{ category || text.all }}</span></label
      >
    </fieldset>
    <a href="#role-list-heading" @click.prevent="list?.focus()">{{
      text.skipCards
    }}</a>
    <div class="list-heading">
      <div role="status" aria-live="polite" aria-atomic="true">
        <p v-if="busy && !loadingMore">
          {{ text.updatingConditions }}：{{ appliedCondition }}
        </p>
        <p>
          {{
            (busy && !loadingMore) || failure
              ? text.previousConditions
              : text.appliedConditions
          }}：{{ displayedCondition }}
        </p>
        <p v-if="hasResults" id="role-list-heading">
          {{ total }} {{ text.roleCount }} · {{ text.loaded }}
          {{ items.length }}
        </p>
      </div>
      <button v-if="filtered || keyword" @click="reset">
        {{ text.reset }}
      </button>
    </div>
    <div
      id="role-list"
      ref="list"
      tabindex="-1"
      class="role-grid"
      role="list"
      aria-labelledby="role-list-heading"
      :aria-busy="busy"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="role-card"
        role="listitem"
        :data-role-id="item.id"
      >
        <a
          class="role-art cover-link"
          :href="`#role/${item.id}`"
          :aria-label="`${text.details} · ${item.name}`"
          @click.prevent="openRole(item.id)"
          ><span aria-hidden="true">{{ item.name.slice(0, 1) }}</span></a
        >
        <div class="card-content">
          <p v-if="item.tags.length" class="eyebrow">
            {{ item.tags.join(" · ") }}
          </p>
          <h2>
            <a :href="`#role/${item.id}`" @click.prevent="openRole(item.id)">{{
              item.name
            }}</a>
          </h2>
          <p class="clamp">{{ item.description }}</p>
          <p v-if="item.creator" class="eyebrow">
            {{ text.creator }} · {{ item.creator }}
          </p>
          <div class="actions">
            <a
              class="button"
              :href="`#role/${item.id}`"
              @click.prevent="openRole(item.id)"
              >{{ text.details
              }}<span class="sr-only"> · {{ item.name }}</span></a
            ><button
              class="primary"
              :disabled="!portal.online.value"
              @click="start(item.id)"
            >
              {{ text.start }}<span class="sr-only"> · {{ item.name }}</span>
            </button>
          </div>
        </div>
      </article>
    </div>
    <div v-if="!busy && !failure && !items.length" class="empty">
      <h2>{{ filtered ? text.noMatch : text.noBrowsableRoles }}</h2>
      <p v-if="filtered">{{ text.noMatchHelp }}</p>
      <button v-if="filtered" @click="reset">{{ text.reset }}</button
      ><button v-else @click="load()">{{ text.reloadRoles }}</button>
    </div>
    <button
      v-if="items.length < total && (!failure || failedMore)"
      class="load-more"
      :disabled="busy"
      @click="load(true)"
    >
      {{ loadingMore ? text.loading : failedMore ? text.retryMore : text.more }}
    </button>
  </section>
  <div v-if="failure" id="role-list-error" role="alert" class="error-panel">
    <p>{{ failure }}</p>
    <button v-if="!failedMore" :disabled="busy" @click="load(false)">
      {{ failedMore ? text.retryMore : text.retry }}</button
    ><a v-if="roleId" :href="`#${catalogueRoute}`" @click.prevent="back">{{
      text.backDiscover
    }}</a>
  </div>
</template>

<style scoped>
.category-choice {
  display: inline-flex;
  gap: var(--space-sm);
  align-items: center;
  min-height: var(--size-target-min);
  padding: var(--space-sm) var(--space-md);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background var(--motion-duration-feedback)
    var(--motion-easing-standard);
}
.category-choice.checked {
  color: var(--color-primary);
  background: var(--color-bg-selected);
  border-color: var(--color-border-selected);
  font-weight: var(--font-weight-emphasis);
}
.category-choice:hover {
  background: var(--color-bg-hover);
}
.category-choice:focus-within {
  outline: var(--border-focus-width) solid var(--color-focus);
  outline-offset: var(--space-focus-offset);
}
.cover-link {
  text-decoration: none;
}
.detail-art {
  border-radius: var(--radius-surface);
  margin: var(--space-xl) 0;
  max-width: var(--size-reading-max);
}
.detail-start {
  position: sticky;
  bottom: var(--space-lg);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-lg);
  padding: var(--space-lg);
  border: var(--border-width) solid var(--color-divider);
  border-radius: var(--radius-surface);
  background: var(--color-bg-surface);
}
.detail-start p {
  margin: 0;
}
.detail-start button {
  flex-shrink: 0;
}
.opening-preview + .opening-preview {
  border-top: var(--border-width) solid var(--color-divider);
  padding-top: var(--space-lg);
}
@media (max-width: 767px) {
  .detail-start {
    bottom: calc(
      var(--size-nav-bottom) + env(safe-area-inset-bottom) + var(--space-sm)
    );
    flex-wrap: wrap;
  }
  .detail-start button {
    width: 100%;
  }
}
@media (max-height: 520px) {
  .detail-start {
    position: static;
  }
}
</style>
