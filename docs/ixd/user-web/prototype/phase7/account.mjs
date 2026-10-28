import { accountContent, accountButton } from "./account-page.mjs";
import { escape } from "./components.mjs";
import { mobileAccountPage } from "./mobile.mjs";
import { desktopAccountPage } from "./desktop.mjs";
import { reviewScope } from "./review.mjs";

export function createAccount({
  root,
  platform,
  profile,
  updateName,
  logout,
  refresh,
  navigate,
  beforeMount,
}) {
  let current = "",
    owner = null,
    editing = false,
    draft = "",
    pending = false,
    sequence = 0,
    scenario = "normal",
    allowLeave = false,
    overlay = null,
    returnFocus = null;
  const draftKey = () => `tavern-phase7-nickname-${owner}`;
  const feedback = (text) => {
    const node = root.querySelector("#account-feedback");
    if (node) node.textContent = text;
  };
  const offline = () => scenario === "offline" || !navigator.onLine;
  const dirty = () => editing && draft !== profile().account?.name;
  function storedDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey()) || "null");
    } catch {
      return null;
    }
  }
  function persistDraft(value) {
    try {
      if (value === null) sessionStorage.removeItem(draftKey());
      else sessionStorage.setItem(draftKey(), JSON.stringify(value));
    } catch {
      feedback("浏览器未能保存昵称草稿，请保持当前页面打开。");
    }
  }
  function closeOverlay() {
    overlay?.remove();
    overlay = null;
    root.firstElementChild?.removeAttribute("inert");
    returnFocus?.focus();
  }
  function prompt(title, content, choices) {
    if (overlay) return;
    returnFocus = document.activeElement;
    root.firstElementChild?.setAttribute("inert", "");
    overlay = document.createElement("div");
    overlay.className = "uw-account-overlay";
    overlay.innerHTML = `<section class="uw-account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><h2 id="account-dialog-title">${title}</h2>${content}<div class="uw-dialog-actions">${choices.map(([label, action]) => accountButton(label, action)).join("")}</div></section>`;
    root.append(overlay);
    overlay.querySelector("button").focus();
  }
  let leave = null;
  function guard(next, proceed) {
    if (allowLeave) {
      allowLeave = false;
      return false;
    }
    if (current !== "account" || next === "account" || !dirty()) return false;
    leave = proceed;
    prompt(
      "离开昵称编辑？",
      "<p>离开后，你可在当前标签页再次进入此账号的用户中心，恢复昵称草稿。</p>",
      [
        ["继续编辑", "stay"],
        ["离开并保留草稿", "leave"],
      ],
    );
    return true;
  }
  function draw() {
    const scroll = root.querySelector(".uw-scroll")?.scrollTop || 0;
    root.innerHTML = (
      platform === "mobile" ? mobileAccountPage : desktopAccountPage
    )(accountContent({ user: profile(), editing, draft, scenario }));
    root.querySelector(".uw-scroll").scrollTop = scroll;
    if (offline())
      feedback("当前离线。你可以查看已保存的资料，连接网络后可保存昵称。");
  }
  function offerDraft() {
    const saved = storedDraft();
    if (saved && saved.value !== profile().account.name)
      prompt(
        "恢复昵称草稿？",
        `<p>当前昵称：${escape(profile().account.name)}</p><p>草稿昵称：${escape(saved.value)}</p>`,
        [
          ["恢复草稿", "restore"],
          ["放弃草稿", "discard"],
        ],
      );
  }
  function render(route) {
    if (route !== "account") {
      current = route;
      sequence++;
      pending = false;
      editing = false;
      closeOverlay();
      return false;
    }
    const entering = current !== "account" || owner !== profile().id;
    current = route;
    owner = profile().id;
    beforeMount();
    scenario = reviewScope("account");
    if (entering) {
      editing = false;
      draft = profile().account.name;
    }
    draw();
    if (entering) {
      const saved = storedDraft();
      if (saved?.submitted && saved.value.trim() === profile().account.name) {
        persistDraft(null);
        feedback("已核对，昵称已保存。");
      } else offerDraft();
    }
    return true;
  }
  function finishSave() {
    editing = false;
    pending = false;
    persistDraft(null);
    draw();
    feedback("昵称已保存");
    root.querySelector("#account-edit").focus();
  }
  function recovery() {
    feedback("保存结果尚未确认，请先核对已保存的昵称。");
    root.querySelector("#account-recovery").innerHTML = accountButton(
      "核对保存结果",
      "verify",
    );
    root.querySelector('#nickname-form button[type="submit"]').disabled = true;
  }
  async function save() {
    if (pending) return;
    const input = root.querySelector("#account-nickname");
    draft = input.value;
    if (!draft.trim()) {
      input.setAttribute("aria-invalid", "true");
      root.querySelector("#account-nickname-error").textContent =
        "请填写昵称。";
      input.focus();
      return;
    }
    if (offline()) {
      feedback("当前离线，请连接网络后再保存昵称。");
      return;
    }
    const value = draft.trim(),
      outcome = scenario,
      ticket = ++sequence;
    pending = true;
    persistDraft({ value: draft, submitted: !["network"].includes(outcome) });
    root
      .querySelectorAll("#nickname-form input,#nickname-form button")
      .forEach((el) => (el.disabled = true));
    root.querySelector("#nickname-form").setAttribute("aria-busy", "true");
    feedback("正在保存昵称…");
    if (outcome !== "network") updateName(value);
    await new Promise((r) => setTimeout(r, outcome === "slow" ? 1500 : 180));
    if (ticket !== sequence || current !== "account") return;
    pending = false;
    root
      .querySelectorAll("#nickname-form input,#nickname-form button")
      .forEach((el) => (el.disabled = false));
    root.querySelector("#nickname-form").setAttribute("aria-busy", "false");
    if (outcome === "network") {
      feedback("昵称保存失败，请重试。");
      return;
    }
    if (["unknown", "check-failure"].includes(outcome)) {
      recovery();
      return;
    }
    finishSave();
  }
  function cancel() {
    editing = false;
    draft = profile().account.name;
    persistDraft(null);
    draw();
    root.querySelector("#account-edit")?.focus();
  }
  root.addEventListener("submit", (e) => {
    if (e.target.id === "nickname-form") {
      e.preventDefault();
      void save();
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id === "account-nickname") {
      draft = e.target.value;
      persistDraft({ value: draft });
      e.target.removeAttribute("aria-invalid");
      root.querySelector("#account-nickname-error").textContent = "";
    }
  });
  root.addEventListener("keydown", (e) => {
    if (current !== "account") return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (overlay) closeOverlay();
      else if (editing && !pending) cancel();
    }
    if (e.key === "Enter" && e.isComposing) e.preventDefault();
    if (overlay && e.key === "Tab") {
      const items = [...overlay.querySelectorAll("button")],
        first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  root.addEventListener("click", (e) => {
    const action = e.target.closest("[data-account]")?.dataset.account;
    if (!action) return;
    if (action === "edit") {
      editing = true;
      draft = profile().account.name;
      draw();
      root.querySelector("#account-nickname").focus();
    }
    if (action === "cancel") cancel();
    if (action === "restore") {
      draft = storedDraft().value;
      editing = true;
      closeOverlay();
      draw();
      root.querySelector("#account-nickname").focus();
    }
    if (action === "discard") {
      persistDraft(null);
      closeOverlay();
    }
    if (action === "stay") closeOverlay();
    if (action === "leave") {
      persistDraft({ value: draft });
      allowLeave = true;
      closeOverlay();
      leave?.();
    }
    if (action === "verify") {
      if (scenario === "check-failure" || offline())
        feedback("昵称读取失败，请检查连接后重试。");
      else if (profile().account.name === draft.trim()) finishSave();
      else {
        root.querySelector("#account-recovery").innerHTML = "";
        root.querySelector('#nickname-form button[type="submit"]').disabled =
          false;
        feedback("昵称尚未保存，请重新提交。");
      }
    }
    if (["reload-profile", "reload-counts"].includes(action)) {
      scenario = "normal";
      document.querySelector("#review-scenario").value = "normal";
      draw();
      feedback(
        action === "reload-counts"
          ? "资源数量已重新读取。"
          : "账号资料已重新读取。",
      );
    }
    if (action === "logout") {
      const unknown = scenario === "logout-unknown";
      persistDraft(null);
      editing = false;
      sequence++;
      logout();
      navigate("discover");
      if (unknown) {
        const banner = document.createElement("div");
        banner.className = "uw-logout-notice";
        banner.setAttribute("role", "status");
        banner.innerHTML =
          "<p>此浏览器已退出登录，服务端退出结果仍待确认。</p>" +
          accountButton("核对退出结果", "verify-logout");
        root.querySelector("main").prepend(banner);
      }
    }
    if (action === "verify-logout") {
      e.target.closest(".uw-logout-notice").textContent =
        "已确认当前模拟账号退出。";
    }
  });
  document.querySelector("#review-scenario").addEventListener("change", (e) => {
    if (current !== "account") return;
    scenario = e.target.value;
    if (scenario === "expired") {
      persistDraft(editing ? { value: draft } : null);
      editing = false;
      logout();
      navigate("account");
      return;
    }
    if (
      [
        "profile-loading",
        "profile-failure",
        "counts-loading",
        "counts-failure",
        "normal",
      ].includes(scenario) &&
      !editing
    )
      draw();
    else feedback(offline() ? "当前离线，请连接网络后再保存昵称。" : "");
  });
  function refreshVisible(event) {
    if (
      current !== "account" ||
      (event?.type === "visibilitychange" &&
        document.visibilityState === "hidden")
    )
      return;
    const previous = owner,
      previousName = profile().account?.name;
    refresh();
    if (!profile().account || previous !== profile().id) {
      editing = false;
      closeOverlay();
      navigate("account");
      return;
    }
    if (!editing) draw();
    else if (previousName !== profile().account.name) {
      closeOverlay();
      draw();
      offerDraft();
    }
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  addEventListener("offline", () => {
    if (current === "account") feedback("当前离线，请连接网络后再保存昵称。");
  });
  addEventListener("online", () => {
    if (current === "account") feedback("网络已恢复，可以继续保存。");
  });
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", () =>
    root
      .querySelector(".uw-account")
      ?.classList.toggle(
        "uw-keyboard-open",
        viewport.height < window.innerHeight * 0.75,
      ),
  );
  return { render, guard };
}
