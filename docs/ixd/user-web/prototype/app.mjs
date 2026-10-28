import { config } from "./data.mjs";
import { createBrowse } from "./phase7/browse.mjs";
import { createPersonas } from "./phase7/personas.mjs";
import { createIdentity } from "./phase7/identity.mjs";
import { createAccount } from "./phase7/account.mjs";
import { createSessionPage, inaccessible } from "./phase7/session.mjs";
import { createStart, startScenarios } from "./phase7/start.mjs";
import { registerReviewScope } from "./phase7/review.mjs";
import { createHistory, historyScenarios } from "./phase7/history.mjs";
import { roleDelivery } from "./role-frontends.mjs";
import { createScriptRuntime, runtimePolicy } from "./runtime.bundle.js";
import {
  createSession,
  addReply,
  selectReply,
  extendReply,
  deleteSessions,
} from "./model.mjs";

import { icon } from "./icons.mjs";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const cardById = (id) => config.cards.find((card) => card.id === id);
const textOf = (message) => message.variants[message.selected];
const resize = () =>
  document.documentElement.style.setProperty(
    "--viewport-height",
    `${innerHeight}px`,
  );
resize();
addEventListener("resize", resize);
const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
let storageWarning = false;
function demoProfile() {
  const first = createSession(config.cards[0], config.personas[0], 0);
  first.title = "雨夜来信";
  first.updatedAt -= 300000;
  first.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    variants: ["“我叫裴修远。有人托我把这封信送到这里。”"],
    selected: 0,
  });
  first.messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    variants: [config.cards[0].replies[0]],
    selected: 0,
  });
  const second = createSession(config.cards[4], config.personas[1], 0);
  second.title = "失落航线";
  second.updatedAt -= 86400000;
  return {
    id: crypto.randomUUID(),
    account: structuredClone(config.demoAccount),
    personas: structuredClone(config.personas),
    defaultPersona: "p1",
    sessions: [first, second],
  };
}
function emptyProfile(account = null) {
  return {
    id: crypto.randomUUID(),
    account,
    personas: [],
    defaultPersona: null,
    sessions: [],
  };
}
function initialStore() {
  return { activeUserId: null, users: [demoProfile()] };
}
let store;
try {
  const saved = JSON.parse(localStorage.getItem(config.storageKey));
  if (!saved) store = initialStore();
  else if (saved.users) store = saved;
  else {
    const owner = {
      ...saved,
      id: crypto.randomUUID(),
      account: saved.account || structuredClone(config.demoAccount),
    };
    store = { activeUserId: saved.account ? owner.id : null, users: [owner] };
  }
} catch {
  store = initialStore();
  storageWarning = true;
}
let state =
  store.users.find((user) => user.id === store.activeUserId) || emptyProfile();
let category = "全部",
  query = "",
  historyQuery = "";
let selectedPersona = state.defaultPersona,
  selectedHistory = new Set(),
  authMode = "login",
  afterAuth = null;
let busy = null,
  toastTimer,
  modalReturnFocus;
let route = location.hash.slice(1) || "discover";
let startSelection = null;
const account = window.prototypePlatform
  ? createAccount({
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      updateName(name) {
        state.account.name = name;
        save();
      },
      logout: clearAccount,
      refresh: refreshAccount,
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
    })
  : null;
const personas = window.prototypePlatform
  ? createPersonas({
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      refresh: refreshAccount,
      write: savePersona,
      remove: removePersona,
      returnToStart(source, id) {
        startSelection = {
          cardId: source.route.split("/")[1],
          personaId: id || state.defaultPersona,
          opening: source.opening,
        };
        go(source.route);
      },
      setDefault(id) {
        if (state.personas.some((p) => p.id === id)) {
          state.defaultPersona = id;
          selectedPersona = id;
          save();
        }
      },
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
    })
  : null;
const identity = window.prototypePlatform
  ? createIdentity({
      account,
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      findAccount: (email) =>
        store.users.find(
          (item) => item.account.email.toLowerCase() === email.toLowerCase(),
        ),
      refresh: refreshAccount,
      register(account) {
        store.users.push(emptyProfile(account));
        save();
      },
      login(email, target) {
        finishAuth(
          store.users.find(
            (item) => item.account.email.toLowerCase() === email.toLowerCase(),
          ).account,
          target,
        );
      },
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
    })
  : null;
const browse = window.prototypePlatform
  ? createBrowse({
      root: app,
      platform: window.prototypePlatform,
      account: () => state.account,
      navigate: go,
      start(id) {
        browse.render(`detail/${id}`);
        const choice = startSelection?.cardId === id ? startSelection : null;
        showDetail(
          id,
          choice?.personaId ?? state.defaultPersona,
          choice?.opening ?? 0,
        );
      },
    })
  : null;
if (window.prototypePlatform) registerReviewScope("start", startScenarios);
const startPage = window.prototypePlatform
  ? createStart({
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      refresh: refreshAccount,
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
      create(cardId, personaId, opening) {
        const card = cardById(cardId),
          persona = state.personas.find((p) => p.id === personaId);
        if (!card || !persona) return null;
        const created = createSession(card, persona, opening);
        state.sessions.push(created);
        save();
        return created.id;
      },
      selection() {
        const value = startSelection;
        startSelection = null;
        return value;
      },
    })
  : null;
if (window.prototypePlatform)
  registerReviewScope("history", {
    label: "第 4 批：历史演绎",
    scenarios: historyScenarios,
  });
