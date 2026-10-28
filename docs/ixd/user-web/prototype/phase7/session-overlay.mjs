import { escape } from "./components.mjs";
export function createSessionOverlay(root) {
  let layer = null,
    trigger = null,
    dismiss = null;
  function close() {
    if (!layer) return;
    layer.remove();
    layer = null;
    root.firstElementChild?.removeAttribute("inert");
    if (trigger?.isConnected) trigger.focus();
    dismiss = null;
  }
  function open({ title, pageId, content, actions, onDismiss }) {
    const focus = trigger?.isConnected ? trigger : document.activeElement;
    close();
    trigger = focus;
    dismiss = onDismiss;
    root.firstElementChild?.setAttribute("inert", "");
    layer = document.createElement("div");
    layer.className = "uw-session-overlay";
    layer.innerHTML = `<section class="uw-session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" ${pageId ? `data-page-id="${pageId}"` : ""}><h2 id="session-dialog-title" tabindex="-1">${escape(title)}</h2><div class="uw-session-dialog-content">${content}</div><div class="uw-session-dialog-actions">${actions.map((a, i) => `<button class="uw-button ${a.danger ? "uw-danger" : ""}" data-session-choice="${i}" ${a.disabled ? "disabled" : ""}>${escape(a.label)}</button>`).join("")}</div></section>`;
    layer.addEventListener("click", (e) => {
      const b = e.target.closest("[data-session-choice]");
      if (b) actions[Number(b.dataset.sessionChoice)].run();
      else if (e.target === layer) requestClose();
    });
    layer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
      if (e.key === "Tab") {
        const f = [
          ...layer.querySelectorAll(
            "button:not(:disabled),input,textarea,a[href]",
          ),
        ];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    });
    root.append(layer);
    layer.querySelector("input,textarea,button")?.focus();
  }
  function requestClose() {
    if (dismiss) dismiss();
    else close();
  }
  return {
    open,
    close,
    requestClose,
    get element() {
      return layer;
    },
    get visible() {
      return !!layer;
    },
  };
}
