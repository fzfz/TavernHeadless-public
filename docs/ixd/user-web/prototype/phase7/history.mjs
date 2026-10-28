import { config } from "../data.mjs";
import { nav } from "./components.mjs";
import { desktopPersonaPage } from "./desktop.mjs";
import { mobilePersonaPage } from "./mobile.mjs";
import { createFrameDialog } from "./frame-dialog.mjs";
import { reviewScope } from "./review.mjs";
import { historyList, historyDeleteView } from "./history-view.mjs";
import fields from "./session-fields.json" with { type: "json" };
export { historyScenarios } from "./history-view.mjs";

const PAGE_SIZE = 4;

export function createHistory({ root, platform, profile, refresh, navigate, beforeMount, rename, remove, isRunning = () => false }) {
  let active = false, owner = null, generation = 0, scenario = "normal";
  let loaded = PAGE_SIZE, query = "", searchDraft = "", selected = new Set(), managed = false;
  let items = [], total = null, loading = false, error = false, failedMore = false, feedback = "";
  let editor = null, drafts = {}, operation = null, menu = null, anchor = null;
  let showDelete = false, deleteTrigger = null, composing = false, allowLeave = false;
  const leaveDialog = createFrameDialog(root);
  const key = (id = owner) => `tavern-phase7-history-${id}`;
  const offline = () => scenario === "offline" || !navigator.onLine;
  const owned = () => active && profile().account && profile().id === owner;
  const row = (id) => [...root.querySelectorAll("[data-history-row]")].find((el) => el.dataset.historyRow === id);
  const focusRow = (id) => { const el = row(id); el?.scrollIntoView({ block: "nearest" }); el?.focus({ preventScroll: true }); };
  const delay = () => new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 1200 : 100));

  const titleKey = (id, account = owner) => `tavern-phase7-title:${account}:${id}`;
  function loadDrafts() {
    const restored = {};
    const prefix = titleKey("");
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (!key.startsWith(prefix)) continue;
        const value = JSON.parse(sessionStorage.getItem(key));
        if (typeof value?.value === "string" && typeof value?.base === "string") restored[key.slice(prefix.length)] = { title: value.value, base: value.base, error: "", conflict: false };
      }
    } catch { feedback = "标题草稿读取失败，请保持页面打开。"; }
    drafts = restored;
    if (editor && !drafts[editor]) editor = null;
  }
  function removeDraft(id) {
    delete drafts[id];
    try { sessionStorage.removeItem(titleKey(id)); } catch {}
  }

  function clearOwnedDrafts(id) {
    try {
      sessionStorage.removeItem(key(id));
      const prefix = titleKey("", id);
      for (const storageKey of Object.keys(sessionStorage)) if (storageKey.startsWith(prefix)) sessionStorage.removeItem(storageKey);
    } catch {}
  }

  function persist() {
    if (!owner) return;
    try {
      sessionStorage.setItem(key(), JSON.stringify({ loaded, query, searchDraft, selected: [...selected], managed, editor, operation, anchor }));
      for (const [id, draft] of Object.entries(drafts)) sessionStorage.setItem(titleKey(id), JSON.stringify({ value: draft.title, base: draft.base }));
    } catch { feedback = "浏览器未能保存当前进度，请保持页面打开。"; }
  }

  function restore(id) {
    owner = id;
    loaded = PAGE_SIZE; query = ""; searchDraft = ""; selected = new Set(); managed = false;
    items = []; total = null; drafts = {}; editor = null; operation = null; anchor = null;
    error = false; failedMore = false; feedback = ""; menu = null; showDelete = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) || "{}");
      loaded = saved.loaded || PAGE_SIZE; query = saved.query || ""; searchDraft = saved.searchDraft || "";
      selected = new Set(saved.selected || []); managed = !!saved.managed;
      editor = saved.editor || null; operation = saved.operation || null; anchor = saved.anchor || null;
      if (operation?.status === "saving") {
        operation.status = "unknown";
        if (operation.kind === "delete") for (const id of Object.keys(operation.outcomes)) if (operation.outcomes[id] === "saving") operation.outcomes[id] = "unknown";
      }
      if (operation?.kind === "delete" && operation.status === "review") operation = null;
    } catch {}
  }

  function records() {
    const source = scenario === "empty" ? [] : structuredClone(profile().sessions || []);
    if (operation?.kind === "delete") {
      for (const target of operation.targets) {
        if (["unknown", "saving"].includes(operation.outcomes[target.id]) && !source.some((item) => item.id === target.id)) source.push(structuredClone(target));
      }
    }
    if (operation?.kind === "rename") {
      const target = source.find((item) => item.id === operation.id);
      if (target) target.title = operation.previous;
    }
    return source.sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt))).map((item) => {
      const date = new Date(item.updatedAt);
      return { ...item, characterName: config.cards.find((c) => c.id === item.cardId)?.name || item.characterName || "角色资料暂不可用", updatedAt: Number.isNaN(date.valueOf()) ? "" : date.toISOString(), fullTime: Number.isNaN(date.valueOf()) ? "更新时间暂不可用" : date.toLocaleString("zh-CN", { hour12: false }) };
    });
  }

  function updateFromSource() {
    const all = records();
    for (const [id, draft] of Object.entries(drafts)) {
      if (operation?.kind === "rename" && operation.id === id) continue;
      const saved = all.find((item) => item.id === id);
      if (saved && saved.title !== draft.base) { draft.conflict = true; draft.saved = saved.title; }
      if (!saved && editor === id) { editor = null; feedback = "正在编辑的演绎已不存在，标题草稿仍保存在当前标签页。"; }
    }
    const keyword = query.toLocaleLowerCase();
    const matching = all.filter((item) => !keyword || [item.title, item.characterName, item.persona?.name].some((value) => String(value || "").toLocaleLowerCase().includes(keyword)));
    total = matching.length; items = matching.slice(0, loaded);
    const valid = new Set(matching.filter((item) => !isRunning(item.id)).map((item) => item.id));
    const previousSize = selected.size;
    selected = new Set([...selected].filter((id) => valid.has(id)));
    if (previousSize > selected.size) feedback = `已取消选择 ${previousSize - selected.size} 条已失效或正在生成的演绎记录。`;
    persist();
  }

  function draw() {
    if (!owned()) return;
    const previousFocus = root.contains(document.activeElement) ? document.activeElement : null;
    const focus = previousFocus ? { ...previousFocus.dataset, id: previousFocus.id } : null;
    const scroll = root.querySelector(".uw-scroll")?.scrollTop || 0;
    const deleteScroll = root.querySelector(".uw-history-delete-dialog .uw-dialog-copy")?.scrollTop || 0;
    root.innerHTML = (platform === "mobile" ? mobilePersonaPage : desktopPersonaPage)({
      content: historyList({ items, total, loaded, query, searchDraft, selected, managed, mobile: platform === "mobile", loading, error, failedMore, offline: offline(), feedback, editor, drafts, operation, menu, running: isRunning }),
      pageId: platform === "mobile" ? "P16" : "P15", title: "历史演绎",
    });
    const navigation = root.querySelector('nav[aria-label="主导航"]');
    if (navigation) navigation.outerHTML = nav("history");
    if (platform === "mobile") {
      root.querySelector(".uw-mobile-header").innerHTML = "<span>Tavern.</span><span>历史演绎</span>";
      const footer = document.createElement("footer"); footer.className = "uw-bottom-nav"; footer.innerHTML = nav("history"); root.firstElementChild.append(footer);
    }
    root.firstElementChild.classList.add("uw-history-page");
    root.querySelector(".uw-scroll").scrollTop = scroll;
    const eligible = items.filter((item) => !isRunning(item.id));
    const master = root.querySelector('[data-history-select="loaded"]');
    if (master) master.indeterminate = eligible.some((item) => selected.has(item.id)) && !eligible.every((item) => selected.has(item.id));
    if (showDelete && operation?.kind === "delete") {
      root.firstElementChild.setAttribute("inert", "");
      const layer = document.createElement("div"); layer.className = "uw-account-overlay uw-persona-overlay uw-history-delete-layer";
      layer.innerHTML = historyDeleteView(operation, offline()); root.append(layer);
      layer.querySelector(".uw-dialog-copy").scrollTop = deleteScroll;
    }
    if (focus) {
      let next;
      if (focus.historySelect) next = [...root.querySelectorAll("[data-history-select]")].find((el) => el.dataset.historySelect === focus.historySelect && (el.dataset.id || "") === (previousFocus.dataset.id || ""));
      if (focus.history) next = [...root.querySelectorAll("[data-history]")].find((el) => el.dataset.history === focus.history && el.dataset.id === previousFocus.dataset.id);
      if (focus.id) next = [...root.querySelectorAll("[id]")].find((el) => el.id === focus.id);
      if (next && !next.disabled && !next.closest("[inert]")) next.focus({ preventScroll: true });
      else if (showDelete) root.querySelector('[data-history="close-delete"]')?.focus();
    }
  }

  async function read(more = false) {
    const ticket = ++generation, requestedOwner = owner;
    loading = true; error = false; menu = null; draw();
    await delay();
    if (ticket !== generation || !owned() || owner !== requestedOwner) return;
    loading = false;
    if (scenario === "failure" || (more && scenario === "append-failure")) {
      error = true; failedMore = more; draw(); return;
    }
    if (more) loaded += PAGE_SIZE;
    failedMore = false; updateFromSource(); draw();
    if (anchor) { focusRow(anchor); anchor = null; persist(); }
  }

  function render(route) {
    if (route !== "history") { if (active) { active = false; generation++; } return false; }
    if (!profile().account) return false;
    const entering = !active || owner !== profile().id;
    if (owner !== profile().id) restore(profile().id);
    active = true; beforeMount(); scenario = reviewScope("history");
    if (entering) {
      loadDrafts();
      if (operation && operation.status !== "review") void verify(false);
      else void read();
    } else draw();
    return true;
  }

  function applySearch(clear = false) {
    if (composing) return;
    searchDraft = clear ? "" : searchDraft; const next = searchDraft.trim();
    if (query !== next || clear) { query = next; loaded = PAGE_SIZE; selected.clear(); items = []; total = null; editor = null; }
    document.activeElement?.blur(); feedback = ""; persist(); void read();
  }

  function closeMenu(focus = true) {
    const id = menu; menu = null;
    root.querySelector('[role="menu"]')?.remove();
    const button = row(id)?.querySelector('[data-history="menu"]'); button?.setAttribute("aria-expanded", "false");
    if (focus) button?.focus();
  }

  function beginRename(id) {
    if (operation) return;
    const item = items.find((value) => value.id === id); if (!item) return;
    if (editor && editor !== id) persist();
    drafts[id] ||= { title: item.title, base: item.title, error: "", conflict: false };
    editor = id; menu = null; updateFromSource(); persist(); draw();
    const input = row(id)?.querySelector('input[name="title"]'); input?.focus(); input?.select(); input?.scrollIntoView({ block: "nearest" });
  }

  function cancelRename(id) {
    if (operation?.kind === "rename" && operation.id === id) return;
    removeDraft(id); editor = null; persist(); draw(); row(id)?.querySelector('[data-history="menu"]')?.focus();
  }

  async function saveTitle(id) {
    if (!owned() || operation || offline() || composing || !drafts[id]) return;
    refresh(); if (!owned()) return;
    const draft = drafts[id], current = profile().sessions.find((item) => item.id === id);
    if (!current) { feedback = "此演绎已不存在。"; editor = null; updateFromSource(); draw(); return; }
    if (current.title !== draft.base) { draft.conflict = true; draft.saved = current.title; persist(); draw(); return; }
    if (draft.conflict) return;
    const title = draft.title.trim();
    if (!title || title.length > fields.title.maxLength) {
      draft.error = !title ? "请填写演绎标题。" : `演绎标题最多 ${fields.title.maxLength} 个字符。`; persist(); draw(); row(id)?.querySelector('input[name="title"]')?.focus(); return;
    }
    if (title === current.title) { cancelRename(id); return; }
    draft.error = "";
    const outcome = scenario, token = ++generation, requestedOwner = owner;
    operation = { kind: "rename", id, title, previous: current.title, status: "saving" }; persist(); draw();
    try { if (outcome !== "write-failure") rename(id, title); }
    catch { operation = null; draft.error = "标题保存失败，请重试。"; persist(); draw(); return; }
    await delay();
    if (token !== generation || !owned() || requestedOwner !== owner) return;
    if (outcome === "write-failure") { operation = null; draft.error = "标题保存失败，请重试。"; persist(); draw(); return; }
    operation.status = "unknown";
    if (["unknown", "check-failure"].includes(outcome)) { feedback = "标题保存结果待确认，请核对重命名结果。"; persist(); draw(); return; }
    await verify();
  }

  function confirmDelete(ids) {
    if (!owned() || operation || offline()) return;
    refresh(); if (!owned()) return;
    const all = records(), targets = ids.map((id) => all.find((item) => item.id === id)).filter(Boolean);
    const eligible = targets.filter((item) => !isRunning(item.id) && editor !== item.id);
    if (!eligible.length) { feedback = "所选演绎暂时无法删除，请核对生成和编辑状态。"; draw(); return; }
    deleteTrigger = document.activeElement?.closest("[data-history]")?.dataset.history || "delete-selected";
    menu = null; operation = { kind: "delete", targets: structuredClone(eligible), status: "review", outcomes: Object.fromEntries(eligible.map((t) => [t.id, "review"])) };
    showDelete = true; persist(); draw(); root.querySelector('[data-history="close-delete"]')?.focus();
  }

  function closeDelete() {
    const targetId = operation?.targets[0]?.id;
    if (operation?.status === "review") operation = null;
    showDelete = false; persist(); draw();
    const trigger = deleteTrigger === "delete-selected" ? root.querySelector('[data-history="delete-selected"]') : row(targetId)?.querySelector('[data-history="menu"]');
    trigger?.focus();
  }

  function finishDelete() {
    if (!operation || operation.kind !== "delete") return;
    const results = Object.values(operation.outcomes), allDone = results.every((v) => ["deleted", "missing"].includes(v));
    if (!allDone) { operation.status = results.includes("unknown") ? "unknown" : "partial"; persist(); updateFromSource(); draw(); if (showDelete) root.querySelector('[data-history="close-delete"]')?.focus(); return; }
    const targets = operation.targets, oldIndex = Math.max(0, items.findIndex((item) => item.id === targets[0].id));
    for (const target of targets) { selected.delete(target.id); removeDraft(target.id); }
    feedback = targets.length === 1 ? results[0] === "missing" ? "此项已不存在。" : "已删除。" : `已删除 ${results.filter((value) => value === "deleted").length} 条演绎，${results.filter((value) => value === "missing").length} 条演绎已不存在。`;
    operation = null; showDelete = false; persist(); updateFromSource(); draw();
    if (items.length) focusRow(items[Math.min(oldIndex, items.length - 1)].id);
    else root.querySelector('a[href="#discover"]')?.focus();
  }

  async function deleteTargets(retry = false) {
    if (!owned() || offline() || operation?.kind !== "delete" || operation.status === "saving") return;
    if (retry && Object.values(operation.outcomes).includes("unknown")) return;
    refresh(); if (!owned()) return;
    const action = operation, outcome = scenario, token = ++generation, requestedOwner = owner;
    const targets = action.targets.filter((t) => retry ? ["failed", "retained", "running"].includes(action.outcomes[t.id]) : action.outcomes[t.id] === "review");
    action.status = "saving"; const ids = [];
    targets.forEach((target, index) => {
      if (!profile().sessions.some((item) => item.id === target.id)) { action.outcomes[target.id] = "missing"; selected.delete(target.id); }
      else if (isRunning(target.id)) action.outcomes[target.id] = "running";
      else if (outcome === "write-failure" || (outcome === "partial" && index % 2 === 1)) action.outcomes[target.id] = "failed";
      else { action.outcomes[target.id] = "saving"; ids.push(target.id); }
    });
    persist(); draw();
    try { if (ids.length) remove(ids); }
    catch { for (const id of ids) action.outcomes[id] = "unknown"; action.status = "unknown"; persist(); draw(); return; }
    await delay();
    if (token !== generation || !owned() || requestedOwner !== owner) return;
    for (const id of ids) action.outcomes[id] = ["unknown", "check-failure"].includes(outcome) ? "unknown" : profile().sessions.some((item) => item.id === id) ? "retained" : "deleted";
    action.status = "partial"; finishDelete();
  }

  async function verify(reread = true) {
    if (!owned()) return;
    if (offline() || scenario === "check-failure") {
      feedback = "操作结果读取失败，请恢复连接后核对。";
      if (!items.length && total === null) updateFromSource(); draw(); return;
    }
    refresh(); if (!owned()) return;
    if (operation?.kind === "rename") {
      const action = operation, saved = profile().sessions.find((item) => item.id === action.id);
      operation = null;
      if (saved?.title === action.title) { removeDraft(action.id); editor = null; feedback = "演绎标题已更新。"; }
      else if (!saved) { editor = null; feedback = "此演绎已不存在，标题草稿仍保存在当前标签页。"; }
      else { feedback = "标题尚未保存，请核对当前标题后重新提交。"; if (drafts[action.id]) { drafts[action.id].conflict = saved.title !== drafts[action.id].base; drafts[action.id].saved = saved.title; } }
      persist(); updateFromSource(); draw(); focusRow(action.id); return;
    }
    if (operation?.kind === "delete") {
      for (const target of operation.targets) {
        if (!["unknown", "saving"].includes(operation.outcomes[target.id])) continue;
        operation.outcomes[target.id] = !profile().sessions.some((item) => item.id === target.id) ? "deleted" : isRunning(target.id) ? "running" : "retained";
      }
      finishDelete(); return;
    }
    if (reread) await read(); else { updateFromSource(); draw(); }
  }

  root.addEventListener("input", (event) => {
    if (!owned()) return;
    if (event.target.id === "history-search") searchDraft = event.target.value;
    const form = event.target.closest('[data-history-form="rename"]');
    if (form && drafts[form.dataset.id] && !operation) { drafts[form.dataset.id].title = event.target.value; drafts[form.dataset.id].error = ""; }
    persist();
  });
  root.addEventListener("compositionstart", () => { composing = true; });
  root.addEventListener("compositionend", () => { composing = false; });
  root.addEventListener("submit", (event) => {
    if (!owned()) return;
    const form = event.target.closest("[data-history-form]"); if (!form) return;
    event.preventDefault(); if (composing) return;
    if (form.dataset.historyForm === "search") applySearch(); else void saveTitle(form.dataset.id);
  });
  root.addEventListener("change", (event) => {
    if (!owned() || !event.target.dataset.historySelect) return;
    if (event.target.dataset.historySelect === "loaded") {
      for (const item of items) if (!isRunning(item.id)) event.target.checked ? selected.add(item.id) : selected.delete(item.id);
    } else event.target.checked ? selected.add(event.target.dataset.id) : selected.delete(event.target.dataset.id);
    persist(); draw();
  });
  root.addEventListener("click", (event) => {
    if (!owned()) return;
    const link = event.target.closest("[data-history-continue]");
    if (link) { anchor = link.dataset.historyContinue; persist(); }
    if (event.target.classList.contains("uw-history-delete-layer")) { closeDelete(); return; }
    const button = event.target.closest("[data-history]"); if (!button || button.disabled) return;
    const action = button.dataset.history, id = button.dataset.id;
    if (action === "menu") {
      if (menu === id) { closeMenu(); return; }
      menu = id; draw(); row(id)?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    }
    if (action === "rename") beginRename(id);
    if (action === "cancel-rename") cancelRename(id);
    if (action === "keep-draft" && drafts[id]) { drafts[id].base = drafts[id].saved; drafts[id].conflict = false; persist(); draw(); row(id)?.querySelector('input[name="title"]')?.focus(); }
    if (action === "use-saved") cancelRename(id);
    if (action === "clear-search") applySearch(true);
    if (action === "manage") { managed = !managed; if (!managed) selected.clear(); persist(); draw(); root.querySelector('[data-history="manage"]')?.focus(); }
    if (action === "delete") confirmDelete([id]);
    if (action === "delete-selected") confirmDelete([...selected]);
    if (action === "close-delete") closeDelete();
    if (action === "confirm-delete") void deleteTargets();
    if (action === "retry-delete") void deleteTargets(true);
    if (action === "show-delete") { showDelete = true; draw(); root.querySelector('[data-history="close-delete"]')?.focus(); }
    if (action === "verify") void verify();
    if (action === "more") void read(true);
    if (action === "refresh") { refresh(); if (owned()) { if (operation && operation.status !== "review") void verify(); else void read(); } }
    if (action === "retry-read") { scenario = "normal"; const select = document.querySelector("#review-scenario"); if (select) select.value = "normal"; void read(failedMore); }
  });

  root.addEventListener("keydown", (event) => {
    if (!owned()) return;
    if (event.isComposing || composing) { if (event.key === "Enter") event.preventDefault(); return; }
    if (showDelete) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDelete(); }
      if (event.key === "Tab") {
        const buttons = [...root.querySelectorAll('.uw-history-delete-layer button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
      return;
    }
    if (menu) {
      const buttons = [...row(menu).querySelectorAll('[role="menuitem"]:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      if (event.key === "Tab") closeMenu(false);
      return;
    }
    if (event.key === "Escape" && editor && event.target.closest('[data-history-form="rename"]')) { event.preventDefault(); event.stopPropagation(); cancelRename(editor); }
  });

  document.addEventListener("click", (event) => {
    if (active && menu && !event.target.closest('.uw-history-menu-wrap')) closeMenu(false);
  });
  document.querySelector("#review-scenario")?.addEventListener("change", (event) => {
    if (!owned()) return;
    scenario = event.target.value;
    if (["normal", "slow", "failure", "empty"].includes(scenario) && !operation) void read(); else draw();
  });
  function refreshVisible(event) {
    if (!active || (event.type === "visibilitychange" && document.visibilityState === "hidden")) return;
    refresh();
    if (!owned()) { clearOwnedDrafts(owner); drafts = {}; editor = null; operation = null; selected.clear(); owner = null; leaveDialog.close(); showDelete = false; active = false; generation++; navigate("history"); return; }
    if (operation && operation.status !== "review") void verify(); else void read();
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("online", refreshVisible);
  addEventListener("offline", () => { if (active) draw(); });

  return {
    render,
    guard(next, proceed) {
      if (allowLeave) { allowLeave = false; return false; }
      if (!active || next === "history") return false;
      if (showDelete) { closeDelete(); return true; }
      if (menu) { closeMenu(); return true; }
      if (editor && drafts[editor] && drafts[editor].title !== drafts[editor].base) {
        persist();
        leaveDialog.open({ title: "保留标题草稿？", content: "<p>当前标题尚未保存。离开后，可在当前标签页继续编辑。</p>", actions: [
          { label: "继续编辑", run() { row(editor)?.querySelector('input[name="title"]')?.focus(); } },
          { label: "离开并保留草稿", run() { persist(); allowLeave = true; proceed(); } },
        ] });
        return true;
      }
      return false;
    },
    suspend() { if (!active) return; persist(); active = false; generation++; menu = null; showDelete = false; leaveDialog.close(); },
    clearDrafts(id = profile().id) {
      clearOwnedDrafts(id);
      if (id === owner) { drafts = {}; editor = null; operation = null; selected.clear(); showDelete = false; }
    },
  };
}
