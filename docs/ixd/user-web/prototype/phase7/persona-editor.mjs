import fields from "./persona-fields.json" with { type: "json" };
import { escape } from "./components.mjs";
import { personaEditorView, personaAction } from "./persona-view.mjs";
import { desktopPersonaPage } from "./desktop.mjs";
import { mobilePersonaPage } from "./mobile.mjs";
import { reviewScope } from "./review.mjs";
import { createFrameDialog } from "./frame-dialog.mjs";
const equal = (a, b) =>
  a?.name === b?.name && a?.description === b?.description;
const valuesOf = (p) => ({
  name: p?.name || "",
  description: p?.description || "",
});
export function createPersonaEditor({
  root,
  platform,
  profile,
  refresh,
  write,
  navigate,
  beforeMount,
  onReturn,
}) {
  let current = "",
    owner = null,
    target = null,
    mode = "create",
    base = null,
    draft = { name: "", description: "" },
    source = { route: "personas" },
    operation = null,
    scenario = "normal",
    pending = false,
    loading = false,
    missing = false,
    failed = false,
    conflict = false,
    allowLeave = false,
    sequence = 0,
    notice = "";
  const dialog = createFrameDialog(root);
  const active = () =>
    current.startsWith("personas/new") || current.startsWith("personas/edit/");
  const key = () => `tavern-phase7-persona-editor:${owner}:${current}`;
  const record = () => profile().personas.find((p) => p.id === target);
  const dirty = () =>
    mode === "create"
      ? !!(draft.name || draft.description)
      : !!base && !equal(draft, base);
  const offline = () => scenario === "offline" || !navigator.onLine;
  const feedback = (text) => {
    const el = root.querySelector("#persona-editor-feedback");
    if (el) el.textContent = text;
  };
  function persist() {
    try {
      sessionStorage.setItem(
        key(),
        JSON.stringify({ base, draft, source, operation }),
      );
    } catch {
      feedback("浏览器未能保存草稿，请保持页面打开。");
    }
  }
  function clear() {
    try {
      sessionStorage.removeItem(key());
    } catch {}
  }
  function resize() {
    const el = root.querySelector("textarea");
    if (el) {
      const height = el.scrollTop;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
      el.scrollTop = height;
    }
  }
  function submitState() {
    const b = root.querySelector('#persona-editor-form button[type="submit"]');
    if (b)
      b.disabled =
        pending ||
        !!operation ||
        conflict ||
        missing ||
        loading ||
        failed ||
        (mode === "edit" && !dirty());
  }
  function recovery() {
    feedback("保存结果尚未确认，请先核对保存结果。");
    root.querySelector("#persona-editor-recovery").innerHTML = personaAction(
      "核对保存结果",
      "verify-save",
    );
    submitState();
  }
  function draw() {
    const back = source.route,
      backLabel = back === "personas" ? "返回人格列表" : "返回开始演绎";
    const content = personaEditorView({
      mode,
      values: draft,
      fields,
      back,
      backLabel,
      notice,
      loading,
      missing,
      failed,
      canRead: !!base,
    });
    root.innerHTML = (
      platform === "mobile" ? mobilePersonaPage : desktopPersonaPage
    )({
      content,
      pageId: mode === "create" ? "P11" : "P12",
      title: mode === "create" ? "创建演绎人格" : "编辑演绎人格",
      back,
      backLabel,
    });
    resize();
    submitState();
    if (!loading && !missing && !failed) {
      if (operation) recovery();
      else if (offline()) feedback("当前离线，草稿已保留；连接网络后可保存。");
      else if (mode === "edit" && !dirty()) feedback("资料尚未修改");
    }
  }
  function showConflict(saved) {
    conflict = true;
    submitState();
    root.querySelector("#persona-conflict").innerHTML =
      `<section class="uw-persona-conflict" role="region" aria-label="人格资料已变化"><h2>人格资料已变化</h2><h3>当前已保存资料</h3><p>${escape(saved.name)}</p><pre>${escape(saved.description)}</pre><h3>你的草稿</h3><p>${escape(draft.name)}</p><pre>${escape(draft.description)}</pre><div class="uw-form-actions">${personaAction("继续编辑草稿", "keep-draft")}${personaAction("使用已保存资料", "use-saved")}</div></section>`;
    feedback("请先选择要继续编辑的资料。");
  }
  async function read() {
    const ticket = ++sequence;
    loading = true;
    draw();
    await new Promise((r) => setTimeout(r, scenario === "slow" ? 1200 : 100));
    if (ticket !== sequence || !active()) return;
    loading = false;
    failed = scenario === "failure";
    if (failed) {
      draw();
      return;
    }
    const saved = record();
    missing = mode === "edit" && !saved;
    if (missing) {
      draw();
      return;
    }
    if (mode === "edit" && !base) {
      base = valuesOf(saved);
      draft = { ...base };
    }
    draw();
    if (mode === "edit" && base && !equal(base, valuesOf(saved)))
      showConflict(valuesOf(saved));
  }
  function render(route) {
    const valid = /^personas\/(new(?:\?|$)|edit\/)/.test(route);
    if (!valid) {
      if (active()) {
        persist();
        sequence++;
        dialog.close();
      }
      current = "";
      return false;
    }
    if (!profile().account) return false;
    if (current === route && owner === profile().id) return true;
    sequence++;
    current = route;
    owner = profile().id;
    target = route.startsWith("personas/edit/") ? route.split("/")[2] : null;
    mode = target ? "edit" : "create";
    base = null;
    draft = { name: "", description: "" };
    operation = null;
    pending = false;
    missing = false;
    failed = false;
    conflict = false;
    notice = "";
    const query = new URLSearchParams(route.split("?")[1] || "");
    const from = query.get("from");
    source = {
      route: from?.startsWith("start/") ? from : "personas",
      opening: Number(query.get("opening") || 0),
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) || "null");
      if (saved) {
        base = saved.base;
        draft = saved.draft;
        source = saved.source;
        operation = saved.operation;
        notice = "已恢复当前账号的人格草稿。";
      }
    } catch {}
    beforeMount();
    scenario = reviewScope("persona-editor");
    if (mode === "edit") void read();
    else {
      loading = false;
      draw();
    }
    return true;
  }
  function guard(next, proceed) {
    if (allowLeave) {
      allowLeave = false;
      return false;
    }
    if (!active() || next === current) return false;
    if (dialog.visible) {
      dialog.close();
      return true;
    }
    if (!dirty() && !operation) {
      if (next === source.route && source.route.startsWith("start/")) {
        current = "";
        allowLeave = true;
        onReturn(null, source);
        return true;
      }
      return false;
    }
    const leave = () => {
      if (next === source.route && source.route.startsWith("start/")) {
        current = "";
        onReturn(null, source);
      } else proceed();
    };
    dialog.open({
      title: "离开人格编辑？",
      content: "<p>你可以保留当前账号在此标签页中的草稿，之后继续填写。</p>",
      actions: [
        { label: "继续填写", run() {} },
        {
          label: "保留草稿并离开",
          run() {
            persist();
            allowLeave = true;
            leave();
          },
        },
        {
          label: "放弃草稿并离开",
          run() {
            if (operation) {
              draft = { ...operation.values };
              persist();
            } else clear();
            draft = base ? { ...base } : { name: "", description: "" };
            current = "";
            allowLeave = true;
            leave();
          },
        },
      ],
    });
    return true;
  }
  function validate() {
    for (const [name, spec] of Object.entries(fields)) {
      const el = root.querySelector(`[name="${name}"]`),
        error = root.querySelector(`#persona-${name}-error`);
      el.removeAttribute("aria-invalid");
      error.textContent = "";
      if (!draft[name].trim()) {
        error.textContent = `请填写${spec.label}。`;
        el.setAttribute("aria-invalid", "true");
        el.focus();
        el.scrollIntoView({ block: "nearest" });
        return false;
      }
    }
    return true;
  }
  function finish(id) {
    clear();
    operation = null;
    draft = base ? { ...base } : { name: "", description: "" };
    allowLeave = true;
    const origin = source;
    current = "";
    onReturn(id, origin);
  }
  async function save() {
    if (pending || operation || conflict || loading || failed || !validate())
      return;
    if (offline()) {
      feedback("当前离线，请连接网络后再保存人格。");
      return;
    }
    const priorOwner = owner;
    refresh();
    if (profile().id !== priorOwner) {
      pending = false;
      current = "";
      navigate("personas");
      return;
    }
    if (mode === "edit") {
      const saved = record();
      if (!saved) {
        missing = true;
        persist();
        draw();
        return;
      }
      if (!equal(base, valuesOf(saved))) {
        showConflict(valuesOf(saved));
        return;
      }
    }
    const value = {
        name: draft.name.trim(),
        description: draft.description.trim(),
      },
      outcome = scenario,
      ticket = ++sequence;
    pending = true;
    root
      .querySelectorAll(
        "#persona-editor-form input,#persona-editor-form textarea,#persona-editor-form button",
      )
      .forEach((el) => (el.disabled = true));
    feedback("正在保存人格…");
    root.querySelector("form").setAttribute("aria-busy", "true");
    if (outcome !== "write-failure") {
      const id = write(value, target);
      operation = { id, values: value };
      persist();
    }
    await new Promise((r) => setTimeout(r, outcome === "slow" ? 1200 : 120));
    if (ticket !== sequence || !active()) return;
    pending = false;
    root
      .querySelectorAll(
        "#persona-editor-form input,#persona-editor-form textarea,#persona-editor-form button",
      )
      .forEach((el) => (el.disabled = false));
    root.querySelector("form").setAttribute("aria-busy", "false");
    if (outcome === "write-failure") {
      feedback("人格保存失败，输入已保留，请重试。");
      submitState();
      return;
    }
    if (["unknown", "check-failure"].includes(outcome)) {
      recovery();
      return;
    }
    finish(operation.id);
  }
  function verify() {
    if (!operation) return;
    if (offline() || scenario === "check-failure") {
      feedback("保存结果读取失败，请检查连接后重试。");
      return;
    }
    refresh();
    if (profile().id !== owner) {
      current = "";
      navigate("personas");
      return;
    }
    const saved = profile().personas.find((p) => p.id === operation.id);
    if (saved && equal(valuesOf(saved), operation.values)) finish(operation.id);
    else if (saved) {
      operation = null;
      base = valuesOf(saved);
      persist();
      showConflict(valuesOf(saved));
    } else {
      operation = null;
      persist();
      root.querySelector("#persona-editor-recovery").innerHTML = "";
      feedback("尚未保存人格，请重新提交。");
      submitState();
    }
  }
  root.addEventListener("input", (e) => {
    if (!active() || !["name", "description"].includes(e.target.name)) return;
    draft[e.target.name] = e.target.value;
    persist();
    if (!operation && !conflict)
      feedback(mode === "edit" && !dirty() ? "资料尚未修改" : "");
    e.target.removeAttribute("aria-invalid");
    root.querySelector(`#persona-${e.target.name}-error`).textContent = "";
    submitState();
    if (e.target.name === "description") resize();
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "persona-editor-form") {
      e.preventDefault();
      void save();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (!active() || e.isComposing) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    } else if (
      e.key === "Enter" &&
      e.target.tagName !== "TEXTAREA" &&
      e.target.tagName !== "BUTTON"
    ) {
      e.preventDefault();
    }
  });
  root.addEventListener("click", (e) => {
    if (!active()) return;
    const action = e.target.closest("[data-persona]")?.dataset.persona;
    if (action === "reload") {
      scenario = "normal";
      document.querySelector("#review-scenario").value = "normal";
      void read();
    }
    if (action === "verify-save") verify();
    if (action === "keep-draft" || action === "use-saved") {
      base = valuesOf(record());
      if (action === "use-saved") draft = { ...base };
      conflict = false;
      persist();
      draw();
      root.querySelector('[name="name"]').focus();
    }
  });
  document.querySelector("#review-scenario").addEventListener("change", (e) => {
    if (!active()) return;
    scenario = e.target.value;
    if (
      ["failure", "normal"].includes(scenario) &&
      mode === "edit" &&
      !dirty() &&
      !operation
    )
      void read();
    else feedback(offline() ? "当前离线，草稿已保留；连接网络后可保存。" : "");
  });
  function clearOwnedDrafts(id) {
    try {
      for (const k of Object.keys(sessionStorage))
        if (k.startsWith(`tavern-phase7-persona-editor:${id}:`))
          sessionStorage.removeItem(k);
    } catch {}
  }
  function refreshVisible(event) {
    if (
      !active() ||
      (event.type === "visibilitychange" &&
        document.visibilityState === "hidden")
    )
      return;
    refresh();
    if (profile().id !== owner) {
      clearOwnedDrafts(owner);
      pending = false;
      sequence++;
      dialog.close();
      current = "";
      navigate("personas");
      return;
    }
    if (mode === "edit") {
      const saved = record();
      if (!saved) {
        missing = true;
        persist();
        draw();
      } else if (
        base &&
        !equal(base, valuesOf(saved)) &&
        !pending &&
        !operation
      ) {
        if (dirty()) showConflict(valuesOf(saved));
        else {
          base = valuesOf(saved);
          draft = { ...base };
          draw();
        }
      }
    }
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("online", refreshVisible);
  addEventListener("offline", () => {
    if (active()) feedback("当前离线，草稿已保留；连接网络后可保存。");
  });
  addEventListener("beforeunload", (e) => {
    if (active() && (dirty() || operation)) {
      persist();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  return {
    render,
    guard,
    suspend() {
      if (active()) {
        persist();
        current = "";
        sequence++;
        dialog.close();
      }
    },
    clearDrafts(id) {
      clearOwnedDrafts(id);
      current = "";
      dialog.close();
    },
  };
}
