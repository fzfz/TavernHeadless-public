import { ref } from "vue";

export function useRoleNavigation(options: {
  resourceDirty: () => boolean;
  configurationDirty: () => boolean;
}) {
  const pendingNavigation = ref<() => void>();
  const discardsConfiguration = ref(false);
  function navigate(action: () => void, replaceConfiguration = false) {
    discardsConfiguration.value =
      replaceConfiguration && options.configurationDirty();
    if (options.resourceDirty() || discardsConfiguration.value) {
      pendingNavigation.value = action;
    } else action();
  }
  function cancelNavigation() {
    pendingNavigation.value = undefined;
    discardsConfiguration.value = false;
  }
  function discardAndNavigate() {
    const action = pendingNavigation.value;
    cancelNavigation();
    action?.();
  }
  return {
    pendingNavigation,
    discardsConfiguration,
    navigate,
    cancelNavigation,
    discardAndNavigate,
  };
}
