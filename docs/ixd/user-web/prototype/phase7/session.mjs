import { config } from "../data.mjs";
import { roleDelivery } from "../role-frontends.mjs";
import { createScriptRuntime, runtimePolicy } from "../runtime.bundle.js";
import { escape as esc } from "./components.mjs";
import { reviewScope, registerReviewScope } from "./review.mjs";
import { createSessionOverlay } from "./session-overlay.mjs";
import fields from "./session-fields.json" with { type: "json" };
export const sessionScenarios = {
  label: "第 5 批：演绎与会话弹层",
  scenarios: [
    ["normal", "正常"],
    ["slow", "慢速读取"],
    ["failure", "会话读取失败"],
    ["runtime-failure", "角色页面加载失败"],
    ["earlier-failure", "更早消息读取失败"],
    ["write-failure", "提交失败"],
    ["unknown", "保存结果待确认"],
    ["check-failure", "结果读取失败"],
    ["snapshot-failure", "人设资料读取失败"],
    ["settings-failure", "设置读取失败"],
    ["offline", "离线"],
    ["missing", "会话不存在"],
    ["forbidden", "无访问权限"],
  ],
};
const button = (label, action, extra = "") =>
  `<button type="button" class="uw-button" data-session="${action}" ${extra}>${label}</button>`;
