export function createFrameDialog(root) {
  let layer = null,
    trigger = null,
    onClose = null;
  function close() {
    if (!layer) return;
    layer.remove();
    layer = null;
    root.firstElementChild?.removeAttribute("inert");
    if (trigger?.isConnected) trigger.focus();
    onClose?.();
    onClose = null;
  }
  function open({ title, content, actions, onDismiss }) {
    close();
    trigger = document.activeElement;
    onClose = onDismiss;
    root.firstElementChild?.setAttribute("inert", "");
    layer = document.createElement("div");
    layer.className = "uw-account-overlay uw-persona-overlay";
    layer.innerHTML = `<section class="uw-account-dialog" role="dialog" aria-modal="true" aria-labelledby="persona-dialog-title"><h2 id="persona-dialog-title">${title}</h2><div class="uw-dialog-copy">${content}</div><div class="uw-dialog-actions">${actions.map((a, i) => `<button type="button" class="uw-button ${a.danger ? "uw-danger" : ""}" data-choice="${i}">${a.label}</button>`).join("")}</div></section>`;
    layer.addEventListener("click", (event) => {
      const button = event.target.closest("[data-choice]");
      if (button) {
        const callback = actions[Number(button.dataset.choice)].run;
        close();
        callback();
      } else if (event.target === layer) close();
    });
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key === "Tab") {
        const buttons = [...layer.querySelectorAll("button")];
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons.at(-1).focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === buttons.at(-1)
        ) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    });
    root.append(layer);
    layer.querySelector("button").focus();
  }
  return {
    open,
    close,
    get visible() {
      return !!layer;
    },
  };
}
