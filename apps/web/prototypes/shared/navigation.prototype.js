// Shared in-memory handoff for the two local prototype documents.
const prototypeSurface =
  document.body.dataset.surface === "user" ? "user" : "admin";
const prototypeScriptURL = document.currentScript.src;
const prototypeURLs = {
  admin: new URL("../admin-workspace.prototype.html", prototypeScriptURL),
  user: new URL(
    "../../../user-web/prototypes/user-roleplay.prototype.html",
    prototypeScriptURL,
  ),
};
const prototypeQuery = new URLSearchParams(location.search);
const incomingPrototype = window.name.startsWith(
  '{"prototype":"role-workspace-3"',
)
  ? JSON.parse(window.name)
  : null;
if (incomingPrototype) {
  ({
    resources,
    saved,
    draft,
    releases,
    activeRelease,
    sessions,
    selected,
    nextId,
    revision,
    agentTypes,
    agentBindings,
    agentJobs,
    failNext,
  } = incomingPrototype);
  Object.assign(management, incomingPrototype.management);
}
for (const s of sessions) s.purpose ??= "preview";
if (prototypeQuery.has("session")) selected = prototypeQuery.get("session");
else if (prototypeSurface === "user") selected = null;
editor = null;
management.page = null;
management.form = null;
let userHome = prototypeSurface === "user" && !getSession();
const commonRender = render;
const chatRender = renderConversation;
const managementNavRender = renderNav;
const managementInspectorRender = renderInspector;
const sharedManagementRender = renderManagement;
renderManagement = () => {
  sharedManagementRender();
  if (prototypeSurface === "user")
    document
      .querySelectorAll('[data-r="return"]')
      .forEach((e) => (e.textContent = "返回对话"));
};
const managementBranchPanel = branchPanel;
branchPanel = (s) => {
  if (prototypeSurface === "admin") return managementBranchPanel(s);
  if (!s) return "<p>请选择一段对话。</p>";
  return `${s.branches.map((b, i) => `<div class="floor-row"><div><strong>${b.parent ? `故事分支 ${i + 1}` : "最初的故事"}</strong><p>${s.rounds.filter((f) => f.branch_id === b.id).length} 轮对话</p></div><button data-r="branch-select" data-id="${b.id}" ${s.activeBranch === b.id || s.running ? "disabled" : ""}>${s.activeBranch === b.id ? "当前分支" : "切换到此分支"}</button></div>`).join("")}${s.purpose === "preview" ? '<button data-admin-panel="branches">在管理端查看分支记录</button>' : ""}`;
};
function preservePrototype() {
  const s = getSession();
  if (prototypeSurface === "user" && s && $("messages"))
    s.chatScroll = $("messages").scrollTop;
  window.name = JSON.stringify({
    prototype: "role-workspace-3",
    resources,
    saved,
    draft,
    releases,
    activeRelease,
    sessions,
    selected,
    nextId,
    revision,
    agentTypes,
    agentBindings,
    agentJobs,
    management,
    failNext,
  });
}
function navigatePrototype(surface, options = {}) {
  preservePrototype();
  const url = new URL(prototypeURLs[surface]);
  if (selected) url.searchParams.set("session", selected);
  for (const [key, value] of Object.entries(options))
    if (value) url.searchParams.set(key, value);
  location.href = url.href;
}
window.addEventListener("pagehide", preservePrototype);
function sessionRecordPanel() {
  const s = sessionState(getSession());
  if (!s) {
    $("mainView").innerHTML =
      `<section class="trial-records"><span class="tag">角色试聊</span><h1>用保存的配置开始对话</h1><button class="primary" data-action="start">开始试聊</button></section>`;
    return;
  }
  $("mainView").innerHTML =
    `<section class="trial-records"><div class="toolbar"><div><span class="caption">${s.purpose === "preview" ? "试聊记录" : "用户对话记录"}</span><h1>${esc(s.name)}</h1></div><button data-action="rename">改名</button><button data-action="archive">${s.status === "archived" ? "恢复" : "归档"}</button><button class="danger" data-action="delete">删除</button></div><p class="small">配置修订 ${s.revision} · ${s.running ? "正在生成" : s.status === "archived" ? "已归档" : "进行中"} · ${s.rounds.length} 轮对话</p><div class="trial-entry"><h2>${s.purpose === "preview" ? "在用户 Web 端继续试聊" : "查看用户对话"}</h2><button class="primary" data-enter-chat>${s.purpose === "preview" ? "继续试聊" : "打开对话"}</button></div><div class="actions"><button data-r="session-config">调整本会话配置</button><button data-r="variables">变量</button><button data-r="memory">记忆</button><button data-r="branches">分支与历史</button></div><h2 class="records-heading">生成记录</h2>${s.rounds.length ? s.rounds.map((f) => `<div class="floor-row"><div><strong>第 ${f.no} 轮</strong><span class="tag">${esc({ committed: "已完成", failed: "生成失败", generating: "正在生成" }[f.state] || f.state)}</span><p>${esc(f.input)}</p><span class="small">${esc(f.branch_id)} · ${f.attempts.length} 次执行</span></div><button data-debug-floor="${f.id}">查看生成详情</button></div>`).join("") : `<p class="empty">暂无生成记录。</p>`}</section>`;
}
function renderUserHome() {
  const latest = sessions
    .filter((s) => s.purpose === "runtime" && s.status === "active")
    .at(-1);
  $("mainView").innerHTML =
    `<section class="role-intro"><div class="caption">港口书店</div><h1>雨夜，书店还亮着灯。</h1><p class="role-lead">林岚正在整理柜台上的信件。推开门，听她讲一段关于旧灯塔的往事。</p><div class="role-details"><span>林岚</span><span>日常 · 悬疑</span><span>从一次避雨开始</span></div>${activeRelease ? `<button class="primary" data-new-user-chat>开始新的对话</button>` : "<p>林岚暂时停止接待新的对话。已有对话可以继续。</p>"}${latest ? `<button data-user-session="${latest.id}">继续上次对话</button>` : ""}</section>`;
}
function startPublishedChat() {
  if (!activeRelease) return;
  const release = releases.find((r) => r.version === activeRelease);
  const s = sessionState({
    id: `user-chat-${nextId++}`,
    purpose: "runtime",
    name: `${getResource(release.config.character.id).name} · 新的故事`,
    revision: release.revision,
    release: release.version,
    config: clone(release.config),
    status: "active",
    messages: [
      { text: valueOf(release.config, "character").first_mes, opening: true },
    ],
    rounds: [],
    input: "",
    running: false,
    failed: false,
  });
  sessions.push(s);
  selected = s.id;
  userHome = false;
  editor = null;
  render();
}
renderNav = () => {
  if (prototypeSurface === "admin") {
    managementNavRender();
    const previews = sessions.filter((s) => s.purpose === "preview");
    $("sessionCount").textContent = `${previews.length} 条`;
    $("newTrial").textContent = previews.length ? "新建独立试聊" : "开始试聊";
    $("sessionList")
      .querySelectorAll("[data-session]")
      .forEach((e) => {
        if (
          sessions.find((s) => s.id === e.dataset.session)?.purpose !==
          "preview"
        )
          e.remove();
      });
    document.getElementById("runtimeHistory")?.remove();
    const runtime = sessions.filter((s) => s.purpose === "runtime");
    if (runtime.length)
      $("sessionList")
        .closest("section")
        .insertAdjacentHTML(
          "afterend",
          `<section class="box" id="runtimeHistory"><h2>用户对话</h2>${runtime.map((s) => `<button class="navitem ${s.id === selected ? "active" : ""}" data-session="${s.id}">${esc(s.name)}</button>`).join("")}</section>`,
        );
    return;
  }
  const active = getSession();
  const list = sessions.filter(
    (s) =>
      s.purpose === (active?.purpose === "preview" ? "preview" : "runtime"),
  );
  document.querySelector(".sidebar").innerHTML =
    `<section><button class="navitem" data-user-home>林岚 · 港口书店</button></section><section class="box"><h2>${active?.purpose === "preview" ? "管理员试聊" : "我的对话"}</h2>${active?.purpose === "preview" ? '<button class="navitem" data-return-admin>返回角色配置</button>' : `<button class="navitem" data-new-user-chat ${activeRelease ? "" : "disabled"}>开始新的对话</button>`}${list.map((s) => `<button class="navitem ${!userHome && s.id === selected ? "active" : ""}" data-user-session="${s.id}">${esc(s.name)}${s.status === "archived" ? " · 已归档" : ""}</button>`).join("") || (activeRelease ? '<p class="small">暂无对话。</p>' : '<p class="small">林岚暂时停止接待新的对话。</p>')}</section>`;
};
renderInspector = () => {
  if (prototypeSurface === "admin") managementInspectorRender();
};
function userVisibleMessages(s) {
  const inherited =
    s.branches.find((b) => b.id === s.activeBranch)?.inherited || [];
  return s.messages.filter(
    (m) =>
      !m.branchId || m.branchId === s.activeBranch || inherited.includes(m.id),
  );
}
function userMessageActions(s, m) {
  if (!m || s.running || s.status !== "active") return [];
  const visible = userVisibleMessages(s);
  if (!visible.includes(m)) return [];
  const f = s.rounds.find((f) => f.id === m.floorId);
  if (!f || f.superseded_at != null) return [];
  const latest = visible.findLast((m) => m.floorId)?.floorId === f.id;
  if (f.state === "committed") {
    if (m.role === "user") return ["message-regenerate-edit"];
    if (m.role === "assistant") return ["message-regenerate"];
  }
  if (latest && f.state === "failed" && m.role === "user")
    return ["message-edit"];
  return [];
}
function userRetryFloor(s) {
  if (!s || s.running || s.status !== "active") return null;
  const id = userVisibleMessages(s).findLast((m) => m.floorId)?.floorId;
  return s.rounds.find(
    (f) => f.id === id && f.state === "failed" && f.superseded_at == null,
  );
}
renderConversation = () => {
  if (prototypeSurface === "admin") {
    sessionRecordPanel();
    return;
  }
  if (userHome || !getSession()) {
    renderUserHome();
    return;
  }
  chatRender();
  const s = getSession();
  const latestId = userVisibleMessages(s).findLast((m) => m.floorId)?.floorId;
  document.querySelectorAll('.message [data-r^="message-"]').forEach((b) => {
    const m = s.messages.find((m) => m.id === b.dataset.id);
    if (!userMessageActions(s, m).includes(b.dataset.r)) {
      b.remove();
      return;
    }
    if (m.floorId !== latestId)
      b.textContent =
        b.dataset.r === "message-regenerate-edit"
          ? "修改输入并创建分支"
          : "从此轮创建分支";
  });
  if (!userRetryFloor(s))
    document
      .querySelectorAll('[data-action="retry"]')
      .forEach((b) => b.parentElement.remove());
  document.querySelector(".session-head").innerHTML =
    `<div class="toolbar"><div>${s.purpose === "preview" ? `<span class="tag">管理员试聊 · 草稿修订 ${s.revision}</span>` : ""}<h1>${esc(s.name)}</h1></div>${s.purpose === "preview" ? "<button data-return-admin>返回管理端</button>" : ""}<button data-action="rename">改名</button><button data-action="archive">${s.status === "archived" ? "恢复" : "归档"}</button><button class="danger" data-action="delete">删除</button></div><div class="actions"><button data-r="branches">分支与历史</button>${s.purpose === "preview" ? '<button data-admin-panel="session-config">调整本会话配置</button><button data-admin-panel="variables">变量</button><button data-admin-panel="memory">记忆</button>' : ""}</div>`;
  if (s.purpose !== "preview")
    document.querySelectorAll("[data-debug-floor]").forEach((e) => e.remove());
  document.querySelectorAll(".message > p.small").forEach((e) => e.remove());
  document.querySelectorAll(".message .row strong").forEach((e) => {
    if (e.textContent === referenceName(s.config.persona))
      e.textContent = valueOf(s.config, "persona")?.name || "访客";
  });
  $("composer").querySelector(".row .small").textContent =
    s.status === "archived"
      ? "恢复对话后可以继续发送。"
      : "Ctrl / ⌘ + Enter 发送";
  $("messages").scrollTop = s.chatScroll || 0;
};
render = () => {
  commonRender();
  if (prototypeSurface === "user") {
    document.querySelector(".topbar .row").innerHTML =
      `<span class="tag">用户 Web 端</span><button data-r="language" id="languageButton">EN</button><button class="mobile-toggle" data-r="toggle-nav">我的对话</button>`;
    document
      .querySelectorAll('[data-action="back-trial"]')
      .forEach((e) => (e.textContent = "返回对话"));
  }
  preservePrototype();
};
window.addEventListener(
  "click",
  (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    const intercept = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (prototypeSurface === "user" && d.action === "retry") {
      intercept();
      const s = getSession(),
        f = userRetryFloor(s);
      if (f) generate(s, f);
      return;
    }
    if (prototypeSurface === "user" && d.r?.startsWith("message-")) {
      const s = getSession();
      const id = d.r === "message-save" ? management.form?.id : d.id;
      const action =
        d.r === "message-save"
          ? management.form?.regenerate
            ? "message-regenerate-edit"
            : "message-edit"
          : d.r;
      if (
        !userMessageActions(
          s,
          s.messages.find((m) => m.id === id),
        ).includes(action)
      ) {
        intercept();
        return;
      }
    }
    if ("enterChat" in d) {
      intercept();
      navigatePrototype("user");
    }
    if ("returnAdmin" in d) {
      intercept();
      navigatePrototype("admin");
    }
    if (d.adminPanel) {
      intercept();
      navigatePrototype("admin", { panel: d.adminPanel });
    }
    if (prototypeSurface === "user" && d.debugFloor) {
      intercept();
      getSession().debugFloor = d.debugFloor;
      navigatePrototype("admin", { floor: d.debugFloor });
    }
    if (
      prototypeSurface === "admin" &&
      d.action === "back-trial" &&
      editor?.kind === "debug"
    ) {
      intercept();
      navigatePrototype("user", { message: getSession()?.debugFloor });
    }
    if (
      prototypeSurface === "admin" &&
      (d.action === "retry" || d.r?.startsWith("message-"))
    ) {
      intercept();
      navigatePrototype("user");
    }
    if (prototypeSurface === "user" && d.userSession) {
      intercept();
      selected = d.userSession;
      userHome = false;
      editor = null;
      render();
    }
    if (prototypeSurface === "user" && "userHome" in d) {
      intercept();
      selected = null;
      userHome = true;
      editor = null;
      render();
    }
    if (prototypeSurface === "user" && "newUserChat" in d) {
      intercept();
      startPublishedChat();
    }
  },
  true,
);
if (prototypeSurface === "user") {
  document.body.classList.add("user-surface");
  $("notice").textContent = "";
  document.querySelector(".inspector").hidden = true;
}
if (
  !incomingPrototype &&
  ["stopped", "updated"].includes(prototypeQuery.get("scenario"))
) {
  const prior = clone(previewSession);
  prior.id = "user-history-1";
  prior.purpose = "runtime";
  prior.release = 1;
  prior.name = "林岚 · 灯塔来信";
  prior.failed = false;
  prior.rounds = prior.rounds.filter((f) => f.state === "committed");
  prior.messages = prior.messages.filter((m) =>
    prior.rounds.some((f) => f.id === m.floorId),
  );
  sessions.push(prior);
  if (prototypeQuery.get("scenario") === "stopped") activeRelease = null;
  else {
    releases.push({ ...clone(releases[0]), version: 2 });
    activeRelease = 2;
  }
}
render();
if (prototypeSurface === "admin" && prototypeQuery.has("floor"))
  openDebug(prototypeQuery.get("floor"));
if (prototypeSurface === "admin" && prototypeQuery.has("panel")) {
  document
    .querySelector(`[data-r="${CSS.escape(prototypeQuery.get("panel"))}"]`)
    ?.click();
}
if (prototypeSurface === "user" && prototypeQuery.has("message")) {
  const id = prototypeQuery.get("message");
  document
    .querySelector(`[data-debug-floor="${CSS.escape(id)}"]`)
    ?.closest("article")
    ?.scrollIntoView({ block: "center" });
}
for (const s of sessions.filter((s) => s.running))
  generate(
    s,
    s.rounds.findLast((f) => f.state === "generating"),
    true,
  );
