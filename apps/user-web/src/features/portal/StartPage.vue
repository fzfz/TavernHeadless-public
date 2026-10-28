<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  apiCollectionPolicy,
  createBrowserUuid,
  userResourcePolicy,
  type PublicRole,
} from "@tavern/shared";
import type { UserDetail } from "@tavern/sdk";
import {
  portalKey,
  accountDraftKey,
  errorMessage,
  errorStatus,
  isUncertainWrite,
} from "./context.js";
import text from "../../config/portal-ui.json";

type CreationInput = {
  userId: string;
  openingId: string;
  expectedUserRevision: number;
};
const props = defineProps<{ roleId: string }>(),
  portal = inject(portalKey)!;
const role = ref<PublicRole | null>(null),
  personas = ref<UserDetail[]>([]),
  personaId = ref(""),
  openingId = ref("");
const roleLoading = ref(true),
  personaLoading = ref(true),
  roleFailure = ref(""),
  personaFailure = ref(""),
  failure = ref(""),
  busy = ref(false),
  pending = ref(false),
  initializing = ref(false),
  more = ref(false),
  loadedPersonaCount = ref(0);
const roleVerified = ref(false),
  personaVerified = ref(false),
  personaUnavailable = ref(false),
  roleUnavailable = ref(false);
const personaChanged = ref(false),
  roleChanged = ref(false);
const confirmedPersonaRevision = ref<number | null>(null),
  confirmedRole = ref<PublicRole | null>(null),
  creationInput = ref<CreationInput | null>(null);
const key = accountDraftKey(portal.account.value!.id, `start:${props.roleId}`);
let operationId = createBrowserUuid(),
  active = true,
  roleGeneration = 0,
  personaGeneration = 0;
