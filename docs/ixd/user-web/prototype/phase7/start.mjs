import { config } from "../data.mjs";
import { startView } from "./start-view.mjs";
import { reviewScope } from "./review.mjs";

export const startScenarios = {
  label: "第 4 批：开始演绎",
  scenarios: [
    ["normal", "正常"], ["slow", "慢速读取与创建"],
    ["persona-failure", "人格读取失败"], ["role-failure", "角色与开场读取失败"],
    ["preview-failure", "开场预览读取失败"], ["append-failure", "更多人格读取失败"],
    ["empty-personas", "人格集合为空"], ["no-openings", "没有可用开场"],
    ["invalid-default", "默认选择失效"], ["invalid-persona", "所选人格失效"],
    ["invalid-opening", "所选开场失效"], ["write-failure", "创建明确失败"],
    ["unknown", "创建结果待确认"], ["unknown-missing", "核对后确认未创建"],
    ["check-failure", "创建结果读取失败"], ["open-failure", "已创建但会话读取失败"],
    ["offline", "离线"], ["missing", "角色无法访问"],
  ],
};

const PAGE_SIZE = 6;
const textOf = (text) => String(text || "").replace(/\\n/g, "\n");
const wait = (slow) => new Promise((resolve) => setTimeout(resolve, slow ? 1200 : 100));

