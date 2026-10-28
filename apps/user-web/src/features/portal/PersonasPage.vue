<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import { userResourcePolicy } from "@tavern/shared";
import type { UserDetail } from "@tavern/sdk";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
  isUncertainWrite,
} from "./context.js";
import PortalDialog from "../../components/PortalDialog.vue";
import text from "../../config/portal-ui.json";
const portal = inject(portalKey)!,
  items = ref<UserDetail[]>([]),
  detailErrors = ref<Record<string, string>>({}),
  busy = ref(false),
  saving = ref(false),
  failure = ref(""),
  more = ref(false),
  deleting = ref<UserDetail | null>(null),
  deletePending = ref(false),
  defaultPending = ref(""),
  defaultBusy = ref("");
let generation = 0,
  active = true;
const accountId = portal.account.value!.id,
  key = accountDraftKey(accountId, "persona-delete"),
  defaultKey = accountDraftKey(accountId, "persona-default"),
  positionKey = accountDraftKey(accountId, "personas-view");
const defaultRecord = ref<UserDetail | null>(null),
  defaultFailure = ref(""),
  appendFailed = ref(false);
let requestedCount = userResourcePolicy.personaPageSize;
try {
  requestedCount = Math.max(
    requestedCount,
    Number(JSON.parse(sessionStorage.getItem(positionKey) || "null")?.count) ||
      0,
  );
} catch {
  sessionStorage.removeItem(positionKey);
}
const nextDefault = computed(() =>
  items.value.find((item) => item.id !== deleting.value?.id),
);
function rememberDelete() {
  if (deleting.value)
    sessionStorage.setItem(
      key,
      JSON.stringify({ target: deleting.value, pending: deletePending.value }),
    );
  else sessionStorage.removeItem(key);
}
async function load(append = false) {
  const ticket = ++generation;
  busy.value = true;
  failure.value = "";
  appendFailed.value = false;
  try {
    const target = append
      ? items.value.length + userResourcePolicy.personaPageSize
      : Math.max(requestedCount, items.value.length);
    const collected: UserDetail[] = append ? [...items.value] : [];
    let hasMore = true;
    do {
      const result = await portal.client.users.listPage({
        status: "active",
        limit: userResourcePolicy.personaPageSize,
        offset: collected.length,
        sortBy: "updated_at",
        sortOrder: "desc",
      });
      const details = await Promise.allSettled(
        result.items.map((user) =>
          portal.client.users.getDetail({ userId: user.id }),
        ),
      );
      if (ticket !== generation) return;
      const rows = result.items.map((record, index) => {
        const detail = details[index]!;
        if (detail.status === "fulfilled") {
          delete detailErrors.value[record.id];
          return detail.value;
        }
        detailErrors.value[record.id] = errorMessage(detail.reason);
        return { ...record, snapshot: null };
      });
      collected.push(...rows);
      hasMore =
        result.total === null
          ? rows.length === userResourcePolicy.personaPageSize
          : collected.length < result.total;
      if (!rows.length) break;
    } while (hasMore && collected.length < target);
    items.value = collected;
    requestedCount = collected.length || userResourcePolicy.personaPageSize;
    more.value = hasMore;
    await readDefault();
  } catch (error) {
    if (ticket === generation) {
      failure.value = errorMessage(error);
      appendFailed.value = append;
    }
  } finally {
    if (ticket === generation) busy.value = false;
  }
}
async function readDefault() {
  defaultFailure.value = "";
  const id = portal.account.value?.defaultPersonaId;
  if (!id || items.value.some((item) => item.id === id)) {
    defaultRecord.value = null;
    return;
  }
  try {
    defaultRecord.value = await portal.client.users.getDetail({ userId: id });
  } catch (error) {
    defaultFailure.value = errorMessage(error);
  }
}
async function readDetail(userId: string) {
  try {
    const detail = await portal.client.users.getDetail({ userId });
    items.value = items.value.map((item) =>
      item.id === userId ? detail : item,
    );
    delete detailErrors.value[userId];
  } catch (error) {
    detailErrors.value[userId] = errorMessage(error);
  }
}
async function verifyDefault() {
  if (saving.value) return;
  saving.value = true;
  failure.value = "";
  try {
    await portal.refreshIdentity();
    defaultPending.value = "";
    sessionStorage.removeItem(defaultKey);
    await readDefault();
    portal.notice.value = text.defaultVerified;
  } catch (error) {
    failure.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}
async function setDefault(user: UserDetail) {
  if (saving.value || defaultPending.value) return;
  saving.value = true;
  defaultBusy.value = user.id;
  failure.value = "";
  try {
    await portal.client.auth.updatePreferences({ defaultPersonaId: user.id });
    await portal.refreshIdentity();
    await readDefault();
    portal.notice.value = text.defaultSaved;
  } catch (error) {
    failure.value = errorMessage(error);
    if (isUncertainWrite(error)) {
      defaultPending.value = user.id;
      sessionStorage.setItem(defaultKey, user.id);
    }
  } finally {
    saving.value = false;
    defaultBusy.value = "";
  }
}
async function refreshAfterDelete() {
  const id = deleting.value?.id;
  deleting.value = null;
  deletePending.value = false;
  sessionStorage.removeItem(key);
  await portal.refreshIdentity();
  items.value = items.value.filter((item) => item.id !== id);
  if (!items.value.length) await load();
  portal.notice.value = text.deleteDone;
}
async function verifyDelete() {
  if (!deleting.value || saving.value) return;
  saving.value = true;
  failure.value = "";
  try {
    const user = await portal.client.users.getDetail({
      userId: deleting.value.id,
    });
    if (user.status === "deleted") {
      await refreshAfterDelete();
    } else {
      deleting.value = user;
      deletePending.value = false;
      rememberDelete();
    }
  } catch (error) {
    if (errorStatus(error) === 404) await refreshAfterDelete();
    else failure.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}
async function remove() {
  if (!deleting.value || saving.value || deletePending.value) return;
  saving.value = true;
  failure.value = "";
  deletePending.value = true;
  rememberDelete();
  try {
    await portal.client.users.remove({
      userId: deleting.value.id,
      expectedRevision: deleting.value.revision,
    });
    await refreshAfterDelete();
  } catch (error) {
    if (errorStatus(error) === 404) await refreshAfterDelete();
    else {
      failure.value = errorMessage(error);
      deletePending.value = isUncertainWrite(error);
      rememberDelete();
    }
  } finally {
    saving.value = false;
  }
}
function openDelete(user: UserDetail) {
  deleting.value = user;
  failure.value = "";
  deletePending.value = false;
}
function reopenDelete() {
  const saved = JSON.parse(sessionStorage.getItem(key) || "null");
  if (saved?.target) deleting.value = saved.target;
}
function closeDelete() {
  if (!deletePending.value) sessionStorage.removeItem(key);
  deleting.value = null;
}
async function refresh() {
  try {
    if (!defaultPending.value) await portal.refreshIdentity();
  } catch (error) {
    defaultFailure.value = errorMessage(error);
  }
  if (active) await load();
}
function visibility() {
  if (
    document.visibilityState === "visible" &&
    !saving.value &&
    !deletePending.value
  )
    void refresh();
}
function storePosition(id: string) {
  sessionStorage.setItem(
    positionKey,
    JSON.stringify({ anchor: id, count: items.value.length }),
  );
}
onMounted(async () => {
  defaultPending.value = sessionStorage.getItem(defaultKey) || "";
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved?.pending) {
      deleting.value = saved.target;
      deletePending.value = true;
    }
  } catch {
    sessionStorage.removeItem(key);
  }
  await refresh();
  let anchor = "";
  try {
    anchor =
      JSON.parse(sessionStorage.getItem(positionKey) || "null")?.anchor || "";
  } catch {
    sessionStorage.removeItem(positionKey);
  }
  await nextTick();
  if (anchor && active)
    document
      .getElementById(`persona-${anchor}`)
      ?.scrollIntoView({ block: "center" });
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
  <section>
    <header class="page-heading">
      <h1>{{ text.personas }}</h1>
      <button class="primary" @click="portal.go('personas/new')">
        {{ text.createPersona }}
      </button>
    </header>
    <div v-if="deletePending && !deleting" class="notice">
      <p>{{ text.deleteUnknown }}</p>
      <button @click="reopenDelete">{{ text.verifyDelete }}</button>
    </div>
    <div v-if="defaultPending" class="notice" role="status">
      <p>{{ text.operationPending }}</p>
      <button :disabled="saving || !portal.online.value" @click="verifyDefault">
        {{ text.verifyDefault }}
      </button>
    </div>
    <div v-if="!busy && !failure && !items.length" class="empty">
      <h2>{{ text.personaEmpty }}</h2>
      <p>{{ text.personaEmptyHelp }}</p>
    </div>
    <p v-if="defaultRecord">
      {{ text.defaultPersona }}：{{ defaultRecord.name }}
    </p>
    <div v-if="defaultFailure" role="alert">
      <p>{{ defaultFailure }}</p>
      <button @click="readDefault">{{ text.verifyDefault }}</button>
    </div>
    <div class="persona-grid">
      <article
        v-for="item in items"
        :id="`persona-${item.id}`"
        :key="item.id"
        class="surface"
      >
        <h2>
          {{ item.name }}
          <small
            v-if="portal.account.value?.defaultPersonaId === item.id"
            class="badge"
            >{{ text.defaultPersona }}</small
          >
        </h2>
        <details>
          <summary>
            {{ text.viewPersona
            }}<span class="sr-only"> · {{ item.name }}</span>
          </summary>
          <p v-if="!detailErrors[item.id]" class="prose">
            {{ item.snapshot?.description }}
          </p>
          <div v-else role="alert">
            <p>{{ detailErrors[item.id] }}</p>
            <button @click="readDetail(item.id)">{{ text.retry }}</button>
          </div>
        </details>
        <div class="actions">
          <button
            :aria-label="`${text.edit} ${item.name}`"
            @click="
              storePosition(item.id);
              portal.go(`personas/edit/${item.id}`);
            "
          >
            {{ text.edit }}</button
          ><button
            :aria-label="`${text.setDefault} ${item.name}`"
            :disabled="
              saving ||
              !!defaultPending ||
              portal.account.value?.defaultPersonaId === item.id ||
              !portal.online.value
            "
            @click="setDefault(item)"
          >
            {{
              defaultBusy === item.id ? text.saving : text.setDefault
            }}</button
          ><button
            class="danger-text"
            :aria-label="`${text.deletePersona} ${item.name}`"
            :disabled="saving || deletePending || !portal.online.value"
            @click="openDelete(item)"
          >
            {{ text.delete }}
          </button>
        </div>
      </article>
    </div>
    <p v-if="busy" role="status">{{ text.loading }}</p>
    <div v-if="failure && !deleting" role="alert" class="error-panel">
      <p>{{ failure }}</p>
      <button @click="load(appendFailed)">{{ text.retry }}</button>
    </div>
    <button v-if="more" :disabled="busy" @click="load(true)">
      {{ text.more }}
    </button>
  </section>
  <PortalDialog
    v-if="deleting"
    :title="text.deletePersona"
    :busy="saving"
    @close="closeDelete"
    ><h3>{{ deleting.name }}</h3>
    <p>{{ text.deletePersonaWarning }}</p>
    <p v-if="portal.account.value?.defaultPersonaId === deleting.id">
      {{
        nextDefault
          ? text.defaultAfterDelete + "：" + nextDefault.name
          : text.personaAfterLastDelete
      }}
    </p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <p v-if="deletePending" role="status">{{ text.operationPending }}</p>
    <template #actions
      ><button autofocus :disabled="saving" @click="closeDelete">
        {{ deletePending ? text.backToList : text.cancel }}</button
      ><button
        v-if="deletePending"
        :disabled="saving || !portal.online.value"
        @click="verifyDelete"
      >
        {{ text.verifyDelete }}</button
      ><button
        v-else
        class="danger"
        :disabled="saving || !portal.online.value"
        @click="remove"
      >
        {{ saving ? text.deleting : text.deletePersona }}
      </button></template
    ></PortalDialog
  >
</template>