const historyPage = window.prototypePlatform
  ? createHistory({
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      refresh: refreshAccount,
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
      rename(id, title) {
        const s = state.sessions.find((s) => s.id === id);
        if (s) {
          s.title = title;
          s.updatedAt = Date.now();
          save();
        }
      },
      remove(ids) {
        state.sessions = deleteSessions(state.sessions, ids);
        save();
      },
      isRunning(id) {
        return !!state.sessions.find((s) => s.id === id)?.run;
      },
    })
  : null;
const sessionPage = window.prototypePlatform
  ? createSessionPage({
      root: app,
      platform: window.prototypePlatform,
      profile: () => state,
      refresh: refreshAccount,
      save,
      navigate: go,
      beforeMount() {
        browse?.suspend();
      },
    })
  : null;
function save() {
  try {
    localStorage.setItem(config.storageKey, JSON.stringify(store));
  } catch {
    storageWarning = true;
    toast("本次更改未能保存到浏览器，刷新或关闭页面后可能丢失。");
  }
}
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}
function go(next) {
  if (
    account?.guard(next, () => go(next)) ||
    personas?.guard(next, () => go(next)) ||
    sessionPage?.guard(next, () => go(next)) ||
    startPage?.guard(next, () => go(next)) ||
    historyPage?.guard(next, () => go(next))
  )
    return;
  if (busy) stopGeneration();
  route = next;
  location.hash = next;
  render();
}
addEventListener("hashchange", () => {
  const next = location.hash.slice(1) || "discover";
  if (next === route) return;
  if (
    account?.guard(next, () => go(next)) ||
    personas?.guard(next, () => go(next)) ||
    sessionPage?.guard(next, () => go(next)) ||
    startPage?.guard(next, () => go(next)) ||
    historyPage?.guard(next, () => go(next))
  ) {
    history.replaceState(null, "", `#${route}`);
    return;
  }
  if (busy) stopGeneration();
  route = next;
  render();
});
function refreshAccount() {
  try {
    const saved = JSON.parse(localStorage.getItem(config.storageKey));
    if (!saved) return;
    const previous = state.id;
    store = saved;
    state =
      store.users.find((user) => user.id === store.activeUserId) ||
      emptyProfile();
    if (state.id !== previous) {
      selectedPersona = state.defaultPersona;
      selectedHistory.clear();
      historyQuery = "";
      afterAuth = null;
    }
  } catch {}
}
function savePersona(values, id) {
  const item = { id: id || crypto.randomUUID(), ...values };
  const index = state.personas.findIndex((p) => p.id === id);
  if (id && index < 0) return null;
  if (index < 0) state.personas.push(item);
  else state.personas[index] = item;
  if (!state.defaultPersona) state.defaultPersona = item.id;
  selectedPersona = item.id;
  save();
  return item.id;
}
function removePersona(id) {
  const index = state.personas.findIndex((p) => p.id === id);
  if (index < 0) return false;
  state.personas.splice(index, 1);
  if (state.defaultPersona === id)
    state.defaultPersona = state.personas[0]?.id || null;
  selectedPersona = state.defaultPersona;
  save();
  return true;
}
function clearAccount() {
  personas?.clearDrafts();
  sessionPage?.clearDrafts(state.id);
  startPage?.clearDrafts(state.id);
  historyPage?.clearDrafts(state.id);
  if (busy) stopGeneration();
  store.activeUserId = null;
  state = emptyProfile();
  selectedPersona = null;
  selectedHistory.clear();
  afterAuth = null;
  save();
}
function requireAccount(action) {
  if (state.account) return action();
  afterAuth = action;
  closeModal();
  go("auth");
}
function button(label, action, extra = "", className = "") {
  return `<button class="btn ${className}" data-action="${action}" ${extra}>${label}</button>`;
}
function cover(card) {
  return `<div class="cover ${card.color}"><span class="cover-number">0${config.cards.indexOf(card) + 1} / TAVERN</span><span class="glyph">${card.symbol}</span><span class="cover-kicker">${card.kicker}</span></div>`;
}
function sortedSessions() {
  return [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}
function date(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
function render() {
  if (!route.startsWith("chat/")) sessionPage?.suspend();
  if (!route.startsWith("start/")) startPage?.suspend();
  if (route !== "history") historyPage?.suspend();
  if (!route.startsWith("personas")) personas?.suspend();
  activeRuntime?.destroy();
  activeRuntime = null;
  systemChatRoot = null;
  if (identity?.render(route)) {
    personas?.suspend();
    sessionPage?.suspend();
    startPage?.suspend();
    return;
  }
  if (historyPage?.render(route)) return;
  if (startPage?.render(route)) return;
  if (sessionPage?.render(route)) return;
  if (personas?.render(route)) return;
  if (browse?.render(route)) return;
  if (window.prototypePlatform) {
    inaccessible(app);
    return;
  }
  const section = route.split("/")[0];
  const needsAccount = ["personas", "history", "account", "chat"].includes(
    section,
  );
  if (needsAccount && !state.account && !afterAuth) {
    const destination = route;
    afterAuth = () => go(destination);
  }
  const session =
    section === "chat"
      ? state.sessions.find((item) => item.id === route.split("/")[1])
      : null;
  if (session && state.account) {
    app.innerHTML = renderChat(session);
    void mountRoleRuntime(session);
    return;
  }
  const labels = {
    discover: "角色广场",
    history: "历史演绎",
    personas: "演绎人格",
    account: "用户中心",
    auth: "登录与注册",
    chat: "演绎",
  };
  app.innerHTML = `<div class="shell"><aside class="sidebar">
    <button class="brand" data-action="nav" data-page="discover" aria-label="Tavern 首页"><span class="brandmark">${icon("book")}</span><span class="brand-name">Tavern<span style="color:#899a7f">.</span></span></button>
    <div class="brand-sub">角色演绎</div>
    <nav class="nav" aria-label="主导航">${config.navigation.map((item) => `<button data-action="nav" data-page="${item.id}" class="${section === item.id ? "active" : ""}" ${section === item.id ? 'aria-current="page"' : ""} title="${item.label}">${icon(item.icon)}<span class="nav-label">${item.label}</span></button>`).join("")}</nav>
    <div class="side-label">最近的故事</div>${sortedSessions()
      .slice(0, 3)
      .map(
        (item) =>
          `<button class="recent-link" data-action="open-session" data-id="${item.id}"><span class="mini">${cardById(item.cardId).symbol}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.persona.name)} · ${cardById(item.cardId).name}</small></span></button>`,
      )
      .join("")}
    <div class="side-bottom"><button class="account-link" data-action="nav" data-page="${state.account ? "account" : "auth"}"><span class="avatar">${state.account ? esc(state.account.name.slice(0, 1)) : icon("person")}</span><span class="account-copy grow"><strong>${state.account ? esc(state.account.name) : "登录 / 注册"}</strong><small style="display:block;margin-top:5px">${state.account ? "用户中心" : "登录账号"}</small></span><span class="account-copy">${icon("right")}</span></button></div></aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Tavern</span><span>/</span><strong>${labels[section] || "角色广场"}</strong></div><div class="top-actions"><span class="badge">交互原型 · 模拟数据</span>${state.account ? `<button class="icon-button" data-action="nav" data-page="account" aria-label="用户中心">${icon("person")}</button>` : button("登录 / 注册", "nav", 'data-page="auth"', "small")}</div></header>
    ${storageWarning ? '<div class="storage-warning">浏览器数据读取或保存失败。当前页面的更改可能在刷新后丢失。</div>' : ""}
    <main class="page">${needsAccount && !state.account ? renderAuth() : section === "history" ? renderHistory() : section === "personas" ? renderPersonas() : section === "account" && state.account ? renderAccount() : section === "auth" || section === "account" || section === "chat" ? renderAuth() : renderDiscover()}</main></div></div>`;
}
function renderDiscover() {
  const recent = sortedSessions()[0];
  return `<div class="page-heading"><div><div class="eyebrow">YOUR NEXT CHAPTER</div><h1>故事，由你续写。</h1><p>找到想遇见的人，走进想经历的故事。</p></div></div>
    ${recent ? `<div class="section-row"><h2>接着上次的故事 <small>${state.account ? "最近演绎" : "示例演绎"}</small></h2>${button("查看全部 →", "nav", 'data-page="history"', "subtle small")}</div><section class="continue-strip"><span class="mini">${cardById(recent.cardId).symbol}</span><div class="grow"><h3>${esc(recent.title)} <small>· ${cardById(recent.cardId).name}</small></h3><p>你是${esc(recent.persona.name)} · ${recent.messages.length} 条消息 · ${date(recent.updatedAt)}</p></div>${button(`继续演绎 ${icon("arrow")}`, "open-session", `data-id="${recent.id}"`, "small")}</section>` : ""}
    <section aria-label="角色筛选"><div class="filter-bar"><div class="tabs">${config.categories.map((name) => `<button class="tab ${category === name ? "active" : ""}" data-action="category" data-value="${name}" aria-pressed="${category === name}">${name}</button>`).join("")}</div><label class="search">${icon("search")}<input id="card-search" aria-label="搜索角色" placeholder="搜索角色、故事或标签" value="${esc(query)}"></label></div><div id="card-results">${renderCards()}</div></section>
`;
}
function renderCards() {
  const cards = config.cards.filter(
    (card) =>
      (category === "全部" || card.category === category) &&
      [card.name, card.subtitle, ...card.tags].join(" ").includes(query.trim()),
  );
  return `<div class="result-row"><span>探索角色 <span> / ${cards.length} 个故事</span></span></div>${cards.length ? `<div class="cards">${cards.map((card) => `<article class="card"><button class="cover-button" data-action="detail" data-id="${card.id}" aria-label="查看${card.name}">${cover(card)}</button><div class="card-body"><div class="card-title"><h3>${card.name}</h3><span class="category">${card.category}</span></div><div class="subtitle">${card.subtitle}</div><p class="description">${card.description}</p><div class="tags">${card.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div><div class="card-footer"><span>创作者 · ${card.author}</span><button class="text-link" data-action="detail" data-id="${card.id}">查看故事 ${icon("arrow")}</button></div></div></article>`).join("")}</div>` : `<div class="empty">${icon("search")}<h2>没有符合筛选条件的角色</h2><p class="muted">试试其他名字或标签，也可以浏览全部角色。</p>${button("重置筛选", "reset-filters", "", "primary")}</div>`}`;
}
function renderHistory() {
  const sessions = sortedSessions().filter((session) =>
    `${session.title} ${cardById(session.cardId).name} ${session.persona.name}`.includes(
      historyQuery.trim(),
    ),
  );
  return `<div class="page-heading"><div><div class="eyebrow">YOUR STORIES</div><h1>历史演绎</h1><p>${state.account ? "每段演绎都保留了当时的人格与对话。" : "登录后可以继续这些示例演绎。"}</p></div>${button(`${icon("plus")} 开始新故事`, "nav", 'data-page="discover"', "primary")}</div><div class="section-row"><h2>历史演绎 <small>${state.sessions.length} 段故事</small></h2><label class="search">${icon("search")}<input id="history-search" aria-label="搜索历史演绎" placeholder="搜索标题、角色或人格" value="${esc(historyQuery)}"></label></div><div id="history-results">${historyRows(sessions)}</div>`;
}
function historyRows(sessions) {
  return `<div class="bulk"><label><input type="checkbox" id="select-all" ${sessions.length && sessions.every((s) => selectedHistory.has(s.id)) ? "checked" : ""}>选择当前结果</label><span>已选 ${selectedHistory.size} 项</span>${button("删除所选", "delete-selected", selectedHistory.size ? "" : "disabled", "small danger")}</div>${sessions.length ? `<div class="history-list">${sessions.map((session) => `<article class="history-row"><input type="checkbox" data-select="${session.id}" aria-label="选择${esc(session.title)}" ${selectedHistory.has(session.id) ? "checked" : ""}><span class="mini">${cardById(session.cardId).symbol}</span><div class="grow"><h3>${esc(session.title)}</h3><p>${cardById(session.cardId).name} · 你是${esc(session.persona.name)} · ${session.messages.length} 条消息 · ${date(session.updatedAt)}</p><p class="preview">${esc(textOf(session.messages.at(-1)).slice(0, 88))}</p></div><div class="history-actions">${button("继续演绎", "open-session", `data-id="${session.id}"`, "small")}<button class="icon-button" data-action="rename" data-id="${session.id}" aria-label="重命名演绎">${icon("edit")}</button><button class="icon-button" data-action="delete-session" data-id="${session.id}" aria-label="删除演绎">${icon("trash")}</button></div></article>`).join("")}</div>` : `<div class="empty">${icon("history")}<h2>${state.sessions.length ? "没有找到匹配的演绎" : "第一段故事，等你开始"}</h2><p class="muted">${state.sessions.length ? "换个标题、角色或人格姓名试试。" : "挑选一张角色卡，开始后会在这里留下记录。"}</p>${button("浏览角色", "nav", 'data-page="discover"', "primary")}</div>`}`;
}
function renderPersonas() {
  const persona =
    state.personas.find((item) => item.id === selectedPersona) ||
    state.personas[0];
  return `<div class="page-heading"><div><div class="eyebrow">WHO WILL YOU BE?</div><h1>演绎人格</h1><p>你可以创建多个演绎人格，并在开始演绎时选择一个。</p></div>${button(`${icon("plus")} 创建人格`, "new-persona", "", "primary")}</div><div class="two-column"><div><div class="persona-list">${state.personas.map((item) => `<button class="persona-item ${item.id === persona?.id ? "selected" : ""}" data-action="select-persona" data-id="${item.id}"><span class="avatar">${esc(item.name.slice(0, 1))}</span><div><h3>${esc(item.name)} ${item.id === state.defaultPersona ? '<span class="tag">默认</span>' : ""}</h3><p>${esc(item.description)}</p></div></button>`).join("")}</div><p class="hint">默认人格会在开始新演绎时优先选中。</p></div>${!persona ? '<div class="empty"><h2>创建你的第一个演绎人格</h2><p>为故事中的自己起一个名字，写下身份、性格与来历。</p></div>' : `<form id="persona-form" data-id="${persona.id}" class="panel stack"><div class="section-row"><h2>人格资料</h2><span class="badge">${persona.id === state.defaultPersona ? "默认人格" : "可用于新演绎"}</span></div><div class="form-row"><label>故事中的姓名<input name="name" required maxlength="30" value="${esc(persona.name)}"></label></div><label>完整人设描述<textarea name="description" required rows="7" maxlength="3000">${esc(persona.description)}</textarea></label><p class="hint">写下人物的性别、年龄、身份、外貌和性格。</p><label class="check-row"><input name="default" type="checkbox" ${persona.id === state.defaultPersona ? "checked disabled" : ""}>用于新演绎的默认人格</label><p class="hint">保存的人格资料用于之后创建的演绎。已有演绎保留开始时的人格资料。</p><div class="form-actions">${button("删除人格", "delete-persona", `type="button" data-id="${persona.id}"`, "danger")}<button class="btn primary" type="submit">保存人格</button></div></form>`}</div>`;
}
function renderAccount() {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR SPACE</div><h1>${esc(state.account.name)}，欢迎回来。</h1></div>${button("退出登录", "logout")}</div><div class="stat-grid"><div class="stat"><strong>${state.sessions.length.toString().padStart(2, "0")}</strong><span>历史演绎</span></div><div class="stat"><strong>${state.personas.length.toString().padStart(2, "0")}</strong><span>演绎人格</span></div></div><div class="two-column"><div class="panel stack"><span class="avatar big">${esc(state.account.name.slice(0, 1))}</span><h2>${esc(state.account.name)}</h2><p class="hint">演示账号资料保存在当前浏览器。</p>${button("管理演绎人格", "nav", 'data-page="personas"')}${button("管理历史演绎", "nav", 'data-page="history"')}</div><form id="account-form" class="panel stack"><h2>账号资料</h2><label>昵称<input name="name" required maxlength="30" value="${esc(state.account.name)}"></label><p class="hint">昵称用于账号展示。演绎中的人物身份由演绎人格决定。</p><div class="form-actions"><button type="submit" class="btn primary">保存资料</button></div></form></div>`;
}
function renderAuth() {
  return `<section class="auth-wrap"><div class="auth-story"><div class="eyebrow">A PLACE FOR YOUR STORIES</div><h1>换一个身份，<br>走进另一个故事。</h1><p>与想遇见的人相逢，<br>把未完的故事继续写下去。</p></div><div class="auth-form"><div class="tabs"><button class="tab ${authMode === "login" ? "active" : ""}" data-action="auth-mode" data-mode="login">登录</button><button class="tab ${authMode === "register" ? "active" : ""}" data-action="auth-mode" data-mode="register">注册</button></div><h2>${authMode === "login" ? "欢迎回来" : "从这里开始"}</h2><form id="auth-form">${authMode === "register" ? '<label>昵称<input name="name" required maxlength="30" autocomplete="off" placeholder="输入昵称"></label>' : ""}<label>邮箱<input name="email" type="email" required autocomplete="off" placeholder="you@example.com"></label><label>演示密码<input name="password" type="password" minlength="8" required autocomplete="off" placeholder="输入至少 8 个字符的测试密码"></label>${authMode === "register" ? '<label>确认演示密码<input name="confirmation" type="password" minlength="8" required autocomplete="off" placeholder="再次输入同一测试密码"></label>' : ""}<p id="auth-error" class="error" role="alert"></p><button class="btn primary" type="submit">${authMode === "login" ? "登录并继续" : "创建账号并继续"}</button></form><p class="hint">此处模拟账号流程。请使用虚构资料和测试密码，密码仅用于表单演示。</p>${button("使用演示账号体验", "demo-login")}${button("先逛逛角色广场 →", "nav", 'data-page="discover"', "subtle")}</div></section>`;
}
function renderSystemChat(session) {
  const card = cardById(session.cardId),
    last = session.messages.at(-1);
  return `<section class="chat-main" data-owner="system-chat"><div class="ownership-label system-chat-label">系统 · 消息记录与输入操作</div><div class="messages" id="messages"><div class="scene-label">${card.subtitle} · 故事开始</div>${session.messages.map((message, index) => `<article class="message ${message.role}"><span class="avatar">${message.role === "user" ? esc(session.persona.name.slice(0, 1)) : card.name.slice(0, 1)}</span><div class="grow"><header><strong>${message.role === "user" ? esc(session.persona.name) : card.name}</strong><small>${message.role === "user" ? "你" : index === 0 ? "开场" : "角色"}</small><small>· ${String(index + 1).padStart(2, "0")}</small></header><div class="message-text">${esc(textOf(message))}</div><div class="message-tools">${button(`${icon("edit")} 编辑`, "edit-message", `data-index="${index}" ${busy ? "disabled" : ""}`, "small")}${index ? button(`${icon("trash")} 删除`, "delete-message", `data-index="${index}" ${busy ? "disabled" : ""}`, "small") : ""}${button(`${icon("branch")} 从这里分支`, "branch", `data-index="${index}" ${busy ? "disabled" : ""}`, "small")}${message.role === "assistant" && index === session.messages.length - 1 ? `<button class="icon-button" data-action="swipe" data-offset="-1" aria-label="上一条回复" ${busy || message.selected === 0 ? "disabled" : ""}>${icon("left")}</button><span class="count">${message.selected + 1} / ${message.variants.length}</span><button class="icon-button" data-action="swipe" data-offset="1" aria-label="下一条回复" ${busy || message.selected === message.variants.length - 1 ? "disabled" : ""}>${icon("right")}</button>${button(`${icon("refresh")} 重新生成`, "generate", `data-mode="regenerate" ${busy ? "disabled" : ""}`, "small")}` : ""}</div></div></article>`).join("")}<div class="chat-pending">${busy ? '<span class="loading" role="status">正在展示示例回复…</span>' : ""}</div></div><form class="composer" id="message-form"><div class="composer-box"><textarea name="message" aria-label="演绎输入" placeholder="写下你的动作或台词……" ${busy ? "disabled" : ""}></textarea><div class="composer-actions"><span class="composer-meta">${icon("person")} 正在扮演 · ${esc(session.persona.name)}</span><div>${busy ? button(`${icon("stop")} 停止生成`, "stop", 'type="button"', "primary small") : `${button("续写", "generate", `type="button" data-mode="continue" ${last.role !== "assistant" ? "disabled" : ""}`, "small")} <button type="submit" class="btn primary small">${icon("send")} 发送</button>`}</div></div></div><div class="composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><span>回复为示例文本 · 历史保存在当前浏览器</span></div></form></section>`;
}

