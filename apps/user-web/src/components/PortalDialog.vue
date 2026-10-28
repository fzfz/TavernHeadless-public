<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { createBrowserUuid } from "@tavern/shared";
import text from "../config/portal-ui.json";
const props = defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let trigger: HTMLElement | null = null;
const historyId = createBrowserUuid();
let mounted = false;
function requestClose() {
  if (!props.busy) emit("close");
}
function cancel(event: Event) {
  event.preventDefault();
  requestClose();
}
function outside(event: MouseEvent) {
  const rect = dialog.value?.getBoundingClientRect();
  if (
    rect &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    requestClose();
}
function back() {
  if (history.state?.userWebDialog === historyId) return;
  requestClose();
  queueMicrotask(() => {
    if (mounted && dialog.value?.open)
      history.pushState({ ...history.state, userWebDialog: historyId }, "");
  });
}
onMounted(() => {
  mounted = true;
  trigger = document.activeElement as HTMLElement;
  history.pushState({ ...history.state, userWebDialog: historyId }, "");
  window.addEventListener("popstate", back);
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  mounted = false;
  window.removeEventListener("popstate", back);
  dialog.value?.close();
  if (history.state?.userWebDialog === historyId) history.back();
  if (trigger?.isConnected) trigger.focus();
  else {
    const heading = document.querySelector<HTMLElement>("#main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
});
</script>
<template>
  <dialog
    ref="dialog"
    class="portal-dialog"
    aria-labelledby="dialog-title"
    @cancel="cancel"
    @click.self="outside"
  >
    <header>
      <h2 id="dialog-title">{{ title }}</h2>
      <button type="button" :disabled="busy" @click="emit('close')">
        {{ text.close }}
      </button>
    </header>
    <div class="dialog-content"><slot /></div>
    <footer><slot name="actions" /></footer>
  </dialog>
</template>