const textOf = (m) => m.variants[m.selected];
export function inaccessible(root, kind = "page", denied = false) {
  const label = {
    page: "这个页面",
    session: "这段演绎",
    persona: "这个人格",
    role: "这个角色",
  }[kind];
  const target = {
    page: "discover",
    role: "discover",
    session: "history",
    persona: "personas",
  }[kind];
  const back = {
    discover: "角色广场",
    history: "历史演绎",
    personas: "人格列表",
  }[target];
  root.innerHTML = `<main class="uw-result" data-page-id="P22"><h1 tabindex="-1">页面无法访问</h1><p>${denied ? "当前账号无法访问此内容。" : kind === "page" ? "没有找到这个页面。" : `${label}已不存在或当前账号无法访问。`}</p><a class="uw-button" href="#${target}">返回${back}</a></main>`;
  root.querySelector("h1").focus();
}
export function createSessionPage({
  root,
  platform,
  profile,
  refresh,
  save,
  navigate,
  beforeMount,
}) {
  registerReviewScope("session", sessionScenarios);
  let id = "",
    owner = "",
    current = "",
    runtime = null,
    chat = null,
    scenario = "normal",
    ticket = 0,
    loaded = 20,
    menu = null,
    editor = null,
    draft = "",
    notice = "",
    follow = true,
    anchor = 0,
    allowLeave = false,
    mode = "";
  let titleDraft = null,
    titleBase = null,
    overlayOrigin = "",
    pending = null,
    timer = null,
    failedRuntime = false;
  const watchers = new Set(),
    overlay = createSessionOverlay(root);
  const session = () => profile().sessions.find((s) => s.id === id);
  const key = () =>
    `tavern-phase7-chat:${owner}:${id}:${session()?.activeBranch || "main"}`;
  const titleKey = () => `tavern-phase7-title:${owner}:${id}`;
  const offline = () => scenario === "offline" || !navigator.onLine;
  const blocked = () =>
    !!pending ||
    !!session()?.pendingOperation ||
    !!session()?.run ||
    offline() ||
    failedRuntime;
  const card = () => config.cards.find((c) => c.id === session()?.cardId);
  function stash() {
    if (!id) return;
    try {
      sessionStorage.setItem(
        key(),
        JSON.stringify({ draft, editor, anchor, loaded }),
      );
      if (titleDraft !== null)
        sessionStorage.setItem(
          titleKey(),
          JSON.stringify({ value: titleDraft, base: titleBase }),
        );
    } catch {
      notice = "浏览器未能保存草稿，请保持页面打开。";
    }
  }
  function restore() {
    draft = "";
    editor = null;
    anchor = 0;
    loaded = 20;
    try {
      const d = JSON.parse(sessionStorage.getItem(key()));
      if (d) {
        ({ draft, editor, anchor, loaded } = d);
        if (draft) notice = "已恢复未发送内容";
      }
      const t = JSON.parse(sessionStorage.getItem(titleKey()));
      titleDraft = t?.value ?? null;
      titleBase = t?.base ?? null;
    } catch {}
  }
  function commit() {
    const s = session();
    if (!s) return;
    if (s.branches)
      s.branches.find((b) => b.id === s.activeBranch).messages = s.messages;
    s.updatedAt = Date.now();
    save();
    watchers.forEach((w) => w());
  }
  function persistTitle() {
    stash();
  }
  function deactivate() {
    stash();
    ticket++;
    runtime?.destroy();
    runtime = null;
    chat = null;
    overlay.close();
    if (timer) {
      clearInterval(timer);
      timer = null;
      const s = session();
      if (s?.run) {
        s.run.status = "needs-check";
        save();
      }
    }
    pending = null;
    current = "";
    id = "";
  }
  function render(route) {
    if (!route.startsWith("chat/")) {
      if (current) deactivate();
      return false;
    }
    if (!profile().account) return false;
    if (current === route && owner === profile().id) return true;
    if (current) deactivate();
    current = route;
    id = route.split("/")[1];
    owner = profile().id;
    notice = "";
    beforeMount();
    scenario = reviewScope("session");
    if (!session()) {
      inaccessible(root, "session");
      return true;
    }
    restore();
    void mount();
    return true;
  }
  async function mount() {
    const n = ++ticket;
    runtime?.destroy();
    runtime = null;
    chat = null;
    failedRuntime = false;
    overlay.close();
    root.innerHTML = `<main class="uw-session ${platform === "mobile" ? "uw-mobile-session" : ""}" data-page-id="${platform === "mobile" ? "P18" : "P17"}"><header class="uw-session-bar"><a class="uw-button" href="#history">返回历史</a><div class="uw-session-title"><h1></h1><p></p></div>${button("查看完整人设", "snapshot")}${button("演绎设置", "settings")}</header><div class="uw-session-status" role="status"></div><div class="uw-runtime" id="role-runtime-host" data-boundaries="${document.querySelector("#review-boundaries")?.getAttribute("aria-pressed") === "true" ? "on" : "off"}"><p>正在读取演绎…</p></div></main>`;
    header();
    await new Promise((r) => setTimeout(r, scenario === "slow" ? 1000 : 70));
    if (n !== ticket || !current) return;
    if (scenario === "missing" || scenario === "forbidden") {
      inaccessible(root, "session", scenario === "forbidden");
      return;
    }
    const hostRoot = root.querySelector("#role-runtime-host");
    if (scenario === "failure") {
      hostRoot.innerHTML = `<div class="uw-runtime-fallback"><h2>演绎读取失败</h2><p>请重新读取这段演绎。</p>${button("重新读取演绎", "reload")}</div>`;
      return;
    }
    if (scenario === "runtime-failure") {
      failedRuntime = true;
      fallback();
      return;
    }
    hostRoot.innerHTML = "<p>正在打开角色页面…</p>";
    const host = {
      report() {
        failedRuntime = true;
        fallback();
      },
      get() {
        return {
          snapshotId: String(session()?.messages.length),
          values: { messageCount: session()?.messages.length || 0 },
        };
      },
      watch(scope, callback) {
        const w = () => callback(this.get());
        watchers.add(w);
        w();
        return () => watchers.delete(w);
      },
      setDraft(text) {
        draft = text;
        stash();
        if (chat) {
          chat.querySelector("[name=message]").value = text;
          chat.querySelector("[name=message]").focus();
          updateSend();
        }
        return null;
      },
      mountChat(container) {
        const w = document.createElement("div");
        w.style.cssText = "height:100%;min-height:0";
        w.dataset.boundaries =
          document
            .querySelector("#review-boundaries")
            ?.getAttribute("aria-pressed") === "true"
            ? "on"
            : "off";
        container.append(w);
        chat = w.attachShadow({ mode: "open" });
        chat.addEventListener("click", chatClick);
        chat.addEventListener("input", chatInput);
        chat.addEventListener("keydown", chatKey);
        chat.addEventListener("submit", (e) => {
          e.preventDefault();
          send();
        });
        drawChat();
        return {
          destroy() {
            w.remove();
            chat = null;
          },
        };
      },
    };
    const instance = createScriptRuntime({
      root: hostRoot,
      delivery: roleDelivery(card()),
      host,
      policy: runtimePolicy,
    });
    runtime = instance;
    try {
      await instance.mount();
      if (n !== ticket) {
        instance.destroy();
        return;
      }
      hostRoot.dataset.ready = "true";
      header();
      if (session().run) notice = "保存结果待确认，请核对当前演绎。";
      update();
    } catch {
      if (n === ticket) {
        failedRuntime = true;
        instance.destroy();
        runtime = null;
        fallback();
      }
    }
  }
  function fallback() {
    const host = root.querySelector("#role-runtime-host");
    host.innerHTML = `<section class="uw-runtime-fallback"><h2>角色页面加载失败</h2>${button("重新加载角色页面", "reload")}<p>已读取的对话</p>${session()
      .messages.map(
        (m) =>
          `<article><strong>${esc(m.role === "user" ? session().persona.name : card().name)}</strong><p>${esc(textOf(m))}</p></article>`,
      )
      .join("")}</section>`;
    header();
  }
  function header() {
    const s = session();
    if (!s) return;
    const h = root.querySelector(".uw-session-title");
    if (!h) return;
    h.querySelector("h1").textContent = s.title;
    h.querySelector("p").textContent =
      `${card().name} · 你是${s.persona.name}${s.activeBranch ? " · " + (s.branches.find((b) => b.id === s.activeBranch)?.name || "主分支") : ""}`;
    const status = root.querySelector(".uw-session-status");
    const waiting = s.run || s.pendingOperation;
    status.innerHTML = `<span>${esc(pending ? "正在生成…" : waiting ? "保存结果待确认" : offline() ? "当前离线，已读取的正文可继续阅读。" : notice || "已保存")}</span>${pending ? button("停止生成", "stop") : waiting ? button("核对演绎结果", "verify") : ""}`;
  }
  function messageHTML(m, index) {
    const s = session(),
      last = index === s.messages.length - 1,
      disabled = blocked() || !!editor;
    const controls = `<button data-chat="menu" data-id="${m.id}" aria-expanded="${menu === m.id}" ${editor ? "disabled" : ""}>消息操作<span class="sr-only"></span></button>${m.variants.length > 1 ? `<button data-chat="candidate" data-id="${m.id}" data-offset="-1" aria-label="上一条回复" ${disabled || m.selected === 0 ? "disabled" : ""}>上一条</button><span>${m.selected + 1} / ${m.variants.length}</span><button data-chat="candidate" data-id="${m.id}" data-offset="1" aria-label="下一条回复" ${disabled || m.selected === m.variants.length - 1 ? "disabled" : ""}>下一条</button>` : ""}`;
    const actions =
      menu === m.id
        ? `<div class="chat-menu" role="menu" aria-label="消息操作"><button role="menuitem" data-chat="edit" data-id="${m.id}" ${disabled ? "disabled" : ""}>编辑消息</button><button role="menuitem" data-chat="delete" data-id="${m.id}" ${disabled ? "disabled" : ""}>删除消息</button><button role="menuitem" data-chat="branch" data-id="${m.id}" ${disabled ? "disabled" : ""}>从此处建立分支</button>${last && m.role === "assistant" ? `<button role="menuitem" data-chat="regenerate" ${disabled ? "disabled" : ""}>重新生成</button><button role="menuitem" data-chat="continue" ${disabled ? "disabled" : ""}>续写</button>` : ""}${disabled ? "<p>请先完成当前编辑或核对演绎结果。</p>" : ""}</div>`
        : "";
    const edit =
      editor?.id === m.id
        ? `<div><label for="message-edit">编辑消息正文</label><textarea id="message-edit" name="edit">${esc(editor.text)}</textarea>${editor.base !== textOf(m) ? `<p>消息正文已变化，当前已保存内容：</p><p>${esc(textOf(m))}</p><button data-chat="accept-base">继续编辑草稿</button><button data-chat="use-saved">使用已保存正文</button>` : ""}<p role="alert" id="message-edit-feedback"></p><div class="editor-actions"><button data-chat="save-edit" ${blocked() || editor.base !== textOf(m) ? "disabled" : ""}>保存消息</button><button data-chat="cancel-edit">取消编辑</button></div></div>`
        : `<div class="message-text">${esc(textOf(m))}</div>`;
    return `<article class="message ${m.role}" data-message-id="${m.id}" tabindex="-1"><header><strong>${esc(m.role === "user" ? s.persona.name : card().name)}</strong><small>${index === 0 ? "开场" : m.role === "user" ? "你" : "角色"}</small></header>${edit}<div class="message-tools">${controls}</div>${actions}</article>`;
  }
  function drawChat() {
    if (!chat || !session()) return;
    const s = session();
    chat.innerHTML = `<link rel="stylesheet" href="${new URL("./session-chat.css", import.meta.url).href}"><section class="chat-main" data-owner="system-chat"><div class="chat-ownership">宿主 · 消息记录与输入操作</div><div class="messages" id="messages">${s.messages.length > loaded ? '<button data-chat="earlier">加载更早消息</button>' : ""}<div id="earlier-feedback" role="status"></div>${
      s.messages.length
        ? s.messages
            .slice(-loaded)
            .map((m, i) =>
              messageHTML(
                m,
                s.messages.length - Math.min(loaded, s.messages.length) + i,
              ),
            )
            .join("")
        : '<p class="chat-empty">当前没有对话记录</p>'
    }</div><button class="latest" data-chat="latest" ${follow ? "hidden" : ""}>回到最新</button><form class="composer" id="session-message-form"><label for="session-message">演绎输入 · ${esc(s.persona.name)}</label><textarea id="session-message" name="message" rows="2" aria-label="演绎输入 · ${esc(s.persona.name)}" placeholder="写下你的动作或台词……">${esc(draft)}</textarea><div class="composer-actions"><small>${platform === "mobile" ? "Enter 换行 · Ctrl / ⌘ + Enter 发送" : "Enter 发送 · Shift + Enter 换行"}</small><button type="submit" class="primary" ${blocked() || editor || !draft.trim() ? "disabled" : ""}>发送</button></div><p class="chat-feedback">回复为示例文本 · 历史保存在当前浏览器</p></form></section>`;
    const list = chat.querySelector(".messages");
    list.scrollTop = follow ? list.scrollHeight : anchor;
    list.addEventListener("scroll", () => {
      if (!chat || !list.isConnected) return;
      anchor = list.scrollTop;
      follow = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      chat.querySelector(".latest").hidden = follow;
      stash();
    });
  }
  function update() {
    header();
    if (!chat) return;
    const list = chat.querySelector(".messages"),
      input = chat.querySelector("[name=message]");
    const focused = chat.activeElement;
    const wasInput = focused === input,
      wasEdit = focused?.name === "edit",
      selection =
        focused && "selectionStart" in focused
          ? [focused.selectionStart, focused.selectionEnd]
          : null;
    anchor = list?.scrollTop || 0;
    drawChat();
    if (wasInput || wasEdit) {
      const el = chat.querySelector(
        wasInput ? "[name=message]" : "[name=edit]",
      );
      el?.focus({ preventScroll: true });
      if (el && selection) el.setSelectionRange(...selection);
    }
  }
  function updateSend() {
    const b = chat?.querySelector("button[type=submit]");
    if (b) b.disabled = blocked() || !!editor || !draft.trim();
  }
  function chatInput(e) {
    if (e.target.name === "message") {
      draft = e.target.value;
      updateSend();
    }
    if (e.target.name === "edit") editor.text = e.target.value;
    stash();
  }
  function chatKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (
      e.target.name === "message" &&
      e.key === "Enter" &&
      ((platform === "desktop" && !e.shiftKey) ||
        (platform === "mobile" && (e.ctrlKey || e.metaKey)))
    ) {
      e.preventDefault();
      send();
    }
    if (e.target.name === "edit") {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    }
    if (e.target.closest("[role=menu]")) {
      const items = [
        ...e.target.parentElement.querySelectorAll("button:not(:disabled)"),
      ];
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        items[
          (items.indexOf(e.target) +
            (e.key === "ArrowDown" ? 1 : items.length - 1)) %
            items.length
        ]?.focus();
      }
      if (e.key === "Escape") {
        menu = null;
        update();
        chat
          .querySelector(`[data-chat=menu][data-id="${e.target.dataset.id}"]`)
          ?.focus();
      }
    }
  }
  function authorize() {
    refresh();
    if (profile().id !== owner || !session()) {
      deactivate();
      navigate("history");
      return false;
    }
    return true;
  }
  function writeAllowed() {
    if (blocked()) return false;
    if (!authorize() || blocked()) return false;
    if (scenario === "write-failure") {
      notice = "本次提交失败，内容已保留，请重试。";
      header();
      return false;
    }
    return true;
  }
  function send() {
    if (!draft.trim() || editor || !writeAllowed()) return;
    const s = session();
    s.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      variants: [draft.trim()],
      selected: 0,
    });
    draft = "";
    stash();
    commit();
    run("reply");
  }
  function run(kind) {
    if (blocked() || editor || !session()) return;
    const s = session();
    let m = s.messages.at(-1);
    if (kind !== "reply" && m?.role !== "assistant") return;
    if (kind === "reply") {
      m = {
        id: crypto.randomUUID(),
        role: "assistant",
        variants: [""],
        selected: 0,
      };
      s.messages.push(m);
    } else if (kind === "regenerate") {
      m.variants.push("");
      m.selected = m.variants.length - 1;
    }
    const output =
      kind === "continue"
        ? card().continuation
        : card().replies[(m.variants.length - 1) % card().replies.length];
    s.run = { id: crypto.randomUUID(), messageId: m.id, status: "running" };
    pending = s.run;
    mode = kind;
    let offset = 0;
    commit();
    update();
    timer = setInterval(() => {
      const currentSession = session();
      if (!currentSession || profile().id !== owner) {
        clearInterval(timer);
        timer = null;
        pending = null;
        return;
      }
      const msg = currentSession.messages.find(
        (x) => x.id === pending?.messageId,
      );
      if (!msg) {
        stop();
        return;
      }
      msg.variants[msg.selected] += output.slice(offset, offset + 6);
      offset += 6;
      commit();
      update();
      if (offset >= output.length) finish();
    }, 65);
  }
  function finish() {
    clearInterval(timer);
    timer = null;
    pending = null;
    const s = session();
    if (!s) return;
    if (["unknown", "check-failure"].includes(scenario)) {
      s.run.status = "needs-check";
      notice = "保存结果待确认";
    } else {
      delete s.run;
      notice = "已保存";
    }
    commit();
    update();
  }
  function stop() {
    if (!pending) return;
    notice = "正在停止…";
    header();
    finish();
  }
  function verify() {
    if (offline() || scenario === "check-failure") {
      notice = "结果读取失败，请连接网络后重试核对。";
      header();
      return;
    }
    if (!authorize()) return;
    const s = session();
    delete s.run;
    delete s.pendingOperation;
    pending = null;
    notice = "已保存";
    commit();
    update();
  }
  function writeOperation(kind, apply) {
    if (!writeAllowed()) return false;
    apply();
    const s = session();
    if (["unknown", "check-failure"].includes(scenario))
      s.pendingOperation = { kind, id: crypto.randomUUID() };
    notice = s.pendingOperation ? "保存结果待确认" : "已保存";
    commit();
    update();
    return true;
  }
  function saveEdit() {
    if (!authorize()) return;
    if (!editor?.text.trim()) {
      chat.querySelector("#message-edit-feedback").textContent =
        "请填写消息正文。";
      return;
    }
    const m = session().messages.find((m) => m.id === editor.id);
    if (!m) {
      editor = null;
      notice = "这条消息已不存在。";
      update();
      return;
    }
    if (editor.base !== textOf(m)) {
      update();
      return;
    }
    const value = editor.text.trim();
    if (
      writeOperation("edit", () => {
        const target = session().messages.find((item) => item.id === m.id);
        target.variants[target.selected] = value;
        editor = null;
        stash();
      })
    )
      menu = null;
  }
  function cancelEdit() {
    if (editor && editor.text !== editor.base) {
      overlay.open({
        title: "放弃本次消息编辑？",
        content: "<p>已保存的消息会保留。</p>",
        actions: [
          { label: "继续编辑", run: () => overlay.close() },
          {
            label: "放弃修改",
            run: () => {
              editor = null;
              stash();
              overlay.close();
              update();
            },
          },
        ],
      });
    } else {
      editor = null;
      stash();
      update();
    }
  }
  function chatClick(e) {
    const b = e.target.closest("[data-chat]");
    if (!b) return;
    const a = b.dataset.chat,
      mid = b.dataset.id,
      m = session()?.messages.find((x) => x.id === mid);
    if (a === "menu") {
      menu = menu === mid ? null : mid;
      update();
      chat.querySelector("[role=menu] button")?.focus();
    }
    if (a === "edit" && m && !blocked()) {
      editor = { id: mid, base: textOf(m), text: textOf(m) };
      menu = null;
      stash();
      update();
      chat.querySelector("[name=edit]").focus();
    }
    if (a === "save-edit") saveEdit();
    if (a === "cancel-edit") cancelEdit();
    if (a === "use-saved" || a === "accept-base") {
      const saved = session().messages.find((x) => x.id === editor.id);
      editor.base = textOf(saved);
      if (a === "use-saved") editor.text = editor.base;
      stash();
      update();
    }
    if (a === "candidate" && m)
      writeOperation("candidate", () => {
        const target = session().messages.find((item) => item.id === m.id);
        target.selected += Number(b.dataset.offset);
      });
    if (a === "regenerate" || a === "continue") {
      menu = null;
      if (writeAllowed()) run(a);
    }
    if (a === "delete" && m) {
      overlay.open({
        title: "删除消息？",
        pageId: "P21",
        content: `<p>${esc(m.role === "user" ? session().persona.name : card().name)} · 第 ${session().messages.indexOf(m) + 1} 条消息</p><p>${esc(textOf(m))}</p><p>删除这条消息后无法撤销。</p>`,
        actions: [
          { label: "取消", run: () => overlay.close() },
          {
            label: "删除消息",
            danger: true,
            run: () => {
              if (
                writeOperation("delete-message", () => {
                  session().messages = session().messages.filter(
                    (x) => x.id !== mid,
                  );
                  menu = null;
                })
              ) {
                overlay.close();
                chat?.querySelector(".message:last-of-type")?.focus();
              }
            },
          },
        ],
      });
    }
    if (a === "branch" && m)
      overlay.open({
        title: "从此处建立分支？",
        content: `<p>将从第 ${session().messages.indexOf(m) + 1} 条消息所在位置继续，原分支会保留。</p>`,
        actions: [
          { label: "取消", run: () => overlay.close() },
          {
            label: "建立分支",
            run: () => {
              writeOperation("branch", () => {
                const s = session();
                s.branches ??= [
                  { id: "main", name: "主分支", messages: s.messages },
                ];
                stash();
                s.branches.find(
                  (b) => b.id === (s.activeBranch || "main"),
                ).messages = s.messages;
                const branch = {
                  id: crypto.randomUUID(),
                  name: `分支 ${s.branches.length}`,
                  messages: structuredClone(
                    s.messages.slice(
                      0,
                      s.messages.findIndex((item) => item.id === m.id) + 1,
                    ),
                  ),
                };
                s.branches.push(branch);
                s.activeBranch = branch.id;
                s.messages = branch.messages;
                draft = "";
                editor = null;
                menu = null;
              });
              overlay.close();
            },
          },
        ],
      });
    if (a === "earlier") {
      if (scenario === "earlier-failure") {
        chat.querySelector("#earlier-feedback").innerHTML =
          '更早消息读取失败。<button data-chat="retry-earlier">重试读取更早消息</button>';
        return;
      }
      const list = chat.querySelector(".messages"),
        height = list.scrollHeight,
        top = list.scrollTop;
      loaded += 20;
      follow = false;
      drawChat();
      const next = chat.querySelector(".messages");
      next.scrollTop = top + next.scrollHeight - height;
      stash();
    }
    if (a === "retry-earlier") {
      scenario = "normal";
      b.dataset.chat = "earlier";
      chatClick(e);
    }
    if (a === "latest") {
      follow = true;
      const list = chat.querySelector(".messages");
      list.scrollTop = list.scrollHeight;
    }
  }
  function snapshot(from = "session") {
    overlayOrigin = from;
    const p = session().persona;
    overlay.open({
      title: "本次演绎人设",
      pageId: "P20",
      content:
        scenario === "snapshot-failure"
          ? '<p role="alert">人设资料读取失败</p>'
          : `<h3>${esc(p?.name || "此会话未保存人格姓名")}</h3><p>${esc(p?.description || "此会话未保存人设描述")}</p>`,
      actions: [
        ...(scenario === "snapshot-failure"
          ? [
              {
                label: "重试读取人设",
                run: () => {
                  scenario = "normal";
                  snapshot(from);
                },
              },
            ]
          : []),
        {
          label: "关闭",
          run: () => (from === "settings" ? settings() : overlay.close()),
        },
      ],
      onDismiss: () => (from === "settings" ? settings() : overlay.close()),
    });
  }
  function closeSettings() {
    if (titleDraft !== null && titleDraft !== titleBase) {
      overlay.open({
        title: "保留标题修改？",
        content: "",
        actions: [
          { label: "继续编辑", run: settings },
          {
            label: "保留草稿并关闭",
            run: () => {
              persistTitle();
              overlay.close();
            },
          },
          {
            label: "放弃修改",
            run: () => {
              titleDraft = null;
              titleBase = null;
              sessionStorage.removeItem(titleKey());
              overlay.close();
            },
          },
        ],
      });
    } else overlay.close();
  }
  function settings() {
    const s = session();
    if (titleDraft === null) {
      titleDraft = s.title;
      titleBase = s.title;
    }
    const conflict = titleBase !== s.title;
    const fail = scenario === "settings-failure";
    overlay.open({
      title: "演绎设置",
      pageId: "P19",
      content: fail
        ? '<p role="alert">演绎设置读取失败，请重新读取。</p>'
        : `<p>角色：${esc(card().name)}</p><p>本次人格：${esc(s.persona.name)}</p>${button("查看完整人设", "settings-snapshot")}<label for="session-title-field">${fields.title.label}</label><input id="session-title-field" maxlength="${fields.title.maxLength}" value="${esc(titleDraft)}"><p id="title-feedback" role="alert">${conflict ? `标题已变化，当前已保存：${esc(s.title)}` : ""}</p>${conflict ? button("继续编辑标题草稿", "title-keep") + button("使用已保存标题", "title-saved") : ""}${s.branches ? `<label for="session-branch">当前分支</label><select id="session-branch">${s.branches.map((b) => `<option value="${b.id}" ${b.id === s.activeBranch ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : ""}`,
      actions: [
        { label: "取消", run: closeSettings },
        ...(fail
          ? [
              {
                label: "重新读取设置",
                run: () => {
                  scenario = "normal";
                  settings();
                },
              },
            ]
          : [
              {
                label: "保存标题",
                disabled: conflict || titleDraft === s.title || blocked(),
                run: saveTitle,
              },
            ]),
      ],
      onDismiss: closeSettings,
    });
    const input = overlay.element.querySelector("input");
    input?.addEventListener("input", () => {
      titleDraft = input.value;
      persistTitle();
      overlay.element.querySelectorAll("[data-session-choice]")[1].disabled =
        titleDraft === s.title || blocked() || conflict;
    });
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        saveTitle();
      }
    });
    overlay.element
      .querySelector("#session-branch")
      ?.addEventListener("change", (e) => {
        const branch = s.branches.find((b) => b.id === e.target.value);
        if (blocked() || editor || draft) {
          e.target.value = s.activeBranch;
          notice = editor
            ? "请先保存或放弃消息编辑。"
            : draft
              ? "请先发送或清空输入框中的内容。"
              : "请先核对演绎结果。";
          header();
          return;
        }
        stash();
        s.branches.find((b) => b.id === s.activeBranch).messages = s.messages;
        s.activeBranch = branch.id;
        s.messages = branch.messages;
        save();
        restore();
        overlay.close();
        update();
      });
  }
  function saveTitle() {
    if (!authorize()) return;
    if (!titleDraft?.trim()) {
      overlay.element.querySelector("#title-feedback").textContent =
        "请填写演绎标题。";
      return;
    }
    if (titleBase !== session().title) {
      settings();
      return;
    }
    if (
      writeOperation("title", () => {
        session().title = titleDraft.trim();
        titleDraft = null;
        titleBase = null;
        sessionStorage.removeItem(titleKey());
      })
    )
      overlay.close();
    else if (overlay.element)
      overlay.element.querySelector("#title-feedback").textContent = notice;
  }
  root.addEventListener("click", (e) => {
    if (!current) return;
    const a = e.target.closest("[data-session]")?.dataset.session;
    if (a === "snapshot") snapshot();
    if (a === "settings") settings();
    if (a === "settings-snapshot") {
      persistTitle();
      snapshot("settings");
    }
    if (a === "title-keep" || a === "title-saved") {
      titleBase = session().title;
      if (a === "title-saved") titleDraft = titleBase;
      persistTitle();
      settings();
    }
    if (a === "stop") stop();
    if (a === "verify") verify();
    if (a === "reload") {
      scenario = "normal";
      document.querySelector("#review-scenario").value = "normal";
      void mount();
    }
  });
  document
    .querySelector("#review-scenario")
    ?.addEventListener("change", (e) => {
      if (!current) return;
      scenario = e.target.value;
      if (
        [
          "normal",
          "slow",
          "failure",
          "runtime-failure",
          "missing",
          "forbidden",
        ].includes(scenario)
      )
        void mount();
      else update();
    });
  document
    .querySelector("#review-boundaries")
    ?.addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
      e.currentTarget.setAttribute("aria-pressed", String(on));
      e.currentTarget.textContent = on ? "隐藏区域说明" : "显示区域说明";
      root
        .querySelector("#role-runtime-host")
        ?.setAttribute("data-boundaries", on ? "on" : "off");
      chat?.host.setAttribute("data-boundaries", on ? "on" : "off");
    });
  function guard(next, proceed) {
    if (!current || next === current) return false;
    if (allowLeave) {
      allowLeave = false;
      return false;
    }
    if (overlay.visible) {
      overlay.requestClose();
      return true;
    }
    if (pending) stop();
    if (draft || editor) {
      overlay.open({
        title: "离开当前演绎？",
        content: "<p>未发送内容和消息编辑草稿将保留在此标签页。</p>",
        actions: [
          { label: "留在此页", run: () => overlay.close() },
          {
            label: "离开并保留草稿",
            run: () => {
              stash();
              overlay.close();
              allowLeave = true;
              proceed();
            },
          },
        ],
      });
      return true;
    }
    return false;
  }
  function refreshVisible(e) {
    if (!current || (e.type === "visibilitychange" && document.hidden)) return;
    refresh();
    if (profile().id !== owner) {
      clearDrafts(owner);
      deactivate();
      navigate("history");
      return;
    }
    if (!session()) {
      runtime?.destroy();
      runtime = null;
      chat = null;
      overlay.close();
      inaccessible(root, "session");
      return;
    }
    if (pending) return;
    update();
    if (overlay.visible && overlay.element.querySelector("[data-page-id=P19]"))
      settings();
  }
  function clearDrafts(target = owner) {
    for (const k of Object.keys(sessionStorage))
      if (
        k.startsWith(`tavern-phase7-chat:${target}:`) ||
        k.startsWith(`tavern-phase7-title:${target}:`)
      )
        sessionStorage.removeItem(k);
    draft = "";
    editor = null;
    titleDraft = null;
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("online", refreshVisible);
  addEventListener("offline", () => {
    if (current) update();
  });
  addEventListener("beforeunload", (e) => {
    if (current) {
      stash();
      if (draft || editor) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
  });
  return {
    render,
    guard,
    suspend() {
      if (current) deactivate();
    },
    clearDrafts,
    isRunning(target) {
      return target === id && !!pending;
    },
  };
}