let activeRuntime = null;
let systemChatRoot = null;
let showOwnership = true;
const runtimeWatchers = new Set();
function renderChat(session) {
  return `<main class="role-stage" data-boundaries="${showOwnership ? "on" : "off"}"><header class="session-toolbar">${button(`${icon("left")} 返回历史`, "nav", 'data-page="history"', "small")}<div class="grow"><h2>${esc(session.title)}</h2><p>你是${esc(session.persona.name)} · ${cardById(session.cardId).name}</p></div>${button("查看完整人设", "session-persona", "", "small")}${button("演绎设置", "chat-settings", "", "small")}${button(showOwnership ? "原型：隐藏区域说明" : "原型：显示区域说明", "toggle-ownership", "", "small")}</header><div id="role-runtime-host" data-boundaries="${showOwnership ? "on" : "off"}"><p class="loading">正在打开角色页面…</p></div></main>`;
}
function applyOwnership() {
  const value = showOwnership ? "on" : "off";
  document.querySelector(".role-stage")?.setAttribute("data-boundaries", value);
  document
    .querySelector("#role-runtime-host")
    ?.setAttribute("data-boundaries", value);
  systemChatRoot?.host.setAttribute("data-boundaries", value);
  const toggle = document.querySelector('[data-action="toggle-ownership"]');
  if (toggle)
    toggle.textContent = showOwnership
      ? "原型：隐藏区域说明"
      : "原型：显示区域说明";
}
async function mountRoleRuntime(session) {
  const root = document.querySelector("#role-runtime-host");
  if (!root) return;
  const host = {
    report(error) {
      console.error(error);
    },
    get() {
      return {
        snapshotId: String(session.messages.length),
        values: { messageCount: session.messages.length },
      };
    },
    watch(scope, callback) {
      const notify = () => callback(this.get());
      runtimeWatchers.add(notify);
      notify();
      return () => runtimeWatchers.delete(notify);
    },
    setDraft(text) {
      const input = systemChatRoot?.querySelector('[name="message"]');
      if (input) {
        input.value = text;
        input.focus();
      }
      return null;
    },
    mountChat(container) {
      container.style.height = "100%";
      const widget = document.createElement("div");
      widget.className = "system-widget";
      widget.style.height = "100%";
      container.append(widget);
      const shadow = widget.attachShadow({ mode: "open" });
      systemChatRoot = shadow;
      shadow.addEventListener("submit", handleSubmit);
      updateSystemChat(session);
      applyOwnership();
      return {
        destroy() {
          shadow.removeEventListener("submit", handleSubmit);
          widget.remove();
          if (systemChatRoot === shadow) systemChatRoot = null;
        },
      };
    },
  };
  const runtime = createScriptRuntime({
    root,
    delivery: roleDelivery(cardById(session.cardId)),
    host,
    policy: runtimePolicy,
  });
  activeRuntime = runtime;
  try {
    await runtime.mount();
    if (activeRuntime !== runtime) return;
    root.dataset.ready = "true";
    applyOwnership();
    scrollChat();
  } catch (error) {
    if (activeRuntime !== runtime) return;
    runtime.destroy();
    root.shadowRoot.innerHTML = `<p role="alert">角色页面加载失败，请刷新重试。</p>`;
    console.error(error);
  }
}
function updateSystemChat(session) {
  if (!systemChatRoot) return;
  for (const notify of runtimeWatchers) notify();
  systemChatRoot.innerHTML = `<link rel="stylesheet" href="${new URL("./style.css", import.meta.url).href}">${renderSystemChat(session)}`;
  scrollChat();
}
function scrollChat() {
  requestAnimationFrame(() => {
    const el = systemChatRoot?.querySelector("#messages");
    if (el) el.scrollTop = el.scrollHeight;
  });
}
function currentSession() {
  return state.sessions.find((session) => session.id === route.split("/")[1]);
}
function showModal(title, body, compact = false) {
  modalReturnFocus = document.activeElement;
  dialog.className = compact ? "compact" : "";
  dialog.innerHTML = `<div class="dialog-top"><h2 id="modal-heading">${title}</h2><button class="icon-button" data-action="close" aria-label="关闭">${icon("close")}</button></div>${body}`;
  dialog.setAttribute("aria-labelledby", "modal-heading");
  if (!dialog.open) dialog.showModal();
}
function closeModal() {
  dialog.close();
  modalReturnFocus?.focus();
}
dialog.addEventListener("click", (event) => {
  if (event.composedPath()[0] === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeModal();
  }
});
function showDetail(id, personaId = state.defaultPersona, openingIndex = 0) {
  const card = cardById(id);
  if (!state.personas.some((persona) => persona.id === personaId))
    personaId = state.defaultPersona;
  showModal(
    "走进这个故事",
    `<div class="detail-grid"><div class="detail-art">${cover(card)}<p>创作者 · ${card.author}</p><div class="tags">${card.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div></div><form id="start-form" data-id="${id}"><span class="eyebrow">${card.category} / ${card.kicker}</span><h2>${card.name}</h2><strong>${card.subtitle}</strong><p>${card.description}</p>${state.account && !state.personas.length ? `<p class="hint">先创建演绎人格，再开始故事。</p>${window.prototypePlatform ? "" : button("创建演绎人格", "nav", 'type="button" data-page="personas"')}` : ""}${window.prototypePlatform ? button("创建演绎人格", "start-new-persona", 'type="button"') : ""}<label>选择演绎人格<select name="persona" aria-label="选择演绎人格">${state.personas.map((persona) => `<option value="${persona.id}" ${persona.id === personaId ? "selected" : ""}>${esc(persona.name)}</option>`).join("")}</select></label><label>选择故事开场<select name="opening" aria-label="选择故事开场" data-card="${id}" id="opening-select">${card.openings.map((opening, index) => `<option value="${index}" ${index === openingIndex ? "selected" : ""}>开场 ${index + 1} · ${esc(opening.split("。")[0])}</option>`).join("")}</select></label><div class="opening" id="opening-preview">${esc(card.openings[openingIndex])}</div><button class="btn primary wide" type="submit" ${state.account && !state.personas.length ? "disabled" : ""}>开始演绎 ${icon("arrow")}</button></form></div>`,
  );
}
function confirmDelete(ids) {
  showModal(
    ids.length === 1 ? "删除这段演绎？" : `删除 ${ids.length} 段演绎？`,
    `<p>删除后将清除所选演绎的全部消息。角色卡和人格资料会保留。</p><div class="dialog-actions">${button("取消", "close")}${button("确认删除", "confirm-delete", `data-ids="${ids.join(",")}"`, "danger")}</div>`,
    true,
  );
}
function finishAuth(account, destination) {
  const email = account.email.trim().toLowerCase();
  let user = store.users.find(
    (item) => item.account.email.toLowerCase() === email,
  );
  if (!user) {
    user =
      email === config.demoAccount.email
        ? demoProfile()
        : emptyProfile({ ...account, email });
    store.users.push(user);
  }
  state = user;
  store.activeUserId = user.id;
  selectedPersona = state.defaultPersona;
  selectedHistory.clear();
  historyQuery = "";
  save();
  const next = afterAuth;
  afterAuth = null;
  go(destination || "discover");
  toast("已登录演示账号。");
  if (!destination && next) next();
}
function generate(mode) {
  const session = currentSession();
  if (!session || busy) return;
  const card = cardById(session.cardId);
  let message = session.messages.at(-1),
    text;
  if (mode === "continue") {
    if (message.role !== "assistant") return;
    text = card.continuation;
  } else if (mode === "regenerate") {
    if (message.role !== "assistant") return;
    text = card.replies[message.variants.length % card.replies.length];
    addReply(message, "");
  } else {
    text =
      card.replies[
        (session.messages.filter((item) => item.role === "user").length - 1) %
          card.replies.length
      ];
    message = {
      id: crypto.randomUUID(),
      role: "assistant",
      variants: [""],
      selected: 0,
    };
    session.messages.push(message);
  }
  let offset = 0;
  busy = { session, message, timer: null };
  busy.timer = setInterval(() => {
    extendReply(message, text.slice(offset, offset + 7));
    offset += 7;
    session.updatedAt = Date.now();
    save();
    if (offset >= text.length) {
      clearInterval(busy.timer);
      busy = null;
    }
    updateSystemChat(session);
  }, 65);
  updateSystemChat(session);
}
function stopGeneration() {
  if (!busy) return;
  clearInterval(busy.timer);
  const { session, message } = busy;
  if (!textOf(message)) {
    if (message.variants.length > 1) {
      message.variants.pop();
      message.selected = message.variants.length - 1;
    } else
      session.messages = session.messages.filter((item) => item !== message);
  }
  busy = null;
  save();
  render();
  toast("生成已停止，已显示的内容会保留。");
}
document.addEventListener("click", (event) => {
  const target = event.composedPath()[0].closest("[data-action]");
  if (!target || target.disabled) return;
  const { action, id, page, value, mode, index } = target.dataset;
  if (action === "nav") {
    closeModal();
    if (["personas", "history", "account"].includes(page))
      return requireAccount(() => go(page));
    return go(page);
  }
  if (action === "toggle-ownership") {
    showOwnership = !showOwnership;
    applyOwnership();
    return;
  }
  if (action === "close") return closeModal();
  if (action === "detail") return showDetail(id);
  if (action === "category") {
    category = value;
    render();
  }
  if (action === "reset-filters") {
    category = "全部";
    query = "";
    render();
  }
  if (action === "open-session") requireAccount(() => go(`chat/${id}`));
  if (action === "auth-mode") {
    authMode = mode;
    render();
  }
  if (action === "demo-login") finishAuth(structuredClone(config.demoAccount));
  if (action === "logout") {
    clearAccount();
    go("auth");
    toast("已退出演示账号。");
  }
  if (action === "delete-session") confirmDelete([id]);
  if (action === "delete-selected") confirmDelete([...selectedHistory]);
  if (action === "confirm-delete") {
    state.sessions = deleteSessions(
      state.sessions,
      target.dataset.ids.split(","),
    );
    selectedHistory.clear();
    save();
    closeModal();
    render();
    toast("所选演绎已删除。");
  }
  if (action === "rename") {
    const session = state.sessions.find((item) => item.id === id);
    showModal(
      "重命名演绎",
      `<form id="rename-form" data-id="${id}" class="stack"><label>演绎标题<input name="title" value="${esc(session.title)}" maxlength="60" required></label><div class="form-actions"><button class="btn primary" type="submit">保存标题</button></div></form>`,
      true,
    );
  }
  if (action === "select-persona") {
    selectedPersona = id;
    render();
  }
  if (action === "start-new-persona") {
    const form = document.querySelector("#start-form");
    startSelection = {
      cardId: form.dataset.id,
      personaId: form.elements.persona.value,
      opening: Number(form.elements.opening.value),
    };
    closeModal();
    go(
      `personas/new?from=${encodeURIComponent("start/" + startSelection.cardId)}&opening=${startSelection.opening}`,
    );
    return;
  }
  if (action === "new-persona")
    showModal(
      "创建演绎人格",
      '<form id="new-persona-form" class="stack"><label>故事中的姓名<input name="name" required maxlength="30" placeholder="例如：裴修远"></label><label>完整人设描述<textarea name="description" rows="5" required maxlength="3000" placeholder="写下人物的性别、年龄、身份、外貌和性格。"></textarea></label><button class="btn primary" type="submit">创建人格</button></form>',
      true,
    );
  if (action === "delete-persona")
    showModal(
      "删除这个人格？",
      `<p>已创建的演绎会保留各自的人格资料。</p><div class="dialog-actions">${button("取消", "close")}${button("确认删除人格", "confirm-delete-persona", `data-id="${id}"`, "danger")}</div>`,
      true,
    );
  if (action === "confirm-delete-persona") {
    removePersona(id);
    closeModal();
    render();
    toast("人格已删除。");
  }
  if (action === "generate") generate(mode);
  if (action === "stop") stopGeneration();
  if (action === "swipe") {
    selectReply(
      currentSession().messages.at(-1),
      Number(target.dataset.offset),
    );
    save();
    render();
  }
  if (action === "session-persona") {
    const persona = currentSession().persona;
    showModal(
      "本次演绎的人格",
      `<h2>${esc(persona.name)}</h2><div class="opening">${esc(persona.description)}</div><p class="hint">这份资料在开始本次演绎时保存。</p>`,
      true,
    );
  }
  if (action === "chat-settings") {
    const session = currentSession();
    showModal(
      "本次演绎设置",
      `<form id="chat-settings-form" class="stack"><label>演绎标题<input name="title" required maxlength="60" value="${esc(session.title)}"></label><p>角色：${cardById(session.cardId).name}<br>演绎人格：${esc(session.persona.name)}</p><p class="hint">更换角色或人格时，请从角色广场开始一段新演绎。</p><button class="btn primary" type="submit">保存设置</button></form>`,
      true,
    );
  }
  if (action === "edit-message") {
    const message = currentSession().messages[Number(index)];
    showModal(
      "编辑消息",
      `<form id="edit-message-form" data-index="${index}" class="stack"><label>消息正文<textarea name="text" rows="8" required>${esc(textOf(message))}</textarea></label><button class="btn primary" type="submit">保存消息</button></form>`,
    );
  }
  if (action === "delete-message")
    showModal(
      "从这条消息开始删除？",
      `<p>将删除这条消息及其后的全部消息。</p><div class="dialog-actions">${button("取消", "close")}${button("确认删除消息", "confirm-delete-message", `data-index="${index}"`, "danger")}</div>`,
      true,
    );
  if (action === "confirm-delete-message") {
    currentSession().messages.splice(Number(index));
    save();
    closeModal();
    render();
    toast("消息已删除。");
  }
  if (action === "branch") {
    const session = structuredClone(currentSession());
    session.id = crypto.randomUUID();
    session.title += " · 分支";
    session.messages = session.messages.slice(0, Number(index) + 1);
    session.updatedAt = Date.now();
    state.sessions.push(session);
    save();
    go(`chat/${session.id}`);
    toast("已从这条消息创建分支。");
  }
});
document.addEventListener("input", (event) => {
  if (event.composedPath()[0].id === "card-search") {
    query = event.composedPath()[0].value;
    document.querySelector("#card-results").innerHTML = renderCards();
  }
  if (event.composedPath()[0].id === "history-search") {
    historyQuery = event.composedPath()[0].value;
    document.querySelector("#history-results").innerHTML = historyRows(
      sortedSessions().filter((session) =>
        `${session.title} ${cardById(session.cardId).name} ${session.persona.name}`.includes(
          historyQuery.trim(),
        ),
      ),
    );
  }
});
document.addEventListener("change", (event) => {
  const target = event.composedPath()[0];
  if (target.id === "opening-select")
    document.querySelector("#opening-preview").textContent = cardById(
      target.dataset.card,
    ).openings[Number(target.value)];
  if (target.dataset.select) {
    if (target.checked) selectedHistory.add(target.dataset.select);
    else selectedHistory.delete(target.dataset.select);
    render();
  }
  if (target.id === "select-all") {
    document.querySelectorAll("[data-select]").forEach((input) => {
      if (target.checked) selectedHistory.add(input.dataset.select);
      else selectedHistory.delete(input.dataset.select);
    });
    render();
  }
});
document.addEventListener("keydown", (event) => {
  if (window.prototypePlatform || event.defaultPrevented) return;
  if (
    event.composedPath()[0].name === "message" &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    event.composedPath()[0].form.requestSubmit();
  }
});
function handleSubmit(event) {
  event.preventDefault();
  const form = event.composedPath()[0],
    data = new FormData(form);
  const field = (name) => String(data.get(name) || "").trim();
  if (form.id === "auth-form") {
    if (
      authMode === "register" &&
      data.get("password") !== data.get("confirmation")
    ) {
      document.querySelector("#auth-error").textContent =
        "两次输入的密码不一致，请重新输入确认密码。";
      return;
    }
    finishAuth({
      name: field("name") || config.demoAccount.name,
      email: field("email"),
    });
  }
  if (form.id === "start-form") {
    const cardId = form.dataset.id,
      personaId = field("persona"),
      opening = Number(field("opening"));
    if (!state.account) {
      requireAccount(() => showDetail(cardId, personaId, opening));
      return;
    }
    const persona = state.personas.find((item) => item.id === personaId);
    if (!persona) return;
    const session = createSession(cardById(cardId), persona, opening);
    state.sessions.push(session);
    save();
    closeModal();
    go(`chat/${session.id}`);
  }
  if (form.id === "persona-form" || form.id === "new-persona-form") {
    if (!field("name") || !field("description")) {
      toast("请填写姓名和完整人设描述。");
      return;
    }
    const id = savePersona(
      { name: field("name"), description: field("description") },
      form.dataset.id,
    );
    if (data.has("default")) {
      state.defaultPersona = id;
      save();
    }
    closeModal();
    render();
    toast("人格资料已保存。");
  }
  if (form.id === "account-form") {
    if (!field("name")) return toast("请填写昵称。");
    state.account.name = field("name");
    save();
    render();
    toast("账号资料已保存。");
  }
  if (form.id === "rename-form") {
    if (!field("title")) return toast("请填写演绎标题。");
    state.sessions.find((session) => session.id === form.dataset.id).title =
      field("title");
    save();
    closeModal();
    render();
  }
  if (form.id === "chat-settings-form") {
    if (!field("title")) return toast("请填写演绎标题。");
    currentSession().title = field("title");
    save();
    closeModal();
    render();
    toast("演绎设置已保存。");
  }
  if (form.id === "edit-message-form") {
    if (!field("text")) return toast("请填写消息正文。");
    const message = currentSession().messages[Number(form.dataset.index)];
    message.variants[message.selected] = field("text");
    save();
    closeModal();
    render();
    toast("消息已保存。");
  }
  if (form.id === "message-form") {
    if (busy || !field("message")) return;
    currentSession().messages.push({
      id: crypto.randomUUID(),
      role: "user",
      variants: [field("message")],
      selected: 0,
    });
    save();
    generate("reply");
  }
}
document.addEventListener("submit", handleSubmit);
save();
render();
