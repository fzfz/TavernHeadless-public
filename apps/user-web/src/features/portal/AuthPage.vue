<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue";
import { createBrowserUuid, userIdentityPolicy } from "@tavern/shared";
import { isTavernApiError } from "@tavern/sdk";
import { portalKey, errorMessage, isUncertainWrite } from "./context.js";
import {
  readPendingRegistration,
  savePendingRegistration,
  clearPendingRegistration,
} from "./auth-registration.js";
import text from "../../config/portal-ui.json";
const props = defineProps<{ registering: boolean }>();
const portal = inject(portalKey)!;
const registration = ref(props.registering ? readPendingRegistration() : null);
const email = ref(
  registration.value?.email ||
    sessionStorage.getItem("user-web:auth-email") ||
    "",
);
const nickname = ref(
  registration.value?.name ||
    sessionStorage.getItem("user-web:auth-name") ||
    "",
);
const password = ref(""),
  confirmation = ref(""),
  showPassword = ref(false),
  showConfirmation = ref(false);
const busy = ref(false),
  checking = ref(false),
  failure = ref(""),
  pending = ref(Boolean(registration.value)),
  resolved = ref(""),
  form = ref<HTMLFormElement>();
const errors = reactive<Record<string, string>>({});
const passwordRule = computed(() =>
  text.passwordRule
    .replace("{min}", String(userIdentityPolicy.passwordMinLength))
    .replace("{max}", String(userIdentityPolicy.passwordMaxLength)),
);
let active = true;
function remember() {
  sessionStorage.setItem("user-web:auth-email", email.value);
  sessionStorage.setItem("user-web:auth-name", nickname.value);
}
function validate() {
  Object.keys(errors).forEach((key) => delete errors[key]);
  if (props.registering && !nickname.value.trim())
    errors.nickname = text.required;
  if (!email.value.trim()) errors.email = text.required;
  else if (
    !form.value?.querySelector<HTMLInputElement>("#auth-email")?.validity.valid
  )
    errors.email = text.invalidEmail;
  if (!password.value) errors.password = text.required;
  else if (
    props.registering &&
    (password.value.length < userIdentityPolicy.passwordMinLength ||
      password.value.length > userIdentityPolicy.passwordMaxLength)
  )
    errors.password = passwordRule.value;
  if (props.registering && confirmation.value !== password.value)
    errors.confirmation = text.passwordMismatch;
  nextTick(() =>
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
  return Object.keys(errors).length === 0;
}
function clearRegistration() {
  if (registration.value)
    clearPendingRegistration(registration.value.operationId);
  registration.value = null;
  pending.value = false;
}
function registered() {
  remember();
  clearRegistration();
  password.value = "";
  confirmation.value = "";
  portal.notice.value = text.registered;
  portal.go("auth");
}
async function checkRegistration() {
  const request = registration.value;
  if (busy.value || !request || !portal.online.value) return;
  busy.value = true;
  checking.value = true;
  failure.value = "";
  resolved.value = "";
  try {
    const result = await portal.client.auth.resolveRegistration({
      operationId: request.operationId,
    });
    if (!active) return;
    if (result.status === "created") registered();
    else {
      clearRegistration();
      resolved.value = text.registrationNotCreated;
    }
  } catch (error) {
    if (active) failure.value = errorMessage(error);
  } finally {
    if (active) {
      busy.value = false;
      checking.value = false;
    }
  }
}
async function checkIdentity() {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    await portal.refreshIdentity();
    if (
      portal.account.value?.email?.toLowerCase() ===
      email.value.trim().toLowerCase()
    )
      success();
    else pending.value = false;
  } catch (error) {
    if (active) failure.value = errorMessage(error);
  } finally {
    if (active) busy.value = false;
  }
}
function success() {
  const request = readPendingRegistration();
  if (request?.email.toLowerCase() === email.value.trim().toLowerCase())
    clearPendingRegistration(request.operationId);
  portal.notice.value = "";
  password.value = "";
  confirmation.value = "";
  const target = sessionStorage.getItem("user-web:return") || "account";
  sessionStorage.removeItem("user-web:return");
  portal.go(target);
}
async function submit() {
  if (busy.value || pending.value || !portal.online.value || !validate())
    return;
  remember();
  busy.value = true;
  failure.value = "";
  resolved.value = "";
  try {
    if (props.registering) {
      const request = {
        operationId: createBrowserUuid(),
        name: nickname.value.trim(),
        email: email.value.trim(),
      };
      savePendingRegistration(request);
      registration.value = request;
      pending.value = true;
      await portal.client.auth.register({
        ...request,
        password: password.value,
      });
      if (active) registered();
    } else {
      await portal.client.auth.login({
        email: email.value.trim(),
        password: password.value,
      });
      await portal.refreshIdentity();
      if (active) success();
    }
  } catch (error) {
    if (!active) return;
    failure.value = errorMessage(error);
    const uncertain =
      isUncertainWrite(error) ||
      (isTavernApiError(error) && error.code === "auth_registration_pending");
    if (props.registering) {
      if (!uncertain) clearRegistration();
    } else pending.value = uncertain;
  } finally {
    if (active) busy.value = false;
  }
}
function onSubmit(event: Event) {
  if ((event as KeyboardEvent).isComposing) return;
  void submit();
}
onMounted(() => {
  if (registration.value) void checkRegistration();
});
onBeforeUnmount(() => {
  active = false;
  remember();
  password.value = "";
  confirmation.value = "";
});
</script>
<template>
  <section class="auth-page">
    <a :href="registering ? '#auth' : '#discover'" @click="remember">{{
      registering ? text.backLogin : text.backDiscover
    }}</a>
    <div class="auth-card">
      <p class="brand">{{ text.brand }}</p>
      <h1>{{ registering ? text.register : text.auth }}</h1>
      <form
        ref="form"
        novalidate
        @submit.prevent="onSubmit"
        @keydown.enter="
          ($event.isComposing || $event.keyCode === 229) &&
          $event.preventDefault()
        "
      >
        <div v-if="registering" class="field">
          <label for="auth-name">{{ text.nickname }}</label
          ><input
            id="auth-name"
            v-model="nickname"
            autocomplete="nickname"
            :maxlength="userIdentityPolicy.nameMaxLength"
            :disabled="busy || (registering && pending)"
            :aria-invalid="!!errors.nickname"
            aria-describedby="name-error"
          />
          <p v-if="errors.nickname" id="name-error" class="error">
            {{ errors.nickname }}
          </p>
        </div>
        <div class="field">
          <label for="auth-email">{{ text.email }}</label
          ><input
            id="auth-email"
            v-model="email"
            type="email"
            autocomplete="username"
            :maxlength="userIdentityPolicy.emailMaxLength"
            :disabled="busy || (registering && pending)"
            :aria-invalid="!!errors.email"
            aria-describedby="email-error"
          />
          <p v-if="errors.email" id="email-error" class="error">
            {{ errors.email }}
          </p>
        </div>
        <div class="field">
          <label for="auth-password">{{ text.password }}</label>
          <div class="password-field">
            <input
              id="auth-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="registering ? 'new-password' : 'current-password'"
              :maxlength="userIdentityPolicy.passwordMaxLength"
              :disabled="busy || (registering && pending)"
              :aria-invalid="!!errors.password"
              aria-describedby="password-help password-error"
            /><button
              type="button"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? text.hidePassword : text.showPassword }}
            </button>
          </div>
          <small v-if="registering" id="password-help">{{
            passwordRule
          }}</small>
          <p v-if="errors.password" id="password-error" class="error">
            {{ errors.password }}
          </p>
        </div>
        <div v-if="registering" class="field">
          <label for="auth-confirmation">{{ text.confirmPassword }}</label>
          <div class="password-field">
            <input
              id="auth-confirmation"
              v-model="confirmation"
              :type="showConfirmation ? 'text' : 'password'"
              autocomplete="new-password"
              :disabled="busy || (registering && pending)"
              :aria-invalid="!!errors.confirmation"
              aria-describedby="confirmation-error"
            /><button
              type="button"
              :aria-pressed="showConfirmation"
              @click="showConfirmation = !showConfirmation"
            >
              {{
                showConfirmation ? text.hideConfirmation : text.showConfirmation
              }}
            </button>
          </div>
          <p v-if="errors.confirmation" id="confirmation-error" class="error">
            {{ errors.confirmation }}
          </p>
        </div>
        <p v-if="failure" role="alert" class="error">{{ failure }}</p>
        <p v-if="registering && pending" role="status">
          {{ text.registrationPending }}
        </p>
        <p v-if="resolved" role="status">{{ resolved }}</p>
        <button
          v-if="registering && pending"
          type="button"
          :disabled="busy || !portal.online.value"
          @click="checkRegistration"
        >
          {{ text.verifyRegister }}
        </button>
        <p v-if="!portal.online.value" role="status">{{ text.offline }}</p>
        <button
          v-if="pending && !registering"
          type="button"
          @click="checkIdentity"
        >
          {{ text.verifyIdentity }}
        </button>
        <a v-if="pending && registering" href="#auth">{{ text.goLogin }}</a>
        <button
          class="primary full"
          type="submit"
          :disabled="busy || pending || !portal.online.value"
        >
          {{
            checking
              ? text.checkingRegistration
              : busy
                ? registering
                  ? text.registering
                  : text.signingIn
                : registering
                  ? text.registerSubmit
                  : text.loginSubmit
          }}
        </button>
      </form>
      <a :href="registering ? '#auth' : '#register'" @click="remember">{{
        registering ? text.existingAccount : text.registerLink
      }}</a>
    </div>
  </section>
</template>