const selected = computed(() =>
  personas.value.find((p) => p.id === personaId.value && p.status === "active"),
);
const opening = computed(() =>
  role.value?.openings.find((p) => p.id === openingId.value),
);
const needsConfirmation = computed(
  () => personaChanged.value || roleChanged.value,
);
const canCreate = computed(
  () =>
    !busy.value &&
    portal.online.value &&
    !roleLoading.value &&
    !personaLoading.value &&
    roleVerified.value &&
    personaVerified.value &&
    !!selected.value &&
    !!opening.value &&
    !roleUnavailable.value &&
    !personaUnavailable.value &&
    !needsConfirmation.value,
);
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || "null");
  if (saved) {
    personaId.value = saved.personaId || "";
    openingId.value = saved.openingId || "";
    operationId = saved.operationId || operationId;
    pending.value = !!saved.pending;
    initializing.value = !!saved.initializing;
    confirmedPersonaRevision.value =
      typeof saved.confirmedPersonaRevision === "number"
        ? saved.confirmedPersonaRevision
        : null;
    confirmedRole.value = saved.confirmedRole || null;
    personaChanged.value = !!saved.personaChanged;
    roleChanged.value = !!saved.roleChanged;
    creationInput.value = saved.creationInput || null;
  }
} catch {
  sessionStorage.removeItem(key);
}
if (!pending.value) {
  const requestedOpening = portal.route.value.query.get("opening");
  if (requestedOpening) openingId.value = requestedOpening;
  const requested = portal.route.value.query.get("persona");
  if (requested) personaId.value = requested;
}
function remember() {
  sessionStorage.setItem(
    key,
    JSON.stringify({
      personaId: personaId.value,
      openingId: openingId.value,
      operationId,
      pending: pending.value,
      initializing: initializing.value,
      confirmedPersonaRevision: confirmedPersonaRevision.value,
      confirmedRole: confirmedRole.value,
      personaChanged: personaChanged.value,
      roleChanged: roleChanged.value,
      creationInput: creationInput.value,
    }),
  );
}
async function loadRole() {
  const ticket = ++roleGeneration;
  roleLoading.value = true;
  roleVerified.value = false;
  roleFailure.value = "";
  try {
    const result = await portal.client.publicRoles.get({
      roleId: props.roleId,
    });
    if (!active || ticket !== roleGeneration) return;
    if (
      roleUnavailable.value ||
      (confirmedRole.value &&
        JSON.stringify(confirmedRole.value) !== JSON.stringify(result))
    )
      roleChanged.value = true;
    role.value = result;
    roleUnavailable.value = false;
    roleVerified.value = true;
    if (!confirmedRole.value) confirmedRole.value = result;
    if (!openingId.value && !pending.value)
      openingId.value = result.openings.find((p) => p.is_default)?.id || "";
    remember();
  } catch (error) {
    if (!active || ticket !== roleGeneration) return;
    roleUnavailable.value = [403, 404].includes(errorStatus(error) || 0);
    roleFailure.value = roleUnavailable.value
      ? text.startRoleUnavailable
      : errorMessage(error);
  } finally {
    if (active && ticket === roleGeneration) roleLoading.value = false;
  }
}
async function loadPersonas(append = false) {
  const ticket = ++personaGeneration;
  personaLoading.value = true;
  personaVerified.value = false;
  personaFailure.value = "";
  const preferred =
    personaId.value || portal.account.value?.defaultPersonaId || "";
  try {
    const targetCount = append
      ? userResourcePolicy.personaPageSize
      : Math.max(userResourcePolicy.personaPageSize, loadedPersonaCount.value);
    const offset = append ? loadedPersonaCount.value : 0;
    const list = [];
    while (list.length < targetCount) {
      const limit = Math.min(
        apiCollectionPolicy.listMaxItems,
        targetCount - list.length,
      );
      const page = await portal.client.users.list({
        status: "active",
        limit,
        offset: offset + list.length,
        sortBy: "created_at",
        sortOrder: "asc",
      });
      list.push(...page);
      if (page.length < limit) break;
    }
    const result = await Promise.allSettled(
      list.map((p) => portal.client.users.getDetail({ userId: p.id })),
    );
    const details: UserDetail[] = [];
    for (const detail of result) {
      if (detail.status === "fulfilled" && detail.value.status === "active")
        details.push(detail.value);
      else if (
        detail.status === "rejected" &&
        errorStatus(detail.reason) !== 404
      )
        throw detail.reason;
    }
    if (preferred && !details.some((p) => p.id === preferred)) {
      try {
        const user = await portal.client.users.getDetail({ userId: preferred });
        if (user.status === "active") details.push(user);
      } catch (error) {
        if (![403, 404].includes(errorStatus(error) || 0)) throw error;
      }
    }
    if (!active || ticket !== personaGeneration) return;
    loadedPersonaCount.value = offset + list.length;
    more.value = list.length === targetCount;
    personas.value = append
      ? [
          ...new Map(
            [...personas.value, ...details].map((p) => [p.id, p]),
          ).values(),
        ]
      : details;
    const current = personas.value.find((p) => p.id === preferred);
    personaUnavailable.value = !!preferred && !current;
    if (current) {
      if (
        confirmedPersonaRevision.value !== null &&
        personaId.value === preferred &&
        current.revision !== confirmedPersonaRevision.value
      )
        personaChanged.value = true;
      if (confirmedPersonaRevision.value === null)
        confirmedPersonaRevision.value = current.revision;
      if (!personaId.value && !pending.value) personaId.value = preferred;
    }
    personaVerified.value = true;
    remember();
  } catch (error) {
    if (active && ticket === personaGeneration)
      personaFailure.value = errorMessage(error);
  } finally {
    if (active && ticket === personaGeneration) personaLoading.value = false;
  }
}
let refreshing: Promise<void> | null = null;
function refreshResources() {
  refreshing ??= Promise.all([loadRole(), loadPersonas()])
    .then(() => {})
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
function reconnected() {
  if (active && !busy.value) void refreshResources();
}
function disconnected() {
  roleVerified.value = false;
  personaVerified.value = false;
}
function confirmResources() {
  if (
    !roleVerified.value ||
    !personaVerified.value ||
    !selected.value ||
    !opening.value ||
    roleLoading.value ||
    personaLoading.value ||
    roleUnavailable.value ||
    personaUnavailable.value
  )
    return;
  confirmedPersonaRevision.value = selected.value.revision;
  confirmedRole.value = role.value;
  personaChanged.value = false;
  roleChanged.value = false;
  remember();
}
async function create(verify = false) {
  if (busy.value || !portal.online.value) return;
  if (!verify && !initializing.value && !canCreate.value) return;
  busy.value = true;
  failure.value = "";
  try {
    if (!verify && !initializing.value) {
      await refreshResources();
      if (
        !active ||
        !roleVerified.value ||
        !personaVerified.value ||
        !selected.value ||
        !opening.value ||
        personaUnavailable.value ||
        roleUnavailable.value ||
        needsConfirmation.value
      )
        return;
      creationInput.value = {
        userId: personaId.value,
        openingId: openingId.value,
        expectedUserRevision: selected.value.revision,
      };
    }
    pending.value = true;
    remember();
    const result = verify
      ? await portal.client.publicRoles.getSessionOperation({ operationId })
      : await portal.client.publicRoles.createSession({
          roleId: props.roleId,
          ...creationInput.value!,
          operationId,
        });
    if (!active) return;
    if (result.status === "complete") {
      pending.value = false;
      sessionStorage.removeItem(key);
      portal.go(`chat/${result.session.id}`);
    } else {
      initializing.value = true;
      failure.value = text.unknownCreate;
      remember();
    }
  } catch (error) {
    if (!active) return;
    failure.value = errorMessage(error);
    if (!isUncertainWrite(error)) {
      pending.value = false;
      initializing.value = false;
      creationInput.value = null;
      if (errorStatus(error) === 409) await refreshResources();
    }
    remember();
  } finally {
    if (active) busy.value = false;
  }
}
function createPersona() {
  remember();
  portal.go(
    `personas/new?return=${encodeURIComponent(`start/${props.roleId}`)}`,
  );
}
watch(personaId, () => {
  if (!pending.value) {
    operationId = createBrowserUuid();
    personaUnavailable.value = false;
    personaChanged.value = false;
    confirmedPersonaRevision.value = selected.value?.revision ?? null;
  }
  remember();
});
watch(openingId, () => {
  if (!pending.value) operationId = createBrowserUuid();
  remember();
});
function visible() {
  if (
    document.visibilityState === "visible" &&
    portal.online.value &&
    !busy.value
  )
    void refreshResources();
}
watch(
  () => portal.online.value,
  (online) => {
    if (online && !busy.value) void refreshResources();
    else if (!online) {
      roleVerified.value = false;
      personaVerified.value = false;
    }
  },
);
onMounted(async () => {
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pageshow", visible);
  window.addEventListener("online", reconnected);
  window.addEventListener("offline", disconnected);
  void loadRole();
  try {
    await portal.refreshIdentity();
  } catch (error) {
    if (active) personaFailure.value = errorMessage(error);
  }
  if (active) void loadPersonas();
});
onBeforeUnmount(() => {
  active = false;
  roleGeneration++;
  personaGeneration++;
  document.removeEventListener("visibilitychange", visible);
  window.removeEventListener("pageshow", visible);
  window.removeEventListener("online", reconnected);
  window.removeEventListener("offline", disconnected);
});
</script>
<template>
  <section>
    <a :href="`#role/${roleId}`" @click.prevent="portal.go(`role/${roleId}`)">{{
      text.back
    }}</a>
    <h1>
      {{ text.start }}<span v-if="role"> · {{ role.name }}</span>
    </h1>
    <div class="start-grid">
      <section class="surface">
        <h2>{{ text.choosePersona }}</h2>
        <p v-if="personaLoading" role="status">{{ text.loading }}</p>
        <div v-if="personaFailure" role="alert">
          <p>{{ personaFailure }}</p>
          <button @click="loadPersonas()">{{ text.retry }}</button>
        </div>
        <fieldset :disabled="busy || pending || personaLoading || roleLoading">
          <legend class="sr-only">{{ text.choosePersona }}</legend>
          <label v-for="persona in personas" :key="persona.id" class="choice"
            ><input
              v-model="personaId"
              type="radio"
              name="persona"
              :value="persona.id"
            /><span
              >{{ persona.name }}
              <small
                v-if="persona.id === portal.account.value?.defaultPersonaId"
                >{{ text.defaultPersona }}</small
              ></span
            ></label
          >
        </fieldset>
        <p v-if="personaUnavailable" role="alert">
          {{ text.startPersonaUnavailable }}
        </p>
        <p v-if="personaChanged" role="status">
          {{ text.startPersonaChanged }}
        </p>
        <p v-if="!personaLoading && !personaFailure && !personas.length">
          {{ text.startEmpty }}
        </p>
        <button
          v-if="more"
          :disabled="personaLoading"
          @click="loadPersonas(true)"
        >
          {{ text.more }}</button
        ><button :disabled="busy || pending" @click="createPersona">
          {{ text.createPersona }}
        </button>
        <details v-if="selected">
          <summary>{{ text.viewPersona }}</summary>
          <p class="prose">{{ selected.snapshot?.description }}</p>
        </details>
      </section>
      <section class="surface">
        <h2>{{ text.chooseOpening }}</h2>
        <p v-if="roleLoading" role="status">{{ text.loading }}</p>
        <div v-if="roleFailure" role="alert">
          <p>{{ roleFailure }}</p>
          <button @click="loadRole">{{ text.retry }}</button>
        </div>
        <fieldset :disabled="busy || pending || personaLoading || roleLoading">
          <legend class="sr-only">{{ text.chooseOpening }}</legend>
          <label v-for="item in role?.openings" :key="item.id" class="choice"
            ><input
              v-model="openingId"
              type="radio"
              name="opening"
              :value="item.id"
            /><span>{{ item.title }}</span></label
          >
        </fieldset>
        <p v-if="openingId && roleVerified && !opening" role="alert">
          {{ text.startOpeningUnavailable }}
        </p>
        <p v-if="roleChanged" role="status">{{ text.startRoleChanged }}</p>
        <details v-if="opening">
          <summary>{{ text.expand }}</summary>
          <p class="prose">{{ opening.display_text || opening.summary }}</p>
        </details>
      </section>
    </div>
    <button
      v-if="needsConfirmation && !pending"
      :disabled="
        busy ||
        roleLoading ||
        personaLoading ||
        !roleVerified ||
        !personaVerified ||
        !selected ||
        !opening ||
        roleUnavailable ||
        personaUnavailable
      "
      @click="confirmResources"
    >
      {{ text.confirmStartResources }}
    </button>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <p v-if="pending" role="status">{{ text.unknownCreate }}</p>
    <button
      v-if="pending"
      class="primary"
      :disabled="busy || !portal.online.value"
      @click="create(!initializing)"
    >
      {{
        busy
          ? text.loading
          : initializing
            ? text.resumeInitialization
            : text.verifyCreate
      }}</button
    ><button v-else class="primary" :disabled="!canCreate" @click="create()">
      {{ busy ? text.creatingSession : text.start }}
    </button>
  </section>
</template>
