import { createFrameDialog } from "./frame-dialog.mjs";
import { escape } from "./components.mjs";
import { createPersonaEditor } from "./persona-editor.mjs";
import { personaList } from "./persona-view.mjs";
import { desktopPersonaPage } from "./desktop.mjs";
import { mobilePersonaPage } from "./mobile.mjs";
import { reviewScope } from "./review.mjs";
const PAGE_SIZE = 2;
export function createPersonas({
  root,
  platform,
  profile,
  refresh,
  setDefault,
  write,
  remove,
  returnToStart,
  navigate,
  beforeMount,
}) {
  let current = "",
    owner = null,
    scenario = "normal",
    generation = 0,
    loaded = PAGE_SIZE,
    items = [],
    total = 0,
    defaultPersona = null,
    defaultName = "",
    loading = false,
    error = false,
    failedMore = false,
    defaultError = false,
    operation = null;
  const dialog = createFrameDialog(root);
  let anchor = null;
  const editor = createPersonaEditor({
    root,
    platform,
    profile,
    refresh,
    write,
    navigate,
    beforeMount,
    onReturn(id, source) {
      owner = profile().id;
      anchor = id;
      const index = profile().personas.findIndex((p) => p.id === id);
      if (index >= 0) loaded = Math.max(loaded, index + 1);
      persist();
      if (source.route.startsWith("start/")) returnToStart(source, id);
      else navigate("personas");
    },
  });
  const key = () => `tavern-phase7-personas-${owner}`;
  const offline = () => scenario === "offline" || !navigator.onLine;
  const feedback = (message) => {
    const el = root.querySelector("#persona-feedback");
    if (el) el.textContent = message;
  };
  function persist() {
    try {
      sessionStorage.setItem(
        key(),
        JSON.stringify({ loaded, operation, anchor }),
      );
    } catch {
      feedback("浏览器未能保存当前进度，请保持页面打开。");
    }
  }
  function mount(content, pageId, title) {
    root.innerHTML = (
      platform === "mobile" ? mobilePersonaPage : desktopPersonaPage
    )({ content, pageId, title });
  }
  function drawList() {
    const scroll = root.querySelector(".uw-scroll")?.scrollTop || 0;
    mount(
      personaList({
        items,
        total,
        defaultPersona,
        defaultName,
        loading,
        error,
        defaultError,
        offline: offline(),
        operation,
      }),
      platform === "mobile" ? "P10" : "P09",
      "演绎人格",
    );
    root.querySelector(".uw-scroll").scrollTop = scroll;
  }
  async function read(more = false) {
    const ticket = ++generation;
    loading = true;
    error = false;
    if (more) loaded += PAGE_SIZE;
    drawList();
    await new Promise((r) => setTimeout(r, scenario === "slow" ? 1200 : 100));
    if (ticket !== generation || current !== "personas") return;
    loading = false;
    if (scenario === "failure" || (scenario === "append-failure" && more)) {
      error = true;
      failedMore = more;
      if (more) loaded -= PAGE_SIZE;
      drawList();
      return;
    }
    const all = profile().personas;
    items = structuredClone(all.slice(0, loaded));
    total = all.length;
    defaultError = scenario === "default-failure";
    if (operation) {
      defaultPersona = operation.previous;
      defaultName = all.find((p) => p.id === defaultPersona)?.name || "";
    } else {
      defaultPersona = profile().defaultPersona;
      defaultName = all.find((p) => p.id === defaultPersona)?.name || "";
    }
    persist();
    drawList();
    if (anchor) {
      const el = root.querySelector(`#persona-${anchor}`);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
      anchor = null;
    }
  }
  function render(route) {
    if (editor.render(route)) {
      current = route;
      generation++;
      return true;
    }
    if (route !== "personas") {
      current = route;
      generation++;
      return false;
    }
    const entering = current !== route || owner !== profile().id;
    current = route;
    if (!profile().account) return false;
    if (owner !== profile().id) {
      owner = profile().id;
      items = [];
      total = 0;
      defaultPersona = null;
      defaultName = "";
      loaded = PAGE_SIZE;
      operation = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key()) || "{}");
        loaded = saved.loaded || PAGE_SIZE;
        operation = saved.operation || null;
        anchor = saved.anchor || null;
      } catch {}
    }
    beforeMount();
    scenario = reviewScope("personas");
    if (entering) void read();
    else drawList();
    return true;
  }
  async function changeDefault(id) {
    if (operation || offline()) return;
    operation = { kind: "default", target: id, previous: defaultPersona };
    persist();
    drawList();
    root.querySelector(`[data-persona-feedback="${id}"]`).textContent =
      "正在保存默认选择…";
    const ticket = ++generation,
      outcome = scenario;
    if (outcome !== "write-failure") setDefault(id);
    await new Promise((r) => setTimeout(r, outcome === "slow" ? 1200 : 120));
    if (ticket !== generation || current !== "personas") return;
    if (outcome === "write-failure") {
      operation = null;
      persist();
      drawList();
      feedback("默认人格保存失败，请重试。");
      return;
    }
    if (["unknown", "check-failure"].includes(outcome)) {
      drawList();
      feedback("默认选择尚未确认，请核对默认选择。");
      return;
    }
    await verify();
  }
  async function verify() {
    if (offline() || scenario === "check-failure") {
      feedback("操作结果读取失败，请检查连接后重试。");
      return;
    }
    const action = operation;
    refresh();
    if (profile().id !== owner) {
      current = "";
      navigate("personas");
      return;
    }
    const succeeded =
      action?.kind === "delete"
        ? !profile().personas.some((p) => p.id === action.target)
        : profile().defaultPersona === action?.target;
    operation = null;
    persist();
    await read();
    feedback(
      succeeded
        ? action?.kind === "delete"
          ? "人格已删除。"
          : "默认人格已更新。"
        : "操作尚未完成，请重新提交。",
    );
    root
      .querySelector(`#persona-${action?.target}`)
      ?.focus({ preventScroll: true });
  }
  function confirmDelete(id) {
    if (offline() || operation) return;
    refresh();
    const item = profile().personas.find((p) => p.id === id);
    if (!item) {
      void read();
      return;
    }
    const next = profile().personas.find((p) => p.id !== id),
      isDefault = profile().defaultPersona === id;
    dialog.open({
      title: "删除人格？",
      content: `<p>${escape(item.name)}${isDefault ? " · 默认人格" : ""}</p><p>已有演绎会保留各自保存的人设。</p>${isDefault ? `<p>${next ? "删除后默认人格为" + escape(next.name) + "。" : "之后开始演绎时，需要先创建人格。"}</p>` : ""}`,
      actions: [
        { label: "取消", run() {} },
        { label: "删除人格", danger: true, run: () => void deleteItem(id) },
      ],
    });
  }
  async function deleteItem(id) {
    operation = { kind: "delete", target: id, previous: defaultPersona };
    persist();
    drawList();
    feedback("正在删除人格…");
    const outcome = scenario,
      ticket = ++generation;
    if (outcome !== "write-failure") remove(id);
    await new Promise((r) => setTimeout(r, outcome === "slow" ? 1200 : 120));
    if (ticket !== generation || current !== "personas") return;
    if (outcome === "write-failure") {
      operation = null;
      persist();
      drawList();
      feedback("人格删除失败，请重试。");
      return;
    }
    if (["unknown", "check-failure"].includes(outcome)) {
      drawList();
      feedback("删除结果尚未确认，请核对删除结果。");
      return;
    }
    const oldIndex = items.findIndex((p) => p.id === id);
    await verify();
    const next = items[Math.min(oldIndex, items.length - 1)];
    if (next) root.querySelector(`#persona-${next.id}`)?.focus();
    else root.querySelector('a[href="#personas/new"]')?.focus();
  }
  root.addEventListener("click", (e) => {
    if (current === "personas") {
      const card = e.target.closest("[data-persona-card]");
      if (card) {
        anchor = card.dataset.personaCard;
        persist();
      }
    }
    const b = e.target.closest("[data-persona]");
    if (!b || current !== "personas") return;
    const action = b.dataset.persona;
    if (action === "delete") confirmDelete(b.dataset.id);
    if (action === "default") void changeDefault(b.dataset.id);
    if (action === "verify") void verify();
    if (action === "more") void read(true);
    if (action === "retry-list" || action === "retry-default") {
      scenario = "normal";
      document.querySelector("#review-scenario").value = "normal";
      const append = action === "retry-list" && failedMore;
      failedMore = false;
      void read(append);
    }
  });
  document.querySelector("#review-scenario").addEventListener("change", (e) => {
    if (current !== "personas") return;
    scenario = e.target.value;
    if (["normal", "slow", "failure", "default-failure"].includes(scenario))
      void read();
    else drawList();
  });
  function refreshVisible(event) {
    if (
      current !== "personas" ||
      (event.type === "visibilitychange" &&
        document.visibilityState === "hidden")
    )
      return;
    refresh();
    if (profile().id !== owner) {
      dialog.close();
      current = "";
      navigate("personas");
      return;
    }
    void read();
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("online", refreshVisible);
  addEventListener("offline", () => {
    if (current === "personas") drawList();
  });
  return {
    render,
    suspend() {
      current = "";
      generation++;
      editor.suspend();
      dialog.close();
    },
    guard(next, proceed) {
      if (dialog.visible) {
        dialog.close();
        return true;
      }
      return editor.guard(next, proceed);
    },
    clearDrafts() {
      editor.clearDrafts(profile().id);
      if (owner) sessionStorage.removeItem(key());
    },
  };
}
