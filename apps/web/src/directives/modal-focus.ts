import type { ObjectDirective } from "vue";

const sessions = new WeakMap<
  HTMLElement,
  { trigger: HTMLElement | null; keydown: (event: KeyboardEvent) => void }
>();
function controls(element: HTMLElement) {
  return Array.from(
    element.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], summary, [tabindex]",
    ),
  ).filter(
    (item) =>
      item.tabIndex >= 0 &&
      !item.matches(":disabled, [hidden]") &&
      item.getClientRects().length > 0,
  );
}
export const vModalFocus: ObjectDirective<HTMLElement, () => void> = {
  beforeMount(element, binding) {
    element.tabIndex = -1;
    const trigger = element.ownerDocument.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        binding.value();
      } else if (event.key === "Tab") {
        const items = controls(element);
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          element.focus();
          return;
        }
        const active = element.ownerDocument.activeElement;
        if (event.shiftKey && (active === first || active === element)) {
          event.preventDefault();
          last!.focus();
        } else if (!event.shiftKey && (active === last || active === element)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    sessions.set(element, { trigger, keydown });
    element.addEventListener("keydown", keydown);
  },
  mounted(element) {
    if (element.tagName !== "DIALOG") (controls(element)[0] ?? element).focus();
  },
  unmounted(element) {
    const session = sessions.get(element)!;
    element.removeEventListener("keydown", session.keydown);
    sessions.delete(element);
    if (session.trigger?.isConnected) session.trigger.focus();
  },
};