export function createStart({ root, platform, profile, refresh, navigate, beforeMount, create, selection }) {
  let current = "", previous = "discover", entrySource = null, owner = null, cardId = null,
    source = "discover", card = null, items = [], openings = [], loaded = PAGE_SIZE,
    total = 0, personaId = null, opening = null, expanded = false, initialized = false,
    operation = null, notice = "", stalePersona = "", staleOpening = false,
    roleStatus = "idle", personaStatus = "idle", previewStatus = "idle",
    moreLoading = false, moreError = false, verifying = false, scenario = "normal",
    savedPersona = null, savedOpening = null, anchor = null, scroll = 0;
  const tickets = { role: 0, personas: 0, preview: 0, operation: 0 };
  const active = () => current.startsWith("start/");
  const offline = () => scenario === "offline" || !navigator.onLine;
  const key = () => `tavern-phase7-start:${owner}:${cardId}`;
  const blocked = () => {
    if (operation) return operation.status === "submitting" ? "正在创建演绎…" : operation.status === "created" ? "演绎已创建，请重新打开。" : "创建结果尚未确认，请先核对";
    if (offline()) return "连接恢复后再开始演绎";
    if (roleStatus === "loading" || personaStatus === "loading" || previewStatus === "loading") return "正在读取本次演绎资料…";
    if (roleStatus !== "ready" || personaStatus !== "ready" || (opening !== null && previewStatus !== "ready")) return "请点击读取失败提示旁的“重新读取”。";
    if (!personaId) return "请选择本次演绎人格。";
    if (opening === null || !openings[opening]) return "请选择本次演绎开场。";
    return "";
  };
  function persist() {
    if (!owner || !cardId) return;
    try {
      sessionStorage.setItem(key(), JSON.stringify({ source, loaded, personaId, opening, expanded, initialized, operation, savedPersona, savedOpening, scroll }));
    } catch { notice = "浏览器未能保存本次选择，请保持页面打开。"; }
  }
  function capture() { scroll = root.querySelector(".uw-scroll")?.scrollTop || scroll; persist(); }
  function sameOwner() {
    refresh();
    if (profile().id === owner && profile().account) return true;
    const route = current;
    suspend();
    navigate(route);
    return false;
  }
  function draw() {
    if (!active()) return;
    if (scenario === "missing" || (roleStatus === "ready" && !card)) {
      root.innerHTML = '<main class="uw-result" data-page-id="P22"><h1 tabindex="-1">页面无法访问</h1><p>这个角色已不存在或当前账号无法访问。</p><a class="uw-button" href="#discover">返回角色广场</a></main>';
      root.querySelector("h1").focus();
      return;
    }
    const focused = document.activeElement;
    const focusKey = focused?.name ? { name: focused.name, value: focused.value } : focused?.dataset.start ? { action: focused.dataset.start } : null;
    const oldScroll = root.querySelector(".uw-scroll");
    if (oldScroll) scroll = oldScroll.scrollTop;
    root.innerHTML = startView({ route: current, source, card, items, openings, loaded, total, personaId, opening, expanded, operation, notice, stalePersona, staleOpening, roleStatus, personaStatus, previewStatus, moreLoading, moreError, verifying, defaultPersona: profile().defaultPersona, offline: offline(), reason: blocked() }, platform);
    const preview = root.querySelector('[data-start="expand"]');
    preview?.setAttribute("aria-expanded", String(expanded));
    preview?.setAttribute("aria-controls", "start-opening-preview");
    root.querySelector('[data-start="create"]')?.setAttribute("aria-describedby", "start-feedback");
    root.querySelector(".uw-scroll").scrollTop = scroll;
    if (focusKey) {
      const candidates = [...root.querySelectorAll("input,button")];
      candidates.find((el) => focusKey.action ? el.dataset.start === focusKey.action : el.name === focusKey.name && el.value === focusKey.value)?.focus({ preventScroll: true });
    }
    if (anchor) {
      const target = [...root.querySelectorAll('[name="start-persona"]')].find((el) => el.value === anchor);
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
      anchor = null;
    }
  }
  function personaData() {
    if (scenario === "empty-personas") return [];
    const all = profile().personas;
    return scenario === "invalid-persona" ? all.filter((p) => p.id !== personaId) : all;
  }
  async function readPersonas(more = false) {
    const ticket = ++tickets.personas, identity = owner;
    if (more) moreLoading = true;
    else personaStatus = "loading";
    moreError = false;
    draw();
    await wait(scenario === "slow");
    if (!active() || identity !== owner || ticket !== tickets.personas) return;
    moreLoading = false;
    if (scenario === "persona-failure" || (more && scenario === "append-failure")) {
      if (more) moreError = true;
      else personaStatus = "error";
      draw(); return;
    }
    if (more) loaded += PAGE_SIZE;
    const all = personaData(), selected = all.find((p) => p.id === personaId);
    if (personaId && (!selected || (savedPersona && (selected.name !== savedPersona.name || selected.description !== savedPersona.description)))) {
      stalePersona = savedPersona?.name || personaId;
      personaId = null;
      savedPersona = null;
    }
    if (!initialized && scenario !== "invalid-default") personaId = all.find((p) => p.id === profile().defaultPersona)?.id || null;
    total = all.length;
    items = structuredClone(all.slice(0, loaded));
    const chosen = all.find((p) => p.id === personaId);
    if (chosen && !items.some((p) => p.id === chosen.id)) items.push(structuredClone(chosen));
    if (chosen) savedPersona = { name: chosen.name, description: chosen.description };
    personaStatus = "ready";
    finishRead();
  }
  async function readRole() {
    const ticket = ++tickets.role, identity = owner;
    roleStatus = "loading"; draw();
    await wait(scenario === "slow");
    if (!active() || identity !== owner || ticket !== tickets.role) return;
    if (scenario === "role-failure") { roleStatus = "error"; draw(); return; }
    card = config.cards.find((c) => c.id === cardId) || null;
    openings = scenario === "no-openings" ? [] : (card?.openings || []).map(textOf);
    if (opening !== null && (!openings[opening] || (savedOpening && savedOpening !== openings[opening]) || scenario === "invalid-opening")) {
      opening = null; savedOpening = null; staleOpening = true;
    }
    if (!initialized && scenario !== "invalid-default" && openings.length) opening = 0;
    roleStatus = "ready";
    savedOpening = openings[opening] || null;
    finishRead();
    if (opening !== null) void readPreview();
  }
  function finishRead() {
    if (roleStatus === "ready" && personaStatus === "ready") initialized = true;
    persist(); draw();
  }
  async function readPreview() {
    const ticket = ++tickets.preview, selected = opening, identity = owner;
    if (selected === null) return;
    previewStatus = "loading"; draw();
    await wait(scenario === "slow");
    if (!active() || identity !== owner || selected !== opening || ticket !== tickets.preview) return;
    previewStatus = scenario === "preview-failure" ? "error" : "ready";
    draw();
  }
  function restore() {
    source = previous === "discover" || previous.startsWith("detail/") ? previous : "discover";
    loaded = PAGE_SIZE; personaId = null; opening = null; expanded = false; initialized = false;
    operation = null; savedPersona = null; savedOpening = null; stalePersona = ""; staleOpening = false; scroll = 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) || "null");
      if (saved) {
        source = saved.source || source; loaded = saved.loaded || PAGE_SIZE;
        personaId = saved.personaId ?? null; opening = saved.opening ?? null; expanded = !!saved.expanded;
        initialized = !!saved.initialized; operation = saved.operation; savedPersona = saved.savedPersona; savedOpening = saved.savedOpening; scroll = saved.scroll || 0;
        if (operation?.status === "submitting") operation.status = "unknown";
      }
    } catch {}
  }
  function render(route) {
    if (!/^start\/[^/?]+(?:\?|$)/.test(route)) {
      if (active()) suspend();
      previous = route;
      return false;
    }
    if (!profile().account) return false;
    if (current === route && owner === profile().id) { draw(); return true; }
    if (active()) capture();
    for (const key of Object.keys(tickets)) tickets[key]++;
    current = route; owner = profile().id; cardId = route.slice(6).split("?")[0];
    card = null; items = []; openings = []; total = 0; notice = ""; moreError = false; moreLoading = false; verifying = false;
    roleStatus = "idle"; personaStatus = "idle"; previewStatus = "idle";
    restore();
    if (entrySource) {
      source = entrySource; entrySource = null;
      if (operation?.status === "created") operation = null;
    }
    const returned = selection?.();
    if (returned?.cardId === cardId) {
      if (returned.personaId) { personaId = returned.personaId; savedPersona = null; anchor = personaId; initialized = true; }
      if (Number.isInteger(returned.opening)) opening = returned.opening;
    }
    const from = new URLSearchParams(route.split("?")[1] || "").get("from");
    if (from === "discover" || from?.startsWith("detail/")) source = from;
    beforeMount();
    scenario = reviewScope("start");
    void readPersonas(); void readRole();
    return true;
  }
  async function submit() {
    if (blocked() || operation || !sameOwner()) return;
    const selected = profile().personas.find((p) => p.id === personaId);
    const actual = config.cards.find((c) => c.id === cardId);
    if (!selected || selected.name !== savedPersona?.name || selected.description !== savedPersona?.description) {
      await readPersonas(); root.querySelector("#start-personas")?.focus(); return;
    }
    if (!actual?.openings[opening] || textOf(actual.openings[opening]) !== savedOpening) {
      await readRole(); root.querySelector("#start-openings")?.focus(); return;
    }
    const outcome = scenario, ticket = ++tickets.operation, identity = owner;
    operation = { status: "submitting", id: null, cardId, personaId, opening, knownMissing: outcome === "unknown-missing" };
    notice = "正在创建演绎…"; persist(); draw();
    if (!["write-failure", "unknown-missing"].includes(outcome)) {
      try { operation.id = create(cardId, personaId, opening); }
      catch { operation.status = "unknown"; notice = "创建结果尚未确认，请先核对"; persist(); draw(); return; }
    }
    persist();
    await wait(outcome === "slow");
    if (!active() || identity !== owner || ticket !== tickets.operation) return;
    if (outcome === "write-failure") { operation = null; notice = "演绎创建失败，本次选择已保留，请重试。"; persist(); draw(); return; }
    if (["unknown", "unknown-missing", "check-failure"].includes(outcome) || !operation.id) {
      operation.status = "unknown"; notice = "创建结果尚未确认，请先核对"; persist(); draw(); return;
    }
    operation.status = "created"; persist();
    if (outcome === "open-failure") { notice = "演绎已创建，会话读取失败，请重新打开。"; draw(); }
    else navigate(`chat/${operation.id}`);
  }
  async function verify() {
    if (!operation || verifying || offline() || !sameOwner()) return;
    const ticket = ++tickets.operation, identity = owner;
    verifying = true; notice = "正在核对创建结果…"; draw();
    await wait(scenario === "slow");
    if (!active() || identity !== owner || ticket !== tickets.operation) return;
    verifying = false;
    if (scenario === "check-failure") { notice = "创建结果读取失败，请检查连接后重试。"; draw(); return; }
    if (!sameOwner()) return;
    if (!operation.id && !operation.knownMissing) {
      notice = "暂时无法确认演绎是否创建成功，请前往历史演绎查看。"; persist(); draw(); return;
    }
    if (operation.id && profile().sessions.some((s) => s.id === operation.id)) {
      operation.status = "created"; notice = "已确认演绎创建成功。"; persist(); navigate(`chat/${operation.id}`);
    } else {
      operation = null; notice = "已确认本次演绎尚未创建，可以重新开始。"; persist(); draw();
    }
  }
  function suspend() {
    if (active()) capture();
    current = "";
    for (const key of Object.keys(tickets)) tickets[key]++;
  }
  function clearDrafts(id) {
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(`tavern-phase7-start:${id}:`)) sessionStorage.removeItem(key);
    } catch {}
    if (owner === id) { suspend(); operation = null; owner = null; }
  }
  root.addEventListener("change", (event) => {
    if (!active() || operation) return;
    if (event.target.name === "start-persona") {
      personaId = event.target.value; stalePersona = "";
      const selected = items.find((p) => p.id === personaId);
      savedPersona = selected ? { name: selected.name, description: selected.description } : null;
      notice = ""; persist(); draw();
    }
    if (event.target.name === "start-opening") {
      opening = Number(event.target.value); staleOpening = false; savedOpening = openings[opening]; notice = "";
      persist(); draw(); void readPreview();
    }
  });
  root.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (link?.getAttribute("href")?.startsWith("#start/")) entrySource = location.hash.slice(1) || "discover";
    if (!active()) return;
    const action = event.target.closest("[data-start]")?.dataset.start;
    if (action === "create") void submit();
    if (action === "verify") void verify();
    if (action === "reopen" && operation?.id && !offline()) navigate(`chat/${operation.id}`);
    if (action === "expand") { expanded = !expanded; persist(); draw(); }
    if (action === "more") void readPersonas(true);
    if (action?.startsWith("retry-")) {
      scenario = "normal";
      const picker = document.querySelector("#review-scenario"); if (picker) picker.value = "normal";
      if (action === "retry-personas") void readPersonas();
      if (action === "retry-more") void readPersonas(true);
      if (action === "retry-role") void readRole();
      if (action === "retry-preview") void readPreview();
    }
  });
  document.querySelector("#review-scenario")?.addEventListener("change", (event) => {
    if (!active()) return;
    scenario = event.target.value; notice = "";
    if (["normal", "slow", "persona-failure", "empty-personas", "invalid-persona"].includes(scenario)) void readPersonas();
    if (["normal", "slow", "role-failure", "no-openings", "invalid-opening"].includes(scenario)) void readRole();
    if (scenario === "preview-failure") void readPreview();
    if (scenario === "invalid-default") { personaId = null; opening = null; savedPersona = null; savedOpening = null; }
    persist(); draw();
  });
  function refreshVisible(event) {
    if (!active() || (event.type === "visibilitychange" && document.visibilityState === "hidden")) return;
    if (!sameOwner()) return;
    if (operation?.status === "submitting") return;
    void readPersonas(); void readRole();
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("online", refreshVisible);
  addEventListener("offline", () => { if (active()) draw(); });
  addEventListener("pagehide", () => { if (active()) capture(); });
  return { render, guard(next) { if (active() && next !== current) capture(); return false; }, suspend, clearDrafts };
}
