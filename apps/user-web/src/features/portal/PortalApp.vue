<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";
import type { AuthAccount } from "@tavern/sdk";
import type { RoleApplicationContext } from "../../lib/bootstrap.js";
import {
  portalKey,
  readPortalRoute,
  errorMessage,
  errorStatus,
} from "./context.js";
import AuthPage from "./AuthPage.vue";
import DiscoverPage from "./DiscoverPage.vue";
import PersonasPage from "./PersonasPage.vue";
import PersonaForm from "./PersonaForm.vue";
import AccountPage from "./AccountPage.vue";
import StartPage from "./StartPage.vue";
import HistoryPage from "./HistoryPage.vue";
import SessionPage from "./SessionPage.vue";
import text from "../../config/portal-ui.json";
import tokens from "../../../../../docs/ixd/user-web/phase6-tokens.json";

const props = defineProps<{ context: RoleApplicationContext }>();
const account = ref<AuthAccount | null>(null),
  route = ref(readPortalRoute()),
  online = ref(navigator.onLine),
  notice = ref("");
const logoutPending = ref(!!localStorage.getItem("user-web:logout-pending"));
const loading = ref(true),
  failure = ref(""),
  beforeLeave = ref<((target: string) => boolean) | null>(null);
const theme = ref(localStorage.getItem("user-web:theme") || "system");
const media = window.matchMedia("(prefers-color-scheme: dark)");
const nav = ["discover", "history", "personas", "account"] as const;
const standalone = computed(() =>
  ["auth", "register", "chat"].includes(route.value.name),
);
const protectedRoute = computed(() =>
  ["history", "personas", "account", "start", "chat"].includes(
    route.value.name,
  ),
);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, (value) => {
  if (noticeTimer) clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => (notice.value = ""), 6000);
});
let identityGeneration = 0;
let identityRefresh: Promise<void> | null = null;
let currentHash = window.location.hash || "#discover";
function go(target: string) {
  if (beforeLeave.value && !beforeLeave.value(target)) return;
  window.location.hash = target;
}
function requireLogin(target: string) {
  sessionStorage.setItem("user-web:return", target);
  go("auth");
}
async function refreshIdentity() {
  const ticket = ++identityGeneration;
  const request = (async () => {
    try {
      const result = await props.context.client.auth.me();
      if (ticket !== identityGeneration) return;
      account.value = result;
      logoutPending.value = false;
      localStorage.removeItem("user-web:logout-pending");
    } catch (error) {
      if (ticket !== identityGeneration) return;
      if (errorStatus(error) === 401) account.value = null;
      else throw error;
    }
  })();
  identityRefresh = request;
  let latest = request;
  for (;;) {
    await latest;
    if (!identityRefresh || latest === identityRefresh) return;
    latest = identityRefresh;
  }
}
async function initialize() {
  loading.value = true;
  failure.value = "";
  try {
    if (!logoutPending.value) await refreshIdentity();
  } catch (error) {
    failure.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}
function hashChange() {
  if ((window.location.hash || "#discover") === currentHash) return;
  const target = window.location.hash.slice(1);
  if (beforeLeave.value && !beforeLeave.value(target)) {
    window.history.replaceState(null, "", currentHash);
    return;
  }
  currentHash = window.location.hash;
  route.value = readPortalRoute();
  window.scrollTo(0, 0);
}
function connectivity() {
  online.value = navigator.onLine;
  if (online.value) void restoreIdentity();
}
function expireIdentity() {
  identityGeneration++;
  identityRefresh = null;
  account.value = null;
  beforeLeave.value = null;
}
async function restoreIdentity() {
  if (document.visibilityState !== "visible" || logoutPending.value) return;
  try {
    await refreshIdentity();
  } catch (error) {
    notice.value = errorMessage(error);
  }
}
function clearPrivateDrafts(accountId: string) {
  for (const key of Object.keys(sessionStorage)) {
    if (
      key.startsWith(`user-web:${accountId}:`) ||
      key.startsWith(`tavern.user.chat:${accountId}:`)
    )
      sessionStorage.removeItem(key);
  }
}
async function confirmLogout() {
  try {
    await props.context.client.auth.logout();
    logoutPending.value = false;
    localStorage.removeItem("user-web:logout-pending");
    notice.value = text.loggedOut;
  } catch {
    notice.value = text.logoutPending;
  }
}
async function detachSignedOutAccount() {
  const accountId = account.value?.id;
  logoutPending.value = true;
  expireIdentity();
  await nextTick();
  if (accountId) clearPrivateDrafts(accountId);
}
async function signOut() {
  const cleanup = detachSignedOutAccount();
  localStorage.setItem("user-web:logout-pending", String(Date.now()));
  go("discover");
  await cleanup;
  if (online.value) await confirmLogout();
  else notice.value = text.logoutPending;
}
function storage(event: StorageEvent) {
  if (event.key !== "user-web:logout-pending") return;
  if (event.newValue) void detachSignedOutAccount();
  else logoutPending.value = false;
}
function applyTheme() {
  const mode =
    theme.value === "system"
      ? media.matches
        ? "dark"
        : "light"
      : theme.value === "dark"
        ? "dark"
        : "light";
  for (const [key, value] of Object.entries(tokens.common))
    document.documentElement.style.setProperty(key, value);
  for (const [key, value] of Object.entries(tokens.colors))
    document.documentElement.style.setProperty(key, value[mode]);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  localStorage.setItem("user-web:theme", theme.value);
}
provide(portalKey, {
  client: props.context.client,
  runtime: props.context,
  account,
  route,
  online,
  notice,
  go,
  refreshIdentity,
  requireLogin,
  beforeLeave,
  signOut,
});
onMounted(() => {
  applyTheme();
  void initialize();
  window.addEventListener("hashchange", hashChange);
  window.addEventListener("storage", storage);
  window.addEventListener("online", connectivity);
  window.addEventListener("offline", connectivity);
  media.addEventListener("change", applyTheme);
  window.addEventListener("user-web:identity-expired", expireIdentity);
  document.addEventListener("visibilitychange", restoreIdentity);
});
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
  window.removeEventListener("hashchange", hashChange);
  window.removeEventListener("storage", storage);
  window.removeEventListener("online", connectivity);
  window.removeEventListener("offline", connectivity);
  media.removeEventListener("change", applyTheme);
  window.removeEventListener("user-web:identity-expired", expireIdentity);
  document.removeEventListener("visibilitychange", restoreIdentity);
});
</script>
<template>
  <div class="portal-root" :class="{ standalone }">
    <template v-if="!standalone">
      <aside class="portal-sidebar">
        <a class="brand" href="#discover" @click.prevent="go('discover')">{{
          text.brand
        }}</a>
        <p>{{ text.tagline }}</p>
        <nav :aria-label="text.tagline">
          <a
            v-for="item in nav"
            :key="item"
            :href="`#${item}`"
            :aria-current="route.name === item ? 'page' : undefined"
            @click.prevent="go(item)"
            >{{ text[item] }}</a
          >
        </nav>
      </aside>
      <header class="portal-header">
        <span>{{ text.brand }}</span
        ><a
          :href="account ? '#account' : '#auth'"
          @click.prevent="go(account ? 'account' : 'auth')"
          >{{ account?.name || text.loginLink }}</a
        >
      </header>
      <nav class="mobile-nav" :aria-label="text.tagline">
        <a
          v-for="item in nav"
          :key="item"
          :href="`#${item}`"
          :aria-current="route.name === item ? 'page' : undefined"
          @click.prevent="go(item)"
          >{{ text[item] }}</a
        >
      </nav>
    </template>
    <main
      id="main"
      :key="
        ['auth', 'register'].includes(route.name)
          ? 'authentication'
          : account?.id || 'visitor'
      "
      class="portal-main"
      :class="{ 'session-main': route.name === 'chat' }"
    >
      <p v-if="notice" role="status" class="notice portal-toast">
        {{ notice }}
      </p>
      <button v-if="logoutPending" :disabled="!online" @click="confirmLogout">
        {{ text.verifyLogout }}
      </button>
      <div v-if="failure && !protectedRoute" role="alert" class="notice">
        <p>{{ failure }}</p>
        <button @click="initialize">{{ text.retry }}</button>
      </div>
      <p v-if="!online" role="status" class="notice">{{ text.offline }}</p>
      <div v-if="loading" class="empty" role="status">{{ text.loading }}</div>
      <div v-else-if="failure && protectedRoute" class="empty">
        <p role="alert">{{ failure }}</p>
        <button @click="initialize">{{ text.retry }}</button>
      </div>
      <div v-else-if="protectedRoute && !account" class="empty">
        <h1>{{ text.auth }}</h1>
        <button
          class="primary"
          @click="requireLogin(route.name + (route.id ? '/' + route.id : ''))"
        >
          {{ text.loginSubmit }}</button
        ><a href="#discover">{{ text.backDiscover }}</a>
      </div>
      <AuthPage
        v-else-if="route.name === 'auth' || route.name === 'register'"
        :key="route.name"
        :registering="route.name === 'register'"
      />
      <DiscoverPage
        v-else-if="route.name === 'discover' || route.name === 'role'"
        :key="`${route.name}/${route.id}`"
        :role-id="route.name === 'role' ? route.id : undefined"
      />
      <PersonaForm
        v-else-if="route.name === 'personas' && route.id"
        :key="route.id"
        :persona-id="
          route.id.startsWith('edit/') ? route.id.slice(5) : undefined
        "
      />
      <PersonasPage v-else-if="route.name === 'personas'" />
      <AccountPage v-else-if="route.name === 'account'" />
      <StartPage
        v-else-if="route.name === 'start'"
        :key="route.id"
        :role-id="route.id"
      />
      <HistoryPage v-else-if="route.name === 'history'" />
      <SessionPage
        v-else-if="route.name === 'chat'"
        :key="route.id"
        :session-id="route.id"
      />
      <div v-else class="empty">
        <h1>{{ text.resourceMissing }}</h1>
        <p>{{ text.resourceMissingHelp }}</p>
        <a href="#discover">{{ text.backDiscover }}</a>
      </div>
      <div v-if="route.name !== 'chat'" class="theme-picker">
        <label for="portal-theme">{{ text.theme }}</label
        ><select id="portal-theme" v-model="theme" @change="applyTheme">
          <option value="system">{{ text.themeSystem }}</option>
          <option value="light">{{ text.themeLight }}</option>
          <option value="dark">{{ text.themeDark }}</option>
        </select>
      </div>
    </main>
  </div>
</template>
